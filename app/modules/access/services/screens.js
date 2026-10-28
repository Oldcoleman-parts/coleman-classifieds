// Loaders and actions for the staff invitation screens. Route files stay thin and call these.
import { randomUUID } from "node:crypto";
import {
  AppError,
  centsToDollars,
  dollarsToCents,
  getSettings,
  isReleased,
  requireEmail,
  requireStaff,
  shopTimeZone,
  ValidationError,
} from "@/modules/core/index.js";
import {
  completeUpload,
  createUploadUrl,
  deletePhoto,
  listPhotos,
  MediaNotConfiguredError,
} from "@/modules/media/index.js";
import {
  createInvitation,
  findSellerHistory,
  getInvitationForStaff,
  revokeInvitation,
} from "./invitations.js";
import {
  getInvitationEmailStatus,
  initialEmailKey,
  resendInvitation,
  sendInvitationEmail,
} from "./invitation-email.js";

/** @param {FormData} formData @param {string} field */
function text(formData, field) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/** Turn a known error into field errors for the form; anything else is rethrown. */
function failure(error) {
  if (error instanceof ValidationError)
    return {
      ok: false,
      fieldErrors: error.fields ?? {},
      message: error.message,
    };
  if (error instanceof AppError)
    return { ok: false, fieldErrors: {}, message: error.message };
  throw error;
}

/**
 * The Create invitation screen. `?email=` adds that seller's earlier listings, and
 * `historyEmail` names the normalised email they belong to (null when none was looked up),
 * so the screen never shows rows under another email (F04-FIX-5).
 * @param {URL} url
 */
export async function loadCreateInvitationScreen(url) {
  const settings = await getSettings();
  let history = [];
  /** @type {string | null} */
  let historyEmail = null;
  const email = url.searchParams.get("email");
  if (email) {
    try {
      const normalised = requireEmail(email, "email");
      history = await findSellerHistory(normalised);
      historyEmail = normalised;
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }
  return {
    regularFee: centsToDollars(settings.baseFeeCents),
    offeredFee: centsToDollars(settings.promoFeeCents ?? settings.baseFeeCents),
    inviteExpiryDays: settings.inviteExpiryDays,
    showOfferScope: isReleased("renewals"),
    // One-time code: a double submit of the form creates one invitation and sends one email.
    formNonce: randomUUID(),
    history: history.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    historyEmail,
  };
}

/** A send outcome as the state the screens show. */
const STATE_OF_OUTCOME = {
  SENT: "SENT",
  FAILED: "NOT_SENT",
  SUPPRESSED: "NOT_DELIVERED",
  PENDING: "SENDING",
};

/**
 * What the screens say about the invitation email. DECISION (F04-FIX-3): "sent" only means
 * the mail service accepted it, and the label says so (client, 2026-10-19).
 * @param {{ state: string, at: Date | null }} email
 */
function emailView(email) {
  const at = email.at
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: shopTimeZone(),
      }).format(email.at)
    : "";
  const label = {
    SENT: `Sent (accepted by the mail service) at ${at}`,
    NOT_SENT: "Not sent: the email couldn’t be sent",
    NOT_DELIVERED:
      "Not delivered: the address bounced or is on the do-not-email list",
    SENDING: "Being sent",
  }[email.state];
  return {
    state: email.state,
    at: email.at ? email.at.toISOString() : null,
    label: label ?? "No send record (records are kept for 30 days)",
  };
}

/**
 * Create an invitation from the form and email it to the seller (F04-FIX-3). The link is in
 * this response only, as the fallback when the email failed: it is never stored.
 * @param {FormData} formData
 * @param {import("@/modules/core/types.js").ActorRef} staff
 * @param {{ admin: object, shop: string, staffFirstName?: string }} shopify
 */
export async function submitCreateInvitation(
  formData,
  staff,
  { admin, shop, staffFirstName = "" },
) {
  try {
    const fee = text(formData, "offeredFee");
    const { invitation, listing, token, duplicate } = await createInvitation(
      {
        sellerName: text(formData, "sellerName"),
        sellerEmail: text(formData, "sellerEmail"),
        sellerPhone: text(formData, "sellerPhone"),
        itemSummary: text(formData, "itemSummary"),
        feeOfferedCents: fee === "" ? null : dollarsToCents(fee, "offeredFee"),
        offerScope: text(formData, "offerScope") || undefined,
      },
      staff,
      { formNonce: text(formData, "formNonce") || undefined },
    );
    const common = {
      ok: true,
      invitationId: invitation.id,
      listingId: listing.id,
      sellerName: invitation.sellerName,
      sellerEmail: invitation.sellerEmail,
      expiresAt: invitation.expiresAt.toISOString(),
    };
    // The form was sent twice: no second email and no link (the token isn't stored).
    if (duplicate)
      return {
        ...common,
        duplicate: true,
        link: null,
        email: emailView(
          await getInvitationEmailStatus({ ...invitation, listing }),
        ),
      };
    const sent = await sendInvitationEmail(invitation, token, {
      admin,
      shop,
      staff,
      staffFirstName,
      listingId: listing.id,
      idempotencyKey: initialEmailKey(invitation.id),
      kind: "CREATE",
    });
    return {
      ...common,
      duplicate: false,
      link: sent.link,
      email: emailView({ state: STATE_OF_OUTCOME[sent.outcome], at: sent.at }),
    };
  } catch (error) {
    const result = failure(error);
    // The form calls the offered fee "offeredFee".
    if (result.fieldErrors.feeOfferedCents)
      result.fieldErrors.offeredFee = result.fieldErrors.feeOfferedCents;
    return result;
  }
}

/**
 * One invitation for staff: details, state and the staff photos. Never the link.
 * @param {string} invitationId
 */
export async function loadInvitationScreen(invitationId) {
  const invitation = await getInvitationForStaff(invitationId);
  if (!invitation) return null;
  const email = await getInvitationEmailStatus(invitation);
  let photos = null;
  if (invitation.listing) {
    try {
      photos = (await listPhotos(invitation.listing.id)).map(
        ({ id, isMain, previewUrl, approved }) => ({
          id,
          isMain,
          previewUrl,
          approved,
        }),
      );
    } catch (error) {
      // Photo storage isn't set up on this environment: the rest of the screen still works.
      if (!(error instanceof MediaNotConfiguredError)) throw error;
    }
  }
  return {
    id: invitation.id,
    sellerName: invitation.sellerName,
    sellerEmail: invitation.sellerEmail,
    sellerPhone: invitation.sellerPhone,
    itemSummary: invitation.itemSummary,
    feeRegular: centsToDollars(invitation.feeRegularCents),
    feeOffered: centsToDollars(invitation.feeOfferedCents),
    offerScope: invitation.offerScope,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    createdBy: invitation.createdBy,
    listing: invitation.listing,
    canRevoke:
      invitation.status === "OPEN" && invitation.listing?.status === "INVITED",
    email: { ...emailView(email), resendsLeft: email.resendsLeft },
    canResend: email.canResend,
    photos,
  };
}

/**
 * Actions on one invitation: revoke, resend the invitation email, and the staff photo
 * upload steps.
 * @param {string} invitationId
 * @param {FormData} formData
 * @param {import("@/modules/core/types.js").ActorRef} actor
 * @param {{ admin?: object, shop?: string, staffFirstName?: string }} [shopify] needed to resend
 */
export async function handleInvitationAction(
  invitationId,
  formData,
  actor,
  { admin, shop, staffFirstName = "" } = {},
) {
  const staff = requireStaff(actor);
  try {
    const intent = text(formData, "intent");
    if (intent === "revoke") {
      await revokeInvitation(invitationId, staff);
      return { ok: true, intent };
    }
    if (intent === "resend") {
      const { outcome, at, link } = await resendInvitation(
        invitationId,
        staff,
        { admin, shop, staffFirstName },
      );
      // The new link comes back only when the email wasn't sent: the old one no longer works.
      return {
        ok: true,
        intent,
        outcome,
        email: emailView({ state: STATE_OF_OUTCOME[outcome], at }),
        link: link ?? null,
      };
    }
    const invitation = await getInvitationForStaff(invitationId);
    const listingId = invitation?.listing?.id;
    if (!listingId)
      return { ok: false, fieldErrors: {}, message: "Invitation not found" };
    if (intent === "upload-url")
      return {
        ok: true,
        intent,
        upload: await createUploadUrl({
          listingId,
          actor: staff,
          contentType: text(formData, "contentType"),
          byteSize: text(formData, "byteSize"),
        }),
      };
    if (intent === "upload-complete") {
      await completeUpload({
        listingId,
        photoId: text(formData, "photoId"),
        actor: staff,
      });
      return { ok: true, intent };
    }
    if (intent === "delete-photo") {
      await deletePhoto(listingId, text(formData, "photoId"), staff);
      return { ok: true, intent };
    }
    return { ok: false, fieldErrors: {}, message: "Unknown action" };
  } catch (error) {
    return failure(error);
  }
}
