# Internal event contract

The event bus is in-process (payload shapes documented with JSDoc `@typedef`) and synchronous-with-queue. Handlers must be idempotent. Every event is written to `AuditEvent` before its handlers run. When a flag is off, the owning module doesn't subscribe.

| Event                                   | Publisher | Payload                             | Subscribers                                                      |
| --------------------------------------- | --------- | ----------------------------------- | ---------------------------------------------------------------- |
| `InvitationCreated`                     | access    | invitationId, listingId             | console                                                          |
| `DraftStarted`                          | core      | listingId, draftDueBy               | notifications (none), scheduler                                  |
| `ListingSubmitted`                      | core      | listingId, kind: NEW \| CORRECTED   | notifications (**instant staff notice**)                         |
| `RevisionSubmitted`                     | workspace | listingId, revisionId               | notifications (**instant staff notice**)                         |
| `ChangesRequested`                      | core      | listingId, note, correctionDueBy    | notifications                                                    |
| `ListingRejected`                       | core      | listingId, note                     | access, notifications                                            |
| `ListingApproved`                       | core      | listingId                           | payments, notifications                                          |
| `PaymentReceived`                       | payments  | listingId, orderGid, billingMode    | core                                                             |
| `ListingWentLive`                       | core      | listingId, firstTime: boolean       | media, publishing, notifications, **alerts (only if firstTime)** |
| `ListingUpdatedImmediate`               | workspace | listingId, fields                   | publishing                                                       |
| `RevisionApproved` / `RevisionRejected` | core      | listingId, revisionId               | media, publishing, notifications                                 |
| `ListingPaused` / `ListingResumed`      | core      | listingId, reason, restoredMinutes? | publishing, renewals                                             |
| `ListingExtended`                       | core      | listingId, minutes, reason          | publishing                                                       |
| `ListingClosed`                         | core      | listingId, reason                   | media, publishing, payments, renewals, access, notifications     |
| `BuyerMessageHeld`                      | contact   | messageId, listingId, reasons       | notifications (**instant staff notice**)                         |
| `RenewalSucceeded` / `RenewalFailed`    | renewals  | listingId, chargeId                 | core, notifications                                              |
| `FeatureToggled`                        | core      | flag, value, staff                  | alerts, renewals, access                                         |
| `IncidentRaised`                        | ops       | incidentId, kind                    | notifications (problem alert email)                              |
