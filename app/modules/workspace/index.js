// Public API of the workspace module: the seller's listing page and its actions.
// Route files import only from here. The access module guards every request (`gateSeller`).
import { registerListeners } from "./events.js";
import { handleClose } from "./services/handlers.js";

export { eraseTermsNetworkData } from "./services/erase.js";
export {
  handleDraft,
  handleLiveUpdate,
  handlePhotoDelete,
  handlePhotoOrder,
  handleRevision,
  handleSellerPage,
  handleSellerResume,
  handleStart,
  handleSubmit,
  handleUploadComplete,
  handleUploadUrl,
} from "./services/handlers.js";

/** POST /sold: mark the item sold (after a confirmation step). */
export const handleSold = handleClose("sold");

/** POST /remove: take the listing down (after a confirmation step). */
export const handleRemove = handleClose("remove");

/** Called from the app bootstrap, after media (and before publishing, F06). */
export function register() {
  registerListeners();
}
