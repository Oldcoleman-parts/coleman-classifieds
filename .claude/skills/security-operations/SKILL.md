---
name: security-operations
description: Security and privacy checklist for the Coleman Classifieds operations module (Jobs, retention, backups and problem alerts.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/scheduler/**"
  - "app/modules/ops/**"
  - "app/routes/jobs.*"
---

# Security checklist: operations

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] `/jobs/run` requires a bearer secret compared in constant time; tasks can’t be triggered from public routes.
- [ ] The retention purge uses a separate DB role; purges are logged as counts only.
- [ ] Backups are encrypted with SSE-KMS, the bucket isn’t public, and lifecycle rules are set; there are no credentials in logs.
- [ ] Incident emails contain no PII or secrets, only IDs and a health page link.
- [ ] The watchdog can’t be silenced without an audit entry.

## Required security tests

- a wrong jobs secret → 401
- the purge doesn’t touch rows before `purgeAfter`

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
