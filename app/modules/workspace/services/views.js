// The seller's listing page, one view per listing status, rendered inside the theme (Liquid).
// Every value is escaped with `escapeHtml` (which also escapes `{ } %`), and the browser data
// and script sit inside `{% raw %}`, so nothing the seller types can become HTML or Liquid.
import { shopTimeZone } from "@/modules/core/index.js";
import {
  deviceStorageKey,
  escapeHtml as h,
  scriptJson,
  sellerLayout,
  sellerPath,
} from "@/modules/access/index.js";
import {
  ARRANGEMENTS,
  firstName,
  LIMITS,
  PRICE_CENTS,
  PRIVATE_SELLER,
  QUANTITY,
  sellerDisplayChoice,
} from "./fields.js";
import { pageScript } from "./page-script.js";

/**
 * @typedef {object} PageModel
 * @property {string} token
 * @property {object} invitation
 * @property {object} listing
 * @property {object} settings
 * @property {string} formToken
 * @property {Array<{ id: string, isMain: boolean, approved: boolean, published: boolean, previewUrl: string }>} [photos]
 * @property {boolean} [photosAvailable]
 * @property {{ id: string, changes: object, photoIds: string[] } | null} [pending] a PENDING revision
 * @property {Record<string, string>} [errors] field → problem
 * @property {FormData | null} [typed] what was posted, to fill the form again after an error
 * @property {string} [notice]
 */

const money = (cents) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** @param {Date | null} date */
export function formatDate(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: shopTimeZone(),
    timeZoneName: "short",
  }).format(date);
}

const STYLE = `<style>
.cc-seller fieldset{border:1px solid rgba(0,0,0,.15);border-radius:6px;padding:1rem;margin:0 0 1.25rem}
.cc-seller legend{font-weight:600;padding:0 .25rem}
.cc-seller label{display:block;font-weight:600;margin:.75rem 0 .25rem}
.cc-seller input[type=text],.cc-seller input[type=number],.cc-seller input:not([type]),.cc-seller textarea{width:100%;box-sizing:border-box;max-width:100%}
.cc-seller .cc-tag{display:inline-block;font-size:.75em;font-weight:600;padding:0 .4em;border-radius:3px;margin-left:.35em;vertical-align:middle}
.cc-seller .cc-public{background:#e3f1df;color:#1e4620}
.cc-seller .cc-private{background:#fbeae5;color:#5c1a0a}
.cc-seller .cc-error{color:#b42318;font-weight:600;margin:.25rem 0 0}
.cc-seller .cc-hint{font-size:.9em;opacity:.8;margin:.25rem 0 0}
.cc-seller .cc-photos{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:.75rem}
.cc-seller .cc-photos img{width:100%;height:auto;display:block;border-radius:4px}
.cc-seller .cc-rules{white-space:pre-line;max-height:16rem;overflow:auto;border:1px solid rgba(0,0,0,.15);padding:.75rem;border-radius:4px}
.cc-seller .cc-actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1rem}
.cc-seller .cc-notice{padding:.75rem;border-radius:4px;background:#fff8e1}
</style>`;

const PUBLIC = `<span class="cc-tag cc-public">Public</span>`;
const PRIVATE = `<span class="cc-tag cc-private">Private</span>`;

/** The hidden fields every seller POST carries: the form token and this device's credential. */
const authFields = (formToken) =>
  `<input type="hidden" name="csrf" value="${h(formToken)}"><input type="hidden" name="device" data-cc-device value="">`;

function errorSummary(errors) {
  if (!errors || Object.keys(errors).length === 0) return "";
  return `<div class="cc-notice" role="alert"><strong>Please check the highlighted fields.</strong>${
    errors.revision
      ? `<p class="cc-error">${h(capitalise(errors.revision))}</p>`
      : ""
  }</div>`;
}

const fieldError = (errors, name) =>
  errors?.[name]
    ? `<p class="cc-error" id="cc-err-${h(name)}">${h(capitalise(errors[name]))}</p>`
    : "";

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** The value to show in a field: what was just posted, else what is saved. */
function valueOf(model, name) {
  if (model.typed?.has(name)) return String(model.typed.get(name) ?? "");
  const { listing } = model;
  if (name === "askingPrice")
    return listing.askingPriceCents === null
      ? ""
      : (listing.askingPriceCents / 100).toFixed(2);
  return listing[name] === null || listing[name] === undefined
    ? ""
    : String(listing[name]);
}

/**
 * One labelled text field.
 * @param {PageModel} model
 * @param {{ name: string, label: string, multiline?: boolean, required?: boolean, hint?: string, max?: number, inputmode?: string, tag?: string }} field
 */
function textField(
  model,
  { name, label, multiline, required, hint, max, inputmode, tag = PUBLIC },
) {
  const id = `cc-${name}`;
  const value = valueOf(model, name);
  const limit = max ?? LIMITS[name]?.max;
  const attrs = `id="${id}" name="${h(name)}"${limit ? ` maxlength="${limit}"` : ""}${inputmode ? ` inputmode="${inputmode}"` : ""}${model.errors?.[name] ? ` aria-invalid="true" aria-describedby="cc-err-${h(name)}"` : ""}`;
  return `<label for="${id}">${h(label)}${required ? " *" : ""} ${tag}</label>
${multiline ? `<textarea ${attrs} rows="${name === "description" ? 8 : 4}">${h(value)}</textarea>` : `<input type="text" ${attrs} value="${h(value)}">`}
${hint ? `<p class="cc-hint">${h(hint)}</p>` : ""}${fieldError(model.errors, name)}`;
}

function feeBlock(invitation) {
  const offered = money(invitation.feeOfferedCents);
  const regular = money(invitation.feeRegularCents);
  const price =
    invitation.feeOfferedCents < invitation.feeRegularCents
      ? `<s>${h(regular)}</s> <strong>${h(offered)}</strong>`
      : `<strong>${h(offered)}</strong>`;
  return `<p>Listing fee: ${price} for one calendar month. You’re only charged after staff approve your listing.</p>`;
}

const SERVICE_INFO = `<p>Old Coleman Parts lists your item in its private-seller classifieds. Buyers contact you through a private email relay, so your email address is never shown. OCP only sells the advertising space: the sale itself is between you and the buyer.</p>`;

function rulesBlock(settings) {
  return `<h2>Listing rules</h2><div class="cc-rules">${h(settings.rulesText)}</div>`;
}

function photoList(model, { canDelete, canReorder }) {
  const { photos = [], pending } = model;
  if (photos.length === 0) return `<p>No photos yet.</p>`;
  const items = photos
    .map((photo) => {
      const labels = [
        photo.isMain ? "Main photo" : "",
        model.listing.status === "LIVE" && !photo.approved
          ? pending?.photoIds.includes(photo.id)
            ? "Waiting for staff review"
            : "Not sent for review yet"
          : "",
      ].filter(Boolean);
      return `<li data-photo-id="${h(photo.id)}"><img src="${h(photo.previewUrl)}" alt="Listing photo" loading="lazy">
${labels.map((label) => `<p class="cc-hint">${h(label)}</p>`).join("")}
<div class="cc-actions">${canReorder && !photo.isMain ? `<button type="button" class="button" data-photo-up="${h(photo.id)}">Move up</button>` : ""}${canDelete ? `<button type="button" class="button" data-photo-delete="${h(photo.id)}">Remove</button>` : ""}</div></li>`;
    })
    .join("");
  return `<ul class="cc-photos" id="cc-photo-list">${items}</ul>`;
}

function photoUpload(model, max) {
  if (model.photosAvailable === false)
    return `<p class="cc-notice">Photo uploads aren’t available just now. Please try again later.</p>`;
  return `<label for="cc-photo-input">Add photos</label>
<input type="file" id="cc-photo-input" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple>
<p class="cc-hint">Up to ${h(max)} photos. Location data is removed from every photo.</p>
<p id="cc-photo-status" role="status"></p>`;
}

function pageData(model, extra = {}) {
  return {
    base: sellerPath(model.token),
    formToken: model.formToken,
    deviceKey: deviceStorageKey(model.invitation.id),
    ...extra,
  };
}

/**
 * The browser data and script, kept away from Liquid. `pageScript()` guarantees no `{% endraw`
 * and no `</script` inside.
 */
function scripts(model, extra) {
  return `{% raw %}<script type="application/json" id="cc-data">${scriptJson(pageData(model, extra))}</script>
<script>${pageScript()}</script>{% endraw %}`;
}

/** Re-opens the page by POST with this device's credential (a GET would need the code again). */
const refreshForm = (model) =>
  `<form id="cc-refresh" method="post" action="${h(sellerPath(model.token))}" hidden><input type="hidden" name="device" data-cc-device value=""></form>`;

function noticeBlock(notice) {
  return notice
    ? `<p class="cc-notice" role="status"><strong>${h(notice)}</strong></p>`
    : "";
}

/** @param {PageModel} model */
function introView(model) {
  const { invitation, settings } = model;
  return `${SERVICE_INFO}
<p>Hello ${h(firstName(invitation.sellerName))}, this is the private page for your listing of <strong>${h(invitation.itemSummary)}</strong>.</p>
${feeBlock(invitation)}
<p>A listing runs for one calendar month from the day it goes live. Once you start, you have ${h(settings.draftWindowDays)} days to send it for review. Your progress is saved as you go, so you can leave and come back.</p>
${rulesBlock(settings)}
<form method="post" action="${h(`${sellerPath(model.token)}/start`)}">${authFields(model.formToken)}
<div class="cc-actions"><button type="submit" class="button">Start my listing</button></div></form>`;
}

/** @param {PageModel} model */
function editView(model) {
  const { invitation, listing, settings } = model;
  const base = sellerPath(model.token);
  const correcting = listing.status === "CHANGES_REQUESTED";
  const due = correcting ? listing.correctionDueBy : listing.draftDueBy;
  const arrangementsTyped = model.typed?.has("arrangementsShown")
    ? model.typed.getAll("arrangements").map(String)
    : listing.arrangements;
  const choice = model.typed?.has("sellerDisplay")
    ? String(model.typed.get("sellerDisplay"))
    : sellerDisplayChoice(listing.sellerDisplay);
  const name = firstName(invitation.sellerName);
  const arrangementLabels = {
    PICKUP: "Pickup",
    SHIPPING: "Shipping",
    OTHER: "Other",
  };

  // DECISION (F04-T2): core keeps the staff note only in the audit log, which no module may
  // read yet (follow-up ticket). The email the seller received carries it.
  const correctionBlock = correcting
    ? `<div class="cc-notice"><p><strong>Staff have asked for some changes.</strong> The details are in the email we sent you. Make the changes and send your listing back before the correction deadline: <strong>${h(formatDate(due))}</strong>.</p></div>`
    : `<p>Send your listing for review by <strong>${h(formatDate(due))}</strong>. After that, this link stops working.</p>`;

  return `${correctionBlock}
${feeBlock(invitation)}
<p>Fields marked ${PUBLIC} appear on your public listing. Fields marked ${PRIVATE} are never shown publicly. * means required before you send it for review.</p>
${errorSummary(model.errors)}
<form id="cc-listing" method="post" action="${h(`${base}/draft`)}" novalidate>${authFields(model.formToken)}
<input type="hidden" name="arrangementsShown" value="1">
<input type="hidden" name="rulesVersion" value="${h(settings.rulesVersion)}">
<fieldset><legend>About the item</legend>
${textField(model, { name: "title", label: "Title", required: true, hint: "For example: Coleman 200A lantern, red, 1951" })}
${textField(model, { name: "description", label: "Description", multiline: true, required: true })}
${textField(model, { name: "condition", label: "Condition", required: true, hint: "For example: working, cleaned, new generator" })}
${textField(model, { name: "knownIssues", label: "Known issues", multiline: true })}
${textField(model, { name: "contents", label: "What’s included", multiline: true, hint: "Accessories and manuals only together with the equipment." })}
</fieldset>
<fieldset><legend>Price and availability</legend>
${textField(model, { name: "askingPrice", label: "Asking price (US$)", required: true, inputmode: "decimal", max: 12, hint: `Between ${money(PRICE_CENTS.min)} and ${money(PRICE_CENTS.max)}.` })}
${textField(model, { name: "quantityAvailable", label: "Quantity", inputmode: "numeric", max: 3, hint: `If you have more than one (${QUANTITY.min}–${QUANTITY.max}).` })}
${textField(model, { name: "availabilityNote", label: "Availability note", hint: "For example: 3 of 11 lanterns left" })}
</fieldset>
<fieldset><legend>Where and how</legend>
${textField(model, { name: "city", label: "City", required: true })}
${textField(model, { name: "state", label: "State", required: true })}
<p><strong>Pickup, shipping or other *</strong> ${PUBLIC}</p>
${ARRANGEMENTS.map((value) => `<label><input type="checkbox" name="arrangements" value="${value}"${arrangementsTyped.includes(value) ? " checked" : ""}> ${arrangementLabels[value]}</label>`).join("")}
${fieldError(model.errors, "arrangements")}
${textField(model, { name: "arrangementsNote", label: "Arrangements note", hint: "Needed when you choose Other." })}
</fieldset>
<fieldset><legend>Your name on the listing *</legend>
<p>Buyers see this name ${PUBLIC}. Your last name is never shown.</p>
<label><input type="radio" name="sellerDisplay" value="FIRST_NAME"${choice === "FIRST_NAME" ? " checked" : ""}> ${h(name || PRIVATE_SELLER)}</label>
<label><input type="radio" name="sellerDisplay" value="PRIVATE"${choice === "PRIVATE" ? " checked" : ""}> ${h(PRIVATE_SELLER)}</label>
${fieldError(model.errors, "sellerDisplay")}
</fieldset>
<fieldset><legend>Your details ${PRIVATE}</legend>
<p>Name: ${h(invitation.sellerName)}<br>Email: ${h(invitation.sellerEmail)}</p>
<p class="cc-hint">Never shown publicly. Buyers’ messages reach you through our private relay.</p>
</fieldset>
<fieldset><legend>Photos *</legend>
${photoList(model, { canDelete: true, canReorder: true })}
${fieldError(model.errors, "photos")}
${photoUpload(model, settings.maxPhotos)}
</fieldset>
${rulesBlock(settings)}
<label><input type="checkbox" name="agree" value="on"> I have read and agree to the listing rules (version ${h(settings.rulesVersion)}). *</label>
${fieldError(model.errors, "agree")}
<p id="cc-save-status" class="cc-hint" role="status"></p>
<div class="cc-actions"><button type="submit" class="button">Save draft</button>
<button type="submit" class="button" formaction="${h(`${base}/submit`)}">${correcting ? "Send my changes for review" : "Send for review"}</button></div>
</form>
`;
}

/** @param {PageModel} model */
function submittedView(model) {
  const { listing } = model;
  return `<p>Thanks! Your listing <strong>${h(listing.title)}</strong> is with our staff for review. We’ll email you when it’s approved or if anything needs changing.</p>
<p>You can’t edit it while it’s being reviewed.</p>`;
}

/** @param {PageModel} model */
function awaitingPaymentView(model) {
  // Placeholder until the pay stage (F06).
  return `<p>Good news: your listing <strong>${h(model.listing.title)}</strong> has been approved.</p>
${feeBlock(model.invitation)}
<p>Please pay by <strong>${h(formatDate(model.listing.paymentDueBy))}</strong>. We’ve emailed you a payment link. Your listing goes live as soon as payment is received.</p>`;
}

/** @param {PageModel} model */
function lapsedView() {
  return `<p>The payment window for this listing has passed, so it didn’t go live. Contact Old Coleman Parts if you’d still like to list it.</p>`;
}

function closeForms(model) {
  const base = sellerPath(model.token);
  return `<h2>Sold or no longer available?</h2>
<div class="cc-actions">
<form method="post" action="${h(`${base}/sold`)}">${authFields(model.formToken)}<button type="submit" class="button">Mark as sold</button></form>
<form method="post" action="${h(`${base}/remove`)}">${authFields(model.formToken)}<button type="submit" class="button">Remove my listing</button></form>
</div>`;
}

/** @param {PageModel} model */
function liveView(model) {
  const { listing, pending, settings } = model;
  const base = sellerPath(model.token);
  const canAdd = !pending;
  return `<p><strong>Your listing is live until ${h(formatDate(listing.expiresAt))}.</strong></p>
${errorSummary(model.errors)}
<form method="post" action="${h(`${base}/live`)}" novalidate>${authFields(model.formToken)}
<fieldset><legend>Price and availability</legend>
<p class="cc-hint">These changes show on your listing straight away.</p>
${textField(model, { name: "askingPrice", label: "Asking price (US$)", required: true, inputmode: "decimal", max: 12 })}
${textField(model, { name: "quantityAvailable", label: "Quantity", inputmode: "numeric", max: 3 })}
${textField(model, { name: "availabilityNote", label: "Availability note" })}
<div class="cc-actions"><button type="submit" class="button">Update now</button></div>
</fieldset></form>
<form method="post" action="${h(`${base}/revision`)}" novalidate>${authFields(model.formToken)}
<fieldset><legend>Title, description and new photos</legend>
<p class="cc-hint">Staff review these changes first. Your listing stays as it is until they’re approved.</p>
${pending ? `<p class="cc-notice">Your last changes are with staff. You can send more once they’ve been reviewed.</p>` : ""}
${textField(model, { name: "title", label: "Title", required: true })}
${textField(model, { name: "description", label: "Description", multiline: true, required: true })}
<div class="cc-actions"><button type="submit" class="button"${pending ? " disabled" : ""}>Send changes for review</button></div>
</fieldset></form>
<fieldset><legend>Photos</legend>
<p class="cc-hint">Removing a photo takes it off your listing straight away. New photos appear once staff approve them: add them, then press “Send changes for review”.</p>
${photoList(model, { canDelete: true, canReorder: false })}
${canAdd ? photoUpload(model, settings.maxPhotos) : ""}
</fieldset>
${closeForms(model)}
`;
}

/** @param {PageModel} model */
function pausedView(model) {
  return `<p>Your listing is paused by Old Coleman Parts and isn’t shown at the moment. We’ll be in touch by email.</p>
${closeForms(model)}`;
}

const EDIT_STATUSES = ["DRAFT", "CHANGES_REQUESTED"];

const VIEWS = {
  INVITED: ["Your listing", introView],
  DRAFT: ["Your listing", editView],
  CHANGES_REQUESTED: ["Your listing: changes requested", editView],
  SUBMITTED: ["Your listing is being reviewed", submittedView],
  APPROVED_AWAITING_PAYMENT: ["Your listing is approved", awaitingPaymentView],
  LAPSED: ["Payment window passed", lapsedView],
  LIVE: ["Your live listing", liveView],
  PAUSED: ["Your listing is paused", pausedView],
};

/**
 * The seller's page for the listing's current status.
 * @param {(body: string, init?: object) => Response} liquid
 * @param {PageModel} model
 * @param {number} [status] HTTP status (422 after a validation error)
 */
export function stagePage(liquid, model, status = 200) {
  const [title, view] = VIEWS[model.listing.status] ?? [
    "This listing has ended",
    () => `<p>This link no longer opens a listing.</p>`,
  ];
  return sellerLayout(
    liquid,
    title,
    // Every stage page carries the script: it fills in this device's credential, which every
    // form (Start, sold, remove, …) must send when Settings require email codes.
    `${STYLE}${noticeBlock(model.notice)}${view(model)}
${refreshForm(model)}
${scripts(model, { autosave: EDIT_STATUSES.includes(model.listing.status) })}`,
    status,
  );
}

const CONFIRM = {
  sold: [
    "Mark as sold?",
    "Your listing will be taken down and closed. This can’t be undone.",
    "Yes, it’s sold",
  ],
  remove: [
    "Remove your listing?",
    "Your listing will be taken down and closed. This can’t be undone, and the fee isn’t refunded.",
    "Yes, remove it",
  ],
};

/**
 * The confirmation step before marking sold or removing.
 * @param {(body: string, init?: object) => Response} liquid
 * @param {PageModel} model
 * @param {"sold" | "remove"} kind
 */
export function confirmPage(liquid, model, kind) {
  const [title, text, button] = CONFIRM[kind];
  const base = sellerPath(model.token);
  return sellerLayout(
    liquid,
    title,
    `${STYLE}<p>${h(text)}</p>
<form method="post" action="${h(`${base}/${kind}`)}">${authFields(model.formToken)}<input type="hidden" name="confirm" value="yes">
<div class="cc-actions"><button type="submit" class="button">${h(button)}</button></div></form>
<form method="post" action="${h(base)}"><input type="hidden" name="device" data-cc-device value=""><div class="cc-actions"><button type="submit" class="button">No, go back</button></div></form>
${scripts(model, { autosave: false })}`,
  );
}

/**
 * After the listing was closed by the seller.
 * @param {(body: string, init?: object) => Response} liquid
 * @param {"sold" | "remove"} kind
 */
export function closedPage(liquid, kind) {
  return sellerLayout(
    liquid,
    kind === "sold"
      ? "Congratulations on the sale"
      : "Your listing was removed",
    `<p>Your listing has been taken down and this link is now closed. Thank you for using Old Coleman Parts classifieds.</p>`,
  );
}
