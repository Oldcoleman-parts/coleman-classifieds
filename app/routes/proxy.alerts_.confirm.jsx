import { handleConfirm } from "@/modules/alerts/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// Confirm an alerts signup (F07-T2): GET shows the button, POST confirms.
export const loader = ({ request }) =>
  withAppProxy(request, (ctx) => handleConfirm(ctx, request));

export const action = ({ request }) =>
  withAppProxy(request, (ctx) => handleConfirm(ctx, request));
