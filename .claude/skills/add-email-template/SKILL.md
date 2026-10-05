---
name: add-email-template
description: Add a new email type to the notifications module, with seed wording, a variable whitelist and required placeholders.
argument-hint: "[template key]"
---

# Add email template `$ARGUMENTS`

1. Add the default subject and body to `docs/reference/email-default-content.md`.
2. Add the key to the template registry in `app/modules/notifications`: stream (`transactional` or `alerts`), `audience`, `label` and `description` (shown in Settings → Emails), allowed variables, required variables, sample data for preview, and Phase 2 flag (if any).
3. Add the seed entry so `EmailTemplate` gets the default on install and on reset.
4. Call it only through `notifications.send('$ARGUMENTS', to, vars)`.
5. Add tests: renders with sample data, rejects unknown variables, and is blocked when a required variable is missing.
