# Default email content

Seeded into `EmailTemplate` by F02-T1. OCP approves the final wording.

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
| `draft_reminder`      | "Finish your Coleman Classifieds listing by {{draft_due_date}}"                                             | `seller_link`                     |
| `payment_reminder`    | "Your listing is approved: pay by {{payment_due_date}}"                                                     | `pay_link`                        |
| `ops_incident`        | "[Coleman Classifieds] Needs attention: {{incident_kind}}"                                                  | `incident_message`, `health_link` |
