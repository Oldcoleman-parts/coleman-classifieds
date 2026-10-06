import prisma from "@/db.server";

/**
 * Empty every table in the test database. Call in `beforeAll` of each test file that uses the DB.
 * Triggers are switched off for the transaction, because AuditEvent rejects TRUNCATE otherwise
 * (this needs a superuser, which the local and CI test databases have).
 */
export async function resetDb() {
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  const names = tables
    .map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`)
    .join(", ");
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`),
    prisma.$executeRawUnsafe(`TRUNCATE ${names} RESTART IDENTITY CASCADE`),
  ]);
}

export { prisma };
