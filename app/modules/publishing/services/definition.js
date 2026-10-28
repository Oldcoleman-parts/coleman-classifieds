// The `classified_listing` definition and the `classifieds.live_count` shop metafield
// definition, created the first time they are needed.
// DECISION (F06-T2): data-model.md named F08 for this; the first go-live needs it, so it is
// created here, by the app, with the same fields. A missing field is added; an existing one
// is never changed or removed, so staff edits in the admin can't break the app's writes.
import { adminGraphql } from "@/modules/platform/index.js";
import {
  COUNT_KEY,
  COUNT_NAMESPACE,
  LISTING_TYPE,
  URL_HANDLE,
} from "./constants.js";
import { FIELD_DEFINITIONS } from "./fields.js";
import {
  LISTING_DEFINITION,
  LISTING_DEFINITION_CREATE,
  LISTING_DEFINITION_UPDATE,
  LIVE_COUNT_DEFINITION_CREATE,
} from "./graphql/admin.js";

/** @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient */

let ready = false;

/** @param {unknown} error @param {string} code */
const hasCode = (error, code) =>
  Array.isArray(/** @type {any} */ (error)?.userErrors) &&
  /** @type {any} */ (error).userErrors.some(
    (problem) => problem.code === code,
  );

/** @param {GraphqlClient} admin */
async function ensureListingDefinition(admin) {
  const data = await adminGraphql(admin, LISTING_DEFINITION, {
    type: LISTING_TYPE,
  });
  const existing = data?.metaobjectDefinitionByType;
  if (!existing) {
    try {
      await adminGraphql(admin, LISTING_DEFINITION_CREATE, {
        definition: {
          type: LISTING_TYPE,
          name: "Classified listing",
          displayNameKey: "title",
          access: { storefront: "PUBLIC_READ" },
          capabilities: {
            publishable: { enabled: true },
            onlineStore: { enabled: true, data: { urlHandle: URL_HANDLE } },
          },
          fieldDefinitions: FIELD_DEFINITIONS,
        },
      });
    } catch (error) {
      // Created by another request a moment ago.
      if (!hasCode(error, "TAKEN")) throw error;
    }
    return;
  }
  const have = new Set(existing.fieldDefinitions.map((field) => field.key));
  const missing = FIELD_DEFINITIONS.filter((field) => !have.has(field.key));
  if (missing.length === 0) return;
  await adminGraphql(admin, LISTING_DEFINITION_UPDATE, {
    id: existing.id,
    definition: {
      fieldDefinitions: missing.map((field) => ({ create: field })),
    },
  });
}

/** @param {GraphqlClient} admin */
async function ensureCountDefinition(admin) {
  try {
    await adminGraphql(admin, LIVE_COUNT_DEFINITION_CREATE, {
      definition: {
        namespace: COUNT_NAMESPACE,
        key: COUNT_KEY,
        name: "Live classified listings",
        type: "number_integer",
        ownerType: "SHOP",
        access: { storefront: "PUBLIC_READ" },
      },
    });
  } catch (error) {
    // TAKEN: it exists. UNSTRUCTURED_ALREADY_EXISTS: values exist without a definition,
    // which Liquid still reads.
    if (!hasCode(error, "TAKEN") && !hasCode(error, "UNSTRUCTURED_ALREADY_EXISTS"))
      throw error;
  }
}

/**
 * Make sure both definitions exist. Remembered for the life of the process once done.
 * @param {{ admin: GraphqlClient }} context
 */
export async function ensureDefinitions({ admin }) {
  if (ready) return;
  await ensureListingDefinition(admin);
  await ensureCountDefinition(admin);
  ready = true;
}

/** Ask Shopify again next time (tests). */
export function resetDefinitionCache() {
  ready = false;
}
