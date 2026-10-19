# Internal event contract

The event bus is in-process (payload shapes documented with JSDoc `@typedef`) and synchronous-with-queue. Handlers must be idempotent. Every event is written to `AuditEvent` before its handlers run. When a flag is off, the owning module doesn't subscribe.

| Event                                | Publisher | Payload                                                 | Subscribers                                                      |
| ------------------------------------ | --------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| `InvitationCreated`                  | access    | invitationId, listingId                                 | console                                                          |
| `DraftStarted`                       | core      | listingId, draftDueBy                                   | notifications (none), scheduler                                  |
| `ListingSubmitted`                   | core      | listingId, kind: NEW \| CORRECTED                       | notifications (**instant staff notice**)                         |
| `RevisionSubmitted`                  | workspace | listingId, revisionId                                   | notifications (**instant staff notice**)                         |
| `ChangesRequested`                   | core      | listingId, note, correctionDueBy                        | — (console sends the email)                                      |
| `ListingRejected`                    | core      | listingId, note                                         | access (console sends the email)                                 |
| `ListingApproved`                    | core      | listingId, photoIds?                                    | payments, notifications, media                                   |
| `PaymentReceived`                    | payments  | listingId, orderGid, billingMode                        | core                                                             |
| `ListingWentLive`                    | core      | listingId, firstTime: boolean, expiresAt                | media, publishing, notifications, **alerts (only if firstTime)** |
| `ListingUpdatedImmediate`            | workspace | listingId, fields                                       | publishing                                                       |
| `RevisionApproved`                   | core      | listingId, revisionId, photoIds                         | media, workspace, publishing, notifications                      |
| `RevisionRejected`                   | core      | listingId, revisionId                                   | workspace, publishing (console sends the email)                  |
| `ListingPaused` / `ListingResumed`   | core      | listingId, reason, restoredMinutes?                     | publishing, renewals                                             |
| `ListingExtended`                    | core      | listingId, minutes, reason                              | publishing                                                       |
| `ListingPaymentOverdue`              | core      | listingId, overdueSince                                 | publishing, notifications (Phase 2)                              |
| `ListingClosed`                      | core      | listingId, reason: SOLD \| REMOVED \| EXPIRED \| LAPSED | media, publishing, payments, renewals, access, notifications     |
| `BuyerMessageHeld`                   | contact   | messageId, listingId, reasons                           | notifications (**instant staff notice**)                         |
| `RenewalSucceeded` / `RenewalFailed` | renewals  | listingId, chargeId                                     | core, notifications                                              |
| `FeatureToggled`                     | core      | flag, value, staff                                      | alerts, renewals, access                                         |
| `IncidentRaised`                     | ops       | incidentId, kind                                        | notifications (problem alert email)                              |

## Notes

- **Names and payload shapes** are defined in `app/modules/core/events.js` (`EVENTS` and the JSDoc typedefs). Publishing an unknown name throws.
- **Audit details are whitelisted per event:** only the payload fields listed above are stored in `AuditEvent.details`. Lifecycle events also store `transition`, `from` and `to`.
- **Lifecycle events** are recorded in the same transaction as the status change; handlers run after it commits. A handler that throws is logged (IDs and error type only) and doesn’t stop the others or undo the change.
- **`PaymentReceived` must succeed** (F01-FIX-1): if one of its handlers throws, `publish()` rejects with that error, after every handler and queued event has run. Payments must `await publish()` inside the `orders/paid` handler and let the rejection through, so the webhook answers 500 and Shopify retries. This is fixed per event in `core/events.js` (`MUST_SUCCEED`); no other event does it. If the event is published from inside another handler, the rejection reaches the outermost publish.
- **Recording inside your own transaction** (F01-FIX-4): call `recordEvent(tx, name, payload, options)` from `core/index.js` inside `prisma.$transaction`, return the result, and call `dispatch(recorded)` only after the transaction resolves. A rollback leaves no audit row and runs no handlers. Never `dispatch` inside the transaction. `dispatch` keeps the `PaymentReceived` must-succeed rule. Without a transaction, use `publish()`. `InvitationCreated` uses this pattern.
- **A publish from inside a handler** is queued and runs after the current event’s handlers.
- **`ListingWentLive.firstTime`** is true only for the first payment. It is false after a renewal and after an overdue listing is paid.
- **A rejection publishes `ListingRejected` only**, not `ListingClosed` as well. The detailed close reason is in `Listing.closedReason`.
- **`ListingApproved`** is also published when staff re-issue a lapsed listing. A re-issue carries no `photoIds`: it approves nothing new.
- **Only approved photos are published** (F03-FIX-2). `APPROVE` and `APPROVE_REVISION` must name the photos staff reviewed (`photoIds`, may be empty); media stores the approval on `Photo.approvedAt`. `ListingWentLive` re-publishes the approved set and carries no photo list.
- **Revision decisions** (F04-FIX-1): workspace copies an approved revision’s title and description into the listing and marks it APPROVED; on rejection it marks it REJECTED and deletes its never-approved photos (media doesn’t listen to `RevisionRejected`). Only a PENDING revision of that listing is decided, so a repeat changes nothing. Handlers run in subscription order: **publishing must register after workspace** (`app/bootstrap.server.js`) so it reads the copied text.
- **Staff notices** (`ListingSubmitted`, `RevisionSubmitted`, `BuyerMessageHeld`) are keyed on the event’s audit id, so a repeated event sends nothing new.
- **Seller decision emails** (F05-T1): the console sends `changes_requested`, `listing_rejected` and `revision_rejected` through `notifications.send()` right after the transition, keyed per decision (`changes_requested:<listingId>:<changesRequestedAt>`, `listing_rejected:<listingId>`, `revision_rejected:<revisionId>`). Notifications doesn't listen to these events. `revision_approved` is sent from F06, once a listing URL exists.
- **Payment emails** (F06-T1): payments listens to `ListingApproved` (an approval or a re-issue), creates the listing's single-use discount code and sends `approved_pay` itself through `notifications.send()`, keyed `approved_pay:<listingId>:<paymentDueBy>:<try>`. Notifications doesn't listen to `ListingApproved`. The handler never throws; the hourly `payments.approval-follow-up` task retries a failed code or email. On `ListingClosed` payments deletes the discount code.
- **`IncidentRaised`** has no listener until F08-T2: `ops` sends the `ops_incident` email itself through `notifications.send()`, because the event carries only the incident id and kind.
- **`PaymentReceived`, `RenewalSucceeded` and `RenewalFailed`** make core call `transition()` (PAY, RENEWAL_PAID, RENEWAL_FAILED). The renewal listeners exist only when `RENEWALS_RELEASED` is true.
- **What core does with `PaymentReceived`** (`core/payment.js`, F01-FIX-1): a listing awaiting payment goes live. A temporary failure (database, lock) rejects the publish and nothing is written. A repeat for a listing that is live or paused, or that closed after being live (`SOLD`, `REMOVED`, `EXPIRED` with `liveAt`), changes nothing. A payment that can never be applied (`LAPSED`, `REJECTED`, any status before approval, an invalid `billingMode`) sets `Listing.refundFlag` and writes one `PaymentNotApplied` audit entry (`orderGid`, `status`, `reason`); the publish resolves, so it is not retried, and a repeat writes nothing more.
