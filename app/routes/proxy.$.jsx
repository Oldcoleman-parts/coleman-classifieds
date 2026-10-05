import { withAppProxy } from "@/modules/platform/index.js";

// Everything under /apps/classifieds on the storefront arrives here, already checked for
// Shopify's signature. Features add their own proxy.* routes; anything else is not found.
const notFound = () => new Response("Not found", { status: 404 });

export const loader = ({ request }) => withAppProxy(request, notFound);
export const action = ({ request }) => withAppProxy(request, notFound);
