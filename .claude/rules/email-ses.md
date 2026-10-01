---
paths:
  - "app/modules/notifications/**"
  - "app/modules/alerts/**"
  - "emails/**"
---

# Email rules

- All email is sent through `notifications.send(key, to, vars)` using Amazon SES. Never use Shopify email features.
- Templates render with liquidjs in strict mode, using a per-template variable whitelist. All variables are HTML-escaped.
- Check `EmailSuppression` before every send.
- Alert emails go through the `alerts` configuration set and always include the one-click unsubscribe link, `List-Unsubscribe` headers and the postal address, whatever the template content.
- Buyer relay emails set `ReplyTo` to the buyer and never CC OCP support.
- Default wording lives in `docs/reference/email-default-content.md`. Seed defaults are generated from it.
- Instant staff notices (new, corrected, edit, held message) are sent immediately via `notifyStaff()` to `EmailSettings.staffNotify`, and are never batched or sent to subscribers.
- Only `ListingWentLive` with `firstTime: true` may enqueue alerts.
