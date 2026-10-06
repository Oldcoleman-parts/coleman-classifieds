// Loaders and actions for the staff invitation screens. Route files stay thin and call these.
import {
  AppError,
  getSettings,
  isReleased,
  requireEmail,
  requireStaff,
  ValidationError,
} from "@/modules/core/index.js";
import {
  completeUpload,
  createUploadUrl,
  deletePhoto,
  listPhotos,
  MediaNotConfiguredError,
} from "@/modules/media/index.js";
import {
  createInvitation,
  findSellerHistory,
  getInvitationForStaff,
  revokeInvitation,
} from "./invitations.js";
import { sellerLink, storefrontBase } from "./links.js";

// DECISION: a local copy of the console's dollar parser; moving it into core is a follow-up.
const AMOUNT_RE = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

/** @param {number} cents */
const centsToDollars = (cents) => (cents / 100).toFixed(2);

/**
 * @param {string} text
 * @param {string} field
 * @returns {number} integer cents
 */
function dollarsToCents(text, field) {
  const match = AMOUNT_RE.exec(text);
  if (!match)
    throw new ValidationError(`${field} is not a valid amount`, {
      [field]: "must be an amount such as 30.00",
    });
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** @param {FormData} formData @param {string} field */
function text(formData, field) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/** Turn a known error into field errors for the form; anything else is rethrown. */
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
 * The Create invitation screen. `?email=` adds that seller's earlier listings.
 * @param {URL} url
 */
export async function loadCreateInvitationScreen(url) {
  const settings = await getSettings();
  let history = [];
  const email = url.searchParams.get("email");
  if (email) {
    try {
      history = await findSellerHistory(requireEmail(email, "email"));
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }
  return {
    regularFee: centsToDollars(settings.baseFeeCents),
    offeredFee: centsToDollars(settings.promoFeeCents ?? settings.baseFeeCents),
    inviteExpiryDays: settings.inviteExpiryDays,
    showOfferScope: isReleased("renewals"),
    history: history.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/**
 * Create an invitation from the form. The link is in this response only: it is never stored.
 * @param {FormData} formData
 * @param {import("@/modules/core/types.js").ActorRef} staff
 * @param {{ admin: object, shop: string }} shopify
 */
export async function submitCreateInvitation(formData, staff, { admin, shop }) {
  try {
    const fee = text(formData, "offeredFee");
    const { invitation, listing, token } = await createInvitation(
      {
        sellerName: text(formData, "sellerName"),
        sellerEmail: text(formData, "sellerEmail"),
        sellerPhone: text(formData, "sellerPhone"),
        itemSummary: text(formData, "itemSummary"),
        feeOfferedCents: fee === "" ? null : dollarsToCents(fee, "offeredFee"),
        offerScope: text(formData, "offerScope") || undefined,
      },
      staff,
    );
    return {
      ok: true,
      invitationId: invitation.id,
      listingId: listing.id,
      link: sellerLink(await storefrontBase(admin, shop), token),
      sellerName: invitation.sellerName,
      sellerEmail: invitation.sellerEmail,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  } catch (error) {
    const result = failure(error);
    // The form calls the offered fee "offeredFee".
    if (result.fieldErrors.feeOfferedCents)
      result.fieldErrors.offeredFee = result.fieldErrors.feeOfferedCents;
    return result;
  }
}

/**
 * One invitation for staff: details, state and the staff photos. Never the link.
 * @param {string} invitationId
 */
export async function loadInvitationScreen(invitationId) {
  const invitation = await getInvitationForStaff(invitationId);
  if (!invitation) return null;
  let photos = null;
  if (invitation.listing) {
    try {
      photos = (await listPhotos(invitation.listing.id)).map(
        ({ id, isMain, previewUrl, approved }) => ({
          id,
          isMain,
          previewUrl,
          approved,
        }),
      );
    } catch (error) {
      // Photo storage isn't set up on this environment: the rest of the screen still works.
      if (!(error instanceof MediaNotConfiguredError)) throw error;
    }
  }
  return {
    id: invitation.id,
    sellerName: invitation.sellerName,
    sellerEmail: invitation.sellerEmail,
    sellerPhone: invitation.sellerPhone,
    itemSummary: invitation.itemSummary,
    feeRegular: centsToDollars(invitation.feeRegularCents),
    feeOffered: centsToDollars(invitation.feeOfferedCents),
    offerScope: invitation.offerScope,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    createdBy: invitation.createdBy,
    listing: invitation.listing,
    canRevoke:
      invitation.status === "OPEN" && invitation.listing?.status === "INVITED",
    photos,
  };
}

/**
 * Actions on one invitation: revoke, and the staff photo upload steps.
 * @param {string} invitationId
 * @param {FormData} formData
 * @param {import("@/modules/core/types.js").ActorRef} actor
 */
export async function handleInvitationAction(invitationId, formData, actor) {
  const staff = requireStaff(actor);
  try {
    const intent = text(formData, "intent");
    if (intent === "revoke") {
      await revokeInvitation(invitationId, staff);
      return { ok: true, intent };
    }
    const invitation = await getInvitationForStaff(invitationId);
    const listingId = invitation?.listing?.id;
    if (!listingId)
      return { ok: false, fieldErrors: {}, message: "Invitation not found" };
    if (intent === "upload-url")
      return {
        ok: true,
        intent,
        upload: await createUploadUrl({
          listingId,
          actor: staff,
          contentType: text(formData, "contentType"),
          byteSize: text(formData, "byteSize"),
        }),
      };
    if (intent === "upload-complete") {
      await completeUpload({
        listingId,
        photoId: text(formData, "photoId"),
        actor: staff,
      });
      return { ok: true, intent };
    }
    if (intent === "delete-photo") {
      await deletePhoto(listingId, text(formData, "photoId"), staff);
      return { ok: true, intent };
    }
    return { ok: false, fieldErrors: {}, message: "Unknown action" };
  } catch (error) {
    return failure(error);
  }
}
