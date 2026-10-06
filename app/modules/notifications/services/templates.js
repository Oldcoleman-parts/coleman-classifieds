// The stored email templates: seeded from emails/defaults.js, edited by staff, versioned.
import prisma from "@/db.server";
import {
  requireStaff,
  SYSTEM_ACTOR,
  writeAudit,
} from "@/modules/core/index.js";
import { EMAIL_DEFAULTS } from "../../../../emails/defaults.js";
import { SUPERSEDED_DEFAULTS } from "../../../../emails/superseded.js";
import { TEMPLATE_KEYS, templateDef } from "../registry.js";
import { getEmailSettings } from "./email-settings.js";
import { cleanTemplate, renderEmail } from "./render.js";

/**
 * @param {string} key
 * @returns {Promise<import("@prisma/client").EmailTemplate>} seeded with the defaults on first use
 */
export async function getTemplate(key) {
  templateDef(key);
  const existing = await prisma.emailTemplate.findUnique({ where: { key } });
  if (existing) return upgradeDefault(existing);
  await prisma.emailTemplate.createMany({
    data: TEMPLATE_KEYS.map((each) => ({ key: each, ...EMAIL_DEFAULTS[each] })),
    skipDuplicates: true,
  });
  return prisma.emailTemplate.findUniqueOrThrow({ where: { key } });
}

/**
 * A stored template that still holds an earlier default (staff never changed it) moves to the
 * current default. Wording staff changed is never touched.
 * @param {import("@prisma/client").EmailTemplate} template
 * @returns {Promise<import("@prisma/client").EmailTemplate>}
 */
async function upgradeDefault(template) {
  const old = (SUPERSEDED_DEFAULTS[template.key] ?? []).find(
    (each) =>
      each.subject === template.subject && each.bodyHtml === template.bodyHtml,
  );
  if (!old) return template;
  await prisma.$transaction(async (tx) => {
    // Only if the row still holds that wording, so a save in between is never overwritten.
    const { count } = await tx.emailTemplate.updateMany({
      where: {
        key: template.key,
        subject: old.subject,
        bodyHtml: old.bodyHtml,
      },
      data: {
        ...EMAIL_DEFAULTS[template.key],
        version: { increment: 1 },
        updatedBy: null,
      },
    });
    if (count > 0)
      await writeAudit(
        {
          action: "EmailTemplateDefaultsUpdated",
          actor: SYSTEM_ACTOR,
          details: { key: template.key, version: template.version + 1 },
        },
        { tx },
      );
  });
  return prisma.emailTemplate.findUniqueOrThrow({
    where: { key: template.key },
  });
}

/**
 * @param {string} key
 * @param {{ subject: string, bodyHtml: string }} content already cleaned
 * @param {import("@/modules/core/types.js").ActorRef} staff
 * @param {string} action the audit action
 */
async function store(key, content, staff, action) {
  const current = await getTemplate(key);
  if (
    current.subject === content.subject &&
    current.bodyHtml === content.bodyHtml
  )
    return { template: current, changed: false };
  const template = await prisma.$transaction(async (tx) => {
    const updated = await tx.emailTemplate.update({
      where: { key },
      data: { ...content, version: { increment: 1 }, updatedBy: staff.ref },
    });
    // The wording itself is not copied into the audit log; the version identifies it.
    await writeAudit(
      { action, actor: staff, details: { key, version: updated.version } },
      { tx },
    );
    return updated;
  });
  return { template, changed: true };
}

/**
 * Save staff's wording for one template. Staff only: call this from admin routes.
 * @param {string} key
 * @param {{ subject: unknown, bodyHtml: unknown }} input
 * @param {import("@/modules/core/types.js").ActorRef} actor
 * @returns {Promise<{ template: import("@prisma/client").EmailTemplate, changed: boolean }>}
 * @throws {import("@/modules/core/index.js").ValidationError} when a placeholder is unknown,
 *   a required one was removed, or the Liquid can't be read
 */
export async function saveTemplate(key, input, actor) {
  const staff = requireStaff(actor);
  return store(
    key,
    await cleanTemplate(key, input),
    staff,
    "EmailTemplateUpdated",
  );
}

/**
 * Put one template back to its default wording. Staff only.
 * @param {string} key
 * @param {import("@/modules/core/types.js").ActorRef} actor
 * @returns {Promise<{ template: import("@prisma/client").EmailTemplate, changed: boolean }>}
 */
export async function resetTemplate(key, actor) {
  const staff = requireStaff(actor);
  templateDef(key);
  return store(key, EMAIL_DEFAULTS[key], staff, "EmailTemplateReset");
}

/**
 * Render a template with its sample data, without sending anything.
 * @param {string} key
 * @param {{ subject: unknown, bodyHtml: unknown }} [draft] unsaved wording to preview;
 *   the stored template when left out
 * @returns {Promise<{ subject: string, html: string, text: string }>}
 */
export async function previewTemplate(key, draft) {
  const def = templateDef(key);
  const template = draft
    ? await cleanTemplate(key, draft)
    : await getTemplate(key);
  return renderEmail(key, template, def.sample, await getEmailSettings());
}
