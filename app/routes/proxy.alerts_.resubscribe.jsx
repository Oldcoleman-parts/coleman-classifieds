import { handleResubscribe } from "@/modules/alerts/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// Resubscribe from the unsubscribed page (F07-T2): sends a new confirm link.
export const action = ({ request }) =>
  withAppProxy(request, (ctx) => handleResubscribe(ctx, request));
