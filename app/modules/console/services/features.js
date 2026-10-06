// The Features card: which optional features staff can see, and switching one on or off.
// Core owns the flags, the release gates and the `FeatureToggled` audit entry.
import {
  ConflictError,
  isEnabled,
  isReleased,
  requireEnum,
  setFlag,
  ValidationError,
} from "@/modules/core/index.js";

/**
 * @typedef {object} FeatureRow
 * @property {string} flag
 * @property {string} label
 * @property {string} description
 * @property {boolean} enabled
 */

const FEATURES = [
  {
    flag: "alerts",
    label: "Listing alerts",
    description:
      "Buyers can sign up for an email when a new listing goes live.",
  },
  {
    flag: "renewals",
    label: "Automatic renewals",
    description: "Sellers can choose to renew their listing every month.",
  },
  {
    flag: "openSubmissions",
    label: "Open submissions",
    description: "Sellers can ask for a listing without an invitation.",
  },
];
const FLAG_NAMES = FEATURES.map(({ flag }) => flag);
const NOT_AVAILABLE = "This feature is not available.";

/**
 * The features staff may switch. Unreleased features are left out entirely.
 * @returns {Promise<{ features: FeatureRow[] }>}
 */
export async function loadFeaturesCard() {
  const features = [];
  for (const feature of FEATURES) {
    if (!isReleased(feature.flag)) continue;
    features.push({ ...feature, enabled: await isEnabled(feature.flag) });
  }
  return { features };
}

/**
 * Switch one feature from the submitted form (`flag`, `value`, and `confirmed` to turn off).
 * @param {FormData} formData
 * @param {import("@/modules/core/types.js").ActorRef} actor the staff member, from the session
 * @returns {Promise<{ ok: true, flag: string, value: boolean } | { ok: false, error: string }>}
 */
export async function saveFeatureToggle(formData, actor) {
  try {
    const flag = requireEnum(formData.get("flag"), FLAG_NAMES, "flag");
    const value =
      requireEnum(formData.get("value"), ["true", "false"], "value") === "true";
    // An unreleased feature has no switch, so a request for one is refused either way.
    if (!isReleased(flag)) return { ok: false, error: NOT_AVAILABLE };
    if (!value && formData.get("confirmed") !== "yes")
      return { ok: false, error: "Confirm before turning a feature off." };

    await setFlag(flag, value, actor);
    return { ok: true, flag, value };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ConflictError)
      return { ok: false, error: NOT_AVAILABLE };
    throw error;
  }
}
