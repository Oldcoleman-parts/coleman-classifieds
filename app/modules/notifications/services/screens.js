// Settings → Emails: turns the stored templates and email settings into what the two admin
// screens show, and a submitted form into a template or settings change.
import {
  requireEmail,
  requireEnum,
  requireStaff,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";
import { EMAIL_DEFAULTS } from "../../../../emails/defaults.js";
import { AUDIENCES, COMMON_PLACEHOLDERS, TEMPLATES } from "../registry.js";
import {
  EMAIL_SETTINGS_FIELDS,
  getEmailSettings,
  updateEmailSettings,
} from "./email-settings.js";
import { send } from "./outbox.js";
import {
  getTemplate,
  previewTemplate,
  resetTemplate,
  saveTemplate,
} from "./templates.js";

const INTENTS = /** @type {const} */ (["save", "preview", "reset", "test"]);

const TEST_MESSAGES = {
  SENT: "Test email sent.",
  PENDING: "The test email is queued and will be sent when email is available.",
  SUPPRESSED:
    "That address is blocked after a bounce or complaint, so no test was sent.",
};
const TEST_FAILED = "The test email could not be sent.";

// DECISION: staff may send a test to any address (the product owner asked for this, to
// check other mailboxes). To keep that from becoming a way to mail strangers in bulk, each
// staff member gets a small hourly allowance and every test is audited with its recipient.
const MAX_TESTS_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;
/** @type {Map<string, number[]>} staff email → times of their recent tests (in-process) */
const recentTests = new Map();

/** Forget the test allowance. For tests. */
export function resetTestEmailLimit() {
  recentTests.clear();
}

/**
 * @param {string} staffRef
 * @param {Date} now
 */
function takeTestAllowance(staffRef, now) {
  const recent = (recentTests.get(staffRef) ?? []).filter(
    (time) => time > now.getTime() - HOUR_MS,
  );
  if (recent.length >= MAX_TESTS_PER_HOUR)
    throw new ValidationError("Too many test emails", {
      testTo: `only ${MAX_TESTS_PER_HOUR} test emails can be sent in an hour; try again later`,
    });
  recentTests.set(staffRef, [...recent, now.getTime()]);
}

/**
 * @param {FormData} formData
 * @param {string} field
 * @returns {string} empty when the field is missing or is a file
 */
function text(formData, field) {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * @param {{ subject: string, bodyHtml: string }} template
 * @param {string} key
 */
function isCustomised(template, key) {
  const defaults = EMAIL_DEFAULTS[key];
  return (
    template.subject !== defaults.subject ||
    template.bodyHtml !== defaults.bodyHtml
  );
}

/**
 * The Emails screen: every template grouped by who receives it, and the settings form.
 * The sender address is shown but can't be edited.
 * @returns {Promise<{
 *   groups: { audience: string, heading: string,
 *     templates: { key: string, label: string, description: string, customised: boolean }[] }[],
 *   settings: Record<string, string>,
 *   fromAddress: string,
 * }>}
 */
export async function loadEmailsScreen() {
  const settings = await getEmailSettings();
  const groups = [];
  for (const { audience, heading } of AUDIENCES) {
    const templates = [];
    for (const [key, def] of Object.entries(TEMPLATES)) {
      if (def.audience !== audience) continue;
      templates.push({
        key,
        label: def.label,
        description: def.description,
        customised: isCustomised(await getTemplate(key), key),
      });
    }
    groups.push({ audience, heading, templates });
  }
  return {
    groups,
    settings: {
      senderName: settings.senderName,
      replyTo: settings.replyTo ?? "",
      staffNotify: settings.staffNotify.join("\n"),
      logoUrl: settings.logoUrl ?? "",
      buttonColor: settings.buttonColor,
      footerText: settings.footerText ?? "",
      phone: settings.phone ?? "",
      supportEmail: settings.supportEmail ?? "",
      postalAddress: settings.postalAddress ?? "",
    },
    fromAddress: settings.fromAddress,
  };
}

/**
 * Save the email settings form.
 * @param {FormData} formData
 * @param {import("@/modules/core/types.js").ActorRef} actor the staff member, from the session
 * @returns {Promise<{ ok: true, changed: string[] } | { ok: false, fieldErrors: Record<string, string> }>}
 */
export async function saveEmailSettingsForm(formData, actor) {
  try {
    const { changed } = await updateEmailSettings(
      Object.fromEntries(
        EMAIL_SETTINGS_FIELDS.map((field) => [field, text(formData, field)]),
      ),
      actor,
    );
    return { ok: true, changed };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ok: false, fieldErrors: error.fields };
  }
}

/**
 * The template editor for one email.
 * @param {unknown} key
 * @param {import("@/modules/core/types.js").ActorRef} actor the staff member, from the session
 * @returns {Promise<null | {
 *   key: string, label: string, description: string, subject: string, bodyHtml: string,
 *   customised: boolean, canTest: boolean, testTo: string,
 *   placeholders: { name: string, required: boolean }[],
 *   loops: { name: string, fields: string[] }[],
 *   preview: { subject: string, html: string } | null,
 * }>} null for a key that isn't in the registry
 */
export async function loadTemplateEditor(key, actor) {
  const staff = requireStaff(actor);
  if (typeof key !== "string" || !Object.hasOwn(TEMPLATES, key)) return null;
  const def = TEMPLATES[key];
  const template = await getTemplate(key);
  const loops = def.loops ?? {};
  let preview = null;
  try {
    const { subject, html } = await previewTemplate(key);
    preview = { subject, html };
  } catch (error) {
    // A stored template that no longer renders still opens, so staff can fix or reset it.
    if (!(error instanceof ValidationError)) throw error;
  }
  return {
    key,
    label: def.label,
    description: def.description,
    subject: template.subject,
    bodyHtml: template.bodyHtml,
    customised: isCustomised(template, key),
    canTest: !def.copyOnly,
    testTo: staff.ref,
    placeholders: [...def.allowed, ...COMMON_PLACEHOLDERS]
      .filter((name) => !Object.hasOwn(loops, name))
      .map((name) => ({ name, required: def.required.includes(name) })),
    loops: Object.entries(loops).map(([name, fields]) => ({ name, fields })),
    preview,
  };
}

/**
 * Send the saved template, filled with its sample data, as a test. It goes to the address
 * staff typed, or to the signed-in staff member when none is given. It goes through
 * `send()`, so a blocked address gets nothing.
 * @param {string} key
 * @param {import("@/modules/core/types.js").ActorRef} actor
 * @param {{ to?: unknown, now?: Date }} [options]
 * @returns {Promise<{ status: string, outboxId: string, to: string }>}
 * @throws {ValidationError} for an unknown key, an email the app doesn't send, a bad
 *   address or too many tests in an hour
 */
export async function sendTestEmail(key, actor, options = {}) {
  const staff = requireStaff(actor);
  if (typeof key !== "string" || !Object.hasOwn(TEMPLATES, key))
    throw new ValidationError("Unknown email template", {
      key: "is not a known email template",
    });
  if (TEMPLATES[key].copyOnly)
    throw new ValidationError("This email is not sent by the app", {
      key: "is not sent by the app",
    });
  const given = typeof options.to === "string" ? options.to.trim() : "";
  const to = given === "" ? staff.ref : requireEmail(given, "testTo");
  takeTestAllowance(staff.ref, options.now ?? new Date());
  let result;
  try {
    result = await send(key, to, TEMPLATES[key].sample, { now: options.now });
  } catch (error) {
    // `send()` names its address field "to"; the screen's field is "testTo".
    if (error instanceof ValidationError && error.fields.to)
      throw new ValidationError(error.message, { testTo: error.fields.to });
    throw error;
  }
  const { status, outboxId } = result;
  await writeAudit({
    action: "EmailTestSent",
    actor: staff,
    details: { key, status, to },
  });
  return { status, outboxId, to };
}

/**
 * One action from the template editor: save, preview, reset or send a test.
 * @param {unknown} key
 * @param {FormData} formData
 * @param {import("@/modules/core/types.js").ActorRef} actor the staff member, from the session
 * @returns {Promise<null
 *   | { ok: true, intent: "save" | "reset", changed: boolean }
 *   | { ok: true, intent: "preview", preview: { subject: string, html: string } }
 *   | { ok: true, intent: "test", message: string }
 *   | { ok: false, intent?: string, error?: string, fieldErrors?: Record<string, string> }
 * >} null for a key that isn't in the registry
 */
export async function handleTemplateEditor(key, formData, actor) {
  requireStaff(actor);
  if (typeof key !== "string" || !Object.hasOwn(TEMPLATES, key)) return null;
  let intent;
  try {
    intent = requireEnum(text(formData, "intent"), INTENTS, "intent");
    const draft = {
      subject: text(formData, "subject"),
      bodyHtml: text(formData, "bodyHtml"),
    };

    if (intent === "save") {
      const { changed } = await saveTemplate(key, draft, actor);
      return { ok: true, intent, changed };
    }
    if (intent === "preview") {
      const { subject, html } = await previewTemplate(key, draft);
      return { ok: true, intent, preview: { subject, html } };
    }
    if (intent === "reset") {
      if (text(formData, "confirmed") !== "yes")
        return { ok: false, intent, error: "Confirm before resetting." };
      const { changed } = await resetTemplate(key, actor);
      return { ok: true, intent, changed };
    }
    // DECISION: a test sends the saved template, not the unsaved draft, through the normal
    // send path; the screen disables the button while there are unsaved edits.
    if (
      TEMPLATES[key].stream === "alerts" &&
      !(await getEmailSettings()).postalAddress?.trim()
    )
      return {
        ok: false,
        intent,
        error:
          "Alert emails need the postal address. Add it in the email settings first.",
      };
    const { status } = await sendTestEmail(key, actor, {
      to: text(formData, "testTo"),
    });
    return TEST_MESSAGES[status]
      ? { ok: true, intent, message: TEST_MESSAGES[status] }
      : { ok: false, intent, error: TEST_FAILED };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const { subject, bodyHtml, testTo, ...other } = error.fields;
    const fieldErrors = {
      ...(subject ? { subject } : {}),
      ...(bodyHtml ? { bodyHtml } : {}),
      ...(testTo ? { testTo } : {}),
    };
    const rest = Object.values(other);
    return {
      ok: false,
      intent,
      fieldErrors,
      // A problem that belongs to no field on the screen is shown as a banner.
      ...(rest.length > 0 || Object.keys(fieldErrors).length === 0
        ? { error: rest[0] ? `This email ${rest[0]}.` : error.message }
        : {}),
    };
  }
}
