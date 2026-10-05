// The EmailSettings singleton (row id 1). Created on first read; staff edit it in
// Settings → Emails.
import prisma from "@/db.server";
import {
  optionalString,
  requireEmail,
  requireStaff,
  requireString,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";

/**
 * @returns {Promise<import("@prisma/client").EmailSettings>}
 */
export async function getEmailSettings() {
  const existing = await prisma.emailSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  // The two columns without a database default start from the environment.
  await prisma.emailSettings.createMany({
    data: [
      {
        id: 1,
        fromAddress: process.env.SES_FROM_TRANSACTIONAL ?? "",
        postalAddress: process.env.OCP_POSTAL_ADDRESS ?? "",
        staffNotify: [],
      },
    ],
    skipDuplicates: true,
  });
  return prisma.emailSettings.findUniqueOrThrow({ where: { id: 1 } });
}

const MAX_STAFF_ADDRESSES = 5;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const PHONE_RE = /^[0-9+().\- x]*$/;
// Characters that could break out of an email header or the address that follows a name.
const HEADER_UNSAFE_RE = /[\r\n"<>\\]+/g;
const ADDRESS_UNSAFE_RE = /[\s"<>\\,;:()]/;

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function emailAddress(value, field) {
  const address = requireEmail(value, field);
  if (ADDRESS_UNSAFE_RE.test(address))
    throw new ValidationError(`${field} is not valid`, {
      [field]: "must be a valid email address",
    });
  return address;
}

/** @type {Record<string, (value: unknown, field: string) => unknown>} */
const EDITABLE = {
  senderName: (value, field) =>
    requireString(
      typeof value === "string"
        ? value.replace(HEADER_UNSAFE_RE, " ").replace(/\s+/g, " ")
        : value,
      field,
      { max: 80 },
    ),
  replyTo: (value, field) =>
    optionalString(value, field) === null ? null : emailAddress(value, field),
  supportEmail: (value, field) =>
    optionalString(value, field) === null ? null : emailAddress(value, field),
  staffNotify: (value, field) => {
    const list = Array.isArray(value)
      ? value
      : String(value ?? "").split(/[\n,]/);
    const addresses = [
      ...new Set(
        list
          .filter((each) => typeof each !== "string" || each.trim() !== "")
          .map((each) => emailAddress(each, field)),
      ),
    ];
    if (addresses.length > MAX_STAFF_ADDRESSES)
      throw new ValidationError(`${field} has too many addresses`, {
        [field]: `must be at most ${MAX_STAFF_ADDRESSES} addresses`,
      });
    return addresses;
  },
  logoUrl: (value, field) => {
    const text = optionalString(value, field, { max: 500 });
    if (text === null) return null;
    const problem = { [field]: "must be a link that starts with https://" };
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new ValidationError(`${field} is not a link`, problem);
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new ValidationError(`${field} is not an https link`, problem);
    return url.href;
  },
  buttonColor: (value, field) => {
    const text = requireString(value, field, { max: 7 });
    if (!HEX_COLOR_RE.test(text))
      throw new ValidationError(`${field} is not a colour`, {
        [field]: "must be a colour such as #C8102E",
      });
    return text.toUpperCase();
  },
  footerText: (value, field) => optionalString(value, field, { max: 500 }),
  phone: (value, field) => {
    const text = optionalString(value, field, { max: 40 });
    if (text !== null && !PHONE_RE.test(text))
      throw new ValidationError(`${field} is not a phone number`, {
        [field]: "must be a phone number",
      });
    return text;
  },
  // DECISION: may be empty; alert emails are refused by the engine until it is filled in.
  postalAddress: (value, field) =>
    optionalString(value, field, { max: 300 }) ?? "",
};

export const EMAIL_SETTINGS_FIELDS = Object.keys(EDITABLE);

/**
 * Change the email settings. Staff only: call this from admin routes. Only the fields that
 * are present are changed; the sender address comes from the environment and can't be set.
 * @param {Record<string, unknown>} input
 * @param {import("@/modules/core/types.js").ActorRef} actor
 * @returns {Promise<{ settings: import("@prisma/client").EmailSettings, changed: string[] }>}
 * @throws {ValidationError} with every field problem
 */
export async function updateEmailSettings(input, actor) {
  const staff = requireStaff(actor);
  /** @type {Record<string, unknown>} */
  const values = {};
  /** @type {Record<string, string>} */
  const fields = {};
  for (const field of Object.keys(input ?? {})) {
    if (!Object.hasOwn(EDITABLE, field)) {
      fields[field] = "can't be changed";
      continue;
    }
    try {
      values[field] = EDITABLE[field](input[field], field);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      Object.assign(fields, error.fields);
    }
  }
  if (Object.keys(fields).length > 0)
    throw new ValidationError("Email settings are not valid", fields);

  const current = await getEmailSettings();
  const changed = Object.keys(values).filter(
    (field) => JSON.stringify(values[field]) !== JSON.stringify(current[field]),
  );
  if (changed.length === 0) return { settings: current, changed };

  const settings = await prisma.$transaction(async (tx) => {
    const updated = await tx.emailSettings.update({
      where: { id: 1 },
      data: Object.fromEntries(changed.map((field) => [field, values[field]])),
    });
    // DECISION: the audit entry names the changed fields only, so addresses stay out of it.
    await writeAudit(
      { action: "EmailSettingsUpdated", actor: staff, details: { changed } },
      { tx },
    );
    return updated;
  });
  return { settings, changed };
}
