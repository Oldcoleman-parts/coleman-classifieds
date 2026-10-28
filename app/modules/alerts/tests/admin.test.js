import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadAlertsScreen,
  setAlertsAdmin,
  streamSubscribersCsv,
} from "@/modules/alerts/index.js";
import {
  activeSubscriber,
  freshWorld,
  makeAdmin,
  openListing,
  pendingSubscriber,
  prisma,
  queue,
  setAlerts,
  STAFF,
  tearDown,
  unsubscribeNow,
} from "./helpers.js";

const csvOf = async (actor) => {
  const { stream } = await streamSubscribersCsv(actor);
  return new Response(stream).text();
};

describe("Settings → Alerts (F07-T2)", () => {
  let ses;

  beforeEach(async () => {
    ses = await freshWorld();
  });

  afterEach(tearDown);

  it("AC: the screen counts active, pending, unsubscribed and queued", async () => {
    await activeSubscriber(ses, "active@example.test");
    await pendingSubscriber(ses, "pending@example.test");
    await activeSubscriber(ses, "gone@example.test");
    await unsubscribeNow("gone@example.test");
    await queue(await openListing());

    expect(await loadAlertsScreen()).toEqual({
      enabled: true,
      counts: { active: 1, pending: 1, unsubscribed: 1, queued: 1 },
    });
  });

  it("SEC: a formula-looking address is neutralised in the CSV", async () => {
    await prisma.alertSubscriber.create({
      data: {
        id: "formula1",
        email: '=HYPERLINK("https://evil.example","x")@example.test',
        confirmedAt: new Date("2026-10-01T00:00:00Z"),
        unsubscribeTokenHash: "a".repeat(64),
      },
    });
    const csv = await csvOf(STAFF);

    expect(csv).toContain(`"'=HYPERLINK`);
    expect(csv).not.toMatch(/^"=HYPERLINK/m);
  });

  it("SEC: the export is audited with the staff email, and refuses a non-staff actor", async () => {
    await activeSubscriber(ses, "export@example.test");
    await csvOf(STAFF);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "AlertSubscribersExported" },
    });
    expect(audit.actorRef).toBe(STAFF.ref);
    await expect(
      streamSubscribersCsv({ type: "SYSTEM", ref: "alerts" }),
    ).rejects.toThrow();
  });

  it('AC: turning alerts off writes the storefront metafield to "false"', async () => {
    const admin = makeAdmin((query) =>
      query.includes("metafieldsSet")
        ? { metafieldsSet: { metafields: [{ id: "m1" }], userErrors: [] } }
        : {
            shop: { id: "gid://shopify/Shop/1", metafield: { value: "true" } },
          },
    );
    setAlertsAdmin(admin);

    await setAlerts(false);

    const [, options] = admin.graphql.mock.calls.find(([query]) =>
      query.includes("metafieldsSet"),
    );
    expect(options.variables.metafields[0]).toMatchObject({
      namespace: "classifieds",
      key: "alerts_enabled",
      value: "false",
    });
  });
});
