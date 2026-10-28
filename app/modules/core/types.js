// Shared shapes, documented with JSDoc. Source of truth: docs/architecture/data-model.md.
// DECISION: the typedefs alias the Prisma-generated types rather than repeating the fields,
// so they can't drift from prisma/schema.prisma.

/** @typedef {import("@prisma/client").Settings} Settings */
/** @typedef {import("@prisma/client").Invitation} Invitation */
/** @typedef {import("@prisma/client").Listing} Listing */
/** @typedef {import("@prisma/client").ListingTimeAdjustment} ListingTimeAdjustment */
/** @typedef {import("@prisma/client").ListingPeriod} ListingPeriod */
/** @typedef {import("@prisma/client").FeeCharge} FeeCharge */
/** @typedef {import("@prisma/client").ListingRevision} ListingRevision */
/** @typedef {import("@prisma/client").Photo} Photo */
/** @typedef {import("@prisma/client").TermsAcceptance} TermsAcceptance */
/** @typedef {import("@prisma/client").BuyerMessage} BuyerMessage */
/** @typedef {import("@prisma/client").AuditEvent} AuditEvent */
/** @typedef {import("@prisma/client").EmailCode} EmailCode */
/** @typedef {import("@prisma/client").AlertSubscriber} AlertSubscriber */
/** @typedef {import("@prisma/client").AlertQueue} AlertQueue */
/** @typedef {import("@prisma/client").EmailTemplate} EmailTemplate */
/** @typedef {import("@prisma/client").EmailSettings} EmailSettings */
/** @typedef {import("@prisma/client").EmailSuppression} EmailSuppression */
/** @typedef {import("@prisma/client").OpsIncident} OpsIncident */
/** @typedef {import("@prisma/client").WebhookReceipt} WebhookReceipt */

/** @typedef {import("@prisma/client").ListingStatus} ListingStatus */
/** @typedef {import("@prisma/client").AccessSource} AccessSource */
/** @typedef {import("@prisma/client").InvitationStatus} InvitationStatus */
/** @typedef {import("@prisma/client").OfferScope} OfferScope */
/** @typedef {import("@prisma/client").BillingMode} BillingMode */
/** @typedef {import("@prisma/client").RevisionStatus} RevisionStatus */
/** @typedef {import("@prisma/client").PauseReason} PauseReason */
/** @typedef {import("@prisma/client").AdjustmentType} AdjustmentType */
/** @typedef {import("@prisma/client").MessageStatus} MessageStatus */
/** @typedef {import("@prisma/client").Actor} Actor */

/**
 * `Settings.heldMessageRules`: when a buyer message is held for staff review.
 * @typedef {{ holdOnLinks: boolean, keywords: string[], repeatThreshold: number }} HeldMessageRules
 */

/**
 * The settings staff can edit on the Settings screen. Every key is optional.
 * @typedef {object} SettingsPatch
 * @property {number} [baseFeeCents]
 * @property {number | null} [promoFeeCents]
 * @property {number} [paymentWindowDays]
 * @property {number} [draftWindowDays]
 * @property {number} [correctionWindowDays]
 * @property {number} [inviteExpiryDays]
 * @property {number} [maxPhotos]
 * @property {boolean} [emailCodeRequired]
 * @property {HeldMessageRules} [heldMessageRules]
 * @property {string} [rulesText] plain text; a change bumps `rulesVersion`
 */

/**
 * Who performed an action. `ref` is the staff email for STAFF and absent for SYSTEM.
 * @typedef {{ type: Actor, ref?: string }} ActorRef
 */

/**
 * A History filter for core's audit reads (F01-FIX-11). Every part is optional and the
 * parts given all apply. `start` is inclusive, `end` exclusive; `actorRef` matches exactly,
 * ignoring case.
 * @typedef {object} AuditFilter
 * @property {string} [listingId]
 * @property {Date} [start]
 * @property {Date} [end]
 * @property {string} [action]
 * @property {"STAFF" | "SELLER" | "BUYER" | "SYSTEM"} [actor]
 * @property {string} [actorRef]
 */

/**
 * One audit entry as core's History reads return it. Staff-only: never public output.
 * @typedef {object} AuditEntry
 * @property {string} id
 * @property {Date} at
 * @property {string | null} listingId
 * @property {string | null} listingTitle null without a listing, and in exports
 * @property {string} action
 * @property {Actor} actor
 * @property {string | null} actorRef
 * @property {unknown} details
 */

export {};
