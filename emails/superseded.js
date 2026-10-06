// Earlier default wording, kept so a stored template that still holds one of them (never
// edited by staff) is moved to the current default. Newest last. Never edit an entry.

/** @type {Record<string, { subject: string, bodyHtml: string }[]>} */
export const SUPERSEDED_DEFAULTS = {
  // Before F03-T4 (the "Get my link" help line).
  draft_reminder: [
    {
      subject:
        "Finish your Coleman Classifieds listing by {{ draft_due_date }}",
      bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>Your Coleman Classifieds listing isn't finished yet. Please add your details and submit it by {{ draft_due_date }}, or the invitation will close.</p>
<p><a href="{{ seller_link }}">Continue my listing</a></p>
<p>Any questions, just reply to this email.</p>`,
    },
  ],
  changes_requested: [
    {
      subject: "Changes needed for your listing: {{ listing_title }}",
      bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>Thanks for sending in <strong>{{ listing_title }}</strong>. Before we can approve it, we need a few changes:</p>
<blockquote>{{ staff_note }}</blockquote>
<p>Please update your listing by {{ correction_due_date }}.</p>
<p><a href="{{ seller_link }}">Update my listing</a></p>
<p>Any questions, just reply to this email.</p>`,
    },
  ],
  listing_live: [
    {
      subject: "Your listing is live: {{ listing_title }}",
      bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>Thanks for your payment. <strong>{{ listing_title }}</strong> is now live on Coleman Classifieds until {{ expires_date }}.</p>
<p><a href="{{ listing_url }}">View my listing</a></p>
<p>Buyers contact you through the listing; their messages arrive in this mailbox, and your email address stays private until you reply.</p>
<p>To edit your listing or mark it as sold, use your private link:<br><a href="{{ seller_link }}">Manage my listing</a></p>`,
    },
  ],
  expiry_reminder: [
    {
      subject: "Your listing ends on {{ expires_date }}",
      bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p><strong>{{ listing_title }}</strong> will come off Coleman Classifieds on {{ expires_date }}.</p>
<p>If it has sold, you can mark it as sold now:</p>
<p><a href="{{ seller_link }}">Manage my listing</a></p>
<p>If you'd like to list it again afterwards, just reply to this email.</p>`,
    },
  ],
  revision_rejected: [
    {
      subject: "About the changes to your listing: {{ listing_title }}",
      bodyHtml: `<p>Hi {{ seller_first_name }},</p>
<p>We couldn't approve the changes to <strong>{{ listing_title }}</strong>. Your listing stays live as it was.</p>
{% if staff_note != "" %}<blockquote>{{ staff_note }}</blockquote>{% endif %}
<p><a href="{{ seller_link }}">Manage my listing</a></p>
<p>Any questions, just reply to this email.</p>`,
    },
  ],
};
