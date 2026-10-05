// The app proxy wrapper for everything under /apps/classifieds on the storefront.
import { authenticate } from "@/shopify.server";

/**
 * @typedef {object} ProxyContext
 * @property {string} shop the `*.myshopify.com` domain
 * @property {URL} url the request URL (the path below the proxy, plus Shopify's parameters)
 * @property {object} session
 * @property {import("./graphql.js").GraphqlClient} admin
 * @property {import("./graphql.js").GraphqlClient} storefront
 * @property {(body: string, init?: number | object) => Response} liquid renders inside the theme
 */

function unauthorized() {
  return new Response(null, {
    status: 401,
    headers: { "X-Robots-Tag": "noindex, nofollow" },
  });
}

/**
 * Verify an app proxy request, then run the handler. Use in every proxy route loader and
 * action. Public POST endpoints still need their own rate limit, Turnstile and honeypot.
 * @param {Request} request
 * @param {(context: ProxyContext) => Response | Promise<Response>} handler
 * @param {{ noindex?: boolean }} [options] `noindex` is on for seller pages (the default)
 * @returns {Promise<Response>} 401 when the signature is missing, wrong or stale
 */
export async function withAppProxy(request, handler, { noindex = true } = {}) {
  let context;
  try {
    // Checks Shopify's signature and rejects timestamps more than 90 seconds old.
    context = await authenticate.public.appProxy(request);
  } catch (error) {
    if (!(error instanceof Response)) throw error;
    return unauthorized();
  }
  // No session means the shop hasn't installed the app (or has uninstalled it).
  if (!context.session) return unauthorized();

  const response = await handler({
    ...context,
    shop: context.session.shop,
    url: new URL(request.url),
  });
  if (noindex) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
