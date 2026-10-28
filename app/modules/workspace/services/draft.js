// Preparing a listing: start the draft, save it, and send it for review (new or corrected).
import prisma from "@/db.server";
import {
  getSettings,
  InvalidTransitionError,
  LISTING_EVENTS,
  transition,
  ValidationError,
} from "@/modules/core/index.js";
import { markInvitationUsed } from "@/modules/access/index.js";
import { cleanDraft, submitProblems } from "./fields.js";
import { photosFor } from "./photos.js";

export const EDITABLE = ["DRAFT", "CHANGES_REQUESTED"];
const USER_AGENT_MAX = 512;

/**
 * INVITED → DRAFT: the draft deadline starts now, and the link is marked used.
 * DECISION (F04-T2): this happens when the seller presses "Start my listing", not when the page
 * is opened, so an email scanner following the link can't start the clock.
 * @param {{ id: string, status: string }} listing
 * @param {{ id: string }} invitation
 * @param {import("@/modules/core/types.js").ActorRef} actor
 * @returns {Promise<boolean>} false when the draft had already been started (a second click)
 */
export async function startDraft(listing, invitation, actor) {
  try {
    await transition(listing.id, LISTING_EVENTS.OPEN, actor);
  } catch (error) {
    if (error instanceof InvalidTransitionError) return false;
    throw error;
  }
  await markInvitationUsed(invitation.id);
  return true;
}

/**
 * Save what the seller has typed so far. Nothing is required yet; only fields in the form change.
 * The write only happens while the listing is still being prepared or corrected.
 * @param {{ id: string }} listing
 * @param {FormData} form
 * @param {{ sellerName: string }} invitation
 * @returns {Promise<object>} the saved listing
 * @throws {ValidationError | InvalidTransitionError}
 */
export async function saveDraft(listing, form, invitation) {
  const data = cleanDraft(form, invitation);
  const where = { id: listing.id, status: { in: EDITABLE } };
  // Prisma reports no rows for an update with nothing to write, so check those by reading.
  const editable =
    Object.keys(data).length > 0
      ? (await prisma.listing.updateMany({ where, data })).count > 0
      : (await prisma.listing.count({ where })) > 0;
  if (!editable)
    throw new InvalidTransitionError("This listing can’t be edited now");
  return prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
}

/**
 * Save the form, check the listing is complete and the rules were agreed, then send it for
 * review. DRAFT → SUBMITTED (NEW) or CHANGES_REQUESTED → SUBMITTED (CORRECTED).
 * @param {{ id: string }} listing
 * @param {FormData} form
 * @param {{ invitation: { sellerName: string }, actor: import("@/modules/core/types.js").ActorRef, ip: string, userAgent: string | null }} context
 * @returns {Promise<object>} the submitted listing
 * @throws {ValidationError} with every field that needs attention (nothing is submitted)
 * @throws {InvalidTransitionError} when the listing is no longer being prepared
 */
export async function submitListing(
  listing,
  form,
  { invitation, actor, ip, userAgent },
) {
  const saved = await saveDraft(listing, form, invitation);
  const { photos } = await photosFor(saved.id);
  const problems = submitProblems(saved, photos.length);

  const settings = await getSettings();
  // DECISION (F04-T2): the box is ticked on every submit, new or corrected, and only for the
  // rules version the seller was shown. A newer version means reading the rules again.
  if (form.get("rulesVersion") !== settings.rulesVersion)
    problems.agree =
      "the listing rules have changed; please read them again and tick the box";
  else if (form.get("agree") !== "on")
    problems.agree = "please confirm you agree to the listing rules";
  if (Object.keys(problems).length > 0)
    throw new ValidationError("Some fields need attention", problems);

  // DECISION (F01-FIX-6): the acceptance is written in the SUBMIT transaction, so a refused
  // submit leaves none. The rules version is the one read above, before the transaction.
  return transition(
    saved.id,
    LISTING_EVENTS.SUBMIT,
    actor,
    {},
    {
      beforeCommit: (tx, submitted) =>
        tx.termsAcceptance.create({
          data: {
            listingId: submitted.id,
            kind: "LISTING_RULES",
            rulesVersion: settings.rulesVersion,
            ip,
            userAgent: (userAgent ?? "").slice(0, USER_AGENT_MAX),
          },
        }),
    },
  );
}
