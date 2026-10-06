import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/../tests/db.js";
import { asSeller, makeListing } from "@/../tests/factories.js";
import { resolveToken } from "@/modules/access/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A listing whose invitation has a known token. */
async function linkFor({ invitation = {}, ...listing } = {}) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256")
    .update(token + process.env.TOKEN_PEPPER)
    .digest("hex");
  await makeListing({ ...listing, invitation: { tokenHash, ...invitation } });
  return token;
}

describe("resolveToken", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it.each([
    [
      "one character flipped",
      (t) => t.slice(0, -1) + (t.at(-1) === "a" ? "b" : "a"),
    ],
    ["truncated", (t) => t.slice(0, -5)],
    ["an extra character", (t) => `${t}x`],
    ["an invalid alphabet", (t) => `${t.slice(0, -1)}!`],
    ["empty", () => ""],
    ["not a string", () => 123],
  ])("AC + SEC: a modified token (%s) → INVALID", async (_, modify) => {
    const token = await linkFor();

    expect(await resolveToken(modify(token))).toEqual({ state: "INVALID" });
  });

  it("AC: a valid token → OK with the invitation and listing", async () => {
    const token = await linkFor();

    const result = await resolveToken(token);

    expect(result.state).toBe("OK");
    expect(result.listing.status).toBe("INVITED");
    expect(result.invitation.id).toBe(result.listing.invitationId);
  });

  it.each([
    ["a revoked invitation", { invitation: { status: "REVOKED" } }, "REVOKED"],
    ["an expired invitation", { invitation: { status: "EXPIRED" } }, "EXPIRED"],
    [
      "an unused link past its expiry date",
      { invitation: { expiresAt: new Date(Date.now() - DAY_MS) } },
      "EXPIRED",
    ],
    ["a closed invitation", { invitation: { status: "CLOSED" } }, "CLOSED"],
    ["a sold listing", { status: "SOLD" }, "CLOSED"],
    ["a rejected listing", { status: "REJECTED" }, "CLOSED"],
    // A staff re-issue reuses the link.
    ["a lapsed listing", { status: "LAPSED" }, "OK"],
    // Once the seller has started, the invitation's own expiry no longer applies.
    [
      "a started draft past the link expiry",
      {
        status: "DRAFT",
        invitation: {
          status: "USED",
          expiresAt: new Date(Date.now() - DAY_MS),
        },
      },
      "OK",
    ],
  ])("AC: %s → %s", async (_, fixture, state) => {
    const token = await linkFor(fixture);

    expect((await resolveToken(token)).state).toBe(state);
  });

  it("SEC: a token with no listing behind it is treated as closed", async () => {
    const { token } = await asSeller();

    expect(await resolveToken(token)).toEqual({ state: "CLOSED" });
  });
});
