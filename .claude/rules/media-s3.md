---
paths:
  - "app/modules/media/**"
---

# Media rules (S3 and CloudFront)

- Bucket prefixes: `incoming/` (raw upload), `private/` (processed, presigned access only) and `public/` (published variants, CloudFront only).
- Photos are never stored in Shopify Files.
- Processing: HEIC→JPEG, re-encode, strip all metadata, record dimensions. Only processed files leave `incoming/`.
- Presigned URLs expire in 10 minutes or less, with content type and size enforced.
- Unpublishing deletes the `public/` objects and creates a CloudFront invalidation.
