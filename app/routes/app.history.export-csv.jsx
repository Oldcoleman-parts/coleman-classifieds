import { authenticate } from "../shopify.server";
import {
  parseExportFilter,
  streamHistoryCsv,
} from "@/modules/console/index.js";
import { staffFromSession, ValidationError } from "@/modules/core/index.js";

// The history CSV itself. POST only: an export is audited, so it must never run from a
// link prefetch.
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  let filter;
  try {
    filter = parseExportFilter({
      listingId: formData.get("listingId"),
      from: formData.get("from"),
      to: formData.get("to"),
    });
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return Response.json(
      { ok: false, message: error.message, fieldErrors: error.fields },
      { status: 400 },
    );
  }
  const { filename, stream } = await streamHistoryCsv(
    filter,
    staffFromSession(session),
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
