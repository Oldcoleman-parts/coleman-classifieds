import { useEffect, useState } from "react";
import { data, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  handleInvitationAction,
  loadInvitationScreen,
} from "@/modules/access/index.js";
import { staffFromSession } from "@/modules/core/index.js";
import { uploadPhoto } from "@/modules/media/client.js";

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);
  const screen = await loadInvitationScreen(params.id);
  if (!screen) throw new Response("Not found", { status: 404 });

  return screen;
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const result = await handleInvitationAction(
    params.id,
    await request.formData(),
    staffFromSession(session),
  );

  return result.ok ? result : data(result, { status: 400 });
};

const STATUS = {
  OPEN: ["Not used yet", "info"],
  USED: ["In use", "success"],
  CLOSED: ["Closed", "neutral"],
  REVOKED: ["Revoked", "critical"],
  EXPIRED: ["Expired", "warning"],
};

export default function Invitation() {
  const invitation = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [label, tone] = STATUS[invitation.status] ?? [
    invitation.status,
    "neutral",
  ];
  const failed = fetcher.data?.ok === false ? fetcher.data : null;

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.intent === "revoke")
      shopify.toast.show("Invitation revoked");
  }, [fetcher.data, shopify]);

  const revoke = () => fetcher.submit({ intent: "revoke" }, { method: "post" });

  return (
    <s-page heading={invitation.sellerName}>
      <s-button slot="secondary-actions" href="/app/invitations/new">
        New invitation
      </s-button>
      {failed?.message && <s-banner tone="critical">{failed.message}</s-banner>}

      <s-section heading="Invitation">
        <s-stack gap="small">
          <s-stack direction="inline" gap="small">
            <s-badge tone={tone}>{label}</s-badge>
            {invitation.listing && (
              <s-text>Listing: {invitation.listing.status}</s-text>
            )}
          </s-stack>
          <s-text>Item: {invitation.itemSummary}</s-text>
          <s-text>
            Email: {invitation.sellerEmail}
            {invitation.sellerPhone
              ? ` · Phone: ${invitation.sellerPhone}`
              : ""}
          </s-text>
          <s-text>
            Fee offered: ${invitation.feeOffered} (listing fee $
            {invitation.feeRegular})
          </s-text>
          <s-text>
            Created {new Date(invitation.createdAt).toLocaleString()} by{" "}
            {invitation.createdBy ?? "staff"}. Unused link expires{" "}
            {new Date(invitation.expiresAt).toLocaleDateString()}.
          </s-text>
          <s-paragraph>
            The private link was shown once when the invitation was created and
            isn’t stored.
          </s-paragraph>
          {invitation.canRevoke && (
            <s-button
              tone="critical"
              commandFor="revoke-invitation"
              command="--show"
            >
              Revoke invitation
            </s-button>
          )}
        </s-stack>
      </s-section>

      {invitation.listing && <Photos />}

      <s-modal id="revoke-invitation" heading="Revoke this invitation?">
        <s-paragraph>
          The link stops working straight away. This can’t be undone; create a
          new invitation if the seller still needs one.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          commandFor="revoke-invitation"
          command="--hide"
          onClick={revoke}
        >
          Revoke
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor="revoke-invitation"
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

/** Staff photos for the seller's listing, uploaded through the photo route. */
function Photos() {
  const invitation = useLoaderData();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const { revalidate } = useRevalidator();
  const [progress, setProgress] = useState(null);

  if (invitation.photos === null)
    return (
      <s-section heading="Photos">
        <s-paragraph>
          Photo storage isn’t set up on this environment.
        </s-paragraph>
      </s-section>
    );

  const call = async (body) => {
    const response = await fetch(`/app/invitations/${invitation.id}/photos`, {
      method: "POST",
      body: new URLSearchParams(body),
    });
    const result = await response.json();
    if (!result.ok)
      throw new Error(result.message || "The photo couldn’t be saved");
    return result;
  };

  const onFiles = async (event) => {
    const files = [...(event.currentTarget.files ?? [])];
    for (const file of files) {
      try {
        await uploadPhoto(file, {
          getUploadUrl: async (input) =>
            (await call({ intent: "upload-url", ...input })).upload,
          complete: (photoId) => call({ intent: "upload-complete", photoId }),
          onProgress: setProgress,
        });
      } catch (error) {
        shopify.toast.show(error.message, { isError: true });
      }
    }
    setProgress(null);
    revalidate();
  };

  return (
    <s-section heading="Photos">
      <s-stack gap="base">
        <s-paragraph>
          Photos you add here are shown to the seller. They go public only after
          staff approve the listing.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          {invitation.photos.map((photo) => (
            <s-stack key={photo.id} gap="small">
              <s-thumbnail src={photo.previewUrl} alt="" size="large" />
              {photo.isMain && <s-badge>Main photo</s-badge>}
              <s-button
                tone="critical"
                variant="tertiary"
                onClick={() =>
                  fetcher.submit(
                    { intent: "delete-photo", photoId: photo.id },
                    { method: "post" },
                  )
                }
              >
                Delete
              </s-button>
            </s-stack>
          ))}
        </s-stack>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          multiple
          onChange={onFiles}
          disabled={progress !== null}
        />
        {progress !== null && (
          <s-text>Uploading… {Math.round(progress * 100)}%</s-text>
        )}
      </s-stack>
    </s-section>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
