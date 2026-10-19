// Keys derived from TOKEN_PEPPER, and the encryption of the stored storefront token.
// DECISION (F06-T1): no separate key to manage. Each use has its own HKDF label, as the
// seller form token does ("cc-form-v1"). Rotating TOKEN_PEPPER makes the stored token
// unreadable; `ensureFeeSetup()` then creates a new one.
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { AppError } from "@/modules/core/index.js";

/**
 * @param {string} label e.g. "cc-pay-v1"
 * @returns {Buffer} a 32-byte key
 */
export function derivedKey(label) {
  const pepper = process.env.TOKEN_PEPPER;
  if (!pepper)
    throw new AppError("TOKEN_PEPPER is not set", { code: "CONFIG" });
  return Buffer.from(hkdfSync("sha256", pepper, "", label, 32));
}

const tokenKey = () => derivedKey("cc-storefront-token-v1");

/**
 * @param {string} plain never logged
 * @returns {string} `v1.<iv>.<tag>.<ciphertext>` (AES-256-GCM, base64url parts)
 */
export function encryptSecret(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(".");
}

/**
 * @param {unknown} stored
 * @returns {string | null} null when it is missing, damaged or made with another key
 */
export function decryptSecret(stored) {
  if (typeof stored !== "string") return null;
  const [version, iv, tag, body, extra] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !body || extra !== undefined)
    return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      tokenKey(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
