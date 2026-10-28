import { authenticate } from "../shopify.server";
import {
  parseHistoryFilter,
  streamHistoryCsv,
} from "@/modules/console/index.js";
import {
  staffFromSession,
  UnauthorizedError,
  ValidationError,
} from "@/modules/core/index.js";

// The history CSV itself. POST only: an export is audited, so it must never run from a
// link prefetch.
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // An export is audited with the staff member, so a session without an online user is
  // refused (F05-FIX-1).
  let staff;
  try {
    staff = staffFromSession(session);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    return Response.json(
      { ok: false, message: "Sign in as a staff member to export." },
      { status: 403 },
    );
  }
  const formData = await request.formData();
  let filter;
  try {
    // The list's resolved dates win over its quick period, so the file covers what it showed.
    filter = parseHistoryFilter(
      {
        listingId: formData.get("listingId"),
        from: formData.get("from"),
        to: formData.get("to"),
        period: formData.get("period"),
        action: formData.get("action"),
        actor: formData.get("actor"),
        staffEmail: formData.get("staffEmail"),
      },
      { fixedDates: true },
    );
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return Response.json(
      { ok: false, message: error.message, fieldErrors: error.fields },
      { status: 400 },
    );
  }
  const { filename, stream } = await streamHistoryCsv(filter, staff);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
