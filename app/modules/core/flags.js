// Feature flags. A flag is on only when its Settings switch is on AND its release gate is open.
import prisma from "@/db.server";
import { requireStaff } from "./actors.js";
import { ConflictError, ValidationError } from "./errors.js";
import { dispatch, EVENTS, recordEvent } from "./events.js";
import { getSettings } from "./settings.js";

/** @typedef {"alerts" | "renewals" | "openSubmissions"} FlagName */

// `gate` is the env var that must be "true" before the feature can be seen or switched on.
const FLAGS = {
  alerts: { setting: "alertsEnabled", gate: null },
  renewals: { setting: "renewalsEnabled", gate: "RENEWALS_RELEASED" },
  openSubmissions: {
    setting: "openSubmissionsEnabled",
    gate: "OPEN_SUBMISSIONS_RELEASED",
  },
};

function flagDef(flag) {
  if (!Object.hasOwn(FLAGS, flag))
    throw new ValidationError(`Unknown flag ${flag}`, { flag: "is not valid" });
  return FLAGS[flag];
}

/**
 * Whether the feature has been released in this environment (its `*_RELEASED` env gate).
 * @param {FlagName} flag
 * @returns {boolean}
 */
export function isReleased(flag) {
  const { gate } = flagDef(flag);
  return gate === null || process.env[gate] === "true";
}

/**
 * @param {import("./types.js").Settings} settings
 * @param {FlagName} flag
 * @returns {boolean}
 */
export function flagOn(settings, flag) {
  return isReleased(flag) && settings[flagDef(flag).setting] === true;
}

/**
 * @param {FlagName} flag
 * @returns {Promise<boolean>}
 */
export async function isEnabled(flag) {
  if (!isReleased(flag)) return false;
  return flagOn(await getSettings(), flag);
}

/**
 * Switch a feature on or off. Staff only: call this from admin routes, never from a seller
 * or public route.
 * @param {FlagName} flag
 * @param {boolean} value
 * @param {import("./types.js").ActorRef} actor
 * @returns {Promise<void>}
 */
export async function setFlag(flag, value, actor) {
  const { setting } = flagDef(flag);
  const staff = requireStaff(actor);
  if (typeof value !== "boolean")
    throw new ValidationError("value must be true or false", {
      value: "must be true or false",
    });
  if (value && !isReleased(flag))
    throw new ConflictError("This feature has not been released yet");

  const event = await prisma.$transaction(async (tx) => {
    await getSettings({ tx });
    await tx.settings.update({ where: { id: 1 }, data: { [setting]: value } });
    return recordEvent(
      tx,
      EVENTS.FeatureToggled,
      { flag, value, staff: staff.ref },
      { actor: staff },
    );
  });
  await dispatch(event);
}
