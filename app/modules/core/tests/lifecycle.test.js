import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import {
  getSettings,
  TERMINAL_STATUSES,
  transition,
} from "@/modules/core/index.js";

const NOW = new Date("2027-03-10T15:00:00Z");
const PAST = new Date("2027-03-09T15:00:00Z");
const FUTURE = new Date("2027-04-01T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const plusDays = (days) => new Date(NOW.getTime() + days * DAY);

const STAFF = { type: "STAFF", ref: "staff@example.test" };
const SELLER = { type: "SELLER" };
const SYSTEM = { type: "SYSTEM" };
const live = { liveAt: PAST, expiresAt: FUTURE };
const paused = { ...live, pausedAt: PAST, pauseReason: "ORDINARY" };

// One row per row of the state table: [from, event, actor, payload, fixture, to, published, expected fields]
const CASES = [
  [
    "INVITED",
    "OPEN",
    SELLER,
    {},
    {},
    "DRAFT",
    "DraftStarted",
    { draftStartedAt: NOW, draftDueBy: plusDays(14) },
  ],
  ["DRAFT", "SUBMIT", SELLER, {}, {}, "SUBMITTED", "ListingSubmitted", {}],
  [
    "DRAFT",
    "EXPIRE",
    SYSTEM,
    {},
    { draftDueBy: PAST },
    "EXPIRED",
    "ListingClosed",
    { closedReason: "DRAFT_NOT_SUBMITTED" },
  ],
  [
    "SUBMITTED",
    "REQUEST_CHANGES",
    STAFF,
    { note: "Add a photo" },
    {},
    "CHANGES_REQUESTED",
    "ChangesRequested",
    { changesRequestedAt: NOW, correctionDueBy: plusDays(14) },
  ],
  [
    "CHANGES_REQUESTED",
    "SUBMIT",
    SELLER,
    {},
    { correctionDueBy: FUTURE },
    "SUBMITTED",
    "ListingSubmitted",
    { correctionDueBy: null },
  ],
  [
    "CHANGES_REQUESTED",
    "EXPIRE",
    SYSTEM,
    {},
    { correctionDueBy: PAST },
    "EXPIRED",
    "ListingClosed",
    { closedReason: "CORRECTION_NOT_SUBMITTED" },
  ],
  [
    "SUBMITTED",
    "REJECT",
    STAFF,
    { note: "Not a Coleman item" },
    {},
    "REJECTED",
    "ListingRejected",
    { closedReason: "REJECTED" },
  ],
  [
    "SUBMITTED",
    "APPROVE",
    STAFF,
    {},
    {},
    "APPROVED_AWAITING_PAYMENT",
    "ListingApproved",
    { approvedAt: NOW, paymentDueBy: plusDays(7) },
  ],
  [
    "APPROVED_AWAITING_PAYMENT",
    "PAY",
    SYSTEM,
    { billingMode: "ONE_MONTH" },
    {},
    "LIVE",
    "ListingWentLive",
    {
      liveAt: NOW,
      expiresAt: new Date("2027-04-10T14:00:00Z"),
      billingMode: "ONE_MONTH",
    },
  ],
  [
    "APPROVED_AWAITING_PAYMENT",
    "LAPSE",
    SYSTEM,
    {},
    { paymentDueBy: PAST },
    "LAPSED",
    "ListingClosed",
    { closedReason: "PAYMENT_WINDOW_PASSED" },
  ],
  [
    "LAPSED",
    "REISSUE",
    STAFF,
    {},
    {
      closedAt: PAST,
      closedReason: "PAYMENT_WINDOW_PASSED",
      purgeAfter: FUTURE,
    },
    "APPROVED_AWAITING_PAYMENT",
    "ListingApproved",
    {
      paymentDueBy: plusDays(7),
      closedAt: null,
      closedReason: null,
      purgeAfter: null,
    },
  ],
  [
    "LIVE",
    "APPROVE_REVISION",
    STAFF,
    { revisionId: "rev_1" },
    live,
    "LIVE",
    "RevisionApproved",
    { expiresAt: FUTURE },
  ],
  [
    "LIVE",
    "REJECT_REVISION",
    STAFF,
    { revisionId: "rev_1" },
    live,
    "LIVE",
    "RevisionRejected",
    { expiresAt: FUTURE },
  ],
  [
    "LIVE",
    "PAUSE",
    STAFF,
    { reason: "ORDINARY" },
    live,
    "PAUSED",
    "ListingPaused",
    { pausedAt: NOW, pauseReason: "ORDINARY" },
  ],
  [
    "PAUSED",
    "RESUME",
    STAFF,
    {},
    paused,
    "LIVE",
    "ListingResumed",
    { pausedAt: null, pauseReason: null, expiresAt: FUTURE },
  ],
  [
    "LIVE",
    "EXTEND",
    STAFF,
    { minutes: 60, reason: "Outage" },
    live,
    "LIVE",
    "ListingExtended",
    { expiresAt: new Date(FUTURE.getTime() + 60 * 60_000) },
  ],
  [
    "PAUSED",
    "EXTEND",
    STAFF,
    { minutes: 60, reason: "Outage" },
    paused,
    "PAUSED",
    "ListingExtended",
    { expiresAt: new Date(FUTURE.getTime() + 60 * 60_000) },
  ],
  [
    "LIVE",
    "MARK_SOLD",
    SELLER,
    {},
    { ...live, renewalOn: true },
    "SOLD",
    "ListingClosed",
    { closedReason: "SOLD", renewalOn: false },
  ],
  [
    "PAUSED",
    "MARK_SOLD",
    STAFF,
    {},
    paused,
    "SOLD",
    "ListingClosed",
    { closedReason: "SOLD" },
  ],
  [
    "LIVE",
    "REMOVE",
    STAFF,
    {},
    live,
    "REMOVED",
    "ListingClosed",
    { closedReason: "REMOVED" },
  ],
  [
    "PAUSED",
    "REMOVE",
    SELLER,
    {},
    paused,
    "REMOVED",
    "ListingClosed",
    { closedReason: "REMOVED" },
  ],
  [
    "LIVE",
    "EXPIRE",
    SYSTEM,
    {},
    { liveAt: PAST, expiresAt: PAST },
    "EXPIRED",
    "ListingClosed",
    { closedReason: "MONTH_ENDED" },
  ],
  [
    "LIVE",
    "RENEWAL_PAID",
    SYSTEM,
    {},
    { liveAt: PAST, expiresAt: NOW },
    "LIVE",
    "ListingWentLive",
    { expiresAt: new Date("2027-04-10T14:00:00Z") },
  ],
  [
    "LIVE",
    "RENEWAL_FAILED",
    SYSTEM,
    {},
    live,
    "PAYMENT_OVERDUE",
    "ListingPaymentOverdue",
    { overdueSince: NOW },
  ],
  [
    "PAYMENT_OVERDUE",
    "PAY",
    SYSTEM,
    {},
    { overdueSince: PAST },
    "LIVE",
    "ListingWentLive",
    {
      liveAt: NOW,
      overdueSince: null,
      expiresAt: new Date("2027-04-10T14:00:00Z"),
    },
  ],
  [
    "PAYMENT_OVERDUE",
    "EXPIRE",
    SYSTEM,
    {},
    { overdueSince: plusDays(-8) },
    "EXPIRED",
    "ListingClosed",
    { closedReason: "RENEWAL_NOT_PAID" },
  ],
];

describe("Listing lifecycle: allowed transitions", () => {
  beforeAll(async () => {
    await resetDb();
    // The two Phase 2 rows need the renewals feature released and switched on.
    process.env.RENEWALS_RELEASED = "true";
    await getSettings();
    await prisma.settings.update({
      where: { id: 1 },
      data: { renewalsEnabled: true },
    });
  });

  afterAll(() => {
    process.env.RENEWALS_RELEASED = "false";
  });

  it.each(CASES)(
    "AC: %s + %s → status, fields and audit entry",
    async (from, event, actor, payload, fixture, to, published, fields) => {
      const listing = await makeListing({ status: from, ...fixture });

      const after = await transition(listing.id, event, actor, payload, {
        now: NOW,
      });

      expect(after.status).toBe(to);
      expect(after).toMatchObject(fields);
      if (TERMINAL_STATUSES.includes(to)) {
        expect(after.closedAt).toEqual(NOW);
        expect(after.purgeAfter).toEqual(plusDays(365));
      } else {
        expect(after.purgeAfter).toBeNull();
      }

      const audit = await prisma.auditEvent.findMany({
        where: { listingId: listing.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: published,
        actor: actor.type,
        actorRef: actor.ref ?? null,
      });
      expect(audit[0].details).toMatchObject({ transition: event, from, to });
    },
  );
});
