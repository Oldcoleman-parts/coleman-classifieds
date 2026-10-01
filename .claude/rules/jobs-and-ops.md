---
paths:
  - "app/modules/scheduler/**"
  - "app/modules/ops/**"
  - "app/routes/jobs.*"
---

# Jobs and operations rules

- Each scheduled task is isolated (try/catch per task), idempotent and time-boxed, and logs a result summary.
- A task that fails twice in a row raises a JOB incident with `ops.raiseIncident()`, de-duplicated by key.
- Retention uses the dedicated purge DB role, and only removes rows past `purgeAfter` or photos past 90 days.
- Backups must be encrypted (SSE-KMS). Never log connection strings.
- Deadline tasks: invitation expiry (30d), draft (14d from start), correction (14d), payment (7d, reminder 2d before), month expiry, and the renewal grace period (Phase 2, 7d).
