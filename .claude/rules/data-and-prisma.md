---
paths:
  - "prisma/**"
  - "app/**/*.server.ts"
  - "app/modules/**/db/**"
---

# Data rules

- `docs/architecture/data-model.md` is the **single source of truth** for the schema and the listing state machine. Any schema change must update that file and add a Prisma migration in the same change (use the `/schema-change` skill).
- Money is stored as integer cents (`*Cents`). Dates are stored in UTC and displayed in the shop timezone.
- Listing periods are **calendar months**: `addMonths(liveAt, 1)` from date-fns, in the shop timezone. Never add 30 days.
- Anything triggered by webhooks or jobs must be idempotent: use `WebhookReceipt`, unique constraints, or idempotency keys.
- Use `prisma.$transaction` when creating an Invitation and its Listing, or when changing several related rows.
- Terminal states set `closedAt` and `purgeAfter = closedAt + recordsRetentionDays` (365).
- `AuditEvent` is append-only. Never write UPDATE or DELETE against it outside the retention purge role (F07).
- Time adjustments (technical extensions, investigation restores) only go through `core.adjustTime()`.
