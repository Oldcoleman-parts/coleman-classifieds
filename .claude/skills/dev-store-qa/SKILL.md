---
name: dev-store-qa
description: Produce a manual QA checklist for a ticket or the full sample workflow on the Shopify development store or staging.
argument-hint: "[ticket id or 'e2e']"
disable-model-invocation: true
---

# Dev store QA for $ARGUMENTS

- For a ticket: turn its acceptance criteria into numbered manual steps with expected results.
- For `e2e`: use `docs/reference/end-to-end-acceptance.md` (steps 1–6 and 11 after F06, all steps in F08-T2).
- Include setup: `npm run dev`, the Bogus Gateway, SES sandbox verified addresses, and short durations in Settings where timing matters.
- Output a tickable checklist. Never claim anything has passed unless it was actually run.
