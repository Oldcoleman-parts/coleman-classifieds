import { useEffect, useState } from "react";
import { data, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  handleMessageAction,
  loadMessagesScreen,
} from "@/modules/console/index.js";
import { staffFromSession } from "@/modules/core/index.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return loadMessagesScreen();
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const result = await handleMessageAction(
    await request.formData(),
    staffFromSession(session),
  );

  return result.ok ? result : data(result, { status: result.status });
};

const DONE = {
  release: "Message sent to the seller",
  discard: "Message discarded",
};

export default function Messages() {
  const { available, rows } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [discarding, setDiscarding] = useState(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show(DONE[fetcher.data.intent]);
  }, [fetcher.data, shopify]);

  const run = (intent, messageId) =>
    fetcher.submit({ intent, messageId }, { method: "post" });

  return (
    <s-page heading="Held messages">
      {fetcher.data?.ok === false && (
        <s-banner tone="critical">{fetcher.data.message}</s-banner>
      )}
      <s-section>
        {!available ? (
          <s-paragraph>
            Buyer messages aren’t set up yet. Held messages will wait here for
            review.
          </s-paragraph>
        ) : rows.length === 0 ? (
          <s-paragraph>No held messages.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Message</s-table-header>
              <s-table-header>Buyer</s-table-header>
              <s-table-header>Listing</s-table-header>
              <s-table-header>Held because</s-table-header>
              <s-table-header>Received</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>{row.body}</s-table-cell>
                  <s-table-cell>
                    {row.buyerName} · {row.buyerEmail}
                  </s-table-cell>
                  <s-table-cell>
                    <s-link href={`/app/listings/${row.listingId}`}>
                      {row.listingTitle ?? "Listing"}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{row.holdReasons.join(", ")}</s-table-cell>
                  <s-table-cell>
                    {new Date(row.createdAt).toLocaleString()}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-button
                        disabled={busy}
                        onClick={() => run("release", row.id)}
                      >
                        Release
                      </s-button>
                      <s-button
                        tone="critical"
                        variant="tertiary"
                        commandFor="discard-message"
                        command="--show"
                        onClick={() => setDiscarding(row.id)}
                      >
                        Discard
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
      <s-modal id="discard-message" heading="Discard this message?">
        <s-paragraph>
          The seller never gets it and the buyer isn’t told. This can’t be
          undone.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          commandFor="discard-message"
          command="--hide"
          onClick={() => discarding && run("discard", discarding)}
        >
          Discard
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor="discard-message"
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
