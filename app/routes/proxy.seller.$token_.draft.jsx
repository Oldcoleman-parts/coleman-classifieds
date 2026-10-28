import { handleDraft } from "@/modules/workspace/index.js";
import { withAppProxy } from "@/modules/platform/index.js";

// POST only: save the draft (JSON for the page's autosave).
export const action = ({ request, params }) =>
  withAppProxy(request, (ctx) => handleDraft(ctx, request, params.token));
