// The seller reminders: finish the draft, and the listing ends soon.
import { getLinkUrl, getSellerContacts } from "@/modules/access/index.js";
import { getSettings } from "@/modules/core/index.js";
import { getEmailStatuses, send } from "@/modules/notifications/index.js";
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
 * Every idempotency key a reminder may use, one per try. Both the send and the
 * already-sent check use it, so the two can't drift apart (F08-FIX-5).
 * @param {string} template
 * @param {string} listingId
 * @param {Date} deadline
 * @returns {string[]}
 */
export function reminderKeys(template, listingId, deadline) {
  return Array.from(
    { length: MAX_TRIES },
    (_, k) => `${template}:${listingId}:${deadline.getTime()}:${k}`,
  );
}

/**
 * DECISION (F08-FIX-5): a reminder is handled once a try didn't fail (SENT, and also
 * SUPPRESSED or DEAD: trying again is pointless) or all three tries failed. A failed try
 * with tries left isn't handled, so the next try is made. Finished outbox rows are removed
 * after 30 days; the reminder windows (`draftReminderDaysBefore`, `expiryReminderDays`,
 * 3 days, not staff-editable) stay well under that.
 * @param {string[]} keys
 * @param {Map<string, string>} statuses
 */
function isHandled(keys, statuses) {
  const found = keys.map((key) => statuses.get(key));
  return (
    found.some((status) => status && status !== "FAILED") ||
    found.every((status) => status === "FAILED")
  );
}

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
  const keys = reminderKeys(template, listing.id, deadline);
  let status = "FAILED";
  for (let k = 0; k < tries && status === "FAILED"; k++) {
    ({ status } = await send(template, contact.sellerEmail, vars, {
      idempotencyKey: keys[k],
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
 * @returns {Promise<{ due: number, failed: number, alreadySent: number }>} `alreadySent`
 *   counts the listings left out because their reminder is handled
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
  const summary = { due: 0, failed: 0, alreadySent: 0 };
  /** @type {string | undefined} */
  let getLink;
  for await (const page of pages) {
    // DECISION (F08-FIX-5): one status lookup per page, before the contacts lookup, leaves
    // out the listings already handled, so they no longer use up the budget. A failure here
    // fails the task, like the contacts lookup, so the scheduler retries it.
    const keysOf = new Map(
      page.map((listing) => [
        listing.id,
        reminderKeys(template, listing.id, deadlineOf(listing)),
      ]),
    );
    const statuses = await getEmailStatuses([...keysOf.values()].flat());
    const listings = page.filter(
      ({ id }) =>
        !isHandled(/** @type {string[]} */ (keysOf.get(id)), statuses),
    );
    summary.alreadySent += page.length - listings.length;
    if (listings.length === 0) continue;
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
