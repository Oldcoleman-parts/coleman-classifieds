import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { resetDb } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import {
  EVENTS,
  publish,
  resetEventBus,
  runOutsideEvents,
  subscribe,
} from "@/modules/core/index.js";

describe("core.runOutsideEvents() (F01-FIX-9)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  afterEach(() => {
    resetEventBus();
  });

  // A ListingApproved handler publishes ListingRejected, either plainly or through `wrap`.
  const publishFromHandler = async (wrap) => {
    const order = [];
    const listing = await makeListing();
    subscribe(EVENTS.ListingApproved, async () => {
      order.push("h1_start");
      await wrap(() =>
        publish(EVENTS.ListingRejected, { listingId: listing.id }),
      );
      order.push("h1_end");
    });
    subscribe(EVENTS.ListingRejected, () => {
      order.push("h2");
    });

    await publish(EVENTS.ListingApproved, { listingId: listing.id });
    return order;
  };

  it("AC: a publish inside runOutsideEvents() from a handler is dispatched at once", async () => {
    expect(await publishFromHandler(runOutsideEvents)).toEqual([
      "h1_start",
      "h2",
      "h1_end",
    ]);
  });

  it("a plain publish from a handler is queued until the handler ends (control)", async () => {
    expect(await publishFromHandler((fn) => fn())).toEqual([
      "h1_start",
      "h1_end",
      "h2",
    ]);
  });
});
