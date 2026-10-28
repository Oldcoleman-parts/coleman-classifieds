// Cloudflare Turnstile, checked on the server for the contact form.
// DECISION (F07-T1): a copy of access's check (contact may not import access's services/),
// failing closed in the same way. Follow-up: one shared `platform.verifyTurnstile()`.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_RESPONSE_LENGTH = 2048;

/** @type {typeof fetch | null} */
let fetchImpl = null;

/** Replace fetch for the verify call (tests). `null` restores the real one. */
export function setTurnstileFetch(fn) {
  fetchImpl = fn;
}

/** @returns {string} the public site key for the widget ("" when not set) */
export const turnstileSiteKey = () => process.env.TURNSTILE_SITE_KEY ?? "";

/**
 * @param {unknown} response the `cf-turnstile-response` form field
 * @param {string} ip
 * @returns {Promise<boolean>} true only when Cloudflare says it passed
 */
export async function verifyTurnstile(response, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (
    !secret ||
    typeof response !== "string" ||
    response === "" ||
    response.length > MAX_RESPONSE_LENGTH
  )
    return false;
  const body = new URLSearchParams({ secret, response });
  if (ip !== "unknown") body.set("remoteip", ip);
  try {
    const result = await (fetchImpl ?? fetch)(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok) return false;
    const data = await result.json();
    return data?.success === true;
  } catch (error) {
    console.error(
      `[contact] turnstile check failed: ${error?.name ?? "Error"}`,
    );
    return false;
  }
}
