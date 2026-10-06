import { handlePhotoDelete } from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: remove a photo (JSON).
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handlePhotoDelete(ctx, request, params.token));
