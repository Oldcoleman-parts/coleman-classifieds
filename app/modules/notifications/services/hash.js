// The non-reversible form of an address kept after a privacy erase (F08-FIX-8), hashed as
// access hashes tokens: sha256(value + TOKEN_PEPPER). Rotating TOKEN_PEPPER makes old
// markers stop matching (recorded in operations.md).
import { createHash } from "node:crypto";
import { AppError } from "@/modules/core/index.js";

/**
 * @param {string} email
 * @returns {string} hex
 */
export function emailHash(email) {
  const pepper = process.env.TOKEN_PEPPER;
  if (!pepper)
    throw new AppError("TOKEN_PEPPER is not set", { code: "CONFIG" });
  return createHash("sha256")
    .update(email.trim().toLowerCase() + pepper)
    .digest("hex");
}
