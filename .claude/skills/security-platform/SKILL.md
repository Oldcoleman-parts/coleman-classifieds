---
name: security-platform
description: Security and privacy checklist for the Coleman Classifieds platform module (Shopify auth, webhooks, the app proxy and API clients.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/platform/**"
  - "app/routes/webhooks.*"
  - "shopify.app.toml"
---

# Security checklist: platform

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] Every webhook verifies HMAC with the app secret using a constant-time compare, **before** parsing. It returns 401 on failure.
- [ ] Webhook idempotency: insert `WebhookReceipt` first; a duplicate returns 200 with no side effects.
- [ ] Every app proxy request verifies the Shopify signature, and rejects stale timestamps (more than 5 minutes).
- [ ] Admin routes use `authenticate.admin` only; there are no custom session cookies.
- [ ] Access scopes are minimal and match `docs/architecture/shopify-config.md`; there are no unused scopes.
- [ ] GraphQL helpers throw on `userErrors` and never log access tokens or full payloads containing PII.
- [ ] Mandatory privacy webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) are implemented.
- [ ] Secrets come from env only; nothing is committed.

## Required security tests

- bad HMAC → 401
- duplicate webhook → single effect
- unsigned or stale proxy request → 401

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
