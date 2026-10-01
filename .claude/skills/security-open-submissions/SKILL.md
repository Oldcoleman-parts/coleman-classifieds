---
name: security-open-submissions
description: Security and privacy checklist for the Coleman Classifieds open-submissions module (Public submissions (later).) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/access/public/**"
  - "app/routes/proxy.submit*"
---

# Security checklist: open-submissions

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] 404 unless released and enabled; Turnstile, honeypot and rate limits; email verification with a hashed, expiring token.
- [ ] One open listing per email, enforced in the DB query plus a transaction.
- [ ] No individual offers; the fee comes from settings only.
- [ ] The response doesn’t reveal whether an email already has a listing.

## Required security tests

- flag off → 404
- a second open listing for the same email → rejected

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
