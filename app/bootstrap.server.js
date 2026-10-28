// Wires the modules together once per server start (and again after a dev reload).
// Order matters: core, platform and scheduler reset their registries, so they come first;
// feature modules then add their event listeners, webhook topics and tasks.
import { register as registerAccess } from "@/modules/access/index.js";
import { register as registerAlerts } from "@/modules/alerts/index.js";
import {
  setHealthProviders,
  setMessageProvider,
} from "@/modules/console/index.js";
import { discard, listHeld, release } from "@/modules/contact/index.js";
import {
  register as registerCore,
  resetEventBus,
} from "@/modules/core/index.js";
import { register as registerMedia } from "@/modules/media/index.js";
import { register as registerNotifications } from "@/modules/notifications/index.js";
import { register as registerOps } from "@/modules/ops/index.js";
import { register as registerPayments } from "@/modules/payments/index.js";
import { register as registerPlatform } from "@/modules/platform/index.js";
import {
  getStorefrontCount,
  register as registerPublishing,
} from "@/modules/publishing/index.js";
import {
  getLastRun,
  register as registerScheduler,
} from "@/modules/scheduler/index.js";
import { register as registerWorkspace } from "@/modules/workspace/index.js";

resetEventBus();
registerCore();
registerPlatform();
registerScheduler();
registerNotifications();
registerMedia();
registerAccess();
// Workspace copies an approved revision into the listing; publishing (F06) must come after it.
registerWorkspace();
registerPayments();
registerPublishing();
// New listing alerts (F07-T2): emails subscribers when a listing first goes live.
registerAlerts();
// Deadlines, reminders and page retirement (F08-T1).
registerOps();
// Health compares the storefront's live count with the app's (F05-T2) and shows the last
// job run (F08-T1).
setHealthProviders({
  liveCount: { getStorefrontCount: () => getStorefrontCount() },
  jobs: { getLastRun },
});
// The held messages screen sends and discards through contact (F07-T1).
setMessageProvider({ listHeld, release, discard });
