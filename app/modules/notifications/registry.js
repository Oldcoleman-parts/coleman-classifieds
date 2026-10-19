// Every email the app knows: its stream, the placeholders staff may use, the ones that
// must stay, and sample data for previews. Default wording is in emails/defaults.js.
import { ValidationError } from "@/modules/core/index.js";

/**
 * @typedef {object} TemplateDef
 * @property {"seller" | "staff" | "alerts" | "ops"} audience who receives it; groups the
 *   list in Settings → Emails
 * @property {string} label the name staff see
 * @property {string} description when it is sent, in one sentence
 * @property {"transactional" | "alerts"} stream the SES configuration set and sender
 * @property {string[]} allowed placeholders the subject and body may use
 * @property {string[]} required placeholders that can't be removed from the template
 * @property {Record<string, string[]>} [loops] list placeholder → the fields of each item
 * @property {Record<string, number>} [limits] list placeholder → most items shown; the rest
 *   are counted in `more_count`, which notifications sets
 * @property {boolean} sensitive carries a code or private link: its data is never stored
 *   in the outbox, so it is tried straight away and never retried later
 * @property {boolean} [copyOnly] staff copy the text; `send()` refuses it
 * @property {Record<string, unknown>} sample
 */

// Filled in from EmailSettings for every template.
export const COMMON_PLACEHOLDERS = [
  "sender_name",
  "ocp_postal_address",
  "support_email",
  "phone",
];

// The groups in Settings → Emails, in the order they are shown.
export const AUDIENCES = [
  { audience: "seller", heading: "Emails to sellers" },
  { audience: "staff", heading: "Emails to staff" },
  { audience: "alerts", heading: "Emails to alert subscribers" },
  { audience: "ops", heading: "Problem alerts" },
];

const SAMPLE_SELLER_LINK =
  "https://oldcolemanparts.com/apps/classifieds/seller/sample";
// The pay page (F06-T1): `/apps/classifieds/pay/<ref>`, a signed reference, not the seller link.
const SAMPLE_PAY_LINK =
  "https://oldcolemanparts.com/apps/classifieds/pay/sample";
const SAMPLE_LISTING_URL =
  "https://oldcolemanparts.com/pages/classifieds/sample-1";
// The "Get my link" page (F04-T3). Only this exact address is accepted for get_link_url.
export const GET_LINK_PATH = "/apps/classifieds/my-link";
const SAMPLE_GET_LINK_URL = `https://oldcolemanparts.com${GET_LINK_PATH}`;

/** @type {Record<string, TemplateDef>} */
export const TEMPLATES = {
  invitation: {
    audience: "seller",
    label: "Invitation",
    description:
      "Sent automatically to the seller with their private invitation link when staff create the invitation, and again when staff resend it.",
    stream: "transactional",
    // F04-FIX-3: sent by the app. Still sensitive: the link is never stored or logged.
    sensitive: true,
    allowed: [
      "seller_first_name",
      "item_summary",
      "invitation_link",
      "invitation_expiry_date",
      "staff_first_name",
    ],
    required: ["invitation_link"],
    sample: {
      seller_first_name: "Pat",
      item_summary: "1962 Coleman 200A lantern",
      invitation_link:
        "https://oldcolemanparts.com/apps/classifieds/seller/sample",
      invitation_expiry_date: "November 4, 2026",
      staff_first_name: "Alex",
    },
  },
  // DECISION: every alerts-stream email needs an unsubscribe link, the confirmation too.
  alerts_confirm: {
    audience: "alerts",
    label: "Alert sign-up confirmation",
    description: "Asks a new subscriber to confirm their email address.",
    stream: "alerts",
    sensitive: true,
    allowed: ["confirm_link", "unsubscribe_link"],
    required: ["confirm_link"],
    sample: {
      confirm_link:
        "https://oldcolemanparts.com/apps/classifieds/alerts/confirm",
      unsubscribe_link:
        "https://oldcolemanparts.com/apps/classifieds/alerts/unsubscribe",
    },
  },
  alerts_digest: {
    audience: "alerts",
    label: "New listings alert",
    description: "Tells subscribers about newly published listings.",
    stream: "alerts",
    sensitive: true,
    allowed: [
      "count",
      "listing_title",
      "listings",
      "more_count",
      "browse_url",
      "unsubscribe_link",
    ],
    required: ["browse_url"],
    loops: {
      listings: [
        "title",
        "asking_price",
        "city",
        "state",
        "listing_url",
        "photo_url",
      ],
    },
    sample: {
      count: 2,
      listing_title: "1962 Coleman 200A lantern",
      more_count: "",
      browse_url: "https://oldcolemanparts.com/pages/classifieds",
      unsubscribe_link:
        "https://oldcolemanparts.com/apps/classifieds/alerts/unsubscribe",
      listings: [
        {
          title: "1962 Coleman 200A lantern",
          asking_price: "$120",
          city: "Spokane",
          state: "WA",
          listing_url: "https://oldcolemanparts.com/pages/classifieds/sample-1",
          photo_url: "https://cdn.example.com/sample-1.jpg",
        },
        {
          title: "Coleman 413G stove",
          asking_price: "$85",
          city: "Boise",
          state: "ID",
          listing_url: "https://oldcolemanparts.com/pages/classifieds/sample-2",
          photo_url: "https://cdn.example.com/sample-2.jpg",
        },
      ],
    },
  },
  staff_review_needed: {
    audience: "staff",
    label: "Listing needs review",
    description:
      "Sent when a seller submits a new listing or a change to a live one.",
    stream: "transactional",
    sensitive: false,
    allowed: ["listing_title", "change_type", "review_link"],
    required: ["review_link", "listing_title"],
    sample: {
      listing_title: "1962 Coleman 200A lantern",
      change_type: "new listing",
      review_link: "https://admin.shopify.com/store/sample/apps/classifieds",
    },
  },
  staff_message_held: {
    audience: "staff",
    label: "Buyer message held",
    description: "Sent when a buyer message is held for staff review.",
    stream: "transactional",
    sensitive: false,
    allowed: ["listing_title", "review_link", "hold_reasons"],
    required: ["review_link", "hold_reasons"],
    sample: {
      listing_title: "1962 Coleman 200A lantern",
      hold_reasons: "LINK, KEYWORD",
      review_link: "https://admin.shopify.com/store/sample/apps/classifieds",
    },
  },
  draft_reminder: {
    audience: "seller",
    label: "Draft reminder",
    description: "Reminds a seller to finish and submit their draft.",
    stream: "transactional",
    sensitive: true,
    // DECISION (F03-T4): only the link's hash is stored, so a scheduled reminder may have no
    // seller_link; the email then points to the invitation email and the "Get my link" page.
    allowed: [
      "seller_first_name",
      "draft_due_date",
      "seller_link",
      "get_link_url",
    ],
    required: [],
    sample: {
      seller_first_name: "Pat",
      draft_due_date: "October 19, 2026",
      seller_link: SAMPLE_SELLER_LINK,
      get_link_url: SAMPLE_GET_LINK_URL,
    },
  },
  payment_reminder: {
    audience: "seller",
    label: "Payment reminder",
    description: "Reminds a seller to pay for an approved listing.",
    stream: "transactional",
    sensitive: true,
    allowed: ["seller_first_name", "payment_due_date", "pay_link"],
    required: ["pay_link"],
    sample: {
      seller_first_name: "Pat",
      payment_due_date: "October 12, 2026",
      pay_link: SAMPLE_PAY_LINK,
    },
  },
  email_code: {
    audience: "seller",
    label: "Sign-in code",
    description: "The code a seller enters to open their listing.",
    stream: "transactional",
    sensitive: true,
    allowed: ["seller_first_name", "code", "code_minutes"],
    required: ["code"],
    sample: { seller_first_name: "Pat", code: "123456", code_minutes: 15 },
  },
  changes_requested: {
    audience: "seller",
    label: "Changes requested",
    description: "Sent when staff ask the seller to change their listing.",
    stream: "transactional",
    sensitive: true,
    allowed: [
      "seller_first_name",
      "listing_title",
      "staff_note",
      "correction_due_date",
      "seller_link",
      "get_link_url",
    ],
    // DECISION (F03-T4): staff screens can't rebuild the seller's link, so it is optional.
    required: ["staff_note"],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      staff_note: "Please add a photo of the underside of the fount.",
      correction_due_date: "October 19, 2026",
      seller_link: SAMPLE_SELLER_LINK,
      get_link_url: SAMPLE_GET_LINK_URL,
    },
  },
  listing_rejected: {
    audience: "seller",
    label: "Listing declined",
    description: "Sent when staff decline a listing.",
    stream: "transactional",
    sensitive: false,
    allowed: ["seller_first_name", "listing_title", "staff_note"],
    required: [],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      staff_note: "We only list Coleman items.",
    },
  },
  approved_pay: {
    audience: "seller",
    label: "Approved, ready to pay",
    description: "Sent when staff approve a listing, with the payment link.",
    stream: "transactional",
    sensitive: true,
    allowed: [
      "seller_first_name",
      "listing_title",
      "fee_amount",
      "payment_due_date",
      "pay_link",
    ],
    required: ["pay_link"],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      fee_amount: "$30.00",
      payment_due_date: "October 12, 2026",
      pay_link: SAMPLE_PAY_LINK,
    },
  },
  listing_live: {
    audience: "seller",
    label: "Listing is live",
    description: "Sent when the listing is paid and published.",
    stream: "transactional",
    sensitive: true,
    allowed: [
      "seller_first_name",
      "listing_title",
      "expires_date",
      "listing_url",
      "seller_link",
      "get_link_url",
    ],
    required: ["listing_url"],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      expires_date: "November 5, 2026",
      listing_url: SAMPLE_LISTING_URL,
      seller_link: SAMPLE_SELLER_LINK,
      get_link_url: SAMPLE_GET_LINK_URL,
    },
  },
  expiry_reminder: {
    audience: "seller",
    label: "Expiry reminder",
    description: "Sent shortly before a listing ends.",
    stream: "transactional",
    sensitive: true,
    allowed: [
      "seller_first_name",
      "listing_title",
      "expires_date",
      "seller_link",
      "get_link_url",
    ],
    required: ["expires_date"],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      expires_date: "November 5, 2026",
      seller_link: SAMPLE_SELLER_LINK,
      get_link_url: SAMPLE_GET_LINK_URL,
    },
  },
  listing_closed: {
    audience: "seller",
    label: "Listing closed",
    description: "Sent when a listing is sold, removed, expired or lapsed.",
    stream: "transactional",
    sensitive: false,
    // close_reason is SOLD, REMOVED, EXPIRED or LAPSED.
    allowed: ["seller_first_name", "listing_title", "close_reason"],
    required: ["listing_title"],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      close_reason: "EXPIRED",
    },
  },
  revision_approved: {
    audience: "seller",
    label: "Change approved",
    description: "Sent when staff approve a change to a live listing.",
    stream: "transactional",
    sensitive: false,
    allowed: ["seller_first_name", "listing_title", "listing_url"],
    required: ["listing_url"],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      listing_url: SAMPLE_LISTING_URL,
    },
  },
  revision_rejected: {
    audience: "seller",
    label: "Change declined",
    description: "Sent when staff decline a change to a live listing.",
    stream: "transactional",
    sensitive: true,
    allowed: [
      "seller_first_name",
      "listing_title",
      "staff_note",
      "seller_link",
      "get_link_url",
    ],
    required: [],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      staff_note: "The new price looks like a typo.",
      seller_link: SAMPLE_SELLER_LINK,
      get_link_url: SAMPLE_GET_LINK_URL,
    },
  },
  // Sent from the "Get my link" page (F04-T3): fresh links for every open listing.
  seller_link_request: {
    audience: "seller",
    label: "Your private links",
    description:
      "Sent when a seller asks for their private links again on the Get my link page.",
    stream: "transactional",
    sensitive: true,
    allowed: ["seller_first_name", "listings", "more_count"],
    required: ["listings"],
    // status is the listing status code; date is formatted by the sender (due or end date).
    loops: { listings: ["title", "status", "date", "seller_link"] },
    limits: { listings: 20 },
    sample: {
      seller_first_name: "Pat",
      listings: [
        {
          title: "1962 Coleman 200A lantern",
          status: "LIVE",
          date: "November 5, 2026",
          seller_link: SAMPLE_SELLER_LINK,
        },
        {
          title: "Coleman 413 stove",
          status: "DRAFT",
          date: "October 19, 2026",
          seller_link: `${SAMPLE_SELLER_LINK}2`,
        },
      ],
      more_count: "",
    },
  },
  // The buyer's words are private, so this email is never stored in the outbox.
  buyer_message: {
    audience: "seller",
    label: "Buyer message",
    description: "Passes a buyer’s message on to the seller.",
    stream: "transactional",
    sensitive: true,
    allowed: ["seller_first_name", "listing_title", "buyer_name", "message"],
    required: ["message"],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      buyer_name: "Sam",
      message: "Is the lantern still available? Does it hold pressure?",
    },
  },
  ops_incident: {
    audience: "ops",
    label: "Problem alert",
    description:
      "Sent to staff and the developer when the app reports a problem.",
    stream: "transactional",
    sensitive: false,
    allowed: ["incident_kind", "incident_message", "health_link"],
    required: ["incident_message", "health_link"],
    sample: {
      incident_kind: "EMAIL",
      incident_message: "Emails are failing to send.",
      health_link: "https://admin.shopify.com/store/sample/apps/classifieds",
    },
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

/**
 * @param {unknown} key
 * @returns {TemplateDef}
 * @throws {ValidationError} for a key that isn't in the registry
 */
export function templateDef(key) {
  if (typeof key !== "string" || !Object.hasOwn(TEMPLATES, key))
    throw new ValidationError("Unknown email template", {
      key: "is not a known email template",
    });
  return TEMPLATES[key];
}
