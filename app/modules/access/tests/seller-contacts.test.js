import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import { ValidationError } from "@/modules/core/index.js";
import { getSellerContacts } from "@/modules/access/index.js";

describe("access.getSellerContacts() (F04-FIX-4)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("AC: getSellerContacts([a, b, unknown]) returns the contacts of a and b only", async () => {
    const a = await makeListing({
      invitation: { sellerName: "Ann Ash", sellerEmail: "ann@example.test" },
    });
    const b = await makeListing({
      invitation: { sellerName: "Bob Birch", sellerEmail: "bob@example.test" },
    });

    const contacts = await getSellerContacts([a.id, b.id, a.id, "unknown123"]);

    expect(contacts.size).toBe(2);
    expect(contacts.get(a.id)).toEqual({
      sellerEmail: "ann@example.test",
      sellerName: "Ann Ash",
    });
    expect(contacts.get(b.id)).toEqual({
      sellerEmail: "bob@example.test",
      sellerName: "Bob Birch",
    });
    expect(contacts.has("unknown123")).toBe(false);
  });

  it("an empty list returns an empty Map", async () => {
    expect((await getSellerContacts([])).size).toBe(0);
  });

  it.each([
    ["null", null],
    ["a string", "abc"],
    ["a malformed id", ["x@y"]],
    ["more than 500 ids", Array.from({ length: 501 }, (_, i) => `id${i}`)],
  ])("SEC: %s throws ValidationError", async (_, value) => {
    await expect(getSellerContacts(value)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
