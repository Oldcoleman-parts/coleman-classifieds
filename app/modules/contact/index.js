// Public API of the contact module (F07-T1): the buyer contact form and held messages.
// Contact registers no event listeners; the staff screen reaches it through
// `console.setMessageProvider()` from the app bootstrap.

/**
 * @typedef {import("@/modules/platform/services/proxy.js").ProxyContext} ProxyContext
 */

export { eraseAllBuyers, eraseBuyer } from "./services/erase.js";
export {
  discard,
  listHeld,
  release,
  submitMessage,
} from "./services/messages.js";
export {
  CONTACT_PATH,
  handleContactPage,
  handleContactSubmit,
} from "./services/pages.js";
export { setTurnstileFetch } from "./services/turnstile.js";
