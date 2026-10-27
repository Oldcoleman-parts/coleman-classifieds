// The seller reminders: finish the draft, and the listing ends soon.
import { getLinkUrl, getSellerContacts } from "@/modules/access/index.js";
import { getSettings } from "@/modules/core/index.js";
import { send } from "@/modules/notifications/index.js";
import { listingPages, startBudget } from "./facts.js";
import {
  DAY_MS,
  errorCode,
  firstName,
  formatDay,
  HOUR_MS,
  offlineAdmin,
  shopDomain,
} from "./shop.js";

/** @typedef {import("./facts.js").OpsListing} OpsListing */
/** @typedef {{ sellerEmail: string, sellerName: string }} SellerContact */

const MAX_TRIES = 3;

/**
 * Send a reminder at most three times, an hour apart.
 * DECISION (F08-T1): both templates are `sensitive`, so a failed send is never queued; the
 * pattern is publishing's `listing_live` one. Try `k` is made only once `k` hours have passed
 * since the reminder window opened, and a used key sends nothing, so every run can call this.
 * The key carries the deadline, so a moved deadline gets its own reminder. The email points
 * to Get my link: only the hash of the seller's private link is stored.
 * @param {string} template
 * @param {OpsListing} listing
 * @param {SellerContact} contact never logged
 * @param {Date} deadline
 * @param {Date} opened when the reminder window opened
 * @param {Record<string, string>} vars
 * @param {Date} now
 * @returns {Promise<string>} the last send status
 */
async function remind(template, listing, contact, deadline, opened, vars, now) {
  const hours = Math.floor((now.getTime() - opened.getTime()) / HOUR_MS);
  const tries = Math.min(MAX_TRIES, Math.max(1, hours + 1));
  let status = "FAILED";
  for (let k = 0; k < tries && status === "FAILED"; k++) {
    ({ status } = await send(template, contact.sellerEmail, vars, {
      idempotencyKey: `${template}:${listing.id}:${deadline.getTime()}:${k}`,
      now,
    }));
  }
  return status;
}

/**
 * @param {string} template
 * @param {AsyncIterable<OpsListing[]>} pages
 * @param {(listing: OpsListing) => Date} deadlineOf
 * @param {number} daysBefore
 * @param {(listing: OpsListing, deadline: Date, contact: SellerContact) => Record<string, string>} varsOf
 * @param {Date} now
 * @param {import("./facts.js").Budget} budget checked before each listing
 * @returns {Promise<{ due: number, failed: number }>}
 */
async function remindAll(
  template,
  pages,
  deadlineOf,
  daysBefore,
  varsOf,
  now,
  budget,
) {
  const summary = { due: 0, failed: 0 };
  /** @type {string | undefined} */
  let getLink;
  for await (const listings of pages) {
    // One lookup per page; a failure here fails the task, so the scheduler retries it.
    const contacts = await getSellerContacts(listings.map(({ id }) => id));
    getLink ??= await getLinkUrl(await offlineAdmin(), shopDomain());
    for (const listing of listings) {
      if (budget.expired()) break;
      summary.due += 1;
      const contact = contacts.get(listing.id);
      if (!contact) {
        // DECISION (F08-FIX-3): counted as failed so the summary keeps its shape.
        summary.failed += 1;
        console.warn(`[ops] ${template} skipped for ${listing.id}: no-contact`);
        continue;
      }
      try {
        const deadline = deadlineOf(listing);
        const opened = new Date(deadline.getTime() - daysBefore * DAY_MS);
        const status = await remind(
          template,
          listing,
          contact,
          deadline,
          opened,
          { ...varsOf(listing, deadline, contact), get_link_url: getLink },
          now,
        );
        if (status === "FAILED") summary.failed += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(
          `[ops] ${template} failed for ${listing.id}: ${errorCode(error)}`,
        );
      }
    }
  }
  return summary;
}

/**
 * `draftReminderDaysBefore` days before the draft deadline.
 * @param {{ now?: Date, budget?: import("./facts.js").Budget }} [context]
 */
export async function runDraftReminders({
  now = new Date(),
  budget = startBudget(),
} = {}) {
  const { draftReminderDaysBefore: days } = await getSettings();
  const pages = listingPages(
    {
      status: "DRAFT",
      draftDueBy: { gt: now, lte: new Date(now.getTime() + days * DAY_MS) },
    },
    "draftDueBy",
    { budget },
  );
  return remindAll(
    "draft_reminder",
    pages,
    (listing) => /** @type {Date} */ (listing.draftDueBy),
    days,
    (listing, deadline, contact) => ({
      seller_first_name: firstName(contact.sellerName),
      draft_due_date: formatDay(deadline),
    }),
    now,
    budget,
  );
}

/**
 * `expiryReminderDays` days before a listing's month ends. Not sent with renewal on: the
 * listing doesn't end (renewals has its own reminder).
 * @param {{ now?: Date, budget?: import("./facts.js").Budget }} [context]
 */
export async function runExpiryReminders({
  now = new Date(),
  budget = startBudget(),
} = {}) {
  const { expiryReminderDays: days } = await getSettings();
  const pages = listingPages(
    {
      status: "LIVE",
      renewalOn: false,
      expiresAt: { gt: now, lte: new Date(now.getTime() + days * DAY_MS) },
    },
    "expiresAt",
    { budget },
  );
  return remindAll(
    "expiry_reminder",
    pages,
    (listing) => /** @type {Date} */ (listing.expiresAt),
    days,
    (listing, deadline, contact) => ({
      seller_first_name: firstName(contact.sellerName),
      listing_title: listing.title ?? "",
      expires_date: formatDay(deadline),
    }),
    now,
    budget,
  );
}
