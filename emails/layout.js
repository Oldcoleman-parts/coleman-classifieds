// The shared email layout: logo header, body, footer. This is the only place that writes
// raw HTML around a template body, so every value from EmailSettings is escaped here.

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** @param {string} text */
const lines = (text) => escapeHtml(text).replace(/\r?\n/g, "<br>");

/**
 * @param {object} options
 * @param {string} options.bodyHtml already rendered and sanitised
 * @param {{ senderName: string, logoUrl?: string | null, footerText?: string | null,
 *   phone?: string | null, supportEmail?: string | null, postalAddress?: string | null }} options.settings
 * @param {string | null} [options.unsubscribeLink] alert emails only: always shown, with the
 *   postal address, whatever the template body says
 * @returns {string} the whole HTML document
 */
export function renderLayout({ bodyHtml, settings, unsubscribeLink = null }) {
  const header = settings.logoUrl
    ? `<img src="${escapeHtml(settings.logoUrl)}" alt="${escapeHtml(settings.senderName)}" height="48" style="height:48px;border:0">`
    : `<strong>${escapeHtml(settings.senderName)}</strong>`;
  const contact = [settings.phone, settings.supportEmail]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
  const footer = [
    settings.footerText ? `<p>${lines(settings.footerText)}</p>` : "",
    contact ? `<p>${contact}</p>` : "",
    unsubscribeLink
      ? `<p><a href="${escapeHtml(unsubscribeLink)}">Unsubscribe</a></p>`
      : "",
    `<p>${escapeHtml(settings.senderName)}${
      settings.postalAddress ? ` · ${lines(settings.postalAddress)}` : ""
    }</p>`,
  ].join("");

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#222">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
<tr><td style="padding:24px 32px 8px">${header}</td></tr>
<tr><td style="padding:8px 32px 24px;font-size:16px;line-height:1.5">${bodyHtml}</td></tr>
<tr><td style="padding:16px 32px 24px;font-size:12px;line-height:1.5;color:#666;border-top:1px solid #e5e5e5">${footer}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}
