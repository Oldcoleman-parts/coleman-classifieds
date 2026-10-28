import { Fragment, useEffect, useRef, useState } from "react";
import {
  data,
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  loadCreateInvitationScreen,
  submitCreateInvitation,
} from "@/modules/access/index.js";
import { staffFromSession } from "@/modules/core/index.js";
import { statusBadge } from "@/modules/console/client.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return loadCreateInvitationScreen(new URL(request.url));
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const result = await submitCreateInvitation(
    await request.formData(),
    staffFromSession(session),
    {
      admin,
      shop: session.shop,
      staffFirstName:
        session.onlineAccessInfo?.associated_user?.first_name ?? "",
    },
  );

  return result.ok ? result : data(result, { status: 400 });
};

export default function NewInvitation() {
  const screen = useLoaderData();
  const result = useActionData();
  const history = useFetcher();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const emailRef = useRef(null);
  const errors = result?.ok === false ? result.fieldErrors : {};
  const [lookedUp, setLookedUp] = useState("");
  const looking = history.state === "loading";
  // DECISION (F04-FIX-5): fetcher rows are shown only when the loader's historyEmail
  // matches the email named above them, so a cleared or changed field never shows old rows.
  const loadedFor = (email) =>
    history.data?.historyEmail === email.toLowerCase();
  const rows = lookedUp && loadedFor(lookedUp) ? history.data.history : [];

  useEffect(() => {
    if (result?.ok) shopify.toast.show("Invitation created");
  }, [result, shopify]);

  const lookUp = () => {
    const email = emailRef.current?.value?.trim() ?? "";
    if (!email) {
      setLookedUp("");
      return;
    }
    // Blur then a button click: one load is enough.
    if (email === lookedUp && (looking || loadedFor(email))) return;
    setLookedUp(email);
    history.load(`/app/invitations/new?email=${encodeURIComponent(email)}`);
  };

  // React 18 doesn't bind onChange on web components, so listen for the field's own event:
  // the panel follows the email without the staff member having to press the button.
  const lookUpRef = useRef(lookUp);
  lookUpRef.current = lookUp;
  useEffect(() => {
    const field = emailRef.current;
    const onChange = () => lookUpRef.current();
    field?.addEventListener("change", onChange);
    return () => field?.removeEventListener("change", onChange);
  }, []);

  if (result?.ok) return <Created />;

  return (
    <s-page heading="New invitation">
      {result?.ok === false && result.message && (
        <s-banner tone="critical">{result.message}</s-banner>
      )}
      <Form method="post">
        <input type="hidden" name="formNonce" value={screen.formNonce} />
        <s-section heading="Seller">
          <s-stack gap="base">
            <s-text-field
              label="Name"
              name="sellerName"
              maxLength="120"
              required
              error={errors.sellerName}
            />
            <s-email-field
              ref={emailRef}
              label="Email"
              name="sellerEmail"
              required
              error={errors.sellerEmail}
              details="The invitation email, with the private link, and sign-in codes go to this address."
            />
            <s-button onClick={lookUp}>
              Show this seller’s earlier listings
            </s-button>
            <s-text-field
              label="Phone (optional)"
              name="sellerPhone"
              maxLength="40"
              error={errors.sellerPhone}
            />
          </s-stack>
        </s-section>

        <s-section heading="Item and fee">
          <s-stack gap="base">
            <s-text-area
              label="Item summary"
              name="itemSummary"
              maxLength="300"
              required
              error={errors.itemSummary}
              details="Shown to the seller on their page. Not public."
            />
            <s-money-field
              label="Fee offered"
              name="offeredFee"
              currencyCode="USD"
              min="0.01"
              value={screen.offeredFee}
              error={errors.offeredFee}
              details={`The listing fee is $${screen.regularFee}. The offered fee is locked when you create the invitation.`}
            />
            {screen.showOfferScope && (
              <s-select
                label="Offer applies to"
                name="offerScope"
                error={errors.offerScope}
              >
                <s-option value="FIRST_MONTH">The first month</s-option>
                <s-option value="ALL_RENEWALS">
                  The first month and every renewal
                </s-option>
              </s-select>
            )}
          </s-stack>
        </s-section>

        <s-section>
          <s-paragraph>
            The seller is emailed their private link as soon as you create the
            invitation. The link works for {screen.inviteExpiryDays} days if it
            isn’t used. You can add photos for the seller on the next screen.
          </s-paragraph>
          <s-button
            type="submit"
            variant="primary"
            disabled={navigation.state !== "idle"}
          >
            Create invitation
          </s-button>
        </s-section>
      </Form>

      <s-section slot="aside" heading="Earlier listings">
        {looking ? (
          <s-paragraph>Looking up {lookedUp}…</s-paragraph>
        ) : !lookedUp ? (
          <s-paragraph>
            Enter the seller’s email to see their earlier listings.
          </s-paragraph>
        ) : rows.length === 0 ? (
          <s-paragraph>No earlier listings for {lookedUp}.</s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-text color="subdued">
              {rows.length} earlier {rows.length === 1 ? "listing" : "listings"}{" "}
              for {lookedUp}
            </s-text>
            {rows.map((row, index) => {
              const [label, tone] = statusBadge(row.status);
              return (
                <Fragment key={row.listingId}>
                  {index > 0 && <s-divider />}
                  <s-stack gap="small-200">
                    <s-link href={`/app/listings/${row.listingId}`}>
                      {row.title ?? row.itemSummary}
                    </s-link>
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <s-badge tone={tone}>{label}</s-badge>
                      <s-text color="subdued">
                        Invited {new Date(row.createdAt).toLocaleDateString()}
                      </s-text>
                    </s-stack>
                  </s-stack>
                </Fragment>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

/**
 * The result of creating an invitation. The email status comes first; the link is shown
 * once, as the fallback when the email wasn't sent. It isn't stored.
 */
function Created() {
  const result = useActionData();
  const shopify = useAppBridge();
  const sent = result.email.state === "SENT";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.link);
      shopify.toast.show("Link copied");
    } catch {
      shopify.toast.show("Couldn’t copy: select the link and copy it", {
        isError: true,
      });
    }
  };

  return (
    <s-page heading="Invitation created">
      <s-section heading={`Invitation for ${result.sellerName}`}>
        <s-stack gap="base">
          {result.duplicate ? (
            <s-banner tone="info">
              This invitation was already created (the form was sent twice). No
              second email was sent.
              {!sent &&
                " Use Resend invitation email on the invitation page to send a new link."}
            </s-banner>
          ) : sent ? (
            <s-banner tone="success">
              Invitation emailed to {result.sellerEmail}.
            </s-banner>
          ) : result.email.state === "NOT_DELIVERED" ? (
            <s-banner tone="critical">
              Not sent: this address is on the do-not-email list because an
              earlier email bounced or was marked as spam. Copy the link below,
              or revoke this invitation and create one with the right address.
            </s-banner>
          ) : result.email.state === "SENDING" ? (
            <s-banner tone="info">
              The email is being sent. Copy the link below if the seller doesn’t
              get it.
            </s-banner>
          ) : (
            <s-banner tone="critical">
              Not sent: the email couldn’t be sent. Copy the link below and send
              it to the seller yourself.
            </s-banner>
          )}
          <s-text>Invitation email: {result.email.label}</s-text>
          {result.link && (
            <>
              <s-text-field
                label="Private link (shown once)"
                value={result.link}
                readOnly
              />
              <s-paragraph>
                This link is shown only once and isn’t stored. If the seller
                loses it, use Resend invitation email on the invitation page.
              </s-paragraph>
            </>
          )}
          <s-stack direction="inline" gap="small">
            {result.link && (
              <s-button variant={sent ? "secondary" : "primary"} onClick={copy}>
                Copy link
              </s-button>
            )}
            <s-button href={`/app/invitations/${result.invitationId}`}>
              Add photos and manage
            </s-button>
          </s-stack>
          <s-paragraph>
            The link works until{" "}
            {new Date(result.expiresAt).toLocaleDateString()} if it isn’t used.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
