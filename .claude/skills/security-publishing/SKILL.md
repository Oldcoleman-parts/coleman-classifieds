---
name: security-publishing
description: Security and privacy checklist for the Coleman Classifieds publishing module (Metaobjects, storefront blocks and the header button.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/publishing/**"
  - "extensions/**"
  - "theme-snippets/**"
---

# Security checklist: publishing

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] Only whitelisted public fields are written to the metaobject: never the email, phone, last name, address or internal notes.
- [ ] Liquid output is escaped for every seller-provided field; there’s no unescaped HTML.
- [ ] Image URLs only come from the CloudFront domain.
- [ ] The closed-listing page reveals no seller data.
- [ ] The contact form in the block posts only to the app proxy, with Turnstile.
- [ ] `live_count` is written only by the app.

## Required security tests

- a script tag in the title renders as text
- the metaobject payload has no PII fields (snapshot test)

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
