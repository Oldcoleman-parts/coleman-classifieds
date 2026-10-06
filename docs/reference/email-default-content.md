# Default email content

Seeded into `EmailTemplate` by F03-T1. OCP approves the final wording.

The seed itself is `emails/defaults.js`, written as Liquid inside a small set of HTML tags. The text below shows the wording; where it uses `{{#each}}` or a `[Button] → link` shorthand, the seed uses Liquid `{% for %}` and a normal link. Alert emails (B and C) get the unsubscribe link and the postal address from the shared layout, so staff can’t remove them.

### Email template content

The wording below is the **default content** for each template. It is seeded into the database on install, and OCP staff edit it in the app (F03). The files in `emails/` hold only the shared layout (logo header, footer) and the seed defaults. Tone: plain and friendly.

#### A. Invitation email (copied by staff, sent from their own mailbox)

Shown on the Create invitation screen with a **Copy email** button. It is not auto-sent. It must not mention the price, because the linked page shows the fee.

```
Subject: Your Coleman Classifieds listing invitation

Hi {{seller_first_name}},

Thanks for talking with us about your {{item_summary}}.

As we discussed, we'd like to invite you to list it on Coleman Classifieds, the private-seller section of Old Coleman Parts.

Here is your private link:
{{invitation_link}}

What happens next:
1. Open the link to see your listing fee, the rules, and how the service works.
2. Add your photos and details, then submit. There's no charge at this point.
3. We'll review your listing and let you know once it's approved.
4. After approval, you'll pay the listing fee and your listing goes live straight away.

This link is just for you and covers this one listing. It stays valid until {{invitation_expiry_date}}.

Any questions, just reply to this email or call/text us at 360-200-1528.

Thanks,
{{staff_first_name}}
Old Coleman Parts
```

#### B. Alerts: confirm your subscription (auto, Phase 2)

```
Subject: Confirm your Coleman Classifieds alerts

Hi,

Please confirm you'd like an email when new listings go live on Coleman Classifieds:

[Confirm my subscription] → {{confirm_link}}

If you didn't sign up, you can ignore this email and you won't hear from us.

Old Coleman Parts
{{ocp_postal_address}}
```

#### C. Alerts: new listings digest (auto, Phase 2, sent once a day only on days with new listings)

```
Subject: {{count}} new on Coleman Classifieds   (1 listing: "New on Coleman Classifieds: {{listing_title}}")

New listings from private sellers, approved by OCP:

{{#each listings}}
[photo]  {{title}}
         {{asking_price}} · {{city}}, {{state}}
         [View listing] → {{listing_url}}
{{/each}}

[Browse all listings] → {{browse_url}}

These are private sellers' items. OCP doesn't inspect, guarantee, ship or handle payment for them. Please contact the seller directly through the listing.

You're receiving this because you signed up for Coleman Classifieds alerts.
[Unsubscribe] → {{unsubscribe_link}}
Old Coleman Parts · {{ocp_postal_address}}
```

Headers: `List-Unsubscribe: <{{unsubscribe_link}}>, <mailto:...>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Show a maximum of 10 listings, then "and {{n}} more".

#### D. Alerts: unsubscribed page (web)

"You've been unsubscribed from Coleman Classifieds alerts. You won't receive any more of these emails." Add a **Resubscribe** button, which restarts double opt-in.

## Staff and ops templates (added)

| Key                   | Subject (default)                                                                                           | Required placeholders             |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `staff_review_needed` | "Ready to review: {{listing_title}} ({{change_type}})". Here `change_type` = new listing / corrected / edit | `review_link`, `listing_title`    |
| `staff_message_held`  | "Buyer message held: {{listing_title}}"                                                                     | `review_link`, `hold_reasons`     |
| `draft_reminder`      | "Finish your Coleman Classifieds listing by {{draft_due_date}}"                                             | —                                 |
| `payment_reminder`    | "Your listing is approved: pay by {{payment_due_date}}"                                                     | `pay_link`                        |
| `ops_incident`        | "[Coleman Classifieds] Needs attention: {{incident_kind}}"                                                  | `incident_message`, `health_link` |

### Default bodies for the staff and ops templates

Drafted in F03-T1 because only the subjects were agreed. OCP may reword them in the app.

| Key                   | Body (default)                                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staff_review_needed` | "A listing is waiting for review." The title, "Type: {{change_type}}", and an **Open the listing** link to `{{review_link}}`.                                                                                                                                                                                 |
| `staff_message_held`  | "A buyer message was held for review." The title, "Why it was held: {{hold_reasons}}" (reason codes only, never the buyer’s words), and a link to the messages.                                                                                                                                               |
| `draft_reminder`      | "Your Coleman Classifieds listing isn’t finished yet. Please add your details and submit it by {{draft_due_date}}, or the invitation will close." A **Continue my listing** link to `{{seller_link}}`, or, without one, “Please use the private link from your invitation email.” Then the help line (below). |
| `payment_reminder`    | "Your Coleman Classifieds listing is approved. Pay the listing fee by {{payment_due_date}} and it goes live straight away." A **Pay and publish my listing** link to `{{pay_link}}`.                                                                                                                          |
| `ops_incident`        | "Something in Coleman Classifieds needs attention." The kind, `{{incident_message}}`, and an **Open system health** link to `{{health_link}}`.                                                                                                                                                                |

### Seller emails

Every email a seller receives at launch has a template staff can edit in **Settings → Emails**. The wording was drafted in F03-T1 and is in `emails/defaults.js`; OCP approves or rewords it in the app. Each one starts "Hi {{seller_first_name}},".

| Key                   | Sent when (by)                                     | Subject (default)                                               | What it says                                                                                                                                                                                            | Required placeholders |
| --------------------- | -------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `email_code`          | the seller asks for a sign-in code (F04)           | "Your Coleman Classifieds code: {{code}}"                       | The code and how many minutes it works.                                                                                                                                                                 | `code`                |
| `changes_requested`   | staff ask for changes (F05)                        | "Changes needed for your listing: {{listing_title}}"            | Staff’s note, the date to update by, an **Update my listing** link (or the invitation-email fallback), and the help line.                                                                               | `staff_note`          |
| `listing_rejected`    | staff reject the listing (F05)                     | "About your Coleman Classifieds listing"                        | The listing can’t be accepted, staff’s note if there is one, and that nothing was charged.                                                                                                              | —                     |
| `approved_pay`        | staff approve the listing (F06)                    | "Your listing is approved: pay to go live"                      | The fee, the date to pay by, and a **Pay and publish my listing** link.                                                                                                                                 | `pay_link`            |
| `payment_reminder`    | 2 days before the payment deadline (F06)           | "Your listing is approved: pay by {{payment_due_date}}"         | See the table above.                                                                                                                                                                                    | `pay_link`            |
| `listing_live`        | the payment is received (F06)                      | "Your listing is live: {{listing_title}}"                       | Live until `{{expires_date}}`, a link to the listing, how buyers get in touch, and the private manage link.                                                                                             | `listing_url`         |
| `expiry_reminder`     | shortly before the listing month ends (F08)        | "Your listing ends on {{expires_date}}"                         | When the listing comes off, and a link to mark it as sold.                                                                                                                                              | `expires_date`        |
| `listing_closed`      | the listing closes (F06 / F08)                     | "Your listing has ended: {{listing_title}}"                     | One paragraph chosen by `{{close_reason}}`: SOLD, EXPIRED, LAPSED (not paid in time) or REMOVED.                                                                                                        | `listing_title`       |
| `revision_approved`   | staff approve an edit to a live listing (F05)      | "Your changes are live: {{listing_title}}"                      | The changes are showing, with a link to the listing.                                                                                                                                                    | `listing_url`         |
| `revision_rejected`   | staff reject an edit to a live listing (F05)       | "About the changes to your listing: {{listing_title}}"          | The changes weren’t approved, the listing stays as it was, and staff’s note if there is one.                                                                                                            | —                     |
| `buyer_message`       | a buyer’s message is delivered to the seller (F07) | "A buyer is asking about: {{listing_title}}"                    | The buyer’s first name and message, how to reply (Reply-To is the buyer), and a short safety note.                                                                                                      | `message`             |
| `draft_reminder`      | 3 days before the draft deadline (F08)             | "Finish your Coleman Classifieds listing by {{draft_due_date}}" | See the table above.                                                                                                                                                                                    | —                     |
| `seller_link_request` | the seller asks on the Get my link page (F04-T3)   | "Your Coleman Classifieds links"                                | One row per open listing (title, status line such as “Live until {date}”, **Open this listing**), at most 20 with “You have N more open listings” after that, and that each link replaces earlier ones. | `listings`            |

Not seeded yet, because their features are hidden until released: the renewal emails (F09) and the daily open-incident summary (F08-T2). Each is added with `/add-email-template` in its own ticket and then appears in Settings → Emails like the rest.

Template keys (19): `invitation` (copied by staff, never sent by the app), `alerts_confirm`, `alerts_digest`, the five staff and ops keys, the ten seller keys added here, and `seller_link_request` (F03-T4).

### The private link and the help line (F03-T4)

Only a hash of each seller link is stored, so emails sent from staff screens or schedules can’t include the seller’s link. `seller_link` is optional everywhere: without it the email points to the invitation email instead of showing an empty link. `changes_requested`, `draft_reminder`, `listing_live`, `expiry_reminder` and `revision_rejected` also show, when `{{get_link_url}}` is given: “Can’t find your private link? Get it here: {{get_link_url}}”. That value must be the exact `/apps/classifieds/my-link` page (https, nothing after it), so it can never carry a token.

Emails staff never edited move to new default wording automatically (audited as `EmailTemplateDefaultsUpdated`); the earlier defaults are kept in `emails/superseded.js`. Edited emails are never changed.
