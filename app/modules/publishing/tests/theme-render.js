// Renders the storefront Liquid (extensions/classifieds-theme and the header snippet) with
// liquidjs. Shopify's own pieces are stubbed: the `t`, `money`, `date`, `newline_to_br` and
// `default_pagination` filters, the objects (`shop`, `routes`, `request`, `block`), and the
// `paginate` and `schema` tags, which only Shopify understands. Everything else is liquidjs.
import { readFileSync } from "node:fs";
import { Liquid } from "liquidjs";
import {
  buildFields,
  FIELD_DEFINITIONS,
} from "@/modules/publishing/services/fields.js";

const ROOT = new URL("../../../../", import.meta.url);
export const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

/** The files under test, by name. */
export const THEME_FILES = {
  listing: "extensions/classifieds-theme/blocks/listing.liquid",
  browse: "extensions/classifieds-theme/blocks/browse.liquid",
  noindex: "extensions/classifieds-theme/blocks/noindex.liquid",
  card: "extensions/classifieds-theme/snippets/classifieds-card.liquid",
  img: "extensions/classifieds-theme/snippets/classifieds-img.liquid",
  header: "theme-snippets/classifieds-header-button.liquid",
};

const LOCALE = JSON.parse(
  read("extensions/classifieds-theme/locales/en.default.json"),
);
const LIST_KEYS = new Set(
  FIELD_DEFINITIONS.filter((field) => field.type.startsWith("list.")).map(
    (field) => field.key,
  ),
);

/** Snippets that blocks `render`. */
const SNIPPETS = {
  "classifieds-card": read(THEME_FILES.card),
  "classifieds-img": read(THEME_FILES.img),
};

// A minimal in-memory file system for `render 'name'`, following liquidjs's FS interface.
// Liquid may prefix the name with its root ("./"), so only the file name is looked up.
const name = (file) =>
  file
    .split(/[\\/]/)
    .pop()
    .replace(/\.liquid$/, "");
const snippetFs = {
  sep: "/",
  exists: async (file) => name(file) in SNIPPETS,
  existsSync: (file) => name(file) in SNIPPETS,
  readFile: async (file) => SNIPPETS[name(file)],
  readFileSync: (file) => SNIPPETS[name(file)],
  resolve: (_dir, file) => file,
  dirname: () => "",
  contains: async () => true,
  containsSync: () => true,
};

const engine = new Liquid({ fs: snippetFs, strictFilters: true, cache: false });
const translate = (key) =>
  key
    .split(".")
    .reduce((node, part) => node?.[part], LOCALE)
    ?.toString() ?? key;
engine.registerFilter("t", translate);
engine.registerFilter("money", (value) => {
  try {
    return `$${JSON.parse(value).amount}`;
  } catch {
    return String(value ?? "");
  }
});
engine.registerFilter("date", (value) => String(value));
engine.registerFilter("default_pagination", () => "");
engine.registerFilter("newline_to_br", (value) =>
  String(value ?? "").replace(/\n/g, "<br />"),
);

/** Drop the Shopify-only `schema` block and replace `paginate` with a one-page stub. */
export function prepare(source) {
  return source
    .replace(/\{%\s*schema\s*%\}[\s\S]*?\{%\s*endschema\s*%\}/g, "")
    .replace(
      /\{%-?\s*paginate\b[^%]*-?%\}/g,
      "{%- assign paginate = pagination -%}",
    )
    .replace(/\{%-?\s*endpaginate\s*-?%\}/g, "");
}

/** The request, shop and block context every template expects. */
const BASE = {
  routes: { root_url: "/" },
  request: { page_type: "product" },
  page: { handle: "" },
  pagination: { pages: 1 },
  block: {
    settings: {
      heading: "Classifieds",
      empty_text: "There are no listings right now. Check back soon.",
      browse_too: true,
      browse_handle: "classifieds",
    },
  },
  shop: {
    metafields: { classifieds: { live_count: { value: "3" } } },
    metaobjects: { classified_listing: { values: [] } },
  },
};

/**
 * Render one theme file.
 * @param {keyof typeof THEME_FILES} name
 * @param {Record<string, unknown>} [data] merged over the base context (shallow)
 * @returns {Promise<string>}
 */
export function render(name, data = {}) {
  return engine.parseAndRender(prepare(read(THEME_FILES[name])), {
    ...BASE,
    ...data,
  });
}

/** A metaobject as Liquid sees it: `entry.<key>.value`, and `system` for its type and URL. */
export function entryOf(fields, { handle = "lantern-abc123" } = {}) {
  const entry = {
    system: {
      type: "classified_listing",
      handle,
      url: `/pages/classified-listing/${handle}`,
    },
  };
  for (const { key, value } of fields)
    entry[key] = { value: LIST_KEYS.has(key) ? JSON.parse(value) : value };
  return entry;
}

export const PHOTO =
  "https://photos.example.test/public/clx1abc/0123_large.jpg";

/** A live listing, as the app would describe it (the page's `buildFields` output). */
export const OPEN_LISTING = {
  id: "clx1abc0000000000000000001",
  status: "LIVE",
  title: "1962 Coleman 200A lantern",
  description: "Original mantle, works well.",
  condition: "Good",
  askingPriceCents: 2500,
  quantityAvailable: 1,
  availabilityNote: null,
  knownIssues: null,
  contents: null,
  city: "Wichita",
  state: "KS",
  arrangements: ["PICKUP"],
  arrangementsNote: null,
  sellerDisplay: "Sam Seller",
  liveAt: new Date("2026-10-19T12:00:00Z"),
  expiresAt: new Date("2026-11-19T12:00:00Z"),
};

/** An open listing's page entry, built from the real field whitelist. */
export function openEntry(overrides = {}) {
  return entryOf(
    buildFields({ ...OPEN_LISTING, ...overrides }, [PHOTO], {
      currency: "USD",
    }),
  );
}

/** Every `{{ ... }}` expression in a template, trimmed. */
export const outputs = (source) =>
  [...source.matchAll(/\{\{-?\s*([\s\S]*?)\s*-?\}\}/g)].map((match) =>
    match[1].trim(),
  );
