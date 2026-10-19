// Get my link (F04-T3): a seller who lost their links types their email address and gets a new
// private link for each open listing. Each new link replaces the old one (only the new hash is
// stored). Every accepted request gets the same reply, so the page never says whether an
// address is known. Tokens, links and the typed address are never logged.
import prisma from "@/db.server";
import {
  requireEmail,
  shopTimeZone,
  SYSTEM_ACTOR,
  writeAudit,
} from "@/modules/core/index.js";
import { send } from "@/modules/notifications/index.js";
import { clientIp, rateLimit } from "@/modules/platform/index.js";
import { sellerLink, storefrontBase } from "./links.js";
import { linkState } from "./resolve.js";
import { myLinkForm, myLinkSent, tooManyRequests } from "./seller-pages.js";
import { hashSecret, newToken } from "./tokens.js";
import { turnstileSiteKey, verifyTurnstile } from "./turnstile.js";

export const MAX_LINKS = 20;
const OPEN_STATUSES = [
  "INVITED",
  "DRAFT",
  "CHANGES_REQUESTED",
  "SUBMITTED",
  "APPROVED_AWAITING_PAYMENT",
  "LIVE",
  "PAUSED",
];
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The date the email shows next to each status (the template words it). */
const DATE_FIELD = {
  DRAFT: "draftDueBy",
  CHANGES_REQUESTED: "correctionDueBy",
  APPROVED_AWAITING_PAYMENT: "paymentDueBy",
  LIVE: "expiresAt",
};

/** @param {Date | null} date */
function formatDay(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: shopTimeZone(),
  }).format(date);
}

const formOf = async (request) => {
  try {
    return await request.formData();
  } catch {
    return new FormData();
  }
};

/**
 * GET: the form.
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleMyLinkPage(ctx, request) {
  if (
    !rateLimit(`my-link-page:ip:${clientIp(request)}`, {
      limit: 60,
      windowMs: MINUTE_MS,
    })
  )
    return tooManyRequests(ctx.liquid);
  return myLinkForm(ctx.liquid, { siteKey: turnstileSiteKey() });
}

/**
 * POST: email new links for the address's open listings.
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleMyLinkRequest(ctx, request) {
  const ip = clientIp(request);
  if (!rateLimit(`my-link:ip:${ip}`, { limit: 10, windowMs: HOUR_MS }))
    return tooManyRequests(ctx.liquid);
  const form = await formOf(request);
  // Honeypot: a person never fills this in. Answer as if it worked and do nothing.
  const trap = form.get("website");
  if (typeof trap === "string" && trap !== "") return myLinkSent(ctx.liquid);
  const again = (notice) =>
    myLinkForm(ctx.liquid, {
      siteKey: turnstileSiteKey(),
      notice,
      status: 400,
    });
  if (!(await verifyTurnstile(form.get("cf-turnstile-response"), ip)))
    return again("Please complete the security check and try again.");
  let email;
  try {
    email = requireEmail(form.get("email"), "email");
  } catch {
    return again("Please enter a valid email address.");
  }
  // DECISION: at most 3 a day per address, known or not, in memory like the other limits.
  // The key is hashed so addresses don't sit in the limiter.
  if (
    !rateLimit(`my-link:email:${hashSecret(email)}`, {
      limit: 3,
      windowMs: DAY_MS,
    })
  )
    return myLinkSent(ctx.liquid);
  await reissueSellerLinks(email, { admin: ctx.admin, shop: ctx.shop });
  return myLinkSent(ctx.liquid);
}

/**
 * Replace the links of every open listing for this address and email the new ones.
 * DECISION: the email is sent first and the new hashes are stored only once SES has it, so a
 * failed or suppressed send never leaves the seller without a working link.
 * @param {string} email normalised (lowercase, trimmed); invitation addresses are stored so
 * @param {{ admin: object, shop: string, now?: Date }} options
 * @returns {Promise<{ state: "SENT" | "NONE" | "FAILED" }>}
 */
export async function reissueSellerLinks(
  email,
  { admin, shop, now = new Date() },
) {
  const candidates = await prisma.invitation.findMany({
    where: {
      sellerEmail: email,
      status: { in: ["OPEN", "USED"] },
      listing: { status: { in: OPEN_STATUSES } },
    },
    include: { listing: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  // Exactly the links the seller page would accept (expiry and deadlines included).
  const open = candidates
    .filter((invitation) => linkState(invitation, now).state === "OK")
    .slice(0, MAX_LINKS);
  if (open.length === 0) return { state: "NONE" };

  const base = await storefrontBase(admin, shop);
  const issued = open.map((invitation) => ({ invitation, token: newToken() }));
  const listings = issued.map(({ invitation, token }) => {
    const { listing } = invitation;
    const field = DATE_FIELD[listing.status];
    return {
      title: listing.title || invitation.itemSummary,
      status: listing.status,
      date: field ? formatDay(listing[field]) : "",
      seller_link: sellerLink(base, token),
    };
  });
  let status;
  try {
    ({ status } = await send(
      "seller_link_request",
      open[0].sellerEmail,
      { seller_first_name: open[0].sellerName.split(/\s+/)[0], listings },
      { now },
    ));
  } catch (error) {
    console.error(`[access] link email failed: ${error?.name ?? "Error"}`);
    status = "FAILED";
  }
  if (status !== "SENT") return { state: "FAILED" };

  await prisma.$transaction(async (tx) => {
    for (const { invitation, token } of issued) {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { tokenHash: hashSecret(token) },
      });
      await writeAudit(
        {
          action: "SellerLinkReissued",
          actor: SYSTEM_ACTOR,
          listingId: invitation.listing.id,
          details: { invitationId: invitation.id },
        },
        { tx },
      );
    }
  });
  return { state: "SENT" };
}
