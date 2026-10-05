# Product overview

## Goals

- **First opportunity to buy.** Sellers come to OCP first. OCP buys what it wants, then invites the seller to list the rest.
- **An option when OCP passes.** Sellers get a trusted, Coleman-focused place to advertise.
- **Very little administration.** Staff send the invitation and approve. Everything else is automatic.
- **Advertising space only.** OCP doesn't sell, ship, inspect, guarantee, collect payment for, or mediate the items.
- **Kept separate from the store.** Listings never appear in search, collections, New Arrivals, auctions, feeds, inventory, fulfillment, ShippingEasy or packing slips.

## What can be listed (OCP listing rules)

- Lanterns and stoves of **any brand**, in any quantity, as one item or a collection.
- Accessories and manuals only when they're **included with the equipment**. No separate parts or documentation listings.
- Actual photos, an accurate description, an asking price, and ownership or permission to sell.
- No wanted ads, services, or duplicate or misleading listings.
- A seller may sell a collection together or piece by piece and update what remains. They **may not replace sold items or add different merchandise**.
- OCP supplies the rules text, including the refund and removal policy. It's shown to every seller and versioned.

## Phases

| Phase                      | Scope                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Launch (4–5 weeks)** | F01–F08 (17 tickets): foundation, admin shell and settings, email and photos, seller journey, staff console, payments and publishing, buyer contact and alerts, operations and launch. Includes the data structures for renewals. |
| **2**                      | F09: automatic monthly renewals.                                                                                                                                                                        |
| **Later**                  | F10: open (non-invited) submissions with their own safeguards.                                                                                                                                          |

### Feature flags

| Flag                     | Phase 1                                              | Notes                                       |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------- |
| `alertsEnabled`          | **on**, with a switch visible in Settings → Features | Staff can pause alerts                      |
| `renewalsEnabled`        | off and hidden (`RENEWALS_RELEASED=false`)           | Switch appears once Phase 2 is released     |
| `openSubmissionsEnabled` | off and hidden (`OPEN_SUBMISSIONS_RELEASED=false`)   | Switch appears once the feature is released |

## Agreed decisions (from OCP)

| Topic                         | Decision                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listing period                | One calendar month from publication (`addMonths`), not 30 days                                                                                                                                                          |
| Pricing                       | $30/month to start; standard, promotional and individual prices editable by staff                                                                                                                                       |
| Offer scope                   | Per offer, staff choose **first month only** or **every renewal**. The seller sees the renewal price before agreeing (Phase 2)                                                                                          |
| Price changes                 | Existing renewing listings keep their agreed price. New prices apply to new invitations                                                                                                                                 |
| Payment deadline              | 7 days after approval, with a reminder 2 days before                                                                                                                                                                    |
| Invitations                   | Unused invitations expire after 30 days                                                                                                                                                                                 |
| Drafts                        | 14 days from the day the seller starts the draft, with a reminder 3 days before                                                                                                                                         |
| Corrections                   | 14 days after changes are requested (suggested; awaiting OCP confirmation)                                                                                                                                              |
| Edits                         | Title, description and photo changes are reviewed while the approved version stays live. Price and availability update immediately. Approving never restarts the month or reopens a closed listing                      |
| Ordinary pause                | Doesn't extend the month                                                                                                                                                                                                |
| Technical problem             | Staff can extend the listing by N days, with a reason                                                                                                                                                                   |
| Investigation pause           | If no violation is found, the paused time is restored on resume                                                                                                                                                         |
| Renewals while paused         | Not charged (Phase 2)                                                                                                                                                                                                   |
| Failed renewal                | Hidden at month end; 7 days to pay, then closed and retries stopped. Paying in the window starts a new month from the payment time (Phase 2)                                                                            |
| Photos                        | Max 12 (adjustable). Closed-listing photos kept privately for 90 days, then deleted                                                                                                                                     |
| Payment and agreement records | Kept **1 year** after the listing closes, then deleted (the Shopify orders remain in Shopify)                                                                                                                           |
| Alerts                        | At launch. Daily digest only on days with new listings. Only first go-live triggers alerts; edits and renewals don't                                                                                                    |
| Staff notifications           | Sent immediately for a new submission, corrected resubmission, edit pending, or held buyer message. They include the title and a direct review link, go to an address set in Settings, and are separate from the digest |
| Agreement                     | Unticked box. Record the rules version, date and time. Renewal consent is added in Phase 2                                                                                                                              |
| Accounts                      | AWS, Railway, GitHub, email domain and the Shopify app are owned by OCP, with developer access                                                                                                                          |

## Open questions (use the default until answered)

- Button placement: header beside Search/Account/Cart (**default**) or the top bar beside "Track My Order".
- Correction window: 14 days (**default**).
- Held-message triggers: links, flagged words, repeated sends (**default**).
- ShippingEasy: access to set the filter, or instructions for OCP to apply it.
