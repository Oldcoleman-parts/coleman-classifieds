import {
  handleMyLinkPage,
  handleMyLinkRequest,
} from "@/modules/access/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// Get my link (F04-T3): GET shows the form, POST emails new links.
export const loader = ({ request }) =>
  withAppProxy(request, (ctx) => handleMyLinkPage(ctx, request));

export const action = ({ request }) =>
  withAppProxy(request, (ctx) => handleMyLinkRequest(ctx, request));
