# F03-FIX-3 — Render a copy-only email template

|                     |                                              |
| ------------------- | -------------------------------------------- |
| **Status**          | To do                                        |
| **Feature**         | [F03 Email and photo services](../README.md) |
| **Module(s)**       | `notifications`                              |
| **Security skills** | `security-notifications`                     |

Start with `/implement-ticket F03-FIX-3`. Follow-up from [F04-T1](../../04-seller-journey/tickets/F04-T1.md) (Notes: the copyable invitation email).

> **2026-10-08:** the client wants the invitation emailed automatically ([F04-FIX-3](../../04-seller-journey/tickets/F04-FIX-3.md)). If that is built, `renderTemplate()` is not needed and only the sample-link fix below remains. Decide before starting this ticket.

## Scope

- [ ] `renderTemplate(key, vars) → { subject, html, text }` exported from `app/modules/notifications/index.js`, for `copyOnly` templates (today: `invitation`). It renders the staff-edited template (or the registry default) with real values.
- [ ] The same checks as `send()`: only whitelisted placeholders for that template, required placeholders present, and every link placeholder must be https. A failed check throws a validation error; nothing is rendered.
- [ ] The rendered result is never stored (no `EmailOutbox` row) and never logged, because it carries the private invitation link.
- [ ] Fix the registry sample link `/apps/classifieds/i/sample` → `/apps/classifieds/seller/sample` (`app/modules/notifications/registry.js`, all sample values, including the `/pay` one) so previews match the real seller route.

## Out of scope

- Sending a `copyOnly` template: `send()` keeps refusing it.
- Showing the rendered email on the Create invitation screen (F04-T1 does that with this helper).

## Acceptance criteria

- [ ] F04-T1’s Create invitation result can show a copyable invitation email with the real link.
- [ ] An unknown key, a non-`copyOnly` key, an unknown placeholder, a missing required placeholder or a non-https link is refused.
- [ ] Rendering writes no `EmailOutbox` row and the link never appears in logs.
- [ ] Settings → Emails previews show `/apps/classifieds/seller/sample`.
- [ ] `npm run test:ai` is green for this feature.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F04-T1 (2026-10-06). The F04-T1 scope item stays open until this lands.
