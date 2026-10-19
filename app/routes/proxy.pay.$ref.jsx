import { handlePay, handlePayPage } from "@/modules/payments/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// The pay page behind the private payment link (F06-T1): GET shows the fee, POST starts
// the Shopify checkout.
export const loader = ({ request, params }) =>
  withAppProxy(request, (ctx) => handlePayPage(ctx, request, params.ref));

export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handlePay(ctx, request, params.ref));
