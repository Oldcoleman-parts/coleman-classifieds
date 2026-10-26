import { authenticate } from "../shopify.server";
import { streamSubscribersCsv } from "@/modules/alerts/index.js";
import { staffFromSession } from "@/modules/core/index.js";

// The alert subscribers CSV (F07-T2). POST only: an export is audited, so it must never run
// from a link prefetch.
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { filename, stream } = await streamSubscribersCsv(
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
