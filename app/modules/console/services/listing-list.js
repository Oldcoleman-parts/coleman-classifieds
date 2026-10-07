// The listings screen (`/app`): status tabs with counts, a search and one page of rows.
// Console reads the tables directly (read-only); every change goes through core.
import prisma from "@/db.server";
import { TERMINAL_STATUSES } from "@/modules/core/index.js";

export const PAGE_SIZE = 50;
const SEARCH_MAX = 100;

/**
 * Each tab is a filter on the listing table. "Needs review" also holds live listings with a
 * change waiting (DECISION D5, F05-T1).
 * @type {Record<string, { label: string, where: object }>}
 */
export const TABS = {
  all: { label: "All", where: { status: { not: "INVITED" } } },
  review: {
    label: "Needs review",
    where: {
      OR: [
        { status: "SUBMITTED" },
        { status: "LIVE", revisions: { some: { status: "PENDING" } } },
      ],
    },
  },
  drafts: {
    label: "With seller",
    where: { status: { in: ["DRAFT", "CHANGES_REQUESTED"] } },
  },
  payment: {
    label: "Awaiting payment",
    where: { status: "APPROVED_AWAITING_PAYMENT" },
  },
  live: { label: "Live", where: { status: "LIVE" } },
  paused: { label: "Paused", where: { status: "PAUSED" } },
  closed: { label: "Closed", where: { status: { in: TERMINAL_STATUSES } } },
};

/**
 * @param {string} q
 * @returns {object | null} a filter on title, seller name, seller email or the exact id
 */
function searchWhere(q) {
  if (!q) return null;
  const contains = { contains: q, mode: "insensitive" };
  return {
    OR: [
      { id: q },
      { title: contains },
      { invitation: { sellerName: contains } },
      { invitation: { sellerEmail: contains } },
    ],
  };
}

/** @param {number} cents */
const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

/**
 * The fee column: the latest charge, or the fee offered while nothing is charged.
 * @param {{ status: string, amountCents: number } | undefined} charge
 * @param {number} feeOfferedCents
 */
function feeState(charge, feeOfferedCents) {
  if (!charge) return `Not charged (${dollars(feeOfferedCents)} offered)`;
  const label = {
    PENDING: "Pending",
    PAID: "Paid",
    FAILED: "Failed",
    REFUNDED: "Refunded",
  }[charge.status];
  return `${label ?? charge.status} ${dollars(charge.amountCents)}`;
}

/**
 * @param {{ tab?: string | null, q?: string | null, cursor?: string | null }} [query]
 * @returns {Promise<{ tab: string, q: string, tabs: Array<{ key: string, label: string, count: number }>, rows: object[], nextCursor: string | null }>}
 */
export async function loadListingList({ tab, q, cursor } = {}) {
  const key = tab && Object.hasOwn(TABS, tab) ? tab : "review";
  const search = typeof q === "string" ? q.trim().slice(0, SEARCH_MAX) : "";
  const searchFilter = searchWhere(search);
  const filter = (where) =>
    searchFilter ? { AND: [where, searchFilter] } : where;

  const counts = await Promise.all(
    Object.values(TABS).map(({ where }) =>
      prisma.listing.count({ where: filter(where) }),
    ),
  );

  const found = await prisma.listing.findMany({
    where: filter(TABS[key].where),
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: String(cursor) }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      status: true,
      expiresAt: true,
      updatedAt: true,
      invitation: {
        select: { sellerName: true, itemSummary: true, feeOfferedCents: true },
      },
      charges: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, amountCents: true },
      },
      revisions: {
        where: { status: "PENDING" },
        take: 1,
        select: { id: true },
      },
    },
  });

  const page = found.slice(0, PAGE_SIZE);
  return {
    tab: key,
    q: search,
    tabs: Object.entries(TABS).map(([tabKey, { label }], index) => ({
      key: tabKey,
      label,
      count: counts[index],
    })),
    rows: page.map((listing) => ({
      id: listing.id,
      title: listing.title ?? listing.invitation.itemSummary,
      sellerName: listing.invitation.sellerName,
      status: listing.status,
      changePending: listing.revisions.length > 0,
      feeState: feeState(
        listing.charges[0],
        listing.invitation.feeOfferedCents,
      ),
      expiresAt: listing.expiresAt?.toISOString() ?? null,
    })),
    nextCursor: found.length > PAGE_SIZE ? page[page.length - 1].id : null,
  };
}
