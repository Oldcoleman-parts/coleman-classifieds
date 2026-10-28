// Public API of the access module: private invitation links, email codes and the seller gate.
// Other modules and routes import only from here.
import { registerTask } from "@/modules/scheduler/index.js";
import { registerListeners } from "./events.js";
import { runExpiry } from "./services/expiry.js";

export {
  checkDeviceCredential,
  issueDeviceCredential,
} from "./services/device.js";
export { requestEmailCode, verifyEmailCode } from "./services/email-codes.js";
export {
  closeInvitationForListing,
  createInvitation,
  findSellerHistory,
  getInvitationForStaff,
  markInvitationUsed,
  revokeInvitation,
} from "./services/invitations.js";
export { getLinkUrl } from "./services/links.js";
export { handleMyLinkPage, handleMyLinkRequest } from "./services/my-link.js";
export { resolveToken } from "./services/resolve.js";
export {
  handleInvitationAction,
  loadCreateInvitationScreen,
  loadInvitationScreen,
  submitCreateInvitation,
} from "./services/screens.js";
export {
  gateSeller,
  handleCodeRequest,
  handleCodeVerify,
} from "./services/seller-gate.js";
export {
  deviceStorageKey,
  escapeHtml,
  scriptJson,
  sellerLayout,
  sellerPath,
} from "./services/seller-pages.js";

/**
 * The hourly invitation task: expire unused links and clear old sign-in codes.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ expired: number, codesDeleted: number }>}
 */
export function runScheduled(context) {
  return runExpiry(context);
}

/** Called from the app bootstrap, after core, platform and the scheduler. */
export function register() {
  registerListeners();
  registerTask("access.expire-invitations", runScheduled);
}
