import { handlePhotoOrder } from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: reorder the photos (JSON).
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handlePhotoOrder(ctx, request, params.token));
