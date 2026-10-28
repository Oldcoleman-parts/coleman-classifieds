import { handleRemove } from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: remove the listing (asks for confirmation first).
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleRemove(ctx, request, params.token));
