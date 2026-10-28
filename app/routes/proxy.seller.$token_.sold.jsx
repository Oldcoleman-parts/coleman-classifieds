import { handleSold } from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: mark the item sold (asks for confirmation first).
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleSold(ctx, request, params.token));
