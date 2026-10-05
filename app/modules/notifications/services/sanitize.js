// The HTML allowed in an email body. Used when staff save a template and again on every
// rendered email, so nothing outside this list is ever sent.
import sanitizeHtml from "sanitize-html";

// A Liquid output or tag: {{ name }}, {% if … %}, with optional whitespace dashes.
export const LIQUID_TOKEN_RE = /\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}/g;

const OPTIONS = {
  allowedTags: [
    "p",
    "br",
    "hr",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "a",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "blockquote",
    "span",
    "div",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "width", "height"],
    th: ["colspan", "rowspan", "align"],
    td: ["colspan", "rowspan", "align"],
  },
  allowedSchemes: ["https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
};

/**
 * @param {string} html
 * @returns {string} with every tag, attribute and URL scheme outside the allow-list removed
 */
export function sanitizeEmailHtml(html) {
  return sanitizeHtml(html, OPTIONS);
}

/**
 * Sanitise a template body without disturbing its Liquid: each `{{ }}` and `{% %}` is set
 * aside while the HTML is cleaned and put back afterwards.
 * @param {string} source
 * @returns {string}
 */
export function sanitizeTemplateSource(source) {
  /** @type {string[]} */
  const kept = [];
  const guarded = source
    .replace(/__LQ\d+__/g, "")
    .replace(LIQUID_TOKEN_RE, (token) => `__LQ${kept.push(token) - 1}__`);
  return sanitizeEmailHtml(guarded).replace(
    /__LQ(\d+)__/g,
    (_, index) => kept[Number(index)] ?? "",
  );
}
