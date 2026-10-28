// Public API of the media module. Other modules and routes import only from here.
// The browser helper is a separate entry, `client.js`, because this file needs the server.
import { registerTask } from "@/modules/scheduler/index.js";
import { registerListeners } from "./events.js";
import { runRetention } from "./services/retention.js";
import { unpublishClosed } from "./services/sweep.js";

export {
  MediaNotConfiguredError,
  setCloudFrontClient,
  setPresigner,
  setS3Client,
} from "./services/aws-clients.js";
export { MAX_BYTES, UPLOAD_TYPES } from "./services/limits.js";
export {
  deletePhoto,
  listPhotos,
  reorder,
  setMain,
} from "./services/photos.js";
export {
  listingsWithStoredPhotos,
  purgeListingPhotos,
} from "./services/purge.js";
export {
  getPublicUrls,
  publish,
  unpublish,
  unpublishOne,
} from "./services/publish.js";
export { completeUpload, createUploadUrl } from "./services/uploads.js";

/**
 * The hourly photo task: delete the stored photos of listings that closed longer ago than
 * the retention period.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ listings: number, purged: number }>}
 */
export function runScheduled(context) {
  return runRetention(context);
}

/** Called from the app bootstrap, after core and the scheduler. */
export function register() {
  registerListeners();
  registerTask("media.purge-closed-photos", runScheduled);
  // The backstop for a failed ListingClosed handler (F03-FIX-2).
  registerTask("media.unpublish-closed", () => unpublishClosed());
}
