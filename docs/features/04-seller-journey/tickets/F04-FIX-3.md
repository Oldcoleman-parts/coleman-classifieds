# F04-FIX-3 — Email the invitation to the seller automatically, with resend

|                     |                                              |
| ------------------- | -------------------------------------------- |
| **Status**          | Done                                         |
| **Feature**         | [F04 Seller journey](../README.md)           |
| **Module(s)**       | `access`, `notifications` (registry, status) |
| **Security skills** | `security-access`, `security-notifications`  |

Start with `/implement-ticket F04-FIX-3`. Change requested by the client on 2026-10-08 (not a review finding).

## Problem

Creating an invitation only shows the private link (`/app/invitations/new`); staff have to copy it and email the seller themselves. The `invitation` template is `copyOnly` (`app/modules/notifications/registry.js`), so `send()` refuses it. The seller should get the invitation email automatically as soon as staff create the invitation.

## Scope

- [x] `invitation` becomes a sent template: remove `copyOnly`, keep `sensitive` (never queued, body never stored or logged), update its description, and fix its sample link to `/apps/classifieds/seller/sample`.
- [x] After `createInvitation()` commits, send `invitation` to the seller's address with `notifications.send()` (`seller_first_name`, `item_summary`, `invitation_link`, `invitation_expiry_date`, `staff_first_name`), keyed `invitation:<invitationId>` so a repeat sends nothing new. The link is https and is never logged.
- [x] The result screen says whether the email was sent. It still shows the copyable link once, as the fallback when the email failed (SES down, suppressed address).
- [x] The invitation screen (`/app/invitations/:id`, already exists) shows the email status: sent (with the time), not sent (send failed), or not delivered (the address bounced or is suppressed). `notifications` exports a small read for this, e.g. `getEmailStatus(idempotencyKey)` plus the existing `isSuppressed(address)`; it returns the status and time only, never a body.
- [x] **Resend invitation email** on that screen, for an invitation that is still open (not used, revoked or expired). Only the link's hash is stored, so a resend issues a new link, makes the old one invalid (as Get my link does, F04-T3) and sends it, keyed per resend. The screen warns staff that the earlier link stops working. A resend never changes the fee, the listing or the expiry date.
- [x] Resend is limited (default: 5 per invitation per day), is refused with a clear message for a suppressed address (the email cannot be delivered; staff must fix the address or copy the link), and writes an audit entry with the staff email.
- [x] A failed send never undoes the invitation. Record the outcome (sent or failed, no link) in the invitation's audit entry.
- [x] Update the F04 README, the template text in Settings → Emails if its wording says "copy", and `docs/product/overview.md` if it describes staff sending the link by hand.

## Out of scope

- Changing the seller's email address on an existing invitation (revoke it and create a new one).
- Removing an address from the suppression list.
- `notifications.renderTemplate()` (F03-FIX-3): no longer needed for the invitation.

## Acceptance criteria

- [x] Creating an invitation sends one `invitation` email to the seller with a working link; creating it twice by double submit sends one email.
- [x] When the send fails, the invitation exists, the screen says the email was not sent and shows the link to copy.
- [x] After a bounce (SES notice) the invitation screen shows "not delivered"; after a failed send it shows "not sent".
- [x] Resend sends a new working link and the old link no longer opens the listing; a confirmed device stays signed in; the 6th resend in a day and a resend on a used, revoked or expired invitation are refused.
- [x] The link appears in no log, no `EmailOutbox` body and no audit entry.
- [x] `npm run test:ai` is green for this feature.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Resend and the delivery status were added on 2026-10-08 at the client's request.
- 2026-10-08: on hold. Not to be built until it has been discussed with the client; the invitation stays copy-only for now. A plan exists (no schema change). Open points for that discussion: double-submit guard (in-memory or a column), whether failed resends count toward the 5 a day, whether a failed resend offers a copyable link, and that "sent" only means SES accepted the email.
- 2026-10-19: approved by the client; the hold is lifted. Answers to the open points: (1) double submit is stopped by the `invitation:<invitationId>` send key plus a one-time nonce on the create form, no schema change; (2) failed resends count toward the 5 a day; (3) a failed resend shows the new link once to copy; (4) "sent" means SES accepted the email, and the screen says so ("Sent (accepted by the mail service)").
- `EmailOutbox` rows are removed 30 days after they finish, so an older invitation shows no send status; a bounce still shows through the suppression list.

- This replaces the "copyable invitation email" part of F04-T1 and makes most of [F03-FIX-3](../../03-email-and-photos/tickets/F03-FIX-3.md) unnecessary; only its sample-link fix remains, and this ticket covers the `invitation` sample.
- Touches two modules (`access` and one registry entry in `notifications`); agreed as one ticket because the registry change has no use on its own.

### Built (2026-10-19)

- `access/services/invitation-email.js` (new): `sendInvitationEmail()`, `resendInvitation()`, `getInvitationEmailStatus()`. `createInvitation()` takes `formNonce`; `screens.js` sends after the commit and returns the email state; the routes `app.invitations.new` and `app.invitations.$id` show it, with Resend and its confirm modal.
- `notifications`: `invitation` is sent by the app (still `sensitive`), sample link `/apps/classifieds/seller/sample`; new `getEmailStatus(idempotencyKey)` (status and time only).
- No schema change, no new events. New audit actions: `InvitationEmailed` (every send: `kind`, `outcome`, `outboxId`; never the link) and `InvitationResent` (`invitationId`, `sendKey`). `InvitationCreated` details gain `formNonce`.
- DECISION: double-submit guard = the form's one-time code in the `InvitationCreated` audit details, checked under a Postgres advisory lock (same staff, last hour). A duplicate shows the email status and no link (the token isn't stored).
- DECISION: the resend limit is a rolling 24 hours, counted from `InvitationResent` rows under a per-invitation advisory lock; the row is written before the send, so failed sends count. Refused resends change nothing and write no audit entry.
- DECISION: each resend is keyed by a random `sendKey` kept in its `InvitationResent` row; the status line follows the latest send.
- Deviation: the suppressed-address refusal doesn't offer a link to copy (none is issued when a resend is refused); it tells staff to revoke and create one with the right address.
- `staff_first_name` comes from the online session's `associated_user.first_name` (empty when missing).
- The Settings → Emails "no test email" text no longer mentions copying; `docs/reference/email-default-content.md` §A and the `emails/defaults.js` comment now say the app sends it. `docs/product/overview.md` needed no change.
- Known: a seller's Get my link request also rotates the hash of an unused invitation (`SellerLinkReissued`), which can stop a just-resent link working; it doesn't count toward the resend limit.
- Tests: `access/tests/invitation-email-create.test.js`, `invitation-resend.test.js`, `invitation-email-security.test.js` (+ `invitation-email-helpers.js`), `notifications/tests/invitation-status.test.js`; the copy-only tests in `send.test.js` and `email-screens.test.js` now check the invitation is sent with its data unstored. access + notifications 290 passed, workspace 60 passed, lint OK.
- Manual QA only: the screen texts (resend warning, status lines) and the Settings → Emails wording. The SENDING and UNKNOWN states have no test.
- Follow-up (optional, unticketed): F03-FIX-3's `invitation` sample-link part is done here; only its other sample links remain.
