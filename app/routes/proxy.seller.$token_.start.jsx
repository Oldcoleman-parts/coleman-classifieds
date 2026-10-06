import { handleStart } from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: start the draft (INVITED → DRAFT).
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleStart(ctx, request, params.token));
