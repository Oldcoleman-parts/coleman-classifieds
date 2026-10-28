import { handleCodeRequest } from "@/modules/access/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: email the seller a sign-in code.
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleCodeRequest(ctx, request, params.token));
