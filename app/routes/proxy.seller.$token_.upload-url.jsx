import { handleUploadUrl } from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: a photo upload link (JSON).
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleUploadUrl(ctx, request, params.token));
