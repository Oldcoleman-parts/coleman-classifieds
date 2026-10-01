---
name: security-media
description: Security and privacy checklist for the Coleman Classifieds media module (S3 uploads, processing and CloudFront publishing.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/media/**"
  - "app/routes/proxy.upload*"
---

# Security checklist: media

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] Presigned PUTs are limited to `incoming/<listingId>/`, ≤10 minutes, with content type and max size enforced; they’re only issued for a valid token and within `maxPhotos`.
- [ ] Files are validated by magic bytes, not the extension; images are decoded and re-encoded (which strips polyglots); all EXIF, GPS and XMP metadata is removed.
- [ ] Block Public Access is on; `private/` is only reachable through presigned GETs (≤10 min); `public/` is only reachable through CloudFront OAC.
- [ ] Object keys use random IDs, never seller names or emails.
- [ ] IAM permissions are least privilege, per prefix.
- [ ] Decompression bomb protection: max pixel count and max input size.

## Required security tests

- a GPS fixture ends up with no metadata after processing
- a non-image with an image extension is rejected
- a direct S3 URL for private/ → 403

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
