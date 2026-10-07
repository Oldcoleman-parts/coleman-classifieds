// Actions on the review screen. Every status change goes through core `transition()`, which
// writes the audit entry with the staff email; this file checks the form and sends the emails.
import prisma from "@/db.server";
import {
  AppError,
  ConflictError,
  LISTING_EVENTS,
  MAX_EXTENSION_MINUTES,
  NotFoundError,
  requireEnum,
  requireInt,
  requireStaff,
  requireString,
  transition,
  ValidationError,
} from "@/modules/core/index.js";
import {
  completeUpload,
  createUploadUrl,
  deletePhoto,
  reorder,
  setMain,
} from "@/modules/media/index.js";
import {
  findListing,
  findPendingRevision,
  PHOTO_DELETE_STATUSES,
  PHOTO_EDIT_STATUSES,
} from "./review.js";
import {
  formatDay,
  linkHelp,
  sellerVars,
  sendSellerEmail,
} from "./seller-email.js";
import { saveStaffWording } from "./wording.js";

const NOTE_MAX = 2000;
const DAY_MINUTES = 24 * 60;
const MAX_EXTENSION_DAYS = MAX_EXTENSION_MINUTES / DAY_MINUTES;

/** @param {FormData} formData @param {string} field */
function text(formData, field) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/** @param {FormData} formData @param {string} field */
const list = (formData, field) =>
  formData.getAll(field).filter((value) => typeof value === "string" && value);

/** Turn a known error into a form result; anything else is rethrown. */
function failure(error) {
  if (error instanceof ValidationError)
    return {
      ok: false,
      fieldErrors: error.fields ?? {},
      message: error.message,
    };
  if (error instanceof AppError)
    return { ok: false, fieldErrors: {}, message: error.message };
  throw error;
}

/**
 * @param {string[]} wanted
 * @param {string[]} allowed
 * @param {string} message
 */
function requireSubset(wanted, allowed, message) {
  if (
    new Set(wanted).size !== wanted.length ||
    wanted.some((id) => !allowed.includes(id))
  )
    throw new ValidationError(message, { photoIds: message });
  return wanted;
}

/** @param {string} listingId */
async function currentPhotoIds(listingId) {
  const photos = await prisma.photo.findMany({
    where: { listingId, deletedAt: null },
    select: { id: true },
  });
  return photos.map((photo) => photo.id);
}

/**
 * @param {{ status: string }} listing
 * @param {string[]} statuses
 */
function requirePhotoStatus(listing, statuses) {
  if (!statuses.includes(listing.status))
    throw new ConflictError("Photos can’t be changed at this stage");
}

/**
 * @param {string} listingId
 * @returns {Promise<NonNullable<Awaited<ReturnType<typeof findPendingRevision>>>>}
 */
async function requirePendingRevision(listingId, revisionId) {
  const revision = await findPendingRevision(listingId);
  if (!revision || revision.id !== revisionId)
    throw new ConflictError("This change has already been decided");
  return revision;
}

/** Each intent gets the listing (with its seller), the form, the staff actor and the context. */
const HANDLERS = {
  async approve({ listing, formData, staff }) {
    const photoIds = requireSubset(
      list(formData, "photoIds"),
      await currentPhotoIds(listing.id),
      "The photos changed while you were reviewing. Reload the page and try again.",
    );
    await transition(listing.id, LISTING_EVENTS.APPROVE, staff, { photoIds });
  },

  async "request-changes"({ listing, formData, staff, getLinkUrl }) {
    const note = requireString(formData.get("note"), "note", { max: NOTE_MAX });
    const updated = await transition(
      listing.id,
      LISTING_EVENTS.REQUEST_CHANGES,
      staff,
      { note },
    );
    await sendSellerEmail(
      "changes_requested",
      listing.invitation.sellerEmail,
      {
        ...sellerVars(listing, listing.invitation),
        staff_note: note,
        correction_due_date: formatDay(updated.correctionDueBy),
        ...(await linkHelp(getLinkUrl)),
      },
      {
        listingId: listing.id,
        idempotencyKey: `changes_requested:${listing.id}:${updated.changesRequestedAt.toISOString()}`,
      },
    );
  },

  // DECISION D3 (F05-T1): a reason is required and is sent to the seller.
  async reject({ listing, formData, staff }) {
    const note = requireString(formData.get("note"), "note", { max: NOTE_MAX });
    await transition(listing.id, LISTING_EVENTS.REJECT, staff, { note });
    await sendSellerEmail(
      "listing_rejected",
      listing.invitation.sellerEmail,
      { ...sellerVars(listing, listing.invitation), staff_note: note },
      {
        listingId: listing.id,
        idempotencyKey: `listing_rejected:${listing.id}`,
      },
    );
  },

  async "approve-revision"({ listing, formData, staff }) {
    const revision = await requirePendingRevision(
      listing.id,
      text(formData, "revisionId"),
    );
    const photoIds = requireSubset(
      list(formData, "photoIds"),
      revision.photoIds,
      "Only photos sent with this change can be approved",
    );
    await transition(listing.id, LISTING_EVENTS.APPROVE_REVISION, staff, {
      revisionId: revision.id,
      photoIds,
    });
    // DECISION (F05-T1 planning): no revision_approved email until a listing URL exists (F06).
  },

  async "reject-revision"({ listing, formData, staff, getLinkUrl }) {
    const revision = await requirePendingRevision(
      listing.id,
      text(formData, "revisionId"),
    );
    const note = text(formData, "note").slice(0, NOTE_MAX);
    await transition(listing.id, LISTING_EVENTS.REJECT_REVISION, staff, {
      revisionId: revision.id,
    });
    await sendSellerEmail(
      "revision_rejected",
      listing.invitation.sellerEmail,
      {
        ...sellerVars(listing, listing.invitation),
        ...(note ? { staff_note: note } : {}),
        ...(await linkHelp(getLinkUrl)),
      },
      {
        listingId: listing.id,
        idempotencyKey: `revision_rejected:${revision.id}`,
      },
    );
  },

  async pause({ listing, formData, staff }) {
    const reason = requireEnum(
      text(formData, "reason"),
      ["ORDINARY", "INVESTIGATION"],
      "reason",
    );
    await transition(listing.id, LISTING_EVENTS.PAUSE, staff, { reason });
  },

  // Core works out any restored time from the pause itself; nothing comes from the form.
  async resume({ listing, formData, staff }) {
    const payload = {};
    if (listing.pauseReason === "INVESTIGATION")
      payload.violation =
        requireEnum(text(formData, "violation"), ["yes", "no"], "violation") ===
        "yes";
    await transition(listing.id, LISTING_EVENTS.RESUME, staff, payload);
  },

  async extend({ listing, formData, staff }) {
    const days = requireInt(text(formData, "days"), "days", {
      min: 1,
      max: MAX_EXTENSION_DAYS,
    });
    const reason = requireString(formData.get("reason"), "reason", {
      max: 500,
    });
    await transition(listing.id, LISTING_EVENTS.EXTEND, staff, {
      minutes: days * DAY_MINUTES,
      reason,
    });
  },

  async "edit-wording"({ listing, formData, staff }) {
    await saveStaffWording(
      listing.id,
      {
        title: formData.get("title"),
        description: formData.get("description"),
      },
      staff,
    );
  },

  async "delete-photo"({ listing, formData, staff }) {
    requirePhotoStatus(listing, PHOTO_DELETE_STATUSES);
    await deletePhoto(listing.id, text(formData, "photoId"), staff);
  },

  async "order-photos"({ listing, formData, staff }) {
    requirePhotoStatus(listing, PHOTO_EDIT_STATUSES);
    await reorder(listing.id, list(formData, "photoIds"), staff);
  },

  async "set-main"({ listing, formData, staff }) {
    requirePhotoStatus(listing, PHOTO_EDIT_STATUSES);
    await setMain(listing.id, text(formData, "photoId"), staff);
  },

  async "upload-url"({ listing, formData, staff }) {
    requirePhotoStatus(listing, PHOTO_EDIT_STATUSES);
    return {
      upload: await createUploadUrl({
        listingId: listing.id,
        actor: staff,
        contentType: text(formData, "contentType"),
        byteSize: text(formData, "byteSize"),
      }),
    };
  },

  async "upload-complete"({ listing, formData, staff }) {
    requirePhotoStatus(listing, PHOTO_EDIT_STATUSES);
    await completeUpload({
      listingId: listing.id,
      photoId: text(formData, "photoId"),
      actor: staff,
    });
  },
};

/**
 * One action from the review screen.
 * @param {string} listingId
 * @param {FormData} formData
 * @param {{ actor: import("@/modules/core/types.js").ActorRef, getLinkUrl?: () => Promise<string> }} context
 *   `getLinkUrl` gives the "Get my link" address for seller emails
 * @returns {Promise<{ ok: boolean, intent?: string, message?: string, fieldErrors?: Record<string, string>, upload?: object }>}
 */
export async function handleReviewAction(
  listingId,
  formData,
  { actor, getLinkUrl },
) {
  const staff = requireStaff(actor);
  try {
    const intent = text(formData, "intent");
    const handler = Object.hasOwn(HANDLERS, intent) ? HANDLERS[intent] : null;
    if (!handler)
      return { ok: false, fieldErrors: {}, message: "Unknown action" };
    const listing = await findListing(listingId);
    if (!listing) throw new NotFoundError("Listing not found");
    const extra = await handler({ listing, formData, staff, getLinkUrl });
    return { ok: true, intent, ...extra };
  } catch (error) {
    return failure(error);
  }
}
