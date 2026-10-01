---
name: schema-change
description: Safely change the database schema. Use whenever a Prisma model, enum or field needs adding, changing or removing.
---

# Schema change

1. Edit `docs/architecture/data-model.md` first (the Prisma block, plus the state machine if it's affected).
2. Mirror the change in `prisma/schema.prisma`, then run `npx prisma migrate dev --name <snake_case>`.
3. Keep the AuditEvent append-only trigger and the purge role grants intact. Add SQL to the migration if new tables need grants.
4. New non-null columns need a default or a data migration.
5. Never edit an applied migration. Note the migration in the ticket.
