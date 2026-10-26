import { useState } from "react";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadAlertsScreen } from "@/modules/alerts/index.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return loadAlertsScreen();
};

export default function Alerts() {
  const { enabled, counts } = useLoaderData();
  const shopify = useAppBridge();
  const [busy, setBusy] = useState(false);

  // The CSV comes from an authenticated request, then is handed to the browser as a file.
  const download = async () => {
    setBusy(true);
    try {
      const response = await fetch("/app/settings/alerts/export", {
        method: "POST",
      });
      if (!response.ok) {
        shopify.toast.show("The export failed", { isError: true });
        return;
      }
      const name = /filename="([^"]+)"/.exec(
        response.headers.get("Content-Disposition") ?? "",
      );
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name ? name[1] : "alert-subscribers.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      shopify.toast.show("The export failed", { isError: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <s-page heading="New listing alerts">
      <s-link slot="breadcrumb-actions" href="/app/settings">
        Settings
      </s-link>

      {!enabled && (
        <s-banner tone="warning">
          Alerts are turned off: the signup is hidden and no alert emails are
          sent. Unsubscribe links still work. Turn alerts on in{" "}
          <s-link href="/app/settings/features">Features</s-link>.
        </s-banner>
      )}

      <s-section heading="Subscribers">
        <s-stack gap="base">
          <s-paragraph>
            Subscribers get an email each time a new listing first goes live.
            This list is separate from Old Coleman Parts marketing email.
          </s-paragraph>
          <s-stack direction="inline" gap="large">
            <s-stack gap="small-300">
              <s-text>Subscribed</s-text>
              <s-heading>{counts.active}</s-heading>
            </s-stack>
            <s-stack gap="small-300">
              <s-text>Waiting to confirm</s-text>
              <s-heading>{counts.pending}</s-heading>
            </s-stack>
            <s-stack gap="small-300">
              <s-text>Unsubscribed</s-text>
              <s-heading>{counts.unsubscribed}</s-heading>
            </s-stack>
            <s-stack gap="small-300">
              <s-text>Listings waiting to be sent</s-text>
              <s-heading>{counts.queued}</s-heading>
            </s-stack>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Export">
        <s-stack gap="base">
          <s-paragraph>
            Download the subscribed addresses as a CSV file. Each export is
            recorded in the history.
          </s-paragraph>
          <s-button onClick={download} disabled={busy || undefined}>
            Export CSV
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
