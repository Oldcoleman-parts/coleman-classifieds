// Shopify's shop/redact (48 hours after an uninstall) as a job (F08-FIX-8). The webhook
// records a `ShopRedactJob`; the hourly `ops.shop-redact` task closes every open listing
// page by page within its budget (an unfinished job goes on next hour), then erases the
// rest table-wide, deletes the shop's sessions and marks the job done.
// DECISION (F08-FIX-8): a job, not the webhook request: closing live listings calls Shopify
// for each one, far past Shopify's 5 s.
import prisma from "@/db.server";
import { deleteShopSessions } from "@/modules/platform/index.js";
import { closeListings, eraseShop } from "./erase.js";
import { openListingPage, startBudget } from "./facts.js";

/** The scheduler time box is 300 s; the job stops closing listings after this. */
const BUDGET_MS = 240_000;

/**
 * Records the job; a repeated webhook changes nothing.
 * @param {{ shop: string, webhookId: string }} request
 * @returns {Promise<{ queued: true }>}
 */
export async function enqueueShopRedact({ shop, webhookId }) {
  await prisma.shopRedactJob.upsert({
    where: { webhookId },
    create: { webhookId, shop },
    update: {},
  });
  return { queued: true };
}

/**
 * The hourly `ops.shop-redact` task. A failure throws, so two failed runs raise a JOB
 * incident (scheduler rule); the job stays open and is tried again.
 * @param {{ now?: Date, budget?: import("./facts.js").Budget }} [context]
 * @returns {Promise<{ jobs: number, done: number, closed: number, skipped: number }>}
 */
export async function runShopRedact({
  now = new Date(),
  budget = startBudget(BUDGET_MS),
} = {}) {
  const jobs = await prisma.shopRedactJob.findMany({
    where: { doneAt: null },
    orderBy: { createdAt: "asc" },
  });
  const summary = { jobs: jobs.length, done: 0, closed: 0, skipped: 0 };
  for (const job of jobs) {
    await prisma.shopRedactJob.update({
      where: { webhookId: job.webhookId },
      data: { attempts: { increment: 1 } },
    });
    let afterId = null;
    let closed = 0;
    let skipped = 0;
    for (;;) {
      if (budget.expired()) return summary;
      const page = await openListingPage({ afterId });
      if (page.length === 0) break;
      const result = await closeListings(page, now);
      closed += result.closed;
      skipped += result.skipped;
      afterId = page[page.length - 1].id;
    }
    summary.closed += closed;
    summary.skipped += skipped;
    await eraseShop({ webhookId: job.webhookId, closed, skipped });
    await deleteShopSessions(job.shop);
    await prisma.shopRedactJob.update({
      where: { webhookId: job.webhookId },
      data: { doneAt: now },
    });
    summary.done += 1;
  }
  return summary;
}
