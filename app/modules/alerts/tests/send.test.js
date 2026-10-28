import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { suppress } from "@/modules/notifications/services/suppression.js";
import {
  activeSubscriber,
  alertsTo,
  freshWorld,
  goLive,
  openListing,
  pendingSubscriber,
  prisma,
  rowFor,
  setAlerts,
  tearDown,
  unsubscribeNow,
} from "./helpers.js";

const EMAIL = "reader@example.test";
const OTHER = "second@example.test";

describe("New-listing alert at go-live (F07-T2)", () => {
  let ses;

  beforeEach(async () => {
    ses = await freshWorld();
  });

  afterEach(tearDown);

  it("AC: a first go-live emails each confirmed subscriber at once", async () => {
    await activeSubscriber(ses, EMAIL);
    await activeSubscriber(ses, OTHER);
    const listing = await openListing();
    await goLive(listing, true);

    const [mail] = alertsTo(ses, EMAIL);
    expect(alertsTo(ses, EMAIL)).toHaveLength(1);
    expect(alertsTo(ses, OTHER)).toHaveLength(1);
    expect(mail.input.Content.Simple.Subject.Data).toContain(listing.title);
    const html = mail.input.Content.Simple.Body.Html.Data;
    expect(html).toContain(listing.metaobjectHandle);
    expect(html).not.toContain("more</p>");
    const row = await prisma.alertQueue.findUnique({
      where: { listingId: listing.id },
    });
    expect(row.sentAt).not.toBeNull();
  });

  it("AC: the same go-live twice sends one email", async () => {
    await activeSubscriber(ses, EMAIL);
    const listing = await openListing();
    await goLive(listing, true);
    await goLive(listing, true);

    expect(
      await prisma.alertQueue.count({ where: { listingId: listing.id } }),
    ).toBe(1);
    expect(alertsTo(ses, EMAIL)).toHaveLength(1);
  });

  it("AC: a re-publish (firstTime false) is never queued or sent", async () => {
    await activeSubscriber(ses, EMAIL);
    await goLive(await openListing(), false);

    expect(await prisma.alertQueue.count()).toBe(0);
    expect(alertsTo(ses, EMAIL)).toHaveLength(0);
  });

  it("AC: two new listings make two separate emails", async () => {
    await activeSubscriber(ses, EMAIL);
    await goLive(await openListing(), true);
    await goLive(await openListing(), true);

    expect(alertsTo(ses, EMAIL)).toHaveLength(2);
  });

  it("AC: the alert goes through the alerts set, with the one-click headers and postal address", async () => {
    await activeSubscriber(ses, EMAIL);
    await goLive(await openListing(), true);
    const [mail] = alertsTo(ses, EMAIL);
    const names = mail.input.Content.Simple.Headers.map((h) => h.Name);

    expect(mail.input.ConfigurationSetName).toBe("alerts-set");
    expect(names).toEqual(
      expect.arrayContaining(["List-Unsubscribe", "List-Unsubscribe-Post"]),
    );
    expect(mail.input.Content.Simple.Body.Html.Data).toContain("123 Main St");
  });

  it("SEC: pending and unsubscribed addresses never receive an alert", async () => {
    await pendingSubscriber(ses, "pending@example.test");
    await activeSubscriber(ses, "gone@example.test");
    await unsubscribeNow("gone@example.test");
    await activeSubscriber(ses, EMAIL);
    await goLive(await openListing(), true);

    expect(alertsTo(ses, "pending@example.test")).toHaveLength(0);
    expect(alertsTo(ses, "gone@example.test")).toHaveLength(0);
    expect(alertsTo(ses, EMAIL)).toHaveLength(1);
  });

  it("SEC: a complaint unsubscribes an active subscriber, who is not sent the alert", async () => {
    await activeSubscriber(ses, EMAIL);
    await suppress(EMAIL, "COMPLAINT");
    await goLive(await openListing(), true);

    expect(alertsTo(ses, EMAIL)).toHaveLength(0);
    expect((await rowFor(EMAIL)).unsubscribedAt).not.toBeNull();
  });

  it("AC: a go-live while alerts are off queues and sends nothing", async () => {
    await activeSubscriber(ses, EMAIL);
    await setAlerts(false);
    await goLive(await openListing(), true);

    expect(await prisma.alertQueue.count()).toBe(0);
    expect(alertsTo(ses, EMAIL)).toHaveLength(0);
  });
});
