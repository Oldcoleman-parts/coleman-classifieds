// Shared set-up for the payments tests.
import { vi } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, mockSes } from "@/../tests/factories.js";
import { setLinkBase } from "@/modules/access/services/links.js";
import {
  getSettings,
  register as registerCore,
  resetEventBus,
} from "@/modules/core/index.js";
import { setSesClient } from "@/modules/notifications/index.js";
import { resetEmailProblems } from "@/modules/notifications/services/problems.js";
import { setStorefrontFetch } from "@/modules/payments/services/checkout.js";
import { encryptSecret } from "@/modules/payments/services/crypto.js";
import { resetPaymentProblems } from "@/modules/payments/services/incidents.js";
import { resetFeeSetupCache } from "@/modules/payments/services/setup.js";
import { setOfflineAdmin } from "@/modules/payments/services/shop.js";
import { resetRateLimits } from "@/modules/platform/index.js";

export const SHOP = "ocp-dev.myshopify.com";
export const BASE = "https://oldcolemanparts.example.test";
export const PRODUCT = "gid://shopify/Product/9";
export const VARIANT = "gid://shopify/ProductVariant/777";
export const DISCOUNT = "gid://shopify/DiscountCodeNode/1";
export const SF_TOKEN = "sf-token-plain";
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** An empty database, core's listeners only, a working SES stand-in and fresh caches. */
export async function freshWorld() {
  await resetDb();
  process.env.SHOP_DOMAIN = SHOP;
  process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
  process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
  resetEventBus();
  registerCore();
  setLinkBase(SHOP, BASE);
  resetFeeSetupCache();
  resetPaymentProblems();
  resetEmailProblems();
  resetRateLimits();
  setStorefrontFetch(null);
  const ses = mockSes();
  setSesClient(ses);
  await getSettings();
  return { ses };
}

/** Store a finished fee setup, as `ensureFeeSetup()` would leave it. */
export async function seedFeeSetup() {
  await prisma.settings.update({
    where: { id: 1 },
    data: {
      feeProductGid: PRODUCT,
      feeVariantGid: VARIANT,
      storefrontTokenEnc: encryptSecret(SF_TOKEN),
    },
  });
  resetFeeSetupCache();
}

/** An approved listing: regular fee $30, offered $25, due in 7 days. */
export function awaiting({ invitation, ...overrides } = {}) {
  return makeListing({
    status: "APPROVED_AWAITING_PAYMENT",
    title: "1962 Coleman 200A lantern",
    paymentDueBy: new Date(Date.now() + 7 * DAY),
    invitation: { feeRegularCents: 3000, feeOfferedCents: 2500, ...invitation },
    ...overrides,
  });
}

const userErrors = [];
const DEFAULTS = {
  FeeProductByHandle: { productByIdentifier: null },
  FeeProductCreate: {
    productCreate: {
      product: { id: PRODUCT, variants: { nodes: [{ id: VARIANT }] } },
      userErrors,
    },
  },
  FeeVariantUpdate: {
    productVariantsBulkUpdate: {
      productVariants: [{ id: VARIANT }],
      userErrors,
    },
  },
  FeeStorefrontTokenCreate: {
    storefrontAccessTokenCreate: {
      storefrontAccessToken: { accessToken: SF_TOKEN },
      userErrors,
    },
  },
  FeeDiscountCreate: {
    discountCodeBasicCreate: { codeDiscountNode: { id: DISCOUNT }, userErrors },
  },
  // No code exists yet, so the first approval creates one.
  FeeDiscountByCode: { codeDiscountNodeByCode: null },
  FeeDiscountAmount: {
    codeDiscountNode: { id: DISCOUNT, codeDiscount: {} },
  },
  FeeDiscountUpdate: {
    discountCodeBasicUpdate: { codeDiscountNode: { id: DISCOUNT }, userErrors },
  },
  FeeDiscountDelete: {
    discountCodeDelete: { deletedCodeDiscountId: DISCOUNT, userErrors },
  },
  // The variant sits at the default base fee ($30.00, see the Settings default).
  FeeVariantPrice: {
    productVariant: { id: VARIANT, price: "30.00", product: { id: PRODUCT } },
  },
  FeePublications: {
    publications: {
      nodes: [
        {
          id: "gid://shopify/Publication/1",
          catalog: { title: "Online Store" },
        },
      ],
    },
  },
  FeePublish: { publishablePublish: { userErrors } },
};

/**
 * An Admin client that answers by operation name, so the order of calls doesn't matter.
 * An unfulfilled order becomes fulfilled once `FeeFulfilmentCreate` has been called.
 * @param {Record<string, object | ((variables: object) => object)>} [answers] by operation
 *   name; these replace the defaults. An unknown operation throws.
 */
export function fakeAdmin(answers = {}) {
  const calls = [];
  let fulfilled = false;
  const table = {
    ...DEFAULTS,
    FeeOrderFulfilmentState: ({ id }) => ({
      order: {
        id,
        displayFulfillmentStatus: fulfilled ? "FULFILLED" : "UNFULFILLED",
        fulfillmentOrders: {
          nodes: [
            {
              id: "gid://shopify/FulfillmentOrder/1",
              status: fulfilled ? "CLOSED" : "OPEN",
            },
          ],
        },
      },
    }),
    FeeFulfilmentCreate: () => {
      fulfilled = true;
      return {
        fulfillmentCreate: { fulfillment: { id: "f1" }, userErrors },
      };
    },
    ...answers,
  };
  const graphql = vi.fn(async (query, { variables } = {}) => {
    const name = /\b(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
    calls.push({ name, variables });
    if (!Object.hasOwn(table, name))
      throw new Error(`fakeAdmin: no answer for ${name}`);
    const answer = table[name];
    const data = typeof answer === "function" ? answer(variables) : answer;
    return { json: async () => ({ data }) };
  });
  const admin = { graphql };
  setOfflineAdmin(admin);
  return {
    admin,
    calls,
    /** @param {string} name @returns {object[]} the variables of each call to it */
    of: (name) =>
      calls.filter((call) => call.name === name).map((call) => call.variables),
  };
}

/** The `PaymentProblem` keys written so far. */
export async function problemKeys() {
  const rows = await prisma.auditEvent.findMany({
    where: { action: "PaymentProblem" },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => row.details.key);
}

/** Text and HTML of every email sent, joined. */
export const emailText = (ses) =>
  ses.sent
    .map(
      ({ input }) =>
        `${input.Content.Simple.Body.Text.Data}\n${input.Content.Simple.Body.Html.Data}`,
    )
    .join("\n");

/** A failing SES: a transient error on every try. */
export function breakSes(ses) {
  ses.send.mockRejectedValue(
    Object.assign(new Error("x"), { name: "ThrottlingException" }),
  );
}

export { prisma };
