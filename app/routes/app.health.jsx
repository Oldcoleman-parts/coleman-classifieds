import { useEffect } from "react";
import { data, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  handleHealthAction,
  loadHealthScreen,
} from "@/modules/console/index.js";
import { staffFromSession } from "@/modules/core/index.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return loadHealthScreen();
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const result = await handleHealthAction(
    await request.formData(),
    staffFromSession(session),
  );

  return result.ok ? result : data(result, { status: result.status });
};

const when = (iso) => new Date(iso).toLocaleString();
const NOT_YET = "Not available yet.";

export default function Health() {
  const { incidents, lastJobRun, email, liveCount } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Problem marked as resolved");
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Health">
      {fetcher.data?.ok === false && (
        <s-banner tone="critical">{fetcher.data.message}</s-banner>
      )}

      <s-section heading="Open problems">
        {!incidents.available ? (
          <s-paragraph>{NOT_YET}</s-paragraph>
        ) : incidents.rows.length === 0 ? (
          <s-paragraph>No open problems.</s-paragraph>
        ) : (
          <s-stack gap="base">
            {incidents.rows.map((incident) => (
              <s-stack key={incident.id} gap="small-200">
                <s-stack direction="inline" gap="small">
                  <s-badge tone="critical">{incident.kind}</s-badge>
                  <s-text>{incident.message}</s-text>
                </s-stack>
                <s-text>
                  First seen {when(incident.firstSeen)} · last seen{" "}
                  {when(incident.lastSeen)}
                </s-text>
                <s-button
                  disabled={busy}
                  onClick={() =>
                    fetcher.submit(
                      { intent: "resolve-incident", incidentId: incident.id },
                      { method: "post" },
                    )
                  }
                >
                  Mark as resolved
                </s-button>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Last job run">
        {!lastJobRun.available ? (
          <s-paragraph>{NOT_YET}</s-paragraph>
        ) : !lastJobRun.finishedAt ? (
          <s-paragraph>No run recorded yet.</s-paragraph>
        ) : (
          <s-stack direction="inline" gap="small">
            <s-badge tone={lastJobRun.ok ? "success" : "critical"}>
              {lastJobRun.ok ? "OK" : "Failed"}
            </s-badge>
            <s-text>
              {when(lastJobRun.finishedAt)}
              {lastJobRun.failedTasks.length > 0 &&
                ` · failed: ${lastJobRun.failedTasks.join(", ")}`}
            </s-text>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Email">
        <s-stack gap="small">
          {email.available && (
            <s-badge tone={email.ok ? "success" : "critical"}>
              {email.ok ? "Sending" : "Sending has a problem"}
            </s-badge>
          )}
          <s-text>
            Email problems reported in the last 24 hours: {email.problems24h}
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Live listings">
        <s-stack gap="small">
          <s-text>Live in the app: {liveCount.dbLive}</s-text>
          {liveCount.storefront === null ? (
            <s-text>
              On the storefront: not available until publishing is set up.
            </s-text>
          ) : (
            <s-stack direction="inline" gap="small">
              <s-text>On the storefront: {liveCount.storefront}</s-text>
              <s-badge tone={liveCount.matches ? "success" : "critical"}>
                {liveCount.matches ? "Matches" : "Doesn’t match"}
              </s-badge>
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
