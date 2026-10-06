// Default wording for every email template, seeded into `EmailTemplate` on first use and
// restored by "reset". Mirrors docs/reference/email-default-content.md; OCP approves the
// final wording and edits it in the app. Bodies are Liquid inside a small set of HTML tags.

/** @type {Record<string, { subject: string, bodyHtml: string }>} */
export const EMAIL_DEFAULTS = {
  // Copied by staff into their own mailbox; the app never sends it.
  invitation: {
    subject: "Your Coleman Classifieds listing invitation",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>Thanks for talking with us about your {{ item_summary }}.</p>
<p>As we discussed, we'd like to invite you to list it on Coleman Classifieds, the private-seller section of Old Coleman Parts.</p>
<p>Here is your private link:<br>{{ invitation_link }}</p>
<p>What happens next:</p>
<ol>
<li>Open the link to see your listing fee, the rules, and how the service works.</li>
<li>Add your photos and details, then submit. There's no charge at this point.</li>
<li>We'll review your listing and let you know once it's approved.</li>
<li>After approval, you'll pay the listing fee and your listing goes live straight away.</li>
</ol>
<p>This link is just for you and covers this one listing. It stays valid until {{ invitation_expiry_date }}.</p>
<p>Any questions, just reply to this email or call/text us at 360-200-1528.</p>
<p>Thanks,<br>{{ staff_first_name }}<br>Old Coleman Parts</p>`,
  },

  alerts_confirm: {
    subject: "Confirm your Coleman Classifieds alerts",
    bodyHtml: `<p>Hi,</p>
<p>Please confirm you'd like an email when new listings go live on Coleman Classifieds:</p>
<p><a href="{{ confirm_link }}">Confirm my subscription</a></p>
<p>If you didn't sign up, you can ignore this email and you won't hear from us.</p>`,
  },

  alerts_digest: {
    subject:
      "{% if count == 1 %}New on Coleman Classifieds: {{ listing_title }}{% else %}{{ count }} new on Coleman Classifieds{% endif %}",
    bodyHtml: `<p>New listings from private sellers, approved by OCP:</p>
{% for listing in listings %}
<p><strong>{{ listing.title }}</strong><br>
{{ listing.asking_price }} · {{ listing.city }}, {{ listing.state }}<br>
<a href="{{ listing.listing_url }}">View listing</a></p>
{% endfor %}
{% if more_count != "" %}<p>and {{ more_count }} more</p>{% endif %}
<p><a href="{{ browse_url }}">Browse all listings</a></p>
<p>These are private sellers' items. OCP doesn't inspect, guarantee, ship or handle payment for them. Please contact the seller directly through the listing.</p>
<p>You're receiving this because you signed up for Coleman Classifieds alerts.</p>`,
  },

  staff_review_needed: {
    subject: "Ready to review: {{ listing_title }} ({{ change_type }})",
    bodyHtml: `<p>A listing is waiting for review.</p>
<p><strong>{{ listing_title }}</strong><br>Type: {{ change_type }}</p>
<p><a href="{{ review_link }}">Open the listing</a></p>`,
  },

  staff_message_held: {
    subject: "Buyer message held: {{ listing_title }}",
    bodyHtml: `<p>A buyer message was held for review.</p>
<p><strong>{{ listing_title }}</strong><br>Why it was held: {{ hold_reasons }}</p>
<p><a href="{{ review_link }}">Review held messages</a></p>`,
  },

  draft_reminder: {
    subject: "Finish your Coleman Classifieds listing by {{ draft_due_date }}",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>Your Coleman Classifieds listing isn't finished yet. Please add your details and submit it by {{ draft_due_date }}, or the invitation will close.</p>
{% if seller_link != "" %}<p><a href="{{ seller_link }}">Continue my listing</a></p>{% else %}<p>Please use the private link from your invitation email.</p>{% endif %}
{% if get_link_url != "" %}<p>Can't find your private link? Get it here: <a href="{{ get_link_url }}">{{ get_link_url }}</a></p>{% endif %}
<p>Any questions, just reply to this email.</p>`,
  },

  payment_reminder: {
    subject: "Your listing is approved: pay by {{ payment_due_date }}",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>Your Coleman Classifieds listing is approved. Pay the listing fee by {{ payment_due_date }} and it goes live straight away.</p>
<p><a href="{{ pay_link }}">Pay and publish my listing</a></p>
<p>Any questions, just reply to this email.</p>`,
  },

  // Seller emails.
  email_code: {
    subject: "Your Coleman Classifieds code: {{ code }}",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>Your code to open your Coleman Classifieds listing is:</p>
<p><strong>{{ code }}</strong></p>
<p>It works for {{ code_minutes }} minutes. If you didn't ask for it, you can ignore this email.</p>`,
  },

  changes_requested: {
    subject: "Changes needed for your listing: {{ listing_title }}",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>Thanks for sending in <strong>{{ listing_title }}</strong>. Before we can approve it, we need a few changes:</p>
<blockquote>{{ staff_note }}</blockquote>
<p>Please update your listing by {{ correction_due_date }}.</p>
{% if seller_link != "" %}<p><a href="{{ seller_link }}">Update my listing</a></p>{% else %}<p>Please use the private link from your invitation email.</p>{% endif %}
{% if get_link_url != "" %}<p>Can't find your private link? Get it here: <a href="{{ get_link_url }}">{{ get_link_url }}</a></p>{% endif %}
<p>Any questions, just reply to this email.</p>`,
  },

  listing_rejected: {
    subject: "About your Coleman Classifieds listing",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>Thanks for sending in <strong>{{ listing_title }}</strong>. We're sorry, but we can't accept this listing.</p>
{% if staff_note != "" %}<blockquote>{{ staff_note }}</blockquote>{% endif %}
<p>You haven't been charged anything. Any questions, just reply to this email.</p>`,
  },

  approved_pay: {
    subject: "Your listing is approved: pay to go live",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>Good news: <strong>{{ listing_title }}</strong> is approved.</p>
<p>Pay the listing fee of {{ fee_amount }} by {{ payment_due_date }} and your listing goes live straight away, for one month.</p>
<p><a href="{{ pay_link }}">Pay and publish my listing</a></p>
<p>Any questions, just reply to this email.</p>`,
  },

  listing_live: {
    subject: "Your listing is live: {{ listing_title }}",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>Thanks for your payment. <strong>{{ listing_title }}</strong> is now live on Coleman Classifieds until {{ expires_date }}.</p>
<p><a href="{{ listing_url }}">View my listing</a></p>
<p>Buyers contact you through the listing; their messages arrive in this mailbox, and your email address stays private until you reply.</p>
{% if seller_link != "" %}<p>To edit your listing or mark it as sold, use your private link:<br><a href="{{ seller_link }}">Manage my listing</a></p>{% else %}<p>To edit your listing or mark it as sold, use the private link from your invitation email.</p>{% endif %}
{% if get_link_url != "" %}<p>Can't find your private link? Get it here: <a href="{{ get_link_url }}">{{ get_link_url }}</a></p>{% endif %}`,
  },

  expiry_reminder: {
    subject: "Your listing ends on {{ expires_date }}",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p><strong>{{ listing_title }}</strong> will come off Coleman Classifieds on {{ expires_date }}.</p>
{% if seller_link != "" %}<p>If it has sold, you can mark it as sold now:</p>
<p><a href="{{ seller_link }}">Manage my listing</a></p>{% else %}<p>If it has sold, you can mark it as sold now with the private link from your invitation email.</p>{% endif %}
{% if get_link_url != "" %}<p>Can't find your private link? Get it here: <a href="{{ get_link_url }}">{{ get_link_url }}</a></p>{% endif %}
<p>If you'd like to list it again afterwards, just reply to this email.</p>`,
  },

  listing_closed: {
    subject: "Your listing has ended: {{ listing_title }}",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
{% if close_reason == "SOLD" %}<p><strong>{{ listing_title }}</strong> is marked as sold and is no longer shown on Coleman Classifieds. Congratulations on the sale.</p>
{% elsif close_reason == "EXPIRED" %}<p>The listing month for <strong>{{ listing_title }}</strong> has ended, so it is no longer shown on Coleman Classifieds.</p>
{% elsif close_reason == "LAPSED" %}<p><strong>{{ listing_title }}</strong> wasn't paid for in time, so the approval has ended. You haven't been charged anything.</p>
{% else %}<p><strong>{{ listing_title }}</strong> has been removed from Coleman Classifieds.</p>
{% endif %}
<p>If you'd like to list it again, or have any questions, just reply to this email.</p>`,
  },

  revision_approved: {
    subject: "Your changes are live: {{ listing_title }}",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>We've approved the changes to <strong>{{ listing_title }}</strong>, and they are now showing on your listing.</p>
<p><a href="{{ listing_url }}">View my listing</a></p>`,
  },

  revision_rejected: {
    subject: "About the changes to your listing: {{ listing_title }}",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>We couldn't approve the changes to <strong>{{ listing_title }}</strong>. Your listing stays live as it was.</p>
{% if staff_note != "" %}<blockquote>{{ staff_note }}</blockquote>{% endif %}
{% if seller_link != "" %}<p><a href="{{ seller_link }}">Manage my listing</a></p>{% endif %}
{% if get_link_url != "" %}<p>Can't find your private link? Get it here: <a href="{{ get_link_url }}">{{ get_link_url }}</a></p>{% endif %}
<p>Any questions, just reply to this email.</p>`,
  },

  // Sent to the seller with Reply-To set to the buyer, so a reply goes straight to them.
  // DECISION (F03-T4): rows carry the status code and a ready-formatted date; the wording
  // stays here so staff can edit it.
  seller_link_request: {
    subject: "Your Coleman Classifieds links",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>You asked for your private links. Here are your open listings on Coleman Classifieds:</p>
{% for listing in listings %}
<p><strong>{{ listing.title }}</strong><br>
{% if listing.status == "INVITED" %}Not started yet{% elsif listing.status == "DRAFT" %}Draft, finish by {{ listing.date }}{% elsif listing.status == "CHANGES_REQUESTED" %}Changes needed by {{ listing.date }}{% elsif listing.status == "SUBMITTED" %}With us for review{% elsif listing.status == "APPROVED_AWAITING_PAYMENT" %}Approved, pay by {{ listing.date }}{% elsif listing.status == "LIVE" %}Live until {{ listing.date }}{% elsif listing.status == "PAUSED" %}Paused{% else %}Open{% endif %}<br>
<a href="{{ listing.seller_link }}">Open this listing</a></p>
{% endfor %}
{% if more_count != "" %}<p>You have {{ more_count }} more open listings. Please reply to this email and we'll help with those.</p>{% endif %}
<p>Each link replaces any earlier link for that listing. Keep this email: these links are private, so please don't share them.</p>
<p>If you didn't ask for this, you can ignore this email.</p>`,
  },

  buyer_message: {
    subject: "A buyer is asking about: {{ listing_title }}",
    bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>{{ buyer_name }} sent you a message about <strong>{{ listing_title }}</strong>:</p>
<blockquote>{{ message }}</blockquote>
<p>To answer, just reply to this email. Your reply goes straight to the buyer, who will then see your email address.</p>
<p>Old Coleman Parts isn't part of the sale. Never share passwords or codes, and be careful with requests to pay or ship in unusual ways.</p>`,
  },

  ops_incident: {
    subject: "[Coleman Classifieds] Needs attention: {{ incident_kind }}",
    bodyHtml: `<p>Something in Coleman Classifieds needs attention.</p>
<p><strong>{{ incident_kind }}</strong><br>{{ incident_message }}</p>
<p><a href="{{ health_link }}">Open system health</a></p>`,
  },
};
