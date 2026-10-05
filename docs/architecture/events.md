# Internal event contract

The event bus is in-process (payload shapes documented with JSDoc `@typedef`) and synchronous-with-queue. Handlers must be idempotent. Every event is written to `AuditEvent` before its handlers run. When a flag is off, the owning module doesn't subscribe.

| Event                                   | Publisher | Payload                                                 | Subscribers                                                      |
| --------------------------------------- | --------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| `InvitationCreated`                     | access    | invitationId, listingId                                 | console                                                          |
| `DraftStarted`                          | core      | listingId, draftDueBy                                   | notifications (none), scheduler                                  |
| `ListingSubmitted`                      | core      | listingId, kind: NEW \| CORRECTED                       | notifications (**instant staff notice**)                         |
| `RevisionSubmitted`                     | workspace | listingId, revisionId                                   | notifications (**instant staff notice**)                         |
| `ChangesRequested`                      | core      | listingId, note, correctionDueBy                        | notifications                                                    |
| `ListingRejected`                       | core      | listingId, note                                         | access, notifications                                            |
| `ListingApproved`                       | core      | listingId                                               | payments, notifications                                          |
| `PaymentReceived`                       | payments  | listingId, orderGid, billingMode                        | core                                                             |
| `ListingWentLive`                       | core      | listingId, firstTime: boolean, expiresAt                | media, publishing, notifications, **alerts (only if firstTime)** |
| `ListingUpdatedImmediate`               | workspace | listingId, fields                                       | publishing                                                       |
| `RevisionApproved` / `RevisionRejected` | core      | listingId, revisionId                                   | media, publishing, notifications                                 |
| `ListingPaused` / `ListingResumed`      | core      | listingId, reason, restoredMinutes?                     | publishing, renewals                                             |
| `ListingExtended`                       | core      | listingId, minutes, reason                              | publishing                                                       |
| `ListingPaymentOverdue`                 | core      | listingId, overdueSince                                 | publishing, notifications (Phase 2)                              |
| `ListingClosed`                         | core      | listingId, reason: SOLD \| REMOVED \| EXPIRED \| LAPSED | media, publishing, payments, renewals, access, notifications     |
| `BuyerMessageHeld`                      | contact   | messageId, listingId, reasons                           | notifications (**instant staff notice**)                         |
| `RenewalSucceeded` / `RenewalFailed`    | renewals  | listingId, chargeId                                     | core, notifications                                              |
| `FeatureToggled`                        | core      | flag, value, staff                                      | alerts, renewals, access                                         |
| `IncidentRaised`                        | ops       | incidentId, kind                                        | notifications (problem alert email)                              |

## Notes

- **Names and payload shapes** are defined in `app/modules/core/events.js` (`EVENTS` and the JSDoc typedefs). Publishing an unknown name throws.
- **Audit details are whitelisted per event:** only the payload fields listed above are stored in `AuditEvent.details`. Lifecycle events also store `transition`, `from` and `to`.
- **Lifecycle events** are recorded in the same transaction as the status change; handlers run after it commits. A handler that throws is logged (IDs and error type only) and doesn’t stop the others or undo the change.
- **A publish from inside a handler** is queued and runs after the current event’s handlers.
- **`ListingWentLive.firstTime`** is true only for the first payment. It is false after a renewal and after an overdue listing is paid.
- **A rejection publishes `ListingRejected` only**, not `ListingClosed` as well. The detailed close reason is in `Listing.closedReason`.
- **`ListingApproved`** is also published when staff re-issue a lapsed listing.
- **`PaymentReceived`, `RenewalSucceeded` and `RenewalFailed`** make core call `transition()` (PAY, RENEWAL_PAID, RENEWAL_FAILED). The renewal listeners exist only when `RENEWALS_RELEASED` is true.
