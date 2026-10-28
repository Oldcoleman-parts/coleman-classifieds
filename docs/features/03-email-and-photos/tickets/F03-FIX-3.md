# F03-FIX-3 — Render a copy-only email template

|                     |                                              |
| ------------------- | -------------------------------------------- |
| **Status**          | Done                                         |
| **Feature**         | [F03 Email and photo services](../README.md) |
| **Module(s)**       | `notifications`                              |
| **Security skills** | `security-notifications`                     |

Start with `/implement-ticket F03-FIX-3`. Follow-up from [F04-T1](../../04-seller-journey/tickets/F04-T1.md) (Notes: the copyable invitation email).

> **2026-10-08:** the client wants the invitation emailed automatically ([F04-FIX-3](../../04-seller-journey/tickets/F04-FIX-3.md)). If that is built, `renderTemplate()` is not needed and only the sample-link fix below remains. Decide before starting this ticket.

## Scope

- [x] ~~`renderTemplate(key, vars)` for `copyOnly` templates~~: no longer needed. F04-FIX-3 emails the invitation automatically, so no template is `copyOnly` and `send()` already runs every check.
- [x] ~~The same checks as `send()`~~: no longer needed (see above).
- [x] ~~The rendered result is never stored or logged~~: no longer needed (see above). The `invitation` template is `sensitive`, so its data is never stored (F04-FIX-3).
- [x] Fix the registry sample links so previews match the real routes (`app/modules/notifications/registry.js`): seller links use `/apps/classifieds/seller/sample` (done in F04-FIX-3), and both `pay_link` samples (`approved_pay`, `payment_reminder`) use `/apps/classifieds/pay/sample`.

## Out of scope

- Sending a `copyOnly` template: `send()` keeps refusing it (the flag stays supported, but no template uses it).

## Acceptance criteria

- [x] ~~F04-T1’s Create invitation result can show a copyable invitation email~~: replaced by F04-FIX-3 (the email is sent, and the link is shown once as a fallback).
- [x] ~~Refusal of bad keys, placeholders and links in `renderTemplate`~~: not applicable; `send()` covers these (`send.test.js`).
- [x] ~~Rendering writes no `EmailOutbox` row~~: not applicable; covered for the sent invitation in F04-FIX-3 (`invitation-email-security.test.js`).
- [x] Settings → Emails previews show `/apps/classifieds/seller/sample` and the pay previews show `/apps/classifieds/pay/sample` (`sample-links.test.js`, `email-screens.test.js`).
- [x] `npm run test:ai` is green for this feature (notifications: 156 passed).

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F04-T1 (2026-10-06). The F04-T1 scope item stays open until this lands.
- **2026-10-19, done.** F04-FIX-3 emails the invitation automatically, so `renderTemplate()` was not built (the decision foreseen in the 2026-10-08 note).
- **Deviation:** the ticket said `/pay` samples should follow the seller link (`/seller/sample/pay`). That address doesn’t exist: the pay page is `/apps/classifieds/pay/<ref>` (F06-T1, `docs/architecture/shopify-config.md`), so both `pay_link` samples use `https://oldcolemanparts.com/apps/classifieds/pay/sample` through one `SAMPLE_PAY_LINK` constant.
- Tests: `app/modules/notifications/tests/sample-links.test.js` (no `/apps/classifieds/i/` sample, seller links, pay links). The `/i/...` addresses in `seller-link-help.test.js` are test inputs, not previews, and were left alone.
- Manual QA: Settings → Emails → Payment reminder and Approved, pay now: the preview button points at `/apps/classifieds/pay/sample`.
