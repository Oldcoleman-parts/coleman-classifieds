import { authenticate } from "../shopify.server";
import { handleInvitationAction } from "@/modules/access/index.js";
import { staffFromSession } from "@/modules/core/index.js";

// JSON for the staff photo uploader: the upload link, then "the upload is done".
const PHOTO_INTENTS = ["upload-url", "upload-complete"];

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (!PHOTO_INTENTS.includes(formData.get("intent")))
    return Response.json(
      { ok: false, message: "Unknown action" },
      { status: 400 },
    );
  const result = await handleInvitationAction(
    params.id,
    formData,
    staffFromSession(session),
  );

  return Response.json(result, { status: result.ok ? 200 : 400 });
};
