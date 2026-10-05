// Wires the modules together once per server start (and again after a dev reload).
// Order matters: core, platform and scheduler reset their registries, so they come first;
// feature modules then add their event listeners, webhook topics and tasks.
import {
  register as registerCore,
  resetEventBus,
} from "@/modules/core/index.js";
import { register as registerPlatform } from "@/modules/platform/index.js";
import { register as registerScheduler } from "@/modules/scheduler/index.js";

resetEventBus();
registerCore();
registerPlatform();
registerScheduler();
