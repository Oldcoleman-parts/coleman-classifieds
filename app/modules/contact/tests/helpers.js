// Shared set-up for the contact (F07-T1) tests: a clean database, an SES stand-in that can be
// taken down, Turnstile answered by a fake, and the buyer form driven through the handlers.
import { vi } from "vitest";
import { makeListing, mockSes } from "@/../tests/factories.js";
import { prisma, resetDb } from "@/../tests/db.js";
import {
  getSettings,
  register as registerCore,
  resetEventBus,
} from "@/modules/core/index.js";
import {
  handleContactPage,
  handleContactSubmit,
  setTurnstileFetch,
} from "@/modules/contact/index.js";
import {
  register as registerNotifications,
  setSesClient,
} from "@/modules/notifications/index.js";
import { getEmailSettings } from "@/modules/notifications/services/email-settings.js";
import { resetEmailProblems } from "@/modules/notifications/services/problems.js";
import { resetRateLimits } from "@/modules/platform/index.js";
import { register as registerScheduler } from "@/modules/scheduler/index.js";

export const SHOP = "ocp-dev.myshopify.com";
export const HANDLE = "lantern-abc123";
export const SELLER_EMAIL = "pat.seller@example.test";
export const BUYER_EMAIL = "buyer@example.test";
export const STAFF_EMAIL = "staff-alerts@example.test";
export const STAFF = { type: "STAFF", ref: "staff@example.test" };
const DAY = 24 * 60 * 60 * 1000;

/** An SES stand-in that can be switched off: while `down`, every send throws. */
export function makeSes() {
  const ses = mockSes();
  const works = ses.send.getMockImplementation();
  ses.down = false;
  ses.send.mockImplementation(async (command) => {
    if (ses.down)
      throw Object.assign(new Error("SES is down"), {
        name: "ServiceUnavailable",
      });
    return works(command);
  });
  return ses;
}

/** Empty database, core and notifications listeners, staff notices going to STAFF_EMAIL. */
export async function freshWorld() {
  await resetDb();
  process.env.SHOP_DOMAIN = SHOP;
  process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
  process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
  vi.stubEnv("TURNSTILE_SECRET_KEY", "test-turnstile-secret");
  resetEventBus();
  registerCore();
  registerScheduler();
  registerNotifications();
  resetEmailProblems();
  resetRateLimits();
  await getSettings();
  await getEmailSettings();
  await prisma.emailSettings.update({
    where: { id: 1 },
    data: { staffNotify: [STAFF_EMAIL] },
  });
  setTurnstile({ success: true });
  const ses = makeSes();
  setSesClient(ses);
  return ses;
}

export function tearDown() {
  setSesClient(null);
  setTurnstileFetch(null);
  vi.unstubAllEnvs();
}

/** Cloudflare's answer to every verify call. `success: null` makes the call fail outright. */
export function setTurnstile({ success }) {
  setTurnstileFetch(
    vi.fn(async () => {
      if (success === null) throw new Error("network down");
      return { ok: true, json: async () => ({ success }) };
    }),
  );
}

/** An open listing: LIVE, not expired, reachable at HANDLE. */
export function openListing(overrides = {}) {
  return makeListing({
    status: "LIVE",
    title: "1962 Coleman 200A lantern",
    metaobjectHandle: HANDLE,
    liveAt: new Date(Date.now() - DAY),
    expiresAt: new Date(Date.now() + 30 * DAY),
    invitation: { sellerEmail: SELLER_EMAIL, sellerName: "Pat Seller" },
    ...overrides,
  });
}

/** Distinct client addresses, so the per-IP limit doesn't get in the way of a test. */
let ipCounter = 0;
export function uniqueIp() {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

/**
 * The buyer's form. A key set to `undefined` is left out of the form.
 * @param {Record<string, string | undefined>} [fields]
 */
export function contactForm(fields = {}) {
  const values = {
    name: "Sam Buyer",
    email: BUYER_EMAIL,
    message: "Is the lantern still available?",
    "cf-turnstile-response": "turnstile-token",
    ...fields,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) form.set(key, value);
  return form;
}

const ctx = {
  shop: SHOP,
  admin: { graphql: () => Promise.resolve({ json: async () => ({}) }) },
  liquid: (body, init) =>
    new Response(body, {
      status: init?.status ?? 200,
      headers: init?.headers,
    }),
};

const pageUrl = (handle) =>
  `https://oldcolemanparts.example.test/apps/classifieds/contact/${handle}`;

/** GET the contact form. */
export function getForm(handle, { ip = uniqueIp() } = {}) {
  const request = new Request(pageUrl(handle), {
    headers: { "x-forwarded-for": ip },
  });
  return handleContactPage(ctx, request, handle);
}

/** POST the buyer's form. */
export function postForm(handle, form, { ip = uniqueIp() } = {}) {
  const request = new Request(pageUrl(handle), {
    method: "POST",
    body: form,
    headers: { "x-forwarded-for": ip },
  });
  return handleContactSubmit(ctx, request, handle);
}

/** The emails sent to one address, in order. */
export const sentTo = (ses, address) =>
  ses.sent.filter(
    (command) => command.input.Destination?.ToAddresses?.[0] === address,
  );

/** The seller's relay emails. */
export const relayed = (ses) => sentTo(ses, SELLER_EMAIL);

export const messageRows = () =>
  prisma.buyerMessage.findMany({ orderBy: { createdAt: "asc" } });

export { prisma };
