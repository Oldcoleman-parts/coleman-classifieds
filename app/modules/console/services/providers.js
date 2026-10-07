// Where the modules that own held messages and system health plug into the console screens.
// DECISION (F05-T2): contact (F07), ops and scheduler (F08) and publishing (F06) aren't
// built yet, and console never reads or writes their tables. Until a module registers a
// provider from the app bootstrap, its screen shows "not available yet".

/**
 * @typedef {object} HeldMessage
 * @property {string} id
 * @property {string} listingId
 * @property {string | null} listingTitle
 * @property {string} buyerName
 * @property {string} buyerEmail
 * @property {string} body
 * @property {string[]} holdReasons
 * @property {Date} createdAt
 *
 * `release` and `discard` must be safe to repeat: the first call does the work (release
 * sends the message exactly once) and returns `changed: true`; a repeat returns
 * `changed: false`.
 * @typedef {object} MessageProvider
 * @property {() => Promise<HeldMessage[]>} listHeld
 * @property {(messageId: string, staff: import("@/modules/core/types.js").ActorRef) => Promise<{ changed: boolean, listingId?: string | null }>} release
 * @property {(messageId: string, staff: import("@/modules/core/types.js").ActorRef) => Promise<{ changed: boolean, listingId?: string | null }>} discard
 *
 * @typedef {{ id: string, kind: string, message: string, firstSeen: Date, lastSeen: Date }} OpenIncident
 * @typedef {object} HealthProviders
 * @property {{ listOpen: () => Promise<OpenIncident[]>, resolve: (incidentId: string, staff: import("@/modules/core/types.js").ActorRef) => Promise<{ changed: boolean, kind?: string }> } | null} incidents
 * @property {{ getLastRun: () => Promise<{ finishedAt: Date, ok: boolean, failedTasks: string[] } | null> } | null} jobs
 * @property {{ getHealth: () => Promise<{ ok: boolean }> } | null} email
 * @property {{ getStorefrontCount: () => Promise<number | null> } | null} liveCount
 */

const NO_HEALTH = { incidents: null, jobs: null, email: null, liveCount: null };

/** @type {MessageProvider | null} */
let messageProvider = null;
/** @type {HealthProviders} */
let healthProviders = { ...NO_HEALTH };

/** @param {MessageProvider | null} provider null removes it */
export function setMessageProvider(provider) {
  messageProvider = provider;
}

export const getMessageProvider = () => messageProvider;

/** @param {Partial<HealthProviders> | null} providers merged in; null removes them all */
export function setHealthProviders(providers) {
  healthProviders = providers
    ? { ...healthProviders, ...providers }
    : { ...NO_HEALTH };
}

export const getHealthProviders = () => healthProviders;
