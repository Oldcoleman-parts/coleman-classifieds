import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";

describe("Prisma schema", () => {
  beforeAll(resetDb);

  it("AC: every migration is applied cleanly", async () => {
    const migrations = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations
      ORDER BY migration_name
    `;

    expect(migrations.map((m) => m.migration_name)).toEqual(
      expect.arrayContaining([
        "20261001000000_create_session_table",
        "20261001000100_initial_project_schema",
      ]),
    );
    for (const migration of migrations) {
      expect(migration.finished_at).not.toBeNull();
      expect(migration.rolled_back_at).toBeNull();
    }
  });

  it("AC: listing arrays, enums and defaults round-trip", async () => {
    const draft = await makeListing({
      arrangements: ["pickup", "shipping"],
      status: "DRAFT",
      askingPriceCents: 12500,
    });
    const untouched = await makeListing();

    const fetched = await prisma.listing.findUniqueOrThrow({
      where: { id: draft.id },
    });

    expect(fetched.arrangements).toEqual(["pickup", "shipping"]);
    expect(fetched.status).toBe("DRAFT");
    expect(fetched.askingPriceCents).toBe(12500);
    expect(untouched.status).toBe("INVITED");
    expect(untouched.refundFlag).toBe(false);
    expect(untouched.invitation.feeOfferedCents).toBe(3000);
    expect(untouched.invitation.status).toBe("OPEN");
  });

  it("AC: one invitation has at most one listing", async () => {
    const listing = await makeListing();

    await expect(
      prisma.listing.create({ data: { invitationId: listing.invitationId } }),
    ).rejects.toThrow(/Unique constraint/);
  });
});
