// Small boundary validators. Each returns the cleaned value or throws ValidationError.
// DECISION: hand-written instead of a schema library, to avoid a dependency (see F01-T1 notes).
import { ValidationError } from "./errors.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * @param {string} field
 * @param {string} problem
 * @returns {never}
 */
function fail(field, problem) {
  throw new ValidationError(`${field} ${problem}`, { [field]: problem });
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ min?: number, max?: number }} [limits]
 * @returns {string} trimmed
 */
export function requireString(value, field, { min = 1, max = 5000 } = {}) {
  if (typeof value !== "string") fail(field, "is required");
  const text = value.trim();
  if (text.length < min)
    fail(
      field,
      min <= 1 ? "is required" : `must be at least ${min} characters`,
    );
  if (text.length > max) fail(field, `must be at most ${max} characters`);
  return text;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ max?: number }} [limits]
 * @returns {string | null} trimmed, or null when empty
 */
export function optionalString(value, field, { max = 5000 } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(field, "must be text");
  const text = value.trim();
  if (text === "") return null;
  if (text.length > max) fail(field, `must be at most ${max} characters`);
  return text;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string} trimmed and lower-cased
 */
export function requireEmail(value, field) {
  const text = requireString(value, field, { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(text)) fail(field, "must be a valid email address");
  return text;
}

/**
 * @param {unknown} value a number or a numeric string (form data)
 * @param {string} field
 * @param {{ min?: number, max?: number }} [limits]
 * @returns {number}
 */
export function requireInt(
  value,
  field,
  { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {},
) {
  const isNumeric =
    typeof value === "number" ||
    (typeof value === "string" && /^-?\d+$/.test(value.trim()));
  const number = isNumeric ? Number(value) : NaN;
  if (!Number.isSafeInteger(number)) fail(field, "must be a whole number");
  if (number < min) fail(field, `must be at least ${min}`);
  if (number > max) fail(field, `must be at most ${max}`);
  return number;
}

/**
 * Money in integer cents, never negative.
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
export function requireCents(value, field) {
  return requireInt(value, field, { min: 0, max: 100_000_000 });
}

const AMOUNT_RE = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

/**
 * A typed dollar amount ("30", "30.5", "30.50") → integer cents, with no floating-point maths.
 * Range limits stay with the caller (`requireCents`, a fee range check).
 * DECISION (F01-FIX-4): anything that isn't a string is refused with the same message.
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
export function dollarsToCents(value, field) {
  const match = typeof value === "string" ? AMOUNT_RE.exec(value.trim()) : null;
  if (!match)
    throw new ValidationError(`${field} is not a valid amount`, {
      [field]: "must be an amount such as 30.00",
    });
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/**
 * Integer cents → "30.00", with integer maths. A formatter, kept next to its parser.
 * DECISION (F01-FIX-4): negative cents get a leading "-" ("-1.50"); non-integers are refused.
 * @param {number} cents
 * @returns {string}
 */
export function centsToDollars(cents) {
  if (!Number.isSafeInteger(cents))
    throw new ValidationError("cents must be whole cents", {
      cents: "must be whole cents",
    });
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * @template {string} T
 * @param {unknown} value
 * @param {readonly T[]} allowed
 * @param {string} field
 * @returns {T}
 */
export function requireEnum(value, allowed, field) {
  if (
    typeof value !== "string" ||
    !allowed.includes(/** @type {T} */ (value))
  ) {
    fail(field, `must be one of: ${allowed.join(", ")}`);
  }
  return /** @type {T} */ (value);
}

/**
 * A database id (cuid) or other short opaque identifier.
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
export function requireId(value, field) {
  if (typeof value !== "string" || !ID_RE.test(value))
    fail(field, "is not a valid id");
  return value;
}

/**
 * A list of ids (may be empty). Duplicates are dropped.
 * @param {unknown} value
 * @param {string} field
 * @param {{ max?: number }} [limits]
 * @returns {string[]}
 */
export function requireIdList(value, field, { max = 100 } = {}) {
  if (!Array.isArray(value)) fail(field, "must be a list of ids");
  const ids = [...new Set(value.map((id) => requireId(id, field)))];
  if (ids.length > max) fail(field, `must have at most ${max} items`);
  return ids;
}

/**
 * Validate form data against a shape, collecting every field problem into one error.
 * @template {Record<string, (value: unknown, field: string) => unknown>} S
 * @param {FormData} formData
 * @param {S} shape field name → validator
 * @returns {{ [K in keyof S]: ReturnType<S[K]> }}
 */
export function readForm(formData, shape) {
  /** @type {Record<string, unknown>} */
  const values = {};
  /** @type {Record<string, string>} */
  const fields = {};
  for (const [field, validate] of Object.entries(shape)) {
    const raw = formData.get(field);
    try {
      values[field] = validate(raw === null ? undefined : raw, field);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      Object.assign(fields, error.fields);
    }
  }
  if (Object.keys(fields).length > 0)
    throw new ValidationError("Some fields need attention", fields);
  return /** @type {{ [K in keyof S]: ReturnType<S[K]> }} */ (values);
}
