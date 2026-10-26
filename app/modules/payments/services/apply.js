// Apply a recorded fee charge: publish the payment, fulfil the fee order, write the period.
// It runs after `orders/paid` has answered (F06-FIX-2), so nothing here makes Shopify wait.
// Every step is safe to run twice; `payments.apply-paid-charges` retries what didn't finish.
import { AsyncLocalStorage } from "node:async_hooks";
import prisma from "@/db.server";
import { EVENTS, publish, writeAudit } from "@/modules/core/index.js";
import { AWAITING, loadPayable } from "./facts.js";
import { ensureFulfilled } from "./fulfil.js";
import { reportPaymentProblem } from "./incidents.js";
import { ensurePeriod } from "./periods.js";
import { offlineAdmin } from "./shop.js";

/** @typedef {"APPLIED" | "ALREADY" | "RETRY"} ApplyResult */

/** @param {unknown} error */
const code = (error) => error?.code ?? error?.name ?? "Error";

// DECISION (F06-FIX-2): taken at import, when no event is being dispatched. A run started from
// inside an event handler would otherwise publish into a queue that has already finished, and
// its events would be lost. Follow-up F01-FIX-9: replace with `core.runOutsideEvents()`.
const outsideEvents = AsyncLocalStorage.snapshot();

/** @type {Map<string, Promise<ApplyResult>>} charge id → the run in progress */
const inFlight = new Map();

/**
 * @param {string} orderGid
 * @returns {Promise<Error | null>} the error, so going live never waits on fulfilment
 */
async function fulfil(orderGid) {
  try {
    const { fulfilled } = await ensureFulfilled(orderGid, {
      admin: await offlineAdmin(),
    });
    if (fulfilled > 0)
      await writeAudit({
        action: "FeeOrderFulfilled",
        details: { orderGid, fulfilled },
      });
    return null;
  } catch (error) {
    return error;
  }
}

/**
 * @param {string} chargeId
 * @param {{ now?: Date }} [context]
 * @returns {Promise<ApplyResult>} never rejects; "RETRY" leaves `appliedAt` empty for the task
 */
export async function applyCharge(chargeId, { now = new Date() } = {}) {
  try {
    const charge = await prisma.feeCharge.findUnique({
      where: { id: chargeId },
      select: {
        listingId: true,
        orderGid: true,
        kind: true,
        status: true,
        appliedAt: true,
      },
    });
    if (
      !charge?.orderGid ||
      charge.appliedAt ||
      charge.kind !== "INITIAL" ||
      charge.status !== "PAID"
    )
      return "ALREADY";
    const { listingId, orderGid } = charge;

    // Only a listing the payment hasn't reached yet gets the event, so a retry of the
    // fulfilment never publishes it again.
    const before = await loadPayable(listingId);
    if (
      before &&
      (before.status === AWAITING || (!before.liveAt && !before.refundFlag))
    ) {
      try {
        await publish(EVENTS.PaymentReceived, {
          listingId,
          orderGid,
          billingMode: "ONE_MONTH",
        });
      } catch (error) {
        console.error(
          `[payments] applying charge ${chargeId} failed: ${code(error)}`,
        );
        return "RETRY";
      }
    }

    const fulfilmentError = await fulfil(orderGid);

    // A publish that resolves doesn't mean the listing is live. When it isn't, core has set
    // `refundFlag` and written `PaymentNotApplied`.
    const after = await loadPayable(listingId);
    if (after?.liveAt) await ensurePeriod(listingId, orderGid);
    else
      await reportPaymentProblem(
        `late-payment:${orderGid}`,
        "A listing fee was paid but the listing could not go live. A refund may be due.",
        { orderGid, status: after?.status ?? null },
        { listingId },
      );

    const others = await prisma.feeCharge.count({
      where: {
        listingId,
        kind: "INITIAL",
        status: "PAID",
        orderGid: { not: orderGid },
      },
    });
    if (others > 0)
      await reportPaymentProblem(
        `duplicate-fee-order:${listingId}`,
        "A listing fee was paid more than once. A refund may be due.",
        { orderGid, otherCharges: others },
        { listingId },
      );

    if (fulfilmentError) {
      // DECISION (F06-FIX-2): never thrown. The listing is live; the task retries the fulfilment.
      await reportPaymentProblem(
        `fee-order-unfulfilled:${orderGid}`,
        "A fee order could not be marked as fulfilled.",
        { orderGid, code: code(fulfilmentError) },
        { listingId },
      );
      return "RETRY";
    }

    const { count } = await prisma.feeCharge.updateMany({
      where: { id: chargeId, appliedAt: null },
      data: { appliedAt: now },
    });
    if (count === 1)
      await writeAudit({
        action: "FeeChargeApplied",
        listingId,
        details: { chargeId, orderGid },
      });
    return "APPLIED";
  } catch (error) {
    console.error(
      `[payments] applying charge ${chargeId} failed: ${code(error)}`,
    );
    return "RETRY";
  }
}

/**
 * Apply a charge in the background, or join the run already in progress for it.
 * @param {string} chargeId
 * @param {{ now?: Date }} [context]
 * @returns {Promise<ApplyResult>}
 */
export function startApply(chargeId, context) {
  const running = inFlight.get(chargeId);
  if (running) return running;
  const run = outsideEvents(
    () =>
      new Promise((resolve) => {
        // Starts only after the caller has returned, so the webhook answers first.
        setImmediate(() => resolve(applyCharge(chargeId, context)));
      }),
  ).finally(() => inFlight.delete(chargeId));
  inFlight.set(chargeId, run);
  return run;
}

/** Wait for every apply started in the background (tests). */
export async function settlePaymentApplies() {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight.values()]);
}
