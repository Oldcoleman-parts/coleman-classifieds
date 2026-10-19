// Helpers for the invitation email tests (F04-FIX-3): staff context, the create form, SES stand-ins.
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { asStaff } from "@/../tests/factories.js";
import { staffFromSession } from "@/modules/core/index.js";
import { setLinkBase } from "@/modules/access/services/links.js";

export const SHOP = "ocp-dev.myshopify.com";
export const BASE = "https://oldcolemanparts.example.test";
export const STAFF_EMAIL = "staff@example.test";

/** Environment and link base for every test that sends the invitation email. */
export function setUpInvitationEmail() {
  process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
  process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
  process.env.OCP_POSTAL_ADDRESS = "123 Main St, Spokane WA";
  setLinkBase(SHOP, BASE);
}

/** The staff actor and the Shopify context the screens take. */
export function staffContext() {
  const staff = asStaff({ shop: SHOP, email: STAFF_EMAIL });
  return {
    actor: staffFromSession(staff.session),
    shopify: { admin: staff.admin, shop: SHOP, staffFirstName: "Alex" },
  };
}

/**
 * The Create invitation form. A fresh form code is used unless one is given.
 * @param {Record<string, string>} [overrides]
 */
export function inviteForm(overrides = {}) {
  const data = new FormData();
  const values = {
    sellerName: "Pat Seller",
    sellerEmail: `seller-${randomUUID()}@example.test`,
    sellerPhone: "",
    itemSummary: "Coleman 200A lantern",
    offeredFee: "",
    offerScope: "",
    formNonce: randomUUID(),
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/** The action form for one invitation (`intent` plus any extra fields). */
export function actionForm(intent, fields = {}) {
  const data = new FormData();
  data.set("intent", intent);
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** An SES stand-in that refuses every send, as when SES is down. */
export function sesDown() {
  const send = vi.fn(async () => {
    throw Object.assign(new Error("Service unavailable"), {
      name: "ServiceUnavailableException",
    });
  });
  return { send, sent: [] };
}

/**
 * The private token in the invitation email's HTML body (the link ends with it).
 * @param {{ input: { Content: { Simple: { Body: { Html: { Data: string } } } } } }} command
 */
export function tokenIn(command) {
  const html = command.input.Content.Simple.Body.Html.Data;
  const match = html.match(/\/seller\/([A-Za-z0-9_-]{43})/);
  if (!match) throw new Error("No seller link in the invitation email");
  return match[1];
}

/** The token at the end of a seller link returned to staff. */
export const tokenOfLink = (link) => link.split("/seller/")[1];
