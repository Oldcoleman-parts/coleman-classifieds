// Shared set-up for the alerts (F07-T2) tests: a clean database, SES and Turnstile stand-ins,
// the signup, confirm and unsubscribe pages driven through their handlers, and open listings
// queued for their alert email. Times are relative to now, so no test depends on the clock.
import { vi } from "vitest";
import { makeListing, mockSes } from "@/../tests/factories.js";
import { prisma, resetDb } from "@/../tests/db.js";
import {
  EVENTS,
  getSettings,
  publish,
  register as registerCore,
  resetEventBus,
  setFlag,
} from "@/modules/core/index.js";
import {
  getEmailSettings,
  register as registerNotifications,
  setSesClient,
} from "@/modules/notifications/index.js";
import { resetEmailProblems } from "@/modules/notifications/services/problems.js";
import { resetRateLimits } from "@/modules/platform/index.js";
import { register as registerScheduler } from "@/modules/scheduler/index.js";
import {
  handleConfirm,
  handleResubscribe,
  handleSignupPage,
  handleSignupSubmit,
  handleUnsubscribePage,
  handleUnsubscribePost,
  register as registerAlerts,
  sendListingAlert,
  sendPendingAlerts,
  setAlertsAdmin,
  settleAlertSends,
  setTurnstileFetch,
} from "@/modules/alerts/index.js";
import { unsubscribeToken } from "@/modules/alerts/services/tokens.js";

export const SHOP = "ocp-dev.myshopify.com";
export const BASE = `https://${SHOP}`;
export const ALERTS = "/apps/classifieds/alerts";
export const CONFIRM = `${ALERTS}/confirm`;
export const UNSUBSCRIBE = `${ALERTS}/unsubscribe`;
export const RESUBSCRIBE = `${ALERTS}/resubscribe`;
export const STAFF = { type: "STAFF", ref: "staff@example.test" };
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

let counter = 0;
const next = () => {
  counter += 1;
  return counter;
};

/** Distinct client addresses, so the per-IP limit doesn't get in the way of a test. */
export function uniqueIp() {
  const n = next();
  return `10.1.${Math.floor(n / 250)}.${(n % 250) + 1}`;
}

/** @param {Record<string, string | null | undefined>} fields null and undefined are left out */
export function formOf(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields))
    if (value !== null && value !== undefined) form.set(key, value);
  return form;
}

/** An Admin stand-in: `answer(query, variables)` gives the `data` of each GraphQL call. */
export function makeAdmin(answer = () => ({})) {
  return {
    graphql: vi.fn(async (query, options) => ({
      json: async () => ({ data: answer(query, options?.variables) }),
    })),
  };
}

const liquid = (body, init) =>
  new Response(body, { status: init?.status ?? 200, headers: init?.headers });

/**
 * Call a handler with a request to `url`, as the app proxy would pass it.
 * @param {Function} handler
 * @param {string} url a path under BASE, with any query
 * @param {{ method?: string, body?: BodyInit, ip?: string, admin?: object }} [options]
 * @returns {Promise<Response>}
 */
export function call(
  handler,
  url,
  { method = "GET", body, ip = uniqueIp(), admin = makeAdmin() } = {},
) {
  const address = new URL(url, BASE);
  const request = new Request(address, {
    method,
    body,
    headers: { "x-forwarded-for": ip },
  });
  return handler({ url: address, shop: SHOP, admin, liquid }, request);
}

/** An SES stand-in and an empty database, with the core, alerts and notifications listeners. */
export async function freshWorld() {
  await resetDb();
  process.env.SHOP_DOMAIN = SHOP;
  process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
  process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
  process.env.SES_FROM_ALERTS = "alerts@example.test";
  process.env.SES_CONFIG_SET_ALERTS = "alerts-set";
  vi.stubEnv("TURNSTILE_SECRET_KEY", "test-turnstile-secret");
  resetEventBus();
  registerCore();
  registerScheduler();
  registerAlerts();
  registerNotifications();
  resetEmailProblems();
  resetRateLimits();
  await getSettings();
  await getEmailSettings();
  await prisma.emailSettings.update({
    where: { id: 1 },
    data: { postalAddress: "123 Main St, Spokane WA" },
  });
  setTurnstile(true);
  setAlertsAdmin(makeAdmin());
  const ses = mockSes();
  setSesClient(ses);
  return ses;
}

export function tearDown() {
  setSesClient(null);
  setTurnstileFetch(null);
  setAlertsAdmin(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
}

/** Cloudflare's answer to every verify call. */
export function setTurnstile(success) {
  setTurnstileFetch(
    vi.fn(async () => ({ ok: true, json: async () => ({ success }) })),
  );
}

/** Every console line from now on, as one string (to check that no token was logged). */
export function captureLogs() {
  const lines = [];
  for (const method of ["log", "info", "warn", "error"])
    vi.spyOn(console, method).mockImplementation((...args) => {
      lines.push(JSON.stringify(args));
    });
  return () => lines.join("\n");
}

/** The alert sign-up page, as a bot or a person would post it. */
export const signUp = (email, { ip, token = "turnstile-ok", website } = {}) =>
  call(handleSignupSubmit, ALERTS, {
    method: "POST",
    ip,
    body: formOf({ email, "cf-turnstile-response": token, website }),
  });

export const signupPage = () => call(handleSignupPage, ALERTS);

export const confirmGet = (t) => call(handleConfirm, `${CONFIRM}?t=${t}`);

export const confirmPost = (t) =>
  call(handleConfirm, CONFIRM, { method: "POST", body: formOf({ t }) });

export const unsubscribeGet = (url) => call(handleUnsubscribePage, url);

/** The mail app's one-click POST, to the address in the List-Unsubscribe header. */
export const oneClick = (url) =>
  call(handleUnsubscribePost, url, {
    method: "POST",
    body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }),
  });

/** The unsubscribe button's POST (the token in the form field). */
export const unsubscribeButton = (t) =>
  call(handleUnsubscribePost, UNSUBSCRIBE, {
    method: "POST",
    body: formOf({ t }),
  });

export const resubscribe = (t) =>
  call(handleResubscribe, RESUBSCRIBE, { method: "POST", body: formOf({ t }) });

/** The address's subscriber row. */
export const rowFor = (email) =>
  prisma.alertSubscriber.findUnique({ where: { email } });

/** The unsubscribe link for a subscriber, as an alert email carries it. */
export const unsubscribeLinkFor = (id) =>
  `${BASE}${UNSUBSCRIBE}?t=${unsubscribeToken(id)}`;

/** The emails sent to one address, in order. */
export const sentTo = (ses, address) =>
  ses.sent.filter(
    (command) => command.input.Destination?.ToAddresses?.[0] === address,
  );

const bodyOf = (command) => command.input.Content.Simple.Body.Text.Data;

/** Alert emails to one address: everything sent to it except the confirm emails. */
export const alertsTo = (ses, address) =>
  sentTo(ses, address).filter((c) => !bodyOf(c).includes(`${ALERTS}/confirm`));

/** The token in the last confirm email sent to an address. */
export function confirmTokenFor(ses, address) {
  const mails = sentTo(ses, address).map(bodyOf);
  const match = /alerts\/confirm\?t=([A-Za-z0-9_.-]+)/.exec(mails.at(-1) ?? "");
  if (!match) throw new Error("no confirm email for this address");
  return match[1];
}

/** A signup, confirmed through its email link: an active subscriber. */
export async function activeSubscriber(ses, email) {
  await signUp(email);
  await confirmPost(confirmTokenFor(ses, email));
  return rowFor(email);
}

/** A signup that never confirms: a pending subscriber. */
export async function pendingSubscriber(ses, email) {
  await signUp(email);
  return rowFor(email);
}

/** Unsubscribe an address with its own token, as the subscriber's button would. */
export async function unsubscribeNow(email) {
  const row = await rowFor(email);
  await unsubscribeButton(unsubscribeToken(row.id));
  return rowFor(email);
}

/** An open listing: LIVE since an hour ago, not expired, reachable at a handle. */
export function openListing(overrides = {}) {
  const n = next();
  return makeListing({
    status: "LIVE",
    title: `Coleman lantern no ${String(n).padStart(2, "0")}`,
    metaobjectHandle: `lantern-${n}`,
    liveAt: new Date(Date.now() - HOUR_MS),
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
    invitation: { sellerEmail: `seller-${n}@example.test`, sellerName: "Pat" },
    ...overrides,
  });
}

/**
 * Queue a listing without sending, as a go-live whose send was interrupted leaves it.
 * By default 2 hours ago, so the sweep picks it up.
 */
export const queue = (listing, at = new Date(Date.now() - 2 * HOUR_MS)) =>
  prisma.alertQueue.create({ data: { listingId: listing.id, queuedAt: at } });

/** Run the hourly sweep at a moment (the scheduler calls it the same way). */
export const sweep = (now = new Date()) => sendPendingAlerts({ now });

/** Send one queued listing's alert now. */
export const sendNow = (listing, now = new Date()) =>
  sendListingAlert(listing.id, { now });

/** Wait for the sends that go-lives started. */
export const settle = () => settleAlertSends();

/** Publish a go-live the way publishing does, and wait for the alert send it starts. */
export async function goLive(listing, firstTime) {
  await publish(EVENTS.ListingWentLive, {
    listingId: listing.id,
    firstTime,
    expiresAt: listing.expiresAt,
  });
  await settle();
}

export const setAlerts = (value) => setFlag("alerts", value, STAFF);

export { prisma };
