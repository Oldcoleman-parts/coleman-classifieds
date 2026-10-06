import { useEffect } from "react";
import { data, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  loadFeaturesCard,
  saveFeatureToggle,
} from "@/modules/console/index.js";
import { staffFromSession } from "@/modules/core/index.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return loadFeaturesCard();
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const result = await saveFeatureToggle(
    await request.formData(),
    staffFromSession(session),
  );

  return result.ok ? result : data(result, { status: 400 });
};

export default function Features() {
  const { features } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const result = fetcher.data;
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (result?.ok)
      shopify.toast.show(
        result.value ? "Feature turned on" : "Feature turned off",
      );
  }, [result, shopify]);

  const turnOn = (flag) =>
    fetcher.submit({ flag, value: "true" }, { method: "post" });
  const turnOff = (flag) =>
    fetcher.submit(
      { flag, value: "false", confirmed: "yes" },
      { method: "post" },
    );

  return (
    <s-page heading="Features">
      <s-link slot="breadcrumb-actions" href="/app/settings">
        Settings
      </s-link>

      {result?.ok === false && (
        <s-banner tone="critical">{result.error}</s-banner>
      )}

      <s-section heading="Optional features">
        <s-stack gap="base">
          {features.map(({ flag, label, description, enabled }) => (
            <s-stack
              key={flag}
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack gap="small-300">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-heading>{label}</s-heading>
                  <s-badge tone={enabled ? "success" : "neutral"}>
                    {enabled ? "On" : "Off"}
                  </s-badge>
                </s-stack>
                <s-paragraph>{description}</s-paragraph>
              </s-stack>

              {enabled ? (
                <s-button
                  commandFor={`turn-off-${flag}`}
                  command="--show"
                  disabled={busy || undefined}
                >
                  Turn off
                </s-button>
              ) : (
                <s-button
                  variant="primary"
                  disabled={busy || undefined}
                  onClick={() => turnOn(flag)}
                >
                  Turn on
                </s-button>
              )}

              <s-modal id={`turn-off-${flag}`} heading={`Turn off ${label}?`}>
                <s-paragraph>
                  This takes effect straight away and is recorded in the
                  history. You can turn it on again later.
                </s-paragraph>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  tone="critical"
                  commandFor={`turn-off-${flag}`}
                  command="--hide"
                  onClick={() => turnOff(flag)}
                >
                  Turn off
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor={`turn-off-${flag}`}
                  command="--hide"
                >
                  Cancel
                </s-button>
              </s-modal>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
