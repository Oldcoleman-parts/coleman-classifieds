// The seller page and its actions, one handler per route. Each one goes through the access
// gate (link, device, form token, rate limits), checks what the listing's status allows on the
// server, then calls a service and renders the result.
import {
  AppError,
  ConflictError,
  getChangesRequestNote,
  getSettings,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from "@/modules/core/index.js";
import {
  gateSeller,
  resolveToken,
  sellerLayout,
} from "@/modules/access/index.js";
import { MediaNotConfiguredError } from "@/modules/media/index.js";
import { saveDraft, startDraft, submitListing, EDITABLE } from "./draft.js";
import { closeListing, submitRevision, updateImmediate } from "./live.js";
import {
  finishUpload,
  pendingRevision,
  photosFor,
  removePhoto,
  reorderPhotos,
  startUpload,
} from "./photos.js";
import { closedPage, confirmPage, stagePage } from "./views.js";

const MOVED_ON =
  "Your listing has moved on to its next stage, so that change wasn’t made.";

/**
 * Load everything the page shows and render it.
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {string} token
 * @param {object} access from the gate
 * @param {{ listing?: object, errors?: Record<string, string>, typed?: FormData | null, notice?: string, status?: number }} [extra]
 */
async function render(ctx, token, access, extra = {}) {
  const listing = extra.listing ?? access.listing;
  const [settings, photoState, pending, changeNote] = await Promise.all([
    getSettings(),
    photosFor(listing.id),
    listing.status === "LIVE" ? pendingRevision(listing.id) : null,
    listing.status === "CHANGES_REQUESTED"
      ? getChangesRequestNote(listing.id)
      : null,
  ]);
  return stagePage(
    ctx.liquid,
    {
      token,
      invitation: access.invitation,
      listing,
      settings,
      formToken: access.formToken,
      photos: photoState.photos,
      photosAvailable: photoState.available,
      pending,
      errors: extra.errors,
      typed: extra.typed ?? null,
      notice: extra.notice,
      changeNote,
    },
    extra.status,
  );
}

/** Fetch the listing again after a change, so the page shows what is stored. */
async function reloaded(token) {
  // Resolving again also re-checks the link and deadlines.
  const resolved = await resolveToken(token);
  return resolved.state === "OK" ? resolved.listing : null;
}

/**
 * Turn a known failure into the page with a message; anything else is a real error.
 * @returns {Promise<Response>}
 */
async function failure(ctx, token, access, error) {
  if (error instanceof ValidationError)
    return render(ctx, token, access, {
      errors: error.fields,
      typed: access.form,
      status: 422,
    });
  if (error instanceof InvalidTransitionError) {
    const listing = await reloaded(token);
    if (!listing) return closedAfterAll(ctx);
    return render(ctx, token, access, {
      listing,
      notice: MOVED_ON,
      status: 409,
    });
  }
  if (error instanceof ConflictError)
    return render(ctx, token, access, { notice: error.message, status: 409 });
  throw error;
}

const closedAfterAll = (ctx) =>
  sellerLayout(
    ctx.liquid,
    "This listing has ended",
    "<p>This link no longer opens a listing.</p>",
    410,
  );

/**
 * GET the seller page.
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {Request} request
 * @param {string} token
 * @returns {Promise<Response>}
 */
export async function handleSellerPage(ctx, request, token) {
  const access = await gateSeller(ctx, request, token, { mode: "page" });
  if ("response" in access) return access.response;
  return render(ctx, token, access);
}

/**
 * POST to the seller page with the device credential: opens the page without changing anything.
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {Request} request
 * @param {string} token
 * @returns {Promise<Response>}
 */
export async function handleSellerResume(ctx, request, token) {
  const access = await gateSeller(ctx, request, token, { mode: "resume" });
  if ("response" in access) return access.response;
  return render(ctx, token, access);
}

/**
 * Run one page action: gate it, check the status allows it, then render the result.
 * @param {(access: object) => Promise<{ listing?: object, notice?: string } | Response | void>} act
 */
async function pageAction(ctx, request, token, allowed, act) {
  const access = await gateSeller(ctx, request, token, { mode: "action" });
  if ("response" in access) return access.response;
  if (!allowed.includes(access.listing.status))
    return render(ctx, token, access, { notice: MOVED_ON, status: 409 });
  try {
    const result = await act(access);
    if (result instanceof Response) return result;
    const listing = (await reloaded(token)) ?? null;
    if (!listing) return closedAfterAll(ctx);
    return render(ctx, token, access, { listing, notice: result?.notice });
  } catch (error) {
    return failure(ctx, token, access, error);
  }
}

/** POST /start: INVITED → DRAFT. A second click just shows the draft. */
export const handleStart = (ctx, request, token) =>
  pageAction(ctx, request, token, ["INVITED", ...EDITABLE], async (access) => {
    if (access.listing.status === "INVITED")
      await startDraft(access.listing, access.invitation, access.actor);
  });

/**
 * POST /draft: save the draft. The browser's autosave (`X-CC-Autosave: 1`) gets JSON.
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {Request} request
 * @param {string} token
 */
export async function handleDraft(ctx, request, token) {
  if (request.headers.get("x-cc-autosave") === "1")
    return jsonAction(ctx, request, token, EDITABLE, async (access) => {
      await saveDraft(access.listing, access.form, access.invitation);
      return {};
    });
  return pageAction(ctx, request, token, EDITABLE, async (access) => {
    await saveDraft(access.listing, access.form, access.invitation);
    return { notice: "Your draft is saved." };
  });
}

/** POST /submit: send the listing for review (NEW, or CORRECTED after a change request). */
export const handleSubmit = (ctx, request, token) =>
  pageAction(ctx, request, token, EDITABLE, async (access) => {
    await submitListing(access.listing, access.form, {
      invitation: access.invitation,
      actor: access.actor,
      ip: access.ip,
      userAgent: request.headers.get("user-agent"),
    });
  });

/** POST /live: price, quantity and availability note, straight away. */
export const handleLiveUpdate = (ctx, request, token) =>
  pageAction(ctx, request, token, ["LIVE"], async (access) => {
    const fields = await updateImmediate(
      access.listing,
      access.form,
      access.actor,
    );
    return {
      notice:
        fields.length > 0 ? "Your listing is updated." : "Nothing had changed.",
    };
  });

/** POST /revision: title, description and new photos, for staff review. */
export const handleRevision = (ctx, request, token) =>
  pageAction(ctx, request, token, ["LIVE"], async (access) => {
    await submitRevision(access.listing, access.form, access.actor);
    return {
      notice:
        "Thanks, your changes are with staff. Your listing stays as it is until they’re approved.",
    };
  });

/**
 * POST /sold and /remove: without `confirm=yes` shows the confirmation step first.
 * @param {"sold" | "remove"} kind
 */
export const handleClose = (kind) => (ctx, request, token) =>
  pageAction(ctx, request, token, ["LIVE", "PAUSED"], async (access) => {
    if (access.form.get("confirm") !== "yes")
      return confirmPage(
        ctx.liquid,
        {
          token,
          invitation: access.invitation,
          listing: access.listing,
          formToken: access.formToken,
        },
        kind,
      );
    await closeListing(access.listing, kind, access.actor);
    return closedPage(ctx.liquid, kind);
  });

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
  });

/**
 * A background call from the page's script: JSON in and out.
 * @param {(access: object) => Promise<object>} act
 */
async function jsonAction(ctx, request, token, allowed, act) {
  const access = await gateSeller(ctx, request, token, {
    mode: "action",
    json: true,
  });
  if ("response" in access) return access.response;
  if (!allowed.includes(access.listing.status))
    return json({ ok: false, message: MOVED_ON }, 409);
  try {
    return json({ ok: true, ...(await act(access)) });
  } catch (error) {
    if (error instanceof ValidationError)
      return json(
        { ok: false, message: error.message, fields: error.fields },
        422,
      );
    if (error instanceof InvalidTransitionError)
      return json({ ok: false, message: MOVED_ON }, 409);
    if (error instanceof ConflictError)
      return json({ ok: false, message: error.message }, 409);
    if (error instanceof NotFoundError)
      return json({ ok: false, message: "That photo wasn’t found." }, 404);
    if (error instanceof MediaNotConfiguredError)
      return json(
        { ok: false, message: "Photo uploads aren’t available just now." },
        503,
      );
    if (error instanceof AppError)
      return json({ ok: false, message: error.message }, 400);
    throw error;
  }
}

const PHOTO_STATUSES = [...EDITABLE, "LIVE"];
const field = (form, name) => {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
};

/** POST /upload-url (JSON): a 10-minute upload link for one photo. */
export const handleUploadUrl = (ctx, request, token) =>
  jsonAction(ctx, request, token, PHOTO_STATUSES, async (access) => ({
    upload: await startUpload(
      access.listing,
      {
        contentType: field(access.form, "contentType"),
        byteSize: field(access.form, "byteSize"),
      },
      access.actor,
    ),
  }));

/** POST /upload-complete (JSON): the upload is done; store the cleaned photo. */
export const handleUploadComplete = (ctx, request, token) =>
  jsonAction(ctx, request, token, PHOTO_STATUSES, async (access) => ({
    photo: await finishUpload(
      access.listing,
      field(access.form, "photoId"),
      access.actor,
    ),
  }));

/** POST /photo-delete (JSON). */
export const handlePhotoDelete = (ctx, request, token) =>
  jsonAction(ctx, request, token, PHOTO_STATUSES, async (access) => {
    await removePhoto(
      access.listing,
      field(access.form, "photoId"),
      access.actor,
    );
    return {};
  });

/** POST /photo-order (JSON): the new order, main photo first. */
export const handlePhotoOrder = (ctx, request, token) =>
  jsonAction(ctx, request, token, EDITABLE, async (access) => {
    await reorderPhotos(
      access.listing,
      access.form.getAll("photoIds").map(String),
      access.actor,
    );
    return {};
  });
