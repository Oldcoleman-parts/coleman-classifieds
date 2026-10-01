---
name: add-webhook
description: Add a new Shopify (or SNS) webhook handler with HMAC verification, idempotency and routing to the owning module.
argument-hint: "[topic, e.g. orders/paid]"
---

# Add webhook `$ARGUMENTS`

1. Register the topic in `shopify.app.toml` (for SNS, document the subscription instead).
2. Create a thin route `app/routes/webhooks.<topic-with-dashes>.tsx` that:
   - authenticates or verifies the signature (401 on failure);
   - inserts a `WebhookReceipt` with the webhook ID and returns 200 early if it already exists;
   - calls the owning module's handler from its `index.ts`.
3. The handler must be idempotent and publish domain events rather than calling other modules directly.
4. Add tests for a valid payload, a duplicate delivery and a bad signature.
5. Document the webhook in `docs/architecture/shopify-config.md`.
