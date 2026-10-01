---
name: security-notifications
description: Security and privacy checklist for the Coleman Classifieds notifications module (SES sending, templates, suppression and staff notices.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/notifications/**"
  - "emails/**"
  - "app/routes/webhooks.ses*"
---

# Security checklist: notifications

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] Template variables are HTML-escaped; only the layout outputs raw HTML; liquidjs runs in strict mode with a whitelist (no file-reading tags).
- [ ] The template editor sanitises HTML (allowlist of tags and attributes); no script tags, event handlers or `javascript:` URLs.
- [ ] SNS messages are signature-verified, the certificate URL is on an amazonaws.com host, and the topic ARN matches.
- [ ] Suppressed addresses are never sent to; complaints unsubscribe alert subscribers.
- [ ] Staff notices go only to configured staff addresses and contain only the title, the change type and the review link.
- [ ] Buyer relay: `ReplyTo` = the buyer; the seller’s address is never exposed to the buyer; no header injection (strip CR and LF in names and subjects).
- [ ] AWS credentials have least privilege (SES send on the verified identity and config sets only).

## Required security tests

- an XSS payload in a template is sanitised
- a forged SNS message → 403
- CRLF in a buyer name → stripped

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
