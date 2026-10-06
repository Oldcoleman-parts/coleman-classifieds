// Who performs an action. Every lifecycle change and staff action carries one of these.
import {
  ForbiddenActorError,
  UnauthorizedError,
  ValidationError,
} from "./errors.js";

/** @typedef {import("./types.js").ActorRef} ActorRef */

const ACTOR_TYPES = ["STAFF", "SELLER", "BUYER", "SYSTEM"];

/** @type {ActorRef} */
export const SYSTEM_ACTOR = Object.freeze({ type: "SYSTEM" });

/**
 * @param {unknown} actor
 * @returns {ActorRef} `ref` is always set for STAFF (the staff email from the session)
 */
export function requireActor(actor) {
  const { type, ref } = /** @type {Partial<ActorRef>} */ (actor ?? {});
  if (!ACTOR_TYPES.includes(/** @type {string} */ (type)))
    throw new ValidationError("actor is not valid", { actor: "is not valid" });
  const cleanRef = typeof ref === "string" && ref.trim() ? ref.trim() : null;
  if (type === "STAFF" && !cleanRef)
    throw new ForbiddenActorError("A staff action needs the staff email");
  return cleanRef ? { type, ref: cleanRef } : { type };
}

/**
 * @param {unknown} actor
 * @returns {ActorRef & { ref: string }}
 */
export function requireStaff(actor) {
  const who = requireActor(actor);
  if (who.type !== "STAFF")
    throw new ForbiddenActorError("Only staff can do this");
  return /** @type {ActorRef & { ref: string }} */ (who);
}

/**
 * The staff actor for an admin request. Needs an online session (`useOnlineTokens`), which
 * carries the logged-in user; the shop-level offline session has no person attached.
 * @param {{ onlineAccessInfo?: { associated_user?: { email?: string } } } | null | undefined} session
 *   from `authenticate.admin(request)`
 * @returns {ActorRef & { ref: string }}
 */
export function staffFromSession(session) {
  const email = session?.onlineAccessInfo?.associated_user?.email;
  if (typeof email !== "string" || !email.trim())
    throw new UnauthorizedError("This action needs a signed-in staff user");
  return { type: "STAFF", ref: email.trim().toLowerCase() };
}
