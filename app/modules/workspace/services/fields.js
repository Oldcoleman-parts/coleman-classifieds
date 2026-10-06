// The listing's content fields: what a seller may type, and when the listing is complete
// enough to send for review. Everything is checked here, on the server, with length limits.
import { ValidationError } from "@/modules/core/index.js";

export const ARRANGEMENTS = ["PICKUP", "SHIPPING", "OTHER"];
export const PRIVATE_SELLER = "Private seller";

// DECISION (F04-T2): the spec gives no limits; these fit a classified ad and the metaobject.
export const LIMITS = {
  title: { min: 5, max: 120 },
  description: { min: 20, max: 5000 },
  condition: { max: 120 },
  knownIssues: { max: 2000 },
  contents: { max: 2000 },
  availabilityNote: { max: 120 },
  city: { max: 80 },
  state: { max: 40 },
  arrangementsNote: { max: 200 },
};
export const PRICE_CENTS = { min: 100, max: 10_000_000 };
export const QUANTITY = { min: 1, max: 999 };

const MULTILINE = ["description", "knownIssues", "contents"];
// Control characters other than tab and line feed.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const PRICE_RE = /^\d{1,7}(\.\d{1,2})?$/;

/**
 * Plain text only. DECISION: `<` and `>` are refused (as for the rules text), so seller text
 * stays harmless wherever it is shown.
 * @param {unknown} value
 * @param {string} field
 * @returns {string | null} trimmed, or null when empty
 */
function text(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw problem(field, "must be text");
  let clean = value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS_RE, "");
  if (!MULTILINE.includes(field)) clean = clean.replace(/\s+/g, " ");
  clean = clean.trim();
  if (clean === "") return null;
  const { max } = LIMITS[field];
  if (clean.length > max)
    throw problem(field, `must be at most ${max} characters`);
  if (/[<>]/.test(clean)) throw problem(field, "can’t contain < or >");
  return clean;
}

/**
 * Dollars as typed ("1,250", "$85.50") to cents.
 * @param {unknown} value
 * @returns {number | null}
 */
function price(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string")
    throw problem("askingPrice", "must be a price");
  const typed = value.replace(/[$,\s]/g, "");
  if (typed === "") return null;
  if (!PRICE_RE.test(typed))
    throw problem(
      "askingPrice",
      "must be a price in dollars, like 85 or 85.50",
    );
  const cents = Math.round(Number(typed) * 100);
  if (cents < PRICE_CENTS.min || cents > PRICE_CENTS.max)
    throw problem(
      "askingPrice",
      `must be between $${PRICE_CENTS.min / 100} and $${(PRICE_CENTS.max / 100).toLocaleString("en-US")}`,
    );
  return cents;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function quantity(value) {
  if (value === undefined || value === null) return null;
  const typed = typeof value === "string" ? value.trim() : value;
  if (typed === "") return null;
  if (typeof typed !== "string" || !/^\d{1,3}$/.test(typed))
    throw problem("quantityAvailable", "must be a whole number");
  const number = Number(typed);
  if (number < QUANTITY.min || number > QUANTITY.max)
    throw problem(
      "quantityAvailable",
      `must be between ${QUANTITY.min} and ${QUANTITY.max}`,
    );
  return number;
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function arrangements(values) {
  const chosen = [...new Set(values)];
  if (chosen.some((value) => !ARRANGEMENTS.includes(value)))
    throw problem("arrangements", "has an unknown choice");
  return ARRANGEMENTS.filter((value) => chosen.includes(value));
}

/**
 * DECISION: the seller picks how their name appears; the server writes the text, so a last
 * name can never be published. FIRST_NAME uses the first word of the invited name.
 * @param {unknown} value
 * @param {string} sellerName from the invitation
 * @returns {string | null}
 */
function sellerDisplay(value, sellerName) {
  if (value === undefined || value === null || value === "") return null;
  if (value === "PRIVATE") return PRIVATE_SELLER;
  if (value === "FIRST_NAME") return firstName(sellerName) || PRIVATE_SELLER;
  throw problem("sellerDisplay", "has an unknown choice");
}

/** @param {string} name */
export const firstName = (name) =>
  String(name ?? "")
    .trim()
    .split(/\s+/)[0]
    .slice(0, 40);

/**
 * @param {string | null} stored `Listing.sellerDisplay`
 * @returns {"FIRST_NAME" | "PRIVATE" | null} the choice to show as ticked
 */
export const sellerDisplayChoice = (stored) =>
  stored === null || stored === undefined
    ? null
    : stored === PRIVATE_SELLER
      ? "PRIVATE"
      : "FIRST_NAME";

const problem = (field, message) =>
  new ValidationError(`${field} ${message}`, { [field]: message });

/**
 * Run each check, collecting every field problem into one error.
 * @param {Array<[string, () => unknown]>} checks [listing field, check]
 * @param {Record<string, string>} [extra] problems found before
 * @returns {Record<string, unknown>}
 */
function collect(checks, extra = {}) {
  const values = {};
  const fields = { ...extra };
  for (const [key, check] of checks) {
    try {
      values[key] = check();
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      Object.assign(fields, error.fields);
    }
  }
  if (Object.keys(fields).length > 0)
    throw new ValidationError("Some fields need attention", fields);
  return values;
}

const DRAFT_TEXT = [
  "title",
  "description",
  "condition",
  "knownIssues",
  "contents",
  "availabilityNote",
  "city",
  "state",
  "arrangementsNote",
];

/**
 * The fields posted with a draft save. Only fields present in the form change; nothing is
 * required yet. Arrangements change only when the form says it showed them.
 * @param {FormData} form
 * @param {{ sellerName: string }} invitation
 * @returns {Record<string, unknown>} `Listing` columns to write
 * @throws {ValidationError}
 */
export function cleanDraft(form, invitation) {
  const has = (name) => form.has(name);
  const raw = (name) => form.get(name) ?? undefined;
  /** @type {Array<[string, () => unknown]>} */
  const checks = DRAFT_TEXT.filter(has).map((field) => [
    field,
    () => text(raw(field), field),
  ]);
  if (has("askingPrice"))
    checks.push(["askingPriceCents", () => price(raw("askingPrice"))]);
  if (has("quantityAvailable"))
    checks.push([
      "quantityAvailable",
      () => quantity(raw("quantityAvailable")),
    ]);
  if (has("arrangementsShown"))
    checks.push([
      "arrangements",
      () => arrangements(form.getAll("arrangements").map(String)),
    ]);
  if (has("sellerDisplay"))
    checks.push([
      "sellerDisplay",
      () => sellerDisplay(raw("sellerDisplay"), invitation.sellerName),
    ]);
  return collect(checks);
}

/**
 * Is the saved listing complete enough to send for review?
 * @param {object} listing the saved row
 * @param {number} photoCount current (not deleted) photos
 * @returns {Record<string, string>} field → problem; empty when it may be submitted
 */
export function submitProblems(listing, photoCount) {
  const problems = {};
  const need = (field, label = "is required") => {
    problems[field] = label;
  };
  for (const field of ["title", "description"]) {
    const value = listing[field] ?? "";
    if (value.length < LIMITS[field].min)
      need(
        field,
        value === ""
          ? "is required"
          : `must be at least ${LIMITS[field].min} characters`,
      );
  }
  for (const field of ["condition", "city", "state"])
    if (!listing[field]) need(field);
  if (listing.askingPriceCents === null) need("askingPrice");
  if (!listing.sellerDisplay)
    need("sellerDisplay", "choose how your name appears");
  if (listing.arrangements.length === 0)
    need("arrangements", "choose at least one");
  if (listing.arrangements.includes("OTHER") && !listing.arrangementsNote)
    need("arrangementsNote", "say what the other arrangement is");
  if (photoCount < 1) need("photos", "add at least one photo");
  return problems;
}

/**
 * The immediate fields of a live listing: price, quantity and availability note.
 * @param {FormData} form
 * @returns {{ askingPriceCents: number, quantityAvailable: number | null, availabilityNote: string | null }}
 * @throws {ValidationError}
 */
export function cleanImmediate(form) {
  const raw = (name) => form.get(name) ?? undefined;
  return /** @type {any} */ (
    collect([
      [
        "askingPriceCents",
        () => {
          const cents = price(raw("askingPrice") ?? "");
          if (cents === null) throw problem("askingPrice", "is required");
          return cents;
        },
      ],
      ["quantityAvailable", () => quantity(raw("quantityAvailable"))],
      [
        "availabilityNote",
        () => text(raw("availabilityNote"), "availabilityNote"),
      ],
    ])
  );
}

/**
 * The reviewed text fields of a live listing: title and description, both required.
 * @param {FormData} form
 * @returns {{ title: string, description: string }}
 * @throws {ValidationError}
 */
export function cleanRevision(form) {
  const raw = (name) => form.get(name) ?? undefined;
  const required = (field) => () => {
    const value = text(raw(field), field) ?? "";
    if (value.length < LIMITS[field].min)
      throw problem(
        field,
        value === ""
          ? "is required"
          : `must be at least ${LIMITS[field].min} characters`,
      );
    return value;
  };
  return /** @type {any} */ (
    collect([
      ["title", required("title")],
      ["description", required("description")],
    ])
  );
}

const REVISABLE = ["title", "description"];

/**
 * The stored `ListingRevision.changes`, checked again before they reach the listing: only title
 * and description, with the same rules as the form. Other keys are dropped.
 * @param {unknown} changes
 * @returns {{ title?: string, description?: string }}
 * @throws {ValidationError}
 */
export function cleanRevisionChanges(changes) {
  if (typeof changes !== "object" || changes === null || Array.isArray(changes))
    throw problem("changes", "are not valid");
  const source = /** @type {Record<string, unknown>} */ (changes);
  return /** @type {any} */ (
    collect(
      REVISABLE.filter((field) => Object.hasOwn(source, field)).map((field) => [
        field,
        () => {
          const value = text(source[field], field) ?? "";
          if (value.length < LIMITS[field].min)
            throw problem(
              field,
              `must be at least ${LIMITS[field].min} characters`,
            );
          return value;
        },
      ]),
    )
  );
}
