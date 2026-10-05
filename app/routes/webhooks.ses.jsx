import { handleSesWebhook } from "@/modules/notifications/index.js";

// Amazon SNS posts SES bounce and complaint notices here. It is not a Shopify webhook, so
// the notifications module verifies the SNS signature itself.
export const action = ({ request }) => handleSesWebhook(request);
