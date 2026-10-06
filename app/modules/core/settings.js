// The Settings singleton (row id 1). Created with the documented defaults on first read.
import prisma from "@/db.server";
import { requireStaff } from "./actors.js";
import { ConflictError, ValidationError } from "./errors.js";
import { writeAudit } from "./events.js";
import { requireCents, requireInt, requireString } from "./validators.js";

/** @typedef {import("./types.js").Settings} Settings */
/** @typedef {import("./types.js").SettingsPatch} SettingsPatch */
/** @typedef {import("./types.js").HeldMessageRules} HeldMessageRules */

// The three columns without a database default. Staff replace the rules text before launch.
const INITIAL = {
  id: 1,
  heldMessageRules: { holdOnLinks: true, keywords: [], repeatThreshold: 3 },
  rulesVersion: "draft-0",
  rulesText: "Listing rules have not been published yet.",
};

const WINDOW_DAYS = { min: 1, max: 60 };
const MAX_PHOTOS = { min: 1, max: 12 };
// DECISION: the spec gives no limits for the held-message rules; these keep the list usable.
const REPEAT_THRESHOLD = { min: 1, max: 20 };
const MAX_KEYWORDS = 50;
const MAX_KEYWORD_LENGTH = 60;
const HELD_RULE_KEYS = ["holdOnLinks", "keywords", "repeatThreshold"];
// DECISION: the spec gives no limit for the rules text; this is several pages.
const MAX_RULES_TEXT = 20000;
// Control characters other than tab and line feed.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {boolean}
 */
function requireBoolean(value, field) {
  if (typeof value !== "boolean")
    throw new ValidationError(`${field} must be true or false`, {
      [field]: "must be true or false",
    });
  return value;
}

/** @type {(value: unknown, field: string) => number} */
const windowDays = (value, field) => requireInt(value, field, WINDOW_DAYS);

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string[]} trimmed, lower-cased, without duplicates
 */
function keywordList(value, field) {
  const fail = (problem) => {
    throw new ValidationError(`${field} ${problem}`, { [field]: problem });
  };
  if (!Array.isArray(value)) fail("must be a list");
  const keywords = new Set();
  for (const item of value) {
    if (typeof item !== "string") fail("must be a list of words or phrases");
    const keyword = item.trim().toLowerCase();
    if (keyword === "") continue;
    if (keyword.length > MAX_KEYWORD_LENGTH)
      fail(`must be at most ${MAX_KEYWORD_LENGTH} characters each`);
    keywords.add(keyword);
  }
  if (keywords.size > MAX_KEYWORDS) fail(`must be at most ${MAX_KEYWORDS}`);
  return [...keywords];
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {HeldMessageRules}
 */
function heldMessageRules(value, field) {
  const isObject =
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (
    !isObject ||
    Object.keys(value).length !== HELD_RULE_KEYS.length ||
    !HELD_RULE_KEYS.every((key) => Object.hasOwn(value, key))
  )
    throw new ValidationError(`${field} is not valid`, {
      [field]: "is not valid",
    });
  const rules = /** @type {Record<string, unknown>} */ (value);
  return collect({
    holdOnLinks: () =>
      requireBoolean(rules.holdOnLinks, `${field}.holdOnLinks`),
    keywords: () => keywordList(rules.keywords, `${field}.keywords`),
    repeatThreshold: () =>
      requireInt(
        rules.repeatThreshold,
        `${field}.repeatThreshold`,
        REPEAT_THRESHOLD,
      ),
  });
}

/**
 * DECISION: the listing rules are plain text, never HTML. Angle brackets are refused, so the
 * text stays harmless even where a later screen forgets to escape it.
 * @param {unknown} value
 * @param {string} field
 * @returns {string} trimmed, with LF line endings and no control characters
 */
function rulesText(value, field) {
  const text = requireString(
    typeof value === "string"
      ? value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS_RE, "")
      : value,
    field,
    { max: MAX_RULES_TEXT },
  );
  if (/[<>]/.test(text))
    throw new ValidationError(`${field} must be plain text`, {
      [field]: "must be plain text without < or >",
    });
  return text;
}

/**
 * DECISION: published versions are numbered v1, v2, …; the seeded "draft-0" becomes "v1".
 * @param {string} version
 * @returns {string}
 */
function nextRulesVersion(version) {
  const number = Number(/(\d+)$/.exec(version)?.[1] ?? 0);
  return `v${number + 1}`;
}

// The only settings `updateSettings()` may change. The rules version is set here, never by the
// caller; feature switches and the Shopify ids have their own writers.
const EDITABLE = {
  baseFeeCents: requireCents,
  /** @type {(value: unknown, field: string) => number | null} */
  promoFeeCents: (value, field) =>
    value === null ? null : requireCents(value, field),
  paymentWindowDays: windowDays,
  draftWindowDays: windowDays,
  correctionWindowDays: windowDays,
  inviteExpiryDays: windowDays,
  /** @type {(value: unknown, field: string) => number} */
  maxPhotos: (value, field) => requireInt(value, field, MAX_PHOTOS),
  emailCodeRequired: requireBoolean,
  heldMessageRules,
  rulesText,
};

/**
 * Run each check, collecting every field problem into one error.
 * @template {Record<string, () => unknown>} C
 * @param {C} checks
 * @returns {{ [K in keyof C]: ReturnType<C[K]> }}
 */
function collect(checks) {
  /** @type {Record<string, unknown>} */
  const values = {};
  /** @type {Record<string, string>} */
  const fields = {};
  for (const [key, check] of Object.entries(checks)) {
    try {
      values[key] = check();
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      Object.assign(fields, error.fields);
    }
  }
  if (Object.keys(fields).length > 0)
    throw new ValidationError("Some fields need attention", fields);
  return /** @type {{ [K in keyof C]: ReturnType<C[K]> }} */ (values);
}

/**
 * @param {unknown} patch
 * @returns {SettingsPatch} validated; unknown keys are refused, not dropped
 */
function cleanPatch(patch) {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch))
    throw new ValidationError("settings are not valid", {
      settings: "are not valid",
    });
  const source = /** @type {Record<string, unknown>} */ (patch);
  return collect(
    Object.fromEntries(
      Object.keys(source).map((key) => [
        key,
        () => {
          if (!Object.hasOwn(EDITABLE, key))
            throw new ValidationError(`${key} cannot be changed here`, {
              [key]: "cannot be changed here",
            });
          return EDITABLE[key](source[key], key);
        },
      ]),
    ),
  );
}

/**
 * The stored rules in a fixed key order, so two equal sets of rules compare equal.
 * @param {unknown} rules
 * @returns {string}
 */
function rulesKey(rules) {
  const { holdOnLinks, keywords, repeatThreshold } =
    /** @type {HeldMessageRules} */ (rules ?? {});
  return JSON.stringify({ holdOnLinks, keywords, repeatThreshold });
}

/**
 * @param {{ tx?: import("@prisma/client").Prisma.TransactionClient }} [options]
 * @returns {Promise<Settings>}
 */
export async function getSettings({ tx } = {}) {
  const db = tx ?? prisma;
  const existing = await db.settings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  // Two first reads can race; the loser's insert is skipped and both read the same row.
  await db.settings.createMany({ data: [INITIAL], skipDuplicates: true });
  return db.settings.findUniqueOrThrow({ where: { id: 1 } });
}

/**
 * Change the settings staff edit on the Settings screen. A changed rules text also gets the
 * next rules version (reported in `changed` as `rulesVersion`). Staff only: call this from admin
 * routes, never from a seller or public route. Nothing is saved unless every field is valid.
 * @param {SettingsPatch} patch only the keys to change
 * @param {import("./types.js").ActorRef} actor
 * @returns {Promise<{ settings: Settings, changed: string[] }>} `changed` is empty when the
 *   patch matched what was already stored (nothing is written or audited then)
 * @throws {ValidationError} with one entry per field that needs attention
 * @throws {ConflictError} when another save changed the rules at the same time
 */
export async function updateSettings(patch, actor) {
  const staff = requireStaff(actor);
  const clean = cleanPatch(patch);

  return prisma.$transaction(async (tx) => {
    const current = await getSettings({ tx });
    const next = { ...current, ...clean };
    // DECISION: a promotional fee above the base fee is treated as a mistake and refused.
    if (next.promoFeeCents !== null && next.promoFeeCents > next.baseFeeCents)
      throw new ValidationError("promoFeeCents is above the base fee", {
        promoFeeCents: "must not be more than the base fee",
      });

    /** @type {Record<string, { from: unknown, to: unknown }>} */
    const changes = {};
    for (const [key, to] of Object.entries(clean)) {
      const from = current[key];
      const same =
        key === "heldMessageRules"
          ? rulesKey(from) === rulesKey(to)
          : from === to;
      if (!same) changes[key] = { from, to };
    }
    if (Object.keys(changes).length === 0)
      return { settings: current, changed: [] };

    const data = Object.fromEntries(
      Object.keys(changes).map((key) => [key, clean[key]]),
    );
    if (changes.rulesText) {
      data.rulesVersion = nextRulesVersion(current.rulesVersion);
      changes.rulesVersion = {
        from: current.rulesVersion,
        to: data.rulesVersion,
      };
    }
    const changed = Object.keys(changes);

    // Matching on the version read above stops two saves publishing the same version.
    const { count } = await tx.settings.updateMany({
      where: { id: 1, rulesVersion: current.rulesVersion },
      data,
    });
    if (count === 0)
      throw new ConflictError(
        "The settings were changed by someone else. Reload and try again.",
      );
    const settings = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
    // DECISION: a settings save is an audit entry only, not a bus event; nothing reacts to it.
    await writeAudit(
      { action: "SettingsUpdated", actor: staff, details: { changes } },
      { tx },
    );
    return { settings, changed };
  });
}
