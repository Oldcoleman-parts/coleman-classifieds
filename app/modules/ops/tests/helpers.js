// Shared set-up for the ops tests (F08-T1). The database, SES and core come from the payments
// helpers; Shopify is the Admin stand-in that answers by operation name.
import { makeListing } from "@/../tests/factories.js";
import { ANSWERS } from "@/modules/publishing/tests/helpers.js";
import {
  fakeAdmin,
  freshWorld,
  prisma,
} from "@/modules/payments/tests/helpers.js";
import {
  register as registerOps,
  setOfflineAdmin,
} from "@/modules/ops/index.js";
import { register as registerScheduler } from "@/modules/scheduler/index.js";

export { prisma };
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An empty database, core and the scheduler, the ops tasks and listeners registered, and an
 * Admin stand-in (answers for the page retirement) as the offline client.
 */
export async function opsWorld() {
  const world = await freshWorld();
  // Clears the task registry first, so the ops register() below adds each task once.
  registerScheduler();
  registerOps();
  const shopify = fakeAdmin({ ...ANSWERS });
  setOfflineAdmin(shopify.admin);
  return { ...world, shopify };
}

/**
 * A listing in `status`. Its deadlines are set by the caller, relative to `Date.now()`.
 * @param {string} status
 * @param {Record<string, unknown>} [overrides]
 */
export function seedListing(status, overrides = {}) {
  return makeListing({
    status,
    title: "1962 Coleman 200A lantern",
    arrangements: ["PICKUP"],
    renewalOn: false,
    ...overrides,
  });
}

/** The status and close fields of a listing. */
export const rowOf = (id) =>
  prisma.listing.findUnique({
    where: { id },
    select: {
      status: true,
      closedAt: true,
      closedReason: true,
      metaobjectGid: true,
    },
  });

/** The `ListingClosed` audit rows of a listing. */
export const closedAudits = (listingId) =>
  prisma.auditEvent.findMany({
    where: { listingId, action: "ListingClosed" },
    select: { id: true, details: true },
  });

/** Every `listing_closed` email queued, oldest first. */
export const closedEmails = () =>
  prisma.emailOutbox.findMany({
    where: { templateKey: "listing_closed" },
    orderBy: { createdAt: "asc" },
    select: { idempotencyKey: true, vars: true },
  });

/** Failed page retirements before a listing is held (F08-FIX-1 and F08-FIX-4). */
export const RETIRE_FAILURES = 3;

/**
 * Closed SOLD listings with a storefront page. The first `failing` ids are the ones whose
 * `metaobjectDelete` always fails; they closed oldest, so they come first in the batch.
 */
export async function seedStuckPages(count, now) {
  const failing = new Set();
  const listings = [];
  for (let i = 0; i < count; i++) {
    const gid = `gid://shopify/Metaobject/${100 + i}`;
    failing.add(gid);
    listings.push(
      await seedListing("SOLD", {
        closedAt: new Date(now.getTime() - (200 - i) * DAY_MS),
        closedReason: "SOLD",
        metaobjectGid: gid,
        metaobjectHandle: `lantern-${100 + i}`,
      }),
    );
  }
  return { failing, listings };
}

/** An Admin stand-in whose `metaobjectDelete` fails for the given gids and succeeds otherwise. */
export function failingAdmin(failing) {
  const shopify = fakeAdmin({
    ...ANSWERS,
    ListingDelete: ({ id }) =>
      failing.has(id)
        ? {
            metaobjectDelete: {
              deletedId: null,
              userErrors: [
                {
                  field: ["id"],
                  message: "Internal error",
                  code: "INTERNAL_ERROR",
                },
              ],
            },
          }
        : ANSWERS.ListingDelete,
  });
  setOfflineAdmin(shopify.admin);
  return shopify;
}
