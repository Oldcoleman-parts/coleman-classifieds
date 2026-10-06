import { handleSellerPage, handleSellerPost } from "@/modules/access/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// The seller's private page: /apps/classifieds/seller/<token> on the storefront.
export const loader = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleSellerPage(ctx, request, params.token));

export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleSellerPost(ctx, request, params.token));
