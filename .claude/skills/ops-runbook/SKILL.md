---
name: ops-runbook
description: Guide backup checks, restores, reconciliation and incident handling for Coleman Classifieds, following docs/architecture/operations.md and the recovery runbook.
argument-hint: "[check-backups | restore-staging | reconcile | incidents]"
disable-model-invocation: true
---

# Ops: $ARGUMENTS

Follow `docs/architecture/operations.md` and `docs/reference/recovery-runbook.md`.

- **Never** run against production without explicit user confirmation. Production restores are done by a human.
- `check-backups`: list the latest S3 dumps and report their age and size. Raise a concern if the latest is older than 26 hours.
- `restore-staging`: restore the latest dump to the staging DB, run migrations and the reconcile task, and report the checks.
- `reconcile`: explain what `/jobs/run?task=reconcile` will change, then run it on the environment the user names.
- `incidents`: summarise open `OpsIncident` rows and suggested fixes.
