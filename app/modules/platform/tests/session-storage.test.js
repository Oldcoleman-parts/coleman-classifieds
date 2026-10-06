import { describe, it, expect, beforeAll } from "vitest";
import { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { resetDb, prisma } from "@/../tests/db.js";

describe("Session storage (template integration)", () => {
  beforeAll(resetDb);

  it("AC: the Session table works with the template session storage", async () => {
    const storage = new PrismaSessionStorage(prisma);
    const id = "offline_ocp-dev.myshopify.com";
    const session = new Session({
      id,
      shop: "ocp-dev.myshopify.com",
      state: "test-state",
      isOnline: false,
      scope: "write_products",
      accessToken: "test-access-token",
      expires: new Date(Date.now() + 60 * 60 * 1000),
    });

    expect(await storage.storeSession(session)).toBe(true);

    const loaded = await storage.loadSession(id);
    expect(loaded.shop).toBe("ocp-dev.myshopify.com");
    expect(loaded.accessToken).toBe("test-access-token");
    expect(loaded.isOnline).toBe(false);

    // Columns the template auth relies on, written directly.
    await prisma.session.update({
      where: { id },
      data: { userId: 9007199254740993n, refreshToken: "test-refresh-token" },
    });
    const row = await prisma.session.findUniqueOrThrow({ where: { id } });
    expect(row.userId).toBe(9007199254740993n);

    expect(await storage.deleteSession(id)).toBe(true);
    expect(await storage.loadSession(id)).toBeUndefined();
  });
});
