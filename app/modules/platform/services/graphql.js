// Shopify GraphQL helpers. Every call goes through these, so a `userErrors` answer can
// never be mistaken for success.
import { ShopifyUserError } from "@/modules/core/index.js";
import { unauthenticated } from "@/shopify.server";

/**
 * @typedef {{ graphql: (query: string, options?: { variables?: object }) => Promise<Response> }} GraphqlClient
 */

const operationName = (query) =>
  /\b(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "anonymous";

/**
 * @param {GraphqlClient} client
 * @param {string} query
 * @param {object} variables
 * @returns {Promise<any>} the `data` part of the response
 */
async function run(client, query, variables) {
  const name = operationName(query);
  const response = await client.graphql(query, { variables });
  const { data, errors } = await response.json();

  /** @type {Array<{ field?: string[] | null, message: string, code?: string }>} */
  const problems = (errors ?? []).map((error) => ({
    message: error.message,
    code: error.extensions?.code,
  }));
  // Mutations report problems per field: userErrors, customerUserErrors, mediaUserErrors…
  for (const result of Object.values(data ?? {})) {
    for (const [key, value] of Object.entries(result ?? {})) {
      if (/userErrors$/i.test(key) && Array.isArray(value))
        problems.push(...value);
    }
  }

  if (problems.length > 0) {
    // The operation name and error codes only: variables and messages can hold personal data.
    console.error(
      `[shopify] ${name} failed: ${problems.map((problem) => problem.code ?? "ERROR").join(", ")}`,
    );
    throw new ShopifyUserError(`Shopify rejected ${name}`, problems);
  }
  return data;
}

/**
 * Run an Admin GraphQL operation.
 * @param {GraphqlClient} admin from `authenticate.admin`, a webhook context or `adminFor()`
 * @param {string} query
 * @param {object} [variables]
 * @returns {Promise<any>} the `data` part of the response
 * @throws {ShopifyUserError} on top-level `errors` or any non-empty `userErrors`
 */
export function adminGraphql(admin, query, variables = {}) {
  return run(admin, query, variables);
}

/**
 * Run a Storefront GraphQL operation.
 * @param {GraphqlClient} storefront from the app proxy context or `storefrontFor()`
 * @param {string} query
 * @param {object} [variables]
 * @returns {Promise<any>} the `data` part of the response
 * @throws {ShopifyUserError} on top-level `errors` or any non-empty `userErrors`
 */
export function storefrontGraphql(storefront, query, variables = {}) {
  return run(storefront, query, variables);
}

/**
 * An Admin client for code that runs without a request (jobs, event handlers).
 * @param {string} shop the `*.myshopify.com` domain
 * @returns {Promise<GraphqlClient>}
 */
export async function adminFor(shop) {
  const { admin } = await unauthenticated.admin(shop);
  return admin;
}

/**
 * A Storefront client for code that runs without a request.
 * @param {string} shop the `*.myshopify.com` domain
 * @returns {Promise<GraphqlClient>}
 */
export async function storefrontFor(shop) {
  const { storefront } = await unauthenticated.storefront(shop);
  return storefront;
}
