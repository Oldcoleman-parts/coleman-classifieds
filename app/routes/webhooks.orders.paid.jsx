import { handleWebhook } from "@/modules/platform/index.js";

export const action = ({ request }) => handleWebhook(request);
