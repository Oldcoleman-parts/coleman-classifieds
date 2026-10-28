import { handleRevision } from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: title, description and new photos, for staff review.
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleRevision(ctx, request, params.token));
