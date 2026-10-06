import { useEffect, useRef, useState } from "react";
import {
  data,
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { staffFromSession } from "@/modules/core/index.js";
import {
  handleTemplateEditor,
  loadTemplateEditor,
} from "@/modules/notifications/index.js";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const editor = await loadTemplateEditor(
    params.key,
    staffFromSession(session),
  );
  if (!editor) throw new Response(null, { status: 404 });

  return editor;
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const result = await handleTemplateEditor(
    params.key,
    await request.formData(),
    staffFromSession(session),
  );
  if (!result) throw new Response(null, { status: 404 });

  return result.ok ? result : data(result, { status: 400 });
};

export default function EmailTemplate() {
  const editor = useLoaderData();
  const saved = useActionData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const formRef = useRef(null);
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const testToRef = useRef(null);
  const [dirty, setDirty] = useState(false);
  const busy = fetcher.state !== "idle";
  // The newest answer wins: a save comes back through the form, the rest through the fetcher.
  const failed = [fetcher.data, saved].find((each) => each?.ok === false);
  const errors = failed?.fieldErrors ?? {};
  const preview =
    fetcher.data?.intent === "preview" && fetcher.data.ok
      ? fetcher.data.preview
      : editor.preview;
  const formKey = `${editor.subject}\n${editor.bodyHtml}`;

  // Custom elements don't raise React's change events, so the form is watched directly.
  useEffect(() => {
    const form = formRef.current;
    const markDirty = () => setDirty(true);
    form?.addEventListener("input", markDirty);
    return () => form?.removeEventListener("input", markDirty);
  }, [formKey]);

  useEffect(() => setDirty(false), [formKey]);

  useEffect(() => {
    if (saved?.ok) shopify.toast.show("Email saved");
  }, [saved, shopify]);

  useEffect(() => {
    const result = fetcher.data;
    if (result?.ok && result.intent === "test")
      shopify.toast.show(result.message);
    if (result?.ok && result.intent === "reset")
      shopify.toast.show("Email reset to the default wording");
  }, [fetcher.data, shopify]);

  const addPlaceholder = (text) => {
    const body = bodyRef.current;
    if (!body) return;
    body.value = `${body.value ?? ""}${text}`;
    // Tells the save bar and the unsaved-edits check that the body changed.
    body.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const showPreview = () =>
    fetcher.submit(
      {
        intent: "preview",
        subject: subjectRef.current?.value ?? "",
        bodyHtml: bodyRef.current?.value ?? "",
      },
      { method: "post" },
    );
  const sendTest = () =>
    fetcher.submit(
      { intent: "test", testTo: testToRef.current?.value ?? "" },
      { method: "post" },
    );
  const reset = () =>
    fetcher.submit({ intent: "reset", confirmed: "yes" }, { method: "post" });

  return (
    <s-page heading={editor.label}>
      <s-link slot="breadcrumb-actions" href="/app/settings/emails">
        Emails
      </s-link>
      {editor.customised && (
        <s-button
          slot="secondary-actions"
          commandFor="reset-email"
          command="--show"
        >
          Reset to default
        </s-button>
      )}

      {failed?.error && <s-banner tone="critical">{failed.error}</s-banner>}

      {/* The key resets the form (and the save bar) once the saved wording comes back. */}
      <Form method="post" data-save-bar key={formKey} ref={formRef}>
        <input type="hidden" name="intent" value="save" />
        <s-section heading="Wording">
          <s-stack gap="base">
            <s-paragraph>{editor.description}</s-paragraph>
            <s-text-field
              ref={subjectRef}
              label="Subject"
              name="subject"
              maxLength="200"
              value={editor.subject}
              error={errors.subject}
            />
            <s-text-area
              ref={bodyRef}
              label="Body"
              name="bodyHtml"
              rows="16"
              value={editor.bodyHtml}
              error={errors.bodyHtml}
              details="Simple HTML: paragraphs, links, lists and bold text. The logo and footer are added automatically."
            />
          </s-stack>
        </s-section>
      </Form>

      <s-section heading="Placeholders">
        <s-stack gap="base">
          <s-paragraph>
            A placeholder is replaced with the real value when the email is
            sent. Select one to add it to the end of the body, or type it into
            the subject. Required ones can’t be removed.
          </s-paragraph>
          <s-stack direction="inline" gap="small">
            {editor.placeholders.map(({ name, required }) => (
              <s-button
                key={name}
                onClick={() => addPlaceholder(`{{ ${name} }}`)}
              >
                {`{{ ${name} }}`}
                {required ? " (required)" : ""}
              </s-button>
            ))}
          </s-stack>
          {editor.loops.map(({ name, fields }) => (
            <s-paragraph key={name}>
              {`List “${name}”: use {% for item in ${name} %} … {% endfor %} with `}
              {fields.map((field) => `{{ item.${field} }}`).join(", ")}.
            </s-paragraph>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Preview">
        <s-stack gap="base">
          <s-button onClick={showPreview} disabled={busy || undefined}>
            Update preview
          </s-button>
          {editor.canTest && (
            <s-stack direction="inline" gap="small" alignItems="end">
              <s-email-field
                ref={testToRef}
                label="Send a test to"
                value={editor.testTo}
                error={errors.testTo}
                details="The saved wording is sent with sample data."
              />
              <s-button
                onClick={sendTest}
                disabled={busy || dirty || undefined}
              >
                Send test
              </s-button>
            </s-stack>
          )}
          {editor.canTest && dirty && (
            <s-paragraph>Save your changes before sending a test.</s-paragraph>
          )}
          {!editor.canTest && (
            <s-paragraph>
              Staff copy this message and send it themselves, so there is no
              test email.
            </s-paragraph>
          )}
          {preview ? (
            <s-stack gap="small">
              <s-paragraph>
                <s-text type="strong">Subject: </s-text>
                {preview.subject}
              </s-paragraph>
              {/* An empty sandbox: the preview can't run scripts or reach the admin. */}
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={preview.html}
                style={{
                  width: "100%",
                  height: "640px",
                  border: "1px solid #ddd",
                }}
              />
            </s-stack>
          ) : (
            <s-paragraph>
              This email can’t be shown until its wording is fixed.
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-modal id="reset-email" heading="Reset to the default wording?">
        <s-paragraph>
          Your subject and body are replaced with the default wording. This is
          recorded in the history.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          commandFor="reset-email"
          command="--hide"
          onClick={reset}
        >
          Reset
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor="reset-email"
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
