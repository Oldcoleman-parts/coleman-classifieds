// The one place that talks to Amazon SES. The client is created on the first send, so the
// app starts (and tests run) without any AWS settings; tests swap in a stand-in.
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

/** @type {{ send: (command: unknown) => Promise<{ MessageId?: string }> } | null} */
let client = null;

/** @returns {{ send: (command: unknown) => Promise<{ MessageId?: string }> }} */
export function getSesClient() {
  // Credentials come from the standard AWS environment variables or the host's role.
  client ??= new SESv2Client({ region: process.env.AWS_REGION });
  return client;
}

/**
 * Replace the SES client (tests), or pass null to go back to the real one.
 * @param {{ send: (command: unknown) => Promise<{ MessageId?: string }> } | null} replacement
 */
export function setSesClient(replacement) {
  client = replacement;
}

const STREAMS = {
  transactional: {
    from: "SES_FROM_TRANSACTIONAL",
    configSet: "SES_CONFIG_SET_TRANSACTIONAL",
  },
  alerts: { from: "SES_FROM_ALERTS", configSet: "SES_CONFIG_SET_ALERTS" },
};

/** The email can't be sent until the stream's sender and configuration set are set. */
export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email sending is not configured");
    this.name = "EmailNotConfigured";
  }
}

/** Strip anything that could start a new header or break out of the quoted name. */
const headerText = (value) =>
  String(value ?? "")
    .replace(/[\r\n"<>\\]+/g, " ")
    .trim();

/**
 * @param {object} email
 * @param {"transactional" | "alerts"} email.stream
 * @param {string} email.to a validated address
 * @param {string | null} [email.replyTo] a validated address
 * @param {string} email.senderName
 * @param {string} email.subject
 * @param {string} email.html
 * @param {string} email.text
 * @param {string | null} [email.unsubscribeLink] alert emails: adds the one-click headers
 * @returns {SendEmailCommand}
 * @throws {EmailNotConfiguredError}
 */
export function buildSendCommand(email) {
  const stream = STREAMS[email.stream];
  const from = process.env[stream.from];
  const configSet = process.env[stream.configSet];
  if (!from || !configSet) throw new EmailNotConfiguredError();
  const name = headerText(email.senderName);
  return new SendEmailCommand({
    FromEmailAddress: name ? `"${name}" <${from}>` : from,
    Destination: { ToAddresses: [email.to] },
    ...(email.replyTo ? { ReplyToAddresses: [email.replyTo] } : {}),
    ConfigurationSetName: configSet,
    Content: {
      Simple: {
        Subject: { Data: headerText(email.subject), Charset: "UTF-8" },
        Body: {
          Html: { Data: email.html, Charset: "UTF-8" },
          Text: { Data: email.text, Charset: "UTF-8" },
        },
        ...(email.unsubscribeLink
          ? {
              Headers: [
                {
                  Name: "List-Unsubscribe",
                  Value: `<${email.unsubscribeLink}>`,
                },
                {
                  Name: "List-Unsubscribe-Post",
                  Value: "List-Unsubscribe=One-Click",
                },
              ],
            }
          : {}),
      },
    },
  });
}
