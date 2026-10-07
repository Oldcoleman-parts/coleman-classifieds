import { useRef, useState } from "react";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadExportScreen } from "@/modules/console/index.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const listingId = new URL(request.url).searchParams.get("listingId") ?? "";

  return { ...loadExportScreen(), listingId };
};

export default function HistoryExport() {
  const defaults = useLoaderData();
  const shopify = useAppBridge();
  const form = useRef(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const byListing = Boolean(defaults.listingId);

  // The CSV comes from an authenticated request, then is handed to the browser as a file.
  const download = async () => {
    setBusy(true);
    setErrors({});
    try {
      const response = await fetch("/app/history/export-csv", {
        method: "POST",
        body: new FormData(form.current),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setErrors(result.fieldErrors ?? {});
        shopify.toast.show(result.message ?? "The export failed", {
          isError: true,
        });
        return;
      }
      const name = /filename="([^"]+)"/.exec(
        response.headers.get("Content-Disposition") ?? "",
      );
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name ? name[1] : "history.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      shopify.toast.show("The export failed", { isError: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <s-page heading="History export">
      <s-section>
        <form ref={form} onSubmit={(event) => event.preventDefault()}>
          <s-stack gap="base">
            <s-paragraph>
              Download the history as a CSV file: everything that happened, in
              order. History can’t be changed or deleted. Each export is
              recorded.
            </s-paragraph>
            {byListing ? (
              <>
                <input
                  type="hidden"
                  name="listingId"
                  value={defaults.listingId}
                />
                <s-text>
                  The full history of{" "}
                  <s-link href={`/app/listings/${defaults.listingId}`}>
                    this listing
                  </s-link>
                  .
                </s-text>
                {errors.listingId && (
                  <s-banner tone="critical">
                    That listing wasn’t found.
                  </s-banner>
                )}
                <s-link href="/app/history/export">
                  Export a date range instead
                </s-link>
              </>
            ) : (
              <s-stack direction="inline" gap="base">
                <s-date-field
                  label="From"
                  name="from"
                  defaultValue={defaults.from}
                  error={errors.from}
                />
                <s-date-field
                  label="To"
                  name="to"
                  defaultValue={defaults.to}
                  error={errors.to}
                  details={`At most ${defaults.maxDays} days.`}
                />
              </s-stack>
            )}
            <s-button variant="primary" disabled={busy} onClick={download}>
              Download CSV
            </s-button>
          </s-stack>
        </form>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
