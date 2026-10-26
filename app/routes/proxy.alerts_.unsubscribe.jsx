import {
  handleUnsubscribePage,
  handleUnsubscribePost,
} from "@/modules/alerts/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// Unsubscribe from alerts (F07-T2): GET shows the button, POST unsubscribes (also the mail
// app's one-click unsubscribe).
export const loader = ({ request }) =>
  withAppProxy(request, (ctx) => handleUnsubscribePage(ctx, request));

export const action = ({ request }) =>
  withAppProxy(request, (ctx) => handleUnsubscribePost(ctx, request));
