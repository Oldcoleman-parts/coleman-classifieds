---
name: security-renewals
description: Security and privacy checklist for the Coleman Classifieds renewals module (Subscriptions and billing attempts (Phase 2).) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/payments/renewals/**"
  - "app/routes/webhooks.subscription*"
  - "app/routes/webhooks.billing*"
---

# Security checklist: renewals

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] Consent is recorded separately (RENEWAL_CONSENT) with the displayed renewal price; the charged amount equals `agreedRenewalCents`.
- [ ] Billing attempts use idempotency keys per period; no charge while PAUSED or after a sold or removed close.
- [ ] Cancellation is effective immediately on sold or removed; the turn-off link token is random and hashed.
- [ ] A failed payment never leaves the listing public past month end.
- [ ] Webhook payloads are cross-checked with the stored contract ID.

## Required security tests

- no double charge on a retry
- no charge while paused
- the amount matches the agreed price

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
