import {
  handleContactPage,
  handleContactSubmit,
} from "@/modules/contact/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// Contact the seller (F07-T1): GET shows the form, POST delivers or holds the message.
export const loader = ({ request, params }) =>
  withAppProxy(request, (ctx) =>
    handleContactPage(ctx, request, params.handle),
  );

export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) =>
    handleContactSubmit(ctx, request, params.handle),
  );
