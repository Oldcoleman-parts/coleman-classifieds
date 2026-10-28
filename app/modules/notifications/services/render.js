// Turns a template and its data into a subject, an HTML body and a plain-text body.
// Liquid runs in strict mode with a per-template list of placeholders and no file access;
// every value is HTML-escaped and only emails/layout.js writes raw HTML around the body.
import { convert } from "html-to-text";
import { Liquid } from "liquidjs";
import { ValidationError } from "@/modules/core/index.js";
import { renderLayout } from "../../../../emails/layout.js";
import {
  COMMON_PLACEHOLDERS,
  GET_LINK_PATH,
  templateDef,
} from "../registry.js";
import {
  LIQUID_TOKEN_RE,
  sanitizeEmailHtml,
  sanitizeTemplateSource,
} from "./sanitize.js";

/** @typedef {import("../registry.js").TemplateDef} TemplateDef */

const MAX_SUBJECT = 200;
const MAX_BODY = 50_000;
const MAX_VALUE = 2000;
const MAX_LIST = 50;

const PATH_RE = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/;
const FOR_RE = /^for\s+([a-z_][a-z0-9_]*)\s+in\s+([a-z_][a-z0-9_]*)$/;
const CONDITION_TAGS = ["if", "elsif", "unless"];
const BARE_TAGS = ["else", "endif", "endunless"];
const CONDITION_WORDS = [
  "and",
  "or",
  "contains",
  "blank",
  "empty",
  "true",
  "false",
  "nil",
];

// Templates never read files: `include`, `render` and `layout` are refused when a template
// is checked, and this stops them finding anything even so.
const NO_FILES = {
  exists: async () => false,
  existsSync: () => false,
  readFile: async () => {
    throw new Error("Templates cannot read files");
  },
  readFileSync: () => {
    throw new Error("Templates cannot read files");
  },
  resolve: (_root, file) => file,
  contains: () => false,
};
const STRICT = {
  strictVariables: true,
  strictFilters: true,
  lenientIf: true,
  ownPropertyOnly: true,
  fs: NO_FILES,
  relativeReference: false,
};
const bodyEngine = new Liquid({ ...STRICT, outputEscape: "escape" });
// A subject is plain text, so its values aren't HTML-escaped.
const subjectEngine = new Liquid(STRICT);

/**
 * @param {string} field
 * @param {string} problem
 * @returns {never}
 */
function fail(field, problem) {
  throw new ValidationError(`${field} ${problem}`, { [field]: problem });
}

/**
 * Check that a subject or body uses only the allowed Liquid: plain `{{ placeholder }}`
 * outputs from the template's list, `if`/`unless`, and `for` over the template's lists.
 * @param {TemplateDef} def
 * @param {string} source
 * @param {string} field
 * @returns {Set<string>} the placeholders the source outputs
 */
function checkLiquid(def, source, field) {
  const scalars = [...def.allowed, ...COMMON_PLACEHOLDERS].filter(
    (name) => !Object.hasOwn(def.loops ?? {}, name),
  );
  /** @type {Map<string, string[]>} loop item name → its fields */
  const items = new Map();
  /** @type {Set<string>} */
  const used = new Set();

  const checkPath = (path, { inCondition = false } = {}) => {
    const [root, child] = path.split(".");
    if (items.has(root)) {
      if (!child || !items.get(root).includes(child))
        fail(field, `uses "${path}", which is not available here`);
      return;
    }
    const isList = inCondition && Object.hasOwn(def.loops ?? {}, root);
    if (child || !(scalars.includes(root) || isList))
      fail(field, `uses "${path}", which is not a placeholder for this email`);
    if (!inCondition) used.add(root);
  };

  for (const match of source.matchAll(LIQUID_TOKEN_RE)) {
    if (match[1] !== undefined) {
      const path = match[1].trim();
      if (!PATH_RE.test(path))
        fail(field, "can only use plain placeholders such as {{ name }}");
      checkPath(path);
      continue;
    }
    const tag = match[2].trim();
    const name = tag.split(/\s+/)[0];
    if (BARE_TAGS.includes(tag) || (def.loops && tag === "endfor")) continue;
    if (CONDITION_TAGS.includes(name)) {
      const condition = tag.slice(name.length).replace(/"[^"]*"|'[^']*'/g, " ");
      if (!/^[\w\s.=!<>]*$/.test(condition))
        fail(field, `has a "${name}" condition that is not allowed`);
      for (const word of condition.match(/[a-z_][\w.]*/gi) ?? [])
        if (!CONDITION_WORDS.includes(word))
          checkPath(word, { inCondition: true });
      continue;
    }
    const loop = def.loops && FOR_RE.exec(tag);
    if (loop && Object.hasOwn(def.loops, loop[2])) {
      items.set(loop[1], def.loops[loop[2]]);
      // A required list stays only while the template loops over it.
      used.add(loop[2]);
      continue;
    }
    fail(field, `uses "{% ${name} %}", which is not allowed`);
  }
  if (/\{\{|\{%|%\}|\}\}/.test(source.replace(LIQUID_TOKEN_RE, "")))
    fail(field, "has an unfinished placeholder");
  return used;
}

/**
 * @param {string} name
 * @param {unknown} value
 * @param {string} field
 * @returns {string | number | boolean}
 */
function cleanValue(name, value, field) {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "string" || value.length > MAX_VALUE)
    fail(field, "is not valid");
  if (/_(?:link|url)$/.test(name) && value !== "") {
    let url;
    try {
      url = new URL(value);
    } catch {
      fail(field, "must be a link");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      fail(field, "must be an https link");
    // The help line only ever points at the "Get my link" page, so it can't carry a token.
    if (
      name === "get_link_url" &&
      (url.pathname !== GET_LINK_PATH || /[?#]/.test(value))
    )
      fail(field, "must be the Get my link page");
  }
  return value;
}

/**
 * Check the data for one email: only the template's placeholders, no nested objects, links
 * are https, and nothing required is missing.
 * @param {string} key
 * @param {unknown} vars
 * @returns {Record<string, unknown>}
 */
export function cleanVars(key, vars) {
  const def = templateDef(key);
  if (typeof vars !== "object" || vars === null || Array.isArray(vars))
    fail("vars", "are not valid");
  const source = /** @type {Record<string, unknown>} */ (vars);
  /** @type {Record<string, unknown>} */
  const clean = {};
  for (const [name, value] of Object.entries(source)) {
    if (!def.allowed.includes(name))
      fail(name, "is not a placeholder for this email");
    const fields = def.loops?.[name];
    if (!fields) {
      clean[name] = cleanValue(name, value, name);
      continue;
    }
    if (!Array.isArray(value) || value.length > MAX_LIST)
      fail(name, "is not valid");
    clean[name] = value.map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item))
        fail(name, "is not valid");
      return Object.fromEntries(
        Object.entries(item).map(([child, childValue]) => {
          if (!fields.includes(child)) fail(name, "is not valid");
          return [child, cleanValue(child, childValue, name)];
        }),
      );
    });
  }
  // A capped list shows its first items; the rest are counted here, never by the sender.
  for (const [name, limit] of Object.entries(def.limits ?? {})) {
    const list = /** @type {unknown[]} */ (clean[name] ?? []);
    clean.more_count = list.length > limit ? list.length - limit : "";
    if (clean[name]) clean[name] = list.slice(0, limit);
  }
  const needed =
    def.stream === "alerts"
      ? [...def.required, "unsubscribe_link"]
      : def.required;
  for (const name of needed)
    if (
      clean[name] === undefined ||
      clean[name] === "" ||
      (Array.isArray(clean[name]) && clean[name].length === 0)
    )
      fail(name, "is required");
  return clean;
}

/**
 * Check and clean a template before it is saved.
 * @param {string} key
 * @param {{ subject: unknown, bodyHtml: unknown }} input
 * @returns {Promise<{ subject: string, bodyHtml: string }>} the body sanitised
 * @throws {ValidationError} with one entry per field (`subject`, `bodyHtml`)
 */
export async function cleanTemplate(key, input) {
  const def = templateDef(key);
  if (typeof input?.subject !== "string" || typeof input?.bodyHtml !== "string")
    fail("bodyHtml", "is required");
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim();
  if (subject === "") fail("subject", "is required");
  if (subject.length > MAX_SUBJECT)
    fail("subject", `must be at most ${MAX_SUBJECT} characters`);
  if (input.bodyHtml.length > MAX_BODY)
    fail("bodyHtml", `must be at most ${MAX_BODY} characters`);
  const bodyHtml = sanitizeTemplateSource(input.bodyHtml).trim();
  if (bodyHtml === "") fail("bodyHtml", "is required");

  const used = new Set([
    ...checkLiquid(def, subject, "subject"),
    ...checkLiquid(def, bodyHtml, "bodyHtml"),
  ]);
  for (const name of def.required)
    if (!used.has(name))
      fail("bodyHtml", `must keep the {{ ${name} }} placeholder`);

  // A trial run with the sample data catches Liquid that doesn't parse (an unclosed "if").
  try {
    await renderParts(def, { subject, bodyHtml }, def.sample, {});
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    fail("bodyHtml", "has Liquid that could not be read");
  }
  return { subject, bodyHtml };
}

/**
 * @param {TemplateDef} def
 * @param {{ subject: string, bodyHtml: string }} template
 * @param {Record<string, unknown>} vars
 * @param {Record<string, unknown>} common
 * @returns {Promise<{ subject: string, bodyHtml: string }>}
 */
async function renderParts(def, template, vars, common) {
  // Every placeholder exists, so an optional one that wasn't given renders as nothing.
  const context = {
    ...Object.fromEntries(COMMON_PLACEHOLDERS.map((name) => [name, ""])),
    ...Object.fromEntries(
      def.allowed.map((name) => [name, def.loops?.[name] ? [] : ""]),
    ),
    ...common,
    ...vars,
  };
  const subject = (
    await subjectEngine.parseAndRender(template.subject, context)
  )
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, MAX_SUBJECT);
  const bodyHtml = sanitizeEmailHtml(
    await bodyEngine.parseAndRender(template.bodyHtml, context),
  );
  return { subject, bodyHtml };
}

/**
 * Render one email.
 * @param {string} key
 * @param {{ subject: string, bodyHtml: string }} template the stored template
 * @param {Record<string, unknown>} vars already checked with `cleanVars()`
 * @param {import("@prisma/client").EmailSettings} settings
 * @returns {Promise<{ subject: string, html: string, text: string }>}
 */
export async function renderEmail(key, template, vars, settings) {
  const def = templateDef(key);
  // The stored template is checked again: it must stay safe even if the row was changed
  // outside the app.
  checkLiquid(def, template.subject, "subject");
  checkLiquid(def, template.bodyHtml, "bodyHtml");
  const { subject, bodyHtml } = await renderParts(def, template, vars, {
    sender_name: settings.senderName,
    ocp_postal_address: settings.postalAddress ?? "",
    support_email: settings.supportEmail ?? "",
    phone: settings.phone ?? "",
  });
  if (subject === "") fail("subject", "is required");
  const html = renderLayout({
    bodyHtml,
    settings,
    unsubscribeLink:
      def.stream === "alerts" ? String(vars.unsubscribe_link ?? "") : null,
  });
  const text = convert(html, {
    wordwrap: 78,
    selectors: [{ selector: "img", format: "skip" }],
  });
  return { subject, html, text };
}
