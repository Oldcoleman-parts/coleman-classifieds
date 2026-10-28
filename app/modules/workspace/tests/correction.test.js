import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/../tests/db.js";
import { mockSes } from "@/../tests/factories.js";
import {
  getSettings,
  resetEventBus,
  transition,
} from "@/modules/core/index.js";
import {
  getEmailSettings,
  register as registerNotifications,
  setSesClient,
} from "@/modules/notifications/index.js";
import { register as registerScheduler } from "@/modules/scheduler/index.js";
import { loader as page } from "@/routes/proxy.seller.$token.jsx";
import { action as submit } from "@/routes/proxy.seller.$token_.submit.jsx";
import {
  call,
  COMPLETE,
  DAY_MS,
  listingOf,
  sellerWith,
  setUp,
  tearDown,
} from "./helpers.js";

describe("Corrections (AC3)", () => {
  let ses;

  beforeEach(async () => {
    await setUp();
    resetEventBus();
    registerScheduler();
    registerNotifications();
    process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
    process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
    ses = mockSes();
    setSesClient(ses);
    await getEmailSettings();
    await prisma.emailSettings.update({
      where: { id: 1 },
      data: { staffNotify: ["staff@example.test"] },
    });
  });

  afterEach(() => {
    tearDown();
    resetEventBus();
    setSesClient(null);
    delete process.env.SES_FROM_TRANSACTIONAL;
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
  });

  const correcting = () =>
    sellerWith(
      {
        status: "CHANGES_REQUESTED",
        correctionDueBy: new Date(Date.now() + 3 * DAY_MS),
        ...COMPLETE,
      },
      { photos: [false] },
    );

  it("AC3: the page asks for changes and shows the correction deadline", async () => {
    const seller = await correcting();

    const body = await (await call(page, seller)).text();

    expect(body).toContain("Staff have asked for some changes");
    expect(body).toContain("correction deadline");
    expect(body).toContain("Send my changes for review");
  });

  it("AC3: resubmitting fires the CORRECTED staff notice", async () => {
    const seller = await correcting();
    const { rulesVersion } = await getSettings();

    const response = await call(submit, seller, {
      title: "Coleman 200A lantern, red",
      agree: "on",
      rulesVersion,
    });

    const listing = await listingOf(seller);
    expect(response.status).toBe(200);
    expect(listing.status).toBe("SUBMITTED");
    expect(listing.correctionDueBy).toBeNull();
    expect(listing.title).toBe("Coleman 200A lantern, red");
    const audit = await prisma.auditEvent.findFirst({
      where: { listingId: listing.id, action: "ListingSubmitted" },
    });
    expect(audit.details).toMatchObject({ kind: "CORRECTED" });
    expect(ses.sent).toHaveLength(1);
    expect(JSON.stringify(ses.sent[0].input)).toContain("corrected");
    expect(await prisma.termsAcceptance.count()).toBe(1);
  });

  it("AC: the seller page shows the staff note escaped", async () => {
    const seller = await sellerWith(
      { status: "SUBMITTED", ...COMPLETE },
      { photos: [false] },
    );
    await transition(
      seller.listing.id,
      "REQUEST_CHANGES",
      { type: "STAFF", ref: "staff@example.test" },
      { note: "Fix <b>photo</b>" },
    );

    const body = await (await call(page, seller)).text();

    expect(body).toContain("Fix &lt;b&gt;photo&lt;/b&gt;");
    expect(body).not.toContain("<b>photo");
  });

  it("AC: without a stored note the page points to the email", async () => {
    const seller = await correcting();

    const body = await (await call(page, seller)).text();

    expect(body).toContain("The details are in the email we sent you.");
    expect(body).not.toContain('<p class="cc-staff-note">');
  });
});
