import {
  handleSellerPage,
  handleSellerResume,
} from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// The seller's private page: /apps/classifieds/seller/<token> on the storefront.
export const loader = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleSellerPage(ctx, request, params.token));

// POST with the device credential re-opens the page (the resume step).
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) =>
    handleSellerResume(ctx, request, params.token),
  );
