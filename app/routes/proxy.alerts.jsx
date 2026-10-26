import {
  handleSignupPage,
  handleSignupSubmit,
} from "@/modules/alerts/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// New listing alerts signup (F07-T2): GET shows the form, POST signs the address up.
export const loader = ({ request }) =>
  withAppProxy(request, (ctx) => handleSignupPage(ctx, request));

export const action = ({ request }) =>
  withAppProxy(request, (ctx) => handleSignupSubmit(ctx, request));
