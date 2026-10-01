---
name: security-contact
description: Security and privacy checklist for the Coleman Classifieds contact module (The buyer contact relay and held messages.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/contact/**"
  - "app/routes/proxy.contact*"
---

# Security checklist: contact

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] Turnstile is verified server-side; there’s a honeypot; rate limits per IP, per email and per listing.
- [ ] Only LIVE listings accept messages; the listing is resolved by handle server-side.
- [ ] The hold classifier runs before sending; HELD messages are never delivered until released; release is idempotent.
- [ ] Email header injection is prevented (CR/LF stripped from name and email); the body is sent as escaped text.
- [ ] The seller’s email never appears in any response; the buyer email is used only as ReplyTo.
- [ ] Stored message bodies are purged after 1 year and aren’t shown in logs.

## Required security tests

- a link in the body → held
- CRLF injection → stripped
- a closed listing → rejected

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
