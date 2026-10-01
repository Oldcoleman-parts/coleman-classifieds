---
name: security-alerts
description: Security and privacy checklist for the Coleman Classifieds alerts module (Alert subscribers and the digest.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/alerts/**"
  - "app/routes/proxy.alerts*"
---

# Security checklist: alerts

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] Double opt-in: confirm and unsubscribe tokens are random and hashed; unsubscribe is one-click and works without login.
- [ ] Signup has Turnstile and rate limits; the response doesn’t reveal whether an email is already subscribed.
- [ ] Digests go only to confirmed, not-unsubscribed, non-suppressed addresses, through the alerts config set.
- [ ] `List-Unsubscribe` headers and the postal address are always present.
- [ ] The subscriber CSV export is admin-only and CSV-injection safe.
- [ ] Only first go-live enqueues alerts (edits and renewals can’t).

## Required security tests

- enumeration: the same response for new and existing emails
- unconfirmed addresses never receive a digest

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
