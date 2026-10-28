import { handleLiveUpdate } from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: price, quantity and availability note of a live listing.
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleLiveUpdate(ctx, request, params.token));
