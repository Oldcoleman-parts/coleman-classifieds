// The Amazon SNS endpoint that receives SES bounce and complaint notices. Nothing in a
// message is trusted until its signature, its certificate's host and its topic are checked.
import { createVerify } from "node:crypto";
import { reportEmailProblem } from "./problems.js";
import { suppress } from "./suppression.js";

const SNS_HOST_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const MAX_BODY_BYTES = 150_000;
// The fields SNS signs, in order, for each message type.
const SIGNED_FIELDS = {
  Notification: [
    "Message",
    "MessageId",
    "Subject",
    "Timestamp",
    "TopicArn",
    "Type",
  ],
  SubscriptionConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
};
SIGNED_FIELDS.UnsubscribeConfirmation = SIGNED_FIELDS.SubscriptionConfirmation;
const ALGORITHMS = { 1: "RSA-SHA1", 2: "RSA-SHA256" };

/** @type {Map<string, string>} certificate URL → PEM */
const certificates = new Map();

/** @type {(url: string) => Promise<string>} */
const fetchText = async (url) => {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error("SNS request failed");
  return response.text();
};
let http = fetchText;

/**
 * Replace the HTTPS fetch used for certificates and subscription confirmation (tests), or
 * pass null to go back to the real one.
 * @param {((url: string) => Promise<string>) | null} replacement
 */
export function setSnsFetch(replacement) {
  http = replacement ?? fetchText;
  certificates.clear();
}

/**
 * @param {unknown} value
 * @param {{ pem?: boolean }} [options]
 * @returns {string | null} the URL when it is https on an Amazon SNS host
 */
function snsUrl(value, { pem = false } = {}) {
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const ok =
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    SNS_HOST_RE.test(url.hostname) &&
    (!pem || url.pathname.endsWith(".pem"));
  return ok ? url.href : null;
}

/**
 * @param {Record<string, unknown>} message the parsed SNS envelope
 * @returns {Promise<boolean>}
 */
async function isGenuine(message) {
  const topic = process.env.SNS_TOPIC_ARN;
  const fields = SIGNED_FIELDS[/** @type {string} */ (message.Type)];
  const algorithm =
    ALGORITHMS[/** @type {string} */ (message.SignatureVersion)];
  const certUrl = snsUrl(message.SigningCertURL, { pem: true });
  if (!topic || message.TopicArn !== topic) return false;
  if (!fields || !algorithm || !certUrl) return false;
  if (typeof message.Signature !== "string") return false;

  let signed = "";
  for (const field of fields) {
    const value = message[field];
    if (value === undefined && field === "Subject") continue;
    if (typeof value !== "string") return false;
    signed += `${field}\n${value}\n`;
  }
  try {
    if (!certificates.has(certUrl))
      certificates.set(certUrl, await http(certUrl));
    return createVerify(algorithm)
      .update(signed, "utf8")
      .verify(certificates.get(certUrl), message.Signature, "base64");
  } catch {
    certificates.delete(certUrl);
    return false;
  }
}

/**
 * Act on one SES event. Repeats are harmless: suppressing an address twice changes nothing.
 * @param {unknown} event the JSON SES put in the SNS message
 */
async function handleSesEvent(event) {
  if (typeof event !== "object" || event === null) return;
  const { eventType, notificationType, bounce, complaint } =
    /** @type {Record<string, any>} */ (event);
  const type = eventType ?? notificationType;
  const addresses = (list) =>
    (Array.isArray(list) ? list : [])
      .map((recipient) => recipient?.emailAddress)
      .filter((email) => typeof email === "string" && email.includes("@"));

  if (type === "Bounce" && bounce?.bounceType === "Permanent") {
    for (const email of addresses(bounce.bouncedRecipients))
      await suppress(email, "BOUNCE");
  } else if (type === "Complaint") {
    // Follow-up for F07: a complaint must also unsubscribe the alert subscriber.
    for (const email of addresses(complaint?.complainedRecipients))
      await suppress(email, "COMPLAINT");
  } else if (type === "Reject" || type === "Rendering Failure") {
    await reportEmailProblem(
      "email-ses-rejected",
      "Amazon SES refused to send an email.",
    );
  }
}

/**
 * Handle `POST /webhooks/ses`.
 * @param {Request} request
 * @returns {Promise<Response>} 403 unless the message is signed by Amazon SNS for our topic
 */
export async function handleSesWebhook(request) {
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const forbidden = () => new Response(null, { status: 403 });

  let message;
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return forbidden();
    message = JSON.parse(body);
  } catch {
    return forbidden();
  }
  if (typeof message !== "object" || message === null || Array.isArray(message))
    return forbidden();
  if (!(await isGenuine(message))) return forbidden();

  if (message.Type === "SubscriptionConfirmation") {
    const confirmUrl = snsUrl(message.SubscribeURL);
    if (!confirmUrl) return forbidden();
    await http(confirmUrl);
    return new Response(null, { status: 200 });
  }
  if (message.Type === "Notification") {
    let event = null;
    try {
      event = JSON.parse(message.Message);
    } catch {
      // Not an SES event (for example the topic's test message): nothing to do.
    }
    await handleSesEvent(event);
  }
  return new Response(null, { status: 200 });
}
