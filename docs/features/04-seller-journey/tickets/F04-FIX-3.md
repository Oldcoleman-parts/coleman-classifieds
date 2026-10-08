# F04-FIX-3 — Email the invitation to the seller automatically, with resend

|                     |                                              |
| ------------------- | -------------------------------------------- |
| **Status**          | To do                                        |
| **Feature**         | [F04 Seller journey](../README.md)           |
| **Module(s)**       | `access`, `notifications` (registry, status) |
| **Security skills** | `security-access`, `security-notifications`  |

Start with `/implement-ticket F04-FIX-3`. Change requested by the client on 2026-10-08 (not a review finding).

## Problem

Creating an invitation only shows the private link (`/app/invitations/new`); staff have to copy it and email the seller themselves. The `invitation` template is `copyOnly` (`app/modules/notifications/registry.js`), so `send()` refuses it. The seller should get the invitation email automatically as soon as staff create the invitation.

## Scope

- [ ] `invitation` becomes a sent template: remove `copyOnly`, keep `sensitive` (never queued, body never stored or logged), update its description, and fix its sample link to `/apps/classifieds/seller/sample`.
- [ ] After `createInvitation()` commits, send `invitation` to the seller's address with `notifications.send()` (`seller_first_name`, `item_summary`, `invitation_link`, `invitation_expiry_date`, `staff_first_name`), keyed `invitation:<invitationId>` so a repeat sends nothing new. The link is https and is never logged.
- [ ] The result screen says whether the email was sent. It still shows the copyable link once, as the fallback when the email failed (SES down, suppressed address).
- [ ] The invitation screen (`/app/invitations/:id`, already exists) shows the email status: sent (with the time), not sent (send failed), or not delivered (the address bounced or is suppressed). `notifications` exports a small read for this, e.g. `getEmailStatus(idempotencyKey)` plus the existing `isSuppressed(address)`; it returns the status and time only, never a body.
- [ ] **Resend invitation email** on that screen, for an invitation that is still open (not used, revoked or expired). Only the link's hash is stored, so a resend issues a new link, makes the old one invalid (as Get my link does, F04-T3) and sends it, keyed per resend. The screen warns staff that the earlier link stops working. A resend never changes the fee, the listing or the expiry date.
- [ ] Resend is limited (default: 5 per invitation per day), is refused with a clear message for a suppressed address (the email cannot be delivered; staff must fix the address or copy the link), and writes an audit entry with the staff email.
- [ ] A failed send never undoes the invitation. Record the outcome (sent or failed, no link) in the invitation's audit entry.
- [ ] Update the F04 README, the template text in Settings → Emails if its wording says "copy", and `docs/product/overview.md` if it describes staff sending the link by hand.

## Out of scope

- Changing the seller's email address on an existing invitation (revoke it and create a new one).
- Removing an address from the suppression list.
- `notifications.renderTemplate()` (F03-FIX-3): no longer needed for the invitation.

## Acceptance criteria

- [ ] Creating an invitation sends one `invitation` email to the seller with a working link; creating it twice by double submit sends one email.
- [ ] When the send fails, the invitation exists, the screen says the email was not sent and shows the link to copy.
- [ ] After a bounce (SES notice) the invitation screen shows "not delivered"; after a failed send it shows "not sent".
- [ ] Resend sends a new working link and the old link no longer opens the listing; a confirmed device stays signed in; the 6th resend in a day and a resend on a used, revoked or expired invitation are refused.
- [ ] The link appears in no log, no `EmailOutbox` body and no audit entry.
- [ ] `npm run test:ai` is green for this feature.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Resend and the delivery status were added on 2026-10-08 at the client's request.
- `EmailOutbox` rows are removed 30 days after they finish, so an older invitation shows no send status; a bounce still shows through the suppression list.

- This replaces the "copyable invitation email" part of F04-T1 and makes most of [F03-FIX-3](../../03-email-and-photos/tickets/F03-FIX-3.md) unnecessary; only its sample-link fix remains, and this ticket covers the `invitation` sample.
- Touches two modules (`access` and one registry entry in `notifications`); agreed as one ticket because the registry change has no use on its own.
