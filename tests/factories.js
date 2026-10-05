// Shared test factories. Use these instead of repeating setup in test files.
import { createHash, randomBytes } from "node:crypto";
import { vi } from "vitest";
import prisma from "@/db.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const random = () => randomBytes(8).toString("hex");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function invitationData(overrides = {}) {
  return {
    tokenHash: sha256(random()),
    sellerName: "Sam Seller",
    sellerEmail: `seller-${random()}@example.test`,
    itemSummary: "Coleman 200A lantern",
    feeRegularCents: 3000,
    feeOfferedCents: 3000,
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
    ...overrides,
  };
}

/**
 * @param {Partial<import("@prisma/client").Prisma.InvitationUncheckedCreateInput>} [overrides]
 * @returns {Promise<import("@/modules/core/types.js").Invitation>}
 */
export function makeInvitation(overrides = {}) {
  return prisma.invitation.create({ data: invitationData(overrides) });
}

/**
 * Creates an invitation and its listing together. `status` is set directly on the fixture row;
 * production code changes status only through `transition()`.
 * @param {Partial<import("@prisma/client").Prisma.ListingUncheckedCreateInput> & { invitation?: object }} [overrides]
 * @returns {Promise<import("@/modules/core/types.js").Listing & { invitation: import("@/modules/core/types.js").Invitation }>}
 */
export function makeListing({
  invitation: invitationOverrides,
  ...overrides
} = {}) {
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.create({
      data: invitationData(invitationOverrides),
    });
    return tx.listing.create({
      data: { invitationId: invitation.id, arrangements: [], ...overrides },
      include: { invitation: true },
    });
  });
}

/**
 * The shape `authenticate.admin(request)` resolves to, for a staff member.
 * @param {{ shop?: string, email?: string }} [options]
 */
export function asStaff({
  shop = "ocp-dev.myshopify.com",
  email = "staff@example.test",
} = {}) {
  const shopify = mockShopify();
  return {
    session: {
      id: `${shop}_1`,
      shop,
      isOnline: true,
      email,
      accessToken: "test-access-token",
    },
    admin: shopify.admin,
    respondWith: shopify.respondWith,
  };
}

/**
 * A seller holding an invitation link. F03 refines this once the access module exists.
 * @param {{ invitation?: import("@/modules/core/types.js").Invitation, token?: string }} [options]
 */
export async function asSeller({ invitation, token = random() } = {}) {
  const owned =
    invitation ??
    (await makeInvitation({
      tokenHash: sha256(token + process.env.TOKEN_PEPPER),
    }));
  return {
    token,
    invitation: owned,
    /**
     * @param {string} [path] below /apps/classifieds
     * @param {RequestInit} [init]
     */
    request(path = "", init) {
      return new Request(
        `https://oldcolemanparts.example.test/apps/classifieds${path}`,
        init,
      );
    },
  };
}

/** Admin and Storefront GraphQL clients; queue responses with `respondWith(data)`. */
export function mockShopify() {
  const graphql = vi.fn();
  const storefrontGraphql = vi.fn();
  return {
    admin: { graphql },
    storefront: { graphql: storefrontGraphql },
    /** @param {object} data the `data` part of the next GraphQL response */
    respondWith(data) {
      const response = { json: async () => ({ data }) };
      graphql.mockResolvedValueOnce(response);
      storefrontGraphql.mockResolvedValueOnce(response);
    },
  };
}

/** An SES client stand-in: every command passed to `send` is kept in `sent`. */
export function mockSes() {
  const sent = [];
  const send = vi.fn(async (command) => {
    sent.push(command);
    return { MessageId: `test-${sent.length}` };
  });
  return { send, sent };
}

/** An S3 client stand-in: `send` is a spy, and tests may use `objects` as the fake bucket. */
export function mockS3() {
  return { send: vi.fn(async () => ({})), objects: new Map() };
}
