// Every email the app knows: its stream, the placeholders staff may use, the ones that
// must stay, and sample data for previews. Default wording is in emails/defaults.js.
import { ValidationError } from "@/modules/core/index.js";

/**
 * @typedef {object} TemplateDef
 * @property {"transactional" | "alerts"} stream the SES configuration set and sender
 * @property {string[]} allowed placeholders the subject and body may use
 * @property {string[]} required placeholders that can't be removed from the template
 * @property {Record<string, string[]>} [loops] list placeholder → the fields of each item
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

const SAMPLE_SELLER_LINK =
  "https://oldcolemanparts.com/apps/classifieds/i/sample";
const SAMPLE_LISTING_URL =
  "https://oldcolemanparts.com/pages/classifieds/sample-1";

/** @type {Record<string, TemplateDef>} */
export const TEMPLATES = {
  invitation: {
    stream: "transactional",
    copyOnly: true,
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
      invitation_link: "https://oldcolemanparts.com/apps/classifieds/i/sample",
      invitation_expiry_date: "November 4, 2026",
      staff_first_name: "Alex",
    },
  },
  // DECISION: every alerts-stream email needs an unsubscribe link, the confirmation too.
  alerts_confirm: {
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
    stream: "transactional",
    sensitive: true,
    allowed: ["seller_first_name", "draft_due_date", "seller_link"],
    required: ["seller_link"],
    sample: {
      seller_first_name: "Pat",
      draft_due_date: "October 19, 2026",
      seller_link: "https://oldcolemanparts.com/apps/classifieds/i/sample",
    },
  },
  payment_reminder: {
    stream: "transactional",
    sensitive: true,
    allowed: ["seller_first_name", "payment_due_date", "pay_link"],
    required: ["pay_link"],
    sample: {
      seller_first_name: "Pat",
      payment_due_date: "October 12, 2026",
      pay_link: "https://oldcolemanparts.com/apps/classifieds/i/sample/pay",
    },
  },
  email_code: {
    stream: "transactional",
    sensitive: true,
    allowed: ["seller_first_name", "code", "code_minutes"],
    required: ["code"],
    sample: { seller_first_name: "Pat", code: "123456", code_minutes: 15 },
  },
  changes_requested: {
    stream: "transactional",
    sensitive: true,
    allowed: [
      "seller_first_name",
      "listing_title",
      "staff_note",
      "correction_due_date",
      "seller_link",
    ],
    required: ["staff_note", "seller_link"],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      staff_note: "Please add a photo of the underside of the fount.",
      correction_due_date: "October 19, 2026",
      seller_link: SAMPLE_SELLER_LINK,
    },
  },
  listing_rejected: {
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
      pay_link: `${SAMPLE_SELLER_LINK}/pay`,
    },
  },
  listing_live: {
    stream: "transactional",
    sensitive: true,
    allowed: [
      "seller_first_name",
      "listing_title",
      "expires_date",
      "listing_url",
      "seller_link",
    ],
    required: ["listing_url"],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      expires_date: "November 5, 2026",
      listing_url: SAMPLE_LISTING_URL,
      seller_link: SAMPLE_SELLER_LINK,
    },
  },
  expiry_reminder: {
    stream: "transactional",
    sensitive: true,
    allowed: [
      "seller_first_name",
      "listing_title",
      "expires_date",
      "seller_link",
    ],
    required: ["expires_date"],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      expires_date: "November 5, 2026",
      seller_link: SAMPLE_SELLER_LINK,
    },
  },
  listing_closed: {
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
    stream: "transactional",
    sensitive: true,
    allowed: [
      "seller_first_name",
      "listing_title",
      "staff_note",
      "seller_link",
    ],
    required: [],
    sample: {
      seller_first_name: "Pat",
      listing_title: "1962 Coleman 200A lantern",
      staff_note: "The new price looks like a typo.",
      seller_link: SAMPLE_SELLER_LINK,
    },
  },
  // The buyer's words are private, so this email is never stored in the outbox.
  buyer_message: {
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
