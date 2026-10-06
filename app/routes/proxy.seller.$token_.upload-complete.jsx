import { handleUploadComplete } from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: finish a photo upload (JSON).
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) =>
    handleUploadComplete(ctx, request, params.token),
  );
