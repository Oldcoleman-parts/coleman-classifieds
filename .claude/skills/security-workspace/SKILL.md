---
name: security-workspace
description: Security and privacy checklist for the Coleman Classifieds workspace module (The seller private page, drafts, corrections, live edits and agreements.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/workspace/**"
  - "app/routes/proxy.seller*"
---

# Security checklist: workspace

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] Every action re-resolves the token and checks the listing status on the server. There are no hidden-field trusts.
- [ ] Immediate edits are limited to price, quantity, availability note and photo removal. Everything else creates a revision. No path adds merchandise.
- [ ] The agreement box starts unticked; acceptance records the rules version, time, IP and user agent server-side, and is refused if the version is stale.
- [ ] CSRF protection on all POSTs (signed form token); `noindex`; `Referrer-Policy: no-referrer`.
- [ ] Input is validated server-side with length limits; output is escaped; there’s no HTML in descriptions.
- [ ] Deadlines are enforced server-side (draft 14 days, corrections 14 days).

## Required security tests

- a stale status action → rejected
- adding a photo to a live listing → creates a revision, public unchanged
- CSRF token missing → 403

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
