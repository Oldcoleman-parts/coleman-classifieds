import { useEffect } from "react";
import { data, Form, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadSettingsForm, saveSettingsForm } from "@/modules/console/index.js";
import { staffFromSession } from "@/modules/core/index.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return loadSettingsForm();
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const result = await saveSettingsForm(
    await request.formData(),
    staffFromSession(session),
  );

  return result.ok ? result : data(result, { status: 400 });
};

// React sets a custom element's `checked={false}` as the text "false", which still counts
// as checked, so the attribute is left out instead.
const checked = (on) => (on ? { checked: "" } : {});

export default function Settings() {
  const values = useLoaderData();
  const result = useActionData();
  const shopify = useAppBridge();
  const errors = result?.ok === false ? result.fieldErrors : {};

  useEffect(() => {
    if (result?.ok) shopify.toast.show("Settings saved");
  }, [result, shopify]);

  return (
    <s-page heading="Settings">
      {/* The key resets the form (and the save bar) once the saved values come back. */}
      <Form method="post" data-save-bar key={JSON.stringify(values)}>
        <s-section heading="Fees">
          <s-stack gap="base">
            <s-money-field
              label="Listing fee"
              name="baseFee"
              currencyCode="USD"
              min="0"
              value={values.baseFee}
              error={errors.baseFee}
              details="Used for new invitations. Existing invitations keep their fee."
            />
            <s-money-field
              label="Promotional fee"
              name="promoFee"
              currencyCode="USD"
              min="0"
              value={values.promoFee}
              error={errors.promoFee}
              details="Leave empty when there is no promotion."
            />
          </s-stack>
        </s-section>

        <s-section heading="Time limits">
          <s-stack gap="base">
            <s-number-field
              label="Invitation link"
              name="inviteExpiryDays"
              suffix="days"
              min="1"
              max="60"
              value={values.inviteExpiryDays}
              error={errors.inviteExpiryDays}
              details="How long a seller has to open their invitation."
            />
            <s-number-field
              label="Draft"
              name="draftWindowDays"
              suffix="days"
              min="1"
              max="60"
              value={values.draftWindowDays}
              error={errors.draftWindowDays}
              details="How long a seller has to submit a listing they started."
            />
            <s-number-field
              label="Corrections"
              name="correctionWindowDays"
              suffix="days"
              min="1"
              max="60"
              value={values.correctionWindowDays}
              error={errors.correctionWindowDays}
              details="How long a seller has to make requested changes."
            />
            <s-number-field
              label="Payment"
              name="paymentWindowDays"
              suffix="days"
              min="1"
              max="60"
              value={values.paymentWindowDays}
              error={errors.paymentWindowDays}
              details="How long a seller has to pay after approval."
            />
          </s-stack>
        </s-section>

        <s-section heading="Photos">
          <s-number-field
            label="Photos per listing"
            name="maxPhotos"
            min="1"
            max="12"
            value={values.maxPhotos}
            error={errors.maxPhotos}
          />
        </s-section>

        <s-section heading="Seller sign-in">
          <s-switch
            label="Ask for an email code"
            name="emailCodeRequired"
            value="true"
            details="Sellers confirm a code sent to their email before opening their listing."
            error={errors.emailCodeRequired}
            {...checked(values.emailCodeRequired)}
          />
        </s-section>

        <s-section heading="Held messages">
          <s-stack gap="base">
            <s-paragraph>
              Buyer messages that match these rules wait for staff review before
              they reach the seller.
            </s-paragraph>
            <s-checkbox
              label="Hold messages that contain links"
              name="holdOnLinks"
              value="true"
              error={errors.holdOnLinks}
              {...checked(values.holdOnLinks)}
            />
            <s-text-area
              label="Flagged words"
              name="keywords"
              rows="4"
              value={values.keywords}
              error={errors.keywords}
              details="One word or phrase per line."
            />
            <s-number-field
              label="Repeated sends"
              name="repeatThreshold"
              min="1"
              max="20"
              value={values.repeatThreshold}
              error={errors.repeatThreshold}
              details="Hold a buyer's messages once they have sent this many."
            />
          </s-stack>
        </s-section>
      </Form>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
