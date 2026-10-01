---
name: security-access
description: Security and privacy checklist for the Coleman Classifieds access module (Invitations, private tokens and email codes.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/access/**"
  - "app/routes/proxy.seller*"
---

# Security checklist: access

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] Tokens: 32 bytes from a CSPRNG, stored only as `sha256(token+PEPPER)`, compared in constant time.
- [ ] Tokens and codes never appear in logs, error messages, analytics, Referer (use `Referrer-Policy: no-referrer` on seller pages) or URLs shared with third parties.
- [ ] Resolving a token checks the invitation status, expiry and listing state on every request.
- [ ] Email code: 6 digits, 15-minute TTL, max 5 attempts, per-IP and per-invitation rate limits, hashed at rest.
- [ ] The device cookie is signed, `HttpOnly`, `Secure`, `SameSite=Lax`, and scoped to the proxy path.
- [ ] Revoked, expired or closed invitations can never be revived except through staff re-issue (LAPSED only).
- [ ] A unique constraint guarantees one listing per invitation.

## Required security tests

- a modified token → invalid
- brute-forcing the code is locked after 5 attempts
- log spy: no token or code in the output

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
