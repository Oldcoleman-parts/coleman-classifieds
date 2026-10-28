import { handleSubmit } from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: send the listing for review.
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleSubmit(ctx, request, params.token));
