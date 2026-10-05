import { useEffect } from "react";
import { data, Form, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { staffFromSession } from "@/modules/core/index.js";
import {
  loadEmailsScreen,
  saveEmailSettingsForm,
} from "@/modules/notifications/index.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return loadEmailsScreen();
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const result = await saveEmailSettingsForm(
    await request.formData(),
    staffFromSession(session),
  );

  return result.ok ? result : data(result, { status: 400 });
};

export default function Emails() {
  const { groups, settings, fromAddress } = useLoaderData();
  const result = useActionData();
  const shopify = useAppBridge();
  const errors = result?.ok === false ? result.fieldErrors : {};

  useEffect(() => {
    if (result?.ok) shopify.toast.show("Email settings saved");
  }, [result, shopify]);

  return (
    <s-page heading="Emails">
      <s-link slot="breadcrumb-actions" href="/app/settings">
        Settings
      </s-link>

      {settings.staffNotify === "" && (
        <s-banner tone="warning">
          Staff notices are off. Add a staff notification address below to be
          told when a listing or a held message needs review.
        </s-banner>
      )}

      {groups.map(({ audience, heading, templates }) => (
        <s-section key={audience} heading={heading}>
          <s-stack gap="base">
            {templates.map(({ key, label, description, customised }) => (
              <s-stack
                key={key}
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-stack gap="small-300">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-heading>{label}</s-heading>
                    <s-badge tone={customised ? "info" : "neutral"}>
                      {customised ? "Customised" : "Default"}
                    </s-badge>
                  </s-stack>
                  <s-paragraph>{description}</s-paragraph>
                </s-stack>
                <s-button href={`/app/settings/emails/${key}`}>Edit</s-button>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      ))}

      {/* The key resets the form (and the save bar) once the saved values come back. */}
      <Form method="post" data-save-bar key={JSON.stringify(settings)}>
        <s-section heading="Sender">
          <s-stack gap="base">
            <s-text-field
              label="Sender name"
              name="senderName"
              maxLength="80"
              value={settings.senderName}
              error={errors.senderName}
              details={`Emails are sent from ${fromAddress || "the address set up with the email service"}.`}
            />
            <s-email-field
              label="Reply-to address"
              name="replyTo"
              value={settings.replyTo}
              error={errors.replyTo}
              details="Where replies go. Leave empty to use the sender address."
            />
            <s-text-area
              label="Staff notification address"
              name="staffNotify"
              rows="3"
              value={settings.staffNotify}
              error={errors.staffNotify}
              details="Who is told when a listing or a held message needs review. One address per line, up to 5."
            />
          </s-stack>
        </s-section>

        <s-section heading="Look">
          <s-stack gap="base">
            <s-url-field
              label="Logo link"
              name="logoUrl"
              value={settings.logoUrl}
              error={errors.logoUrl}
              details="An https link to the logo image. Leave empty to show the sender name."
            />
            <s-text-field
              label="Button and link colour"
              name="buttonColor"
              maxLength="7"
              value={settings.buttonColor}
              error={errors.buttonColor}
              details="A colour code such as #C8102E."
            />
          </s-stack>
        </s-section>

        <s-section heading="Footer">
          <s-stack gap="base">
            <s-text-area
              label="Footer text"
              name="footerText"
              rows="3"
              value={settings.footerText}
              error={errors.footerText}
            />
            <s-text-field
              label="Phone"
              name="phone"
              value={settings.phone}
              error={errors.phone}
            />
            <s-email-field
              label="Support email"
              name="supportEmail"
              value={settings.supportEmail}
              error={errors.supportEmail}
            />
            <s-text-area
              label="Postal address"
              name="postalAddress"
              rows="3"
              value={settings.postalAddress}
              error={errors.postalAddress}
              details="Shown at the bottom of every email. Alert emails are not sent without it."
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
