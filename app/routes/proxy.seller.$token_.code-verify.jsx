import { handleCodeVerify } from "@/modules/access/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: check the seller's sign-in code.
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleCodeVerify(ctx, request, params.token));
