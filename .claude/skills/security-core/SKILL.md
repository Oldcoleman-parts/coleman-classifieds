---
name: security-core
description: Security and privacy checklist for the Coleman Classifieds core module (The lifecycle state machine, audit log, flags and time adjustments.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/core/**"
  - "prisma/**"
---

# Security checklist: core

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] No code path writes `listing.status` except `transition()` (grep for status updates).
- [ ] `transition()` validates the actor: sellers can’t approve, staff can’t submit as the seller, SYSTEM only for timed or webhook events.
- [ ] AuditEvent is append-only at the DB level (trigger); only the purge role can delete past `purgeAfter`.
- [ ] Time adjustments need a staff actor and a reason; the minutes are bounded (for example ≤ 60 days).
- [ ] Flags and release gates can’t be toggled from any seller or public route.
- [ ] Audit details never store tokens, codes or full message bodies.

## Required security tests

- invalid transitions and wrong actors are rejected
- UPDATE and DELETE on AuditEvent fail
- flag changes need an admin session

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
