---
name: security-console
description: Security and privacy checklist for the Coleman Classifieds console module (Admin screens, settings, pause and extend, held messages, history export and health.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/console/**"
  - "app/routes/app.*"
---

# Security checklist: console

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] All routes require an admin session; destructive actions need confirmation and are audited with the staff email.
- [ ] The history export only includes the fields needed; it’s streamed; it’s CSV-injection safe (prefix cells starting with = + - @).
- [ ] Settings validation: bounded numbers (fees ≥ 0, windows 1–60 days), the rules text is sanitised.
- [ ] Extensions are bounded and need a reason; investigation restores are computed server-side, never from client input.
- [ ] Held message release sends exactly once (idempotent).
- [ ] The health page never shows secrets or connection strings.

## Required security tests

- CSV injection is escaped
- an out-of-range setting is rejected
- double release sends once

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
