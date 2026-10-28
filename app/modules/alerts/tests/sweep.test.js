import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeSubscriber,
  alertsTo,
  DAY_MS,
  freshWorld,
  goLive,
  openListing,
  prisma,
  queue,
  sendNow,
  setAlerts,
  sweep,
  tearDown,
} from "./helpers.js";

const EMAIL = "reader@example.test";

const unsent = () => prisma.alertQueue.count({ where: { sentAt: null } });

describe("Hourly alert sweep (F07-T2)", () => {
  let ses;

  beforeEach(async () => {
    ses = await freshWorld();
  });

  afterEach(tearDown);

  it("AC: an empty queue sends nothing", async () => {
    await activeSubscriber(ses, EMAIL);

    expect(await sweep()).toMatchObject({ listings: 0, sent: 0 });
    expect(alertsTo(ses, EMAIL)).toHaveLength(0);
  });

  it("AC: the sweep sends an alert a go-live left unsent, once", async () => {
    await activeSubscriber(ses, EMAIL);
    await queue(await openListing());
    await sweep();
    await sweep();

    expect(alertsTo(ses, EMAIL)).toHaveLength(1);
    expect(await unsent()).toBe(0);
  });

  it("AC: a listing already sent at go-live is not re-sent by the sweep", async () => {
    await activeSubscriber(ses, EMAIL);
    await goLive(await openListing(), true);
    await sweep(new Date(Date.now() + DAY_MS));

    expect(alertsTo(ses, EMAIL)).toHaveLength(1);
  });

  it("AC: the immediate send and the sweep at the same time send one email", async () => {
    await activeSubscriber(ses, EMAIL);
    const listing = await openListing();
    await queue(listing);
    await Promise.all([sendNow(listing), sweep()]);

    expect(alertsTo(ses, EMAIL)).toHaveLength(1);
  });

  it("AC: the sweep leaves a row just queued to the immediate send", async () => {
    await activeSubscriber(ses, EMAIL);
    await queue(await openListing(), new Date());

    expect(await sweep()).toMatchObject({ listings: 0 });
    expect(await unsent()).toBe(1);
  });

  it("AC: a LIVE listing without its storefront page waits, then the sweep sends it", async () => {
    await activeSubscriber(ses, EMAIL);
    const listing = await openListing({ metaobjectHandle: null });
    await queue(listing);
    await sweep();

    expect(alertsTo(ses, EMAIL)).toHaveLength(0);
    expect(await unsent()).toBe(1);

    await prisma.listing.update({
      where: { id: listing.id },
      data: { metaobjectHandle: "lantern-ready" },
    });
    await sweep();
    expect(alertsTo(ses, EMAIL)).toHaveLength(1);
  });

  it("AC: a sold, expired or stale listing is not sent and its row is marked", async () => {
    await activeSubscriber(ses, EMAIL);
    await queue(await openListing({ status: "SOLD" }));
    await queue(await openListing({ expiresAt: new Date(Date.now() - 1000) }));
    await queue(await openListing(), new Date(Date.now() - 4 * DAY_MS));
    await sweep();

    expect(alertsTo(ses, EMAIL)).toHaveLength(0);
    expect(await unsent()).toBe(0);
  });

  it("AC: with alerts off the sweep is paused and the queue kept; on again it sends", async () => {
    await activeSubscriber(ses, EMAIL);
    await queue(await openListing());
    await setAlerts(false);

    expect(await sweep()).toMatchObject({ paused: true });
    expect(await unsent()).toBe(1);
    expect(alertsTo(ses, EMAIL)).toHaveLength(0);

    await setAlerts(true);
    await sweep();
    expect(alertsTo(ses, EMAIL)).toHaveLength(1);
  });
});
