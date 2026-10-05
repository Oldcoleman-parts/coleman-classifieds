// The Settings screen: turns the stored settings into form values and a submitted form into
// a core settings change. Core owns the table and the rules for what may be saved.
import {
  getSettings,
  updateSettings,
  ValidationError,
} from "@/modules/core/index.js";

/**
 * What the Settings form shows. Fees are dollar amounts; keywords are one per line.
 * @typedef {object} SettingsFormValues
 * @property {string} baseFee
 * @property {string} promoFee empty when there is no promotional fee
 * @property {number} paymentWindowDays
 * @property {number} draftWindowDays
 * @property {number} correctionWindowDays
 * @property {number} inviteExpiryDays
 * @property {number} maxPhotos
 * @property {boolean} emailCodeRequired
 * @property {boolean} holdOnLinks
 * @property {string} keywords
 * @property {number} repeatThreshold
 * @property {string} rulesText
 * @property {string} rulesVersion shown only; core sets it when the text changes
 */

const AMOUNT_RE = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

// Core field name → form field name, where they differ.
const FORM_FIELD = {
  baseFeeCents: "baseFee",
  promoFeeCents: "promoFee",
  "heldMessageRules.holdOnLinks": "holdOnLinks",
  "heldMessageRules.keywords": "keywords",
  "heldMessageRules.repeatThreshold": "repeatThreshold",
};

/**
 * @param {number} cents
 * @returns {string} for example "30.00"
 */
function centsToDollars(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * @param {string} text a dollar amount such as "30" or "30.50"
 * @param {string} field
 * @returns {number} integer cents (no floating-point maths)
 */
function dollarsToCents(text, field) {
  const match = AMOUNT_RE.exec(text);
  if (!match)
    throw new ValidationError(`${field} is not a valid amount`, {
      [field]: "must be an amount such as 30.00",
    });
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/**
 * @param {FormData} formData
 * @param {string} field
 * @returns {string} trimmed; empty when the field is missing or is a file
 */
function text(formData, field) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The editable settings as form values. Nothing else from the Settings row leaves the server.
 * @returns {Promise<SettingsFormValues>}
 */
export async function loadSettingsForm() {
  const settings = await getSettings();
  const rules =
    /** @type {import("@/modules/core/types.js").HeldMessageRules} */ (
      settings.heldMessageRules
    );
  return {
    baseFee: centsToDollars(settings.baseFeeCents),
    promoFee:
      settings.promoFeeCents === null
        ? ""
        : centsToDollars(settings.promoFeeCents),
    paymentWindowDays: settings.paymentWindowDays,
    draftWindowDays: settings.draftWindowDays,
    correctionWindowDays: settings.correctionWindowDays,
    inviteExpiryDays: settings.inviteExpiryDays,
    maxPhotos: settings.maxPhotos,
    emailCodeRequired: settings.emailCodeRequired,
    holdOnLinks: rules.holdOnLinks,
    keywords: rules.keywords.join("\n"),
    repeatThreshold: rules.repeatThreshold,
    rulesText: settings.rulesText,
    rulesVersion: settings.rulesVersion,
  };
}

/**
 * Save the submitted Settings form.
 * @param {FormData} formData
 * @param {import("@/modules/core/types.js").ActorRef} actor the staff member, from the session
 * @returns {Promise<{ ok: true, changed: string[] } | { ok: false, fieldErrors: Record<string, string> }>}
 *   field errors are keyed by form field name
 */
export async function saveSettingsForm(formData, actor) {
  try {
    const promoFee = text(formData, "promoFee");
    const { changed } = await updateSettings(
      {
        baseFeeCents: dollarsToCents(text(formData, "baseFee"), "baseFee"),
        promoFeeCents:
          promoFee === "" ? null : dollarsToCents(promoFee, "promoFee"),
        paymentWindowDays: text(formData, "paymentWindowDays"),
        draftWindowDays: text(formData, "draftWindowDays"),
        correctionWindowDays: text(formData, "correctionWindowDays"),
        inviteExpiryDays: text(formData, "inviteExpiryDays"),
        maxPhotos: text(formData, "maxPhotos"),
        // A switch or checkbox is only submitted when it is on.
        emailCodeRequired: formData.has("emailCodeRequired"),
        heldMessageRules: {
          holdOnLinks: formData.has("holdOnLinks"),
          keywords: text(formData, "keywords")
            .split(/[\n,]/)
            .map((keyword) => keyword.trim())
            .filter(Boolean),
          repeatThreshold: text(formData, "repeatThreshold"),
        },
        ...(formData.has("rulesText")
          ? { rulesText: text(formData, "rulesText") }
          : {}),
      },
      actor,
    );
    return { ok: true, changed };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return {
      ok: false,
      fieldErrors: Object.fromEntries(
        Object.entries(error.fields).map(([field, problem]) => [
          FORM_FIELD[field] ?? field,
          problem,
        ]),
      ),
    };
  }
}
