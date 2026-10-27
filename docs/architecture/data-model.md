# Data model and listing lifecycle

**This is the single source of truth.** Change it with `/schema-change`, in the same commit as the Prisma migration.

## Shopify metaobject `classified_listing` (public data only)

Capabilities: **publishable** and **online store** (URL `/pages/classified-listing/{handle}`). Created by the app on first use (`publishing`, F06-T2). A closed listing keeps its entry with only `title`, `public_status=closed` and `listing_ref` until photo retention ends.

| Field                                     | Type                  | Notes                                                 |
| ----------------------------------------- | --------------------- | ----------------------------------------------------- |
| `title`, `condition`                      | single_line_text      |                                                       |
| `description`, `known_issues`, `contents` | multi_line_text       | `contents` = what's included or remaining             |
| `asking_price`                            | money                 |                                                       |
| `quantity_available`                      | number_integer        | optional; updated immediately by the seller           |
| `availability_note`                       | single_line_text      | e.g. "3 of 11 lanterns left"; updated immediately     |
| `city`, `state`                           | single_line_text      |                                                       |
| `arrangements`                            | list.single_line_text | pickup / shipping / other                             |
| `arrangements_note`                       | single_line_text      |                                                       |
| `photos`                                  | list.url              | CloudFront `_large` URLs; the first is the main photo |
| `seller_display`                          | single_line_text      | first name or "Private seller"                        |
| `public_status`                           | single_line_text      | `live` \| `closed`                                    |
| `live_at`, `expires_at`                   | date_time             |                                                       |
| `listing_ref`                             | single_line_text      | the app's Listing id                                  |

Shop metafield `classifieds.live_count` (integer, storefront readable) controls the header button.

## Prisma schema

The template’s `Session` model (from `shopify app init`) stays exactly as generated and isn’t repeated below. The datasource changes from SQLite to `postgresql` in F01-T1.

```prisma
enum ListingStatus {
  INVITED
  DRAFT
  SUBMITTED                  // needs review (new or corrected)
  CHANGES_REQUESTED
  APPROVED_AWAITING_PAYMENT
  LIVE
  PAUSED
  PAYMENT_OVERDUE            // Phase 2: renewal failed, hidden, 7-day window
  SOLD
  EXPIRED                    // month ended, or draft/correction/renewal window passed
  REMOVED
  REJECTED
  LAPSED                     // approved but unpaid within 7 days
}
enum AccessSource    { STAFF_INVITE PUBLIC_SUBMISSION }
enum InvitationStatus { OPEN USED CLOSED REVOKED EXPIRED }
enum OfferScope      { FIRST_MONTH ALL_RENEWALS }
enum BillingMode     { ONE_MONTH AUTO_RENEW }
enum RevisionStatus  { PENDING APPROVED REJECTED }
enum PauseReason     { ORDINARY INVESTIGATION }
enum AdjustmentType  { TECHNICAL_EXTENSION INVESTIGATION_RESTORE }
enum MessageStatus   { DELIVERED HELD RELEASED DISCARDED BLOCKED }
enum Actor           { STAFF SELLER BUYER SYSTEM }

model Settings {
  id                        Int     @id @default(1)
  baseFeeCents              Int     @default(3000)
  promoFeeCents             Int?
  paymentWindowDays         Int     @default(7)
  paymentReminderDaysBefore Int     @default(2)
  inviteExpiryDays          Int     @default(30)
  draftWindowDays           Int     @default(14)
  draftReminderDaysBefore   Int     @default(3)
  correctionWindowDays      Int     @default(14)
  expiryReminderDays        Int     @default(3)
  renewalReminderDays       Int     @default(3)
  renewalGraceDays          Int     @default(7)
  maxPhotos                 Int     @default(12)
  photoRetentionDays        Int     @default(90)
  recordsRetentionDays      Int     @default(365)   // payment + agreement records + history
  heldMessageRules          Json                     // { holdOnLinks, keywords[], repeatThreshold }
  rulesVersion              String
  rulesText                 String                   // OCP listing rules incl. refund & removal policy
  emailCodeRequired         Boolean @default(true)
  alertsEnabled             Boolean @default(true)   // Phase 1
  renewalsEnabled           Boolean @default(false)  // Phase 2
  openSubmissionsEnabled    Boolean @default(false)  // Later
  feeProductGid             String?
  feeVariantGid             String?
  sellingPlanGid            String?
  storefrontTokenEnc        String?
  updatedAt                 DateTime @updatedAt
}

model Invitation {
  id              String           @id @default(cuid())
  source          AccessSource     @default(STAFF_INVITE)
  tokenHash       String           @unique
  sellerName      String
  sellerEmail     String
  sellerPhone     String?
  itemSummary     String
  feeRegularCents Int                                   // locked at creation
  feeOfferedCents Int                                   // locked at creation
  offerScope      OfferScope       @default(FIRST_MONTH)
  status          InvitationStatus @default(OPEN)
  expiresAt       DateTime
  createdBy       String?
  createdAt       DateTime         @default(now())
  listing         Listing?
  emailCodes      EmailCode[]
  @@index([sellerEmail])
}

model Listing {
  id                  String        @id @default(cuid())
  invitationId        String        @unique              // one link = one listing
  invitation          Invitation    @relation(fields: [invitationId], references: [id])
  status              ListingStatus @default(INVITED)
  title               String?
  description         String?
  askingPriceCents    Int?
  quantityAvailable   Int?
  availabilityNote    String?
  condition           String?
  knownIssues         String?
  contents            String?
  city                String?
  state               String?
  arrangements        String[]
  arrangementsNote    String?
  sellerDisplay       String?
  metaobjectGid       String?
  metaobjectHandle    String?
  billingMode         BillingMode?
  agreedRenewalCents  Int?                               // Phase 2 price lock
  discountCodeId      String?
  subscriptionContractGid String?
  renewalOn           Boolean       @default(false)
  nextBillingAt       DateTime?
  draftStartedAt      DateTime?
  draftDueBy          DateTime?
  changesRequestedAt  DateTime?
  correctionDueBy     DateTime?
  approvedAt          DateTime?
  paymentDueBy        DateTime?
  liveAt              DateTime?
  expiresAt           DateTime?
  pausedAt            DateTime?
  pauseReason         PauseReason?
  overdueSince        DateTime?                          // Phase 2
  closedAt            DateTime?
  closedReason        String?
  refundFlag          Boolean       @default(false)
  purgeAfter          DateTime?                          // closedAt + recordsRetentionDays
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt
  photos              Photo[]
  revisions           ListingRevision[]
  periods             ListingPeriod[]
  charges             FeeCharge[]
  terms               TermsAcceptance[]
  messages            BuyerMessage[]
  adjustments         ListingTimeAdjustment[]
  audit               AuditEvent[]
  @@index([status])
  @@index([expiresAt])
  @@index([purgeAfter])
}

model ListingTimeAdjustment {
  id         String         @id @default(cuid())
  listingId  String
  listing    Listing        @relation(fields: [listingId], references: [id])
  type       AdjustmentType
  minutes    Int
  reason     String
  staff      String
  at         DateTime       @default(now())
}

model ListingPeriod {
  id        String   @id @default(cuid())
  listingId String
  listing   Listing  @relation(fields: [listingId], references: [id])
  startsAt  DateTime
  endsAt    DateTime
  chargeId  String?  @unique
}

model FeeCharge {
  id                String   @id @default(cuid())
  listingId         String
  listing           Listing  @relation(fields: [listingId], references: [id])
  kind              String   // INITIAL | RENEWAL
  orderGid          String?  @unique
  billingAttemptGid String?  @unique
  amountCents       Int
  status            String   // PENDING | PAID | FAILED | REFUNDED
  createdAt         DateTime @default(now())
  appliedAt         DateTime? // set when the apply step finished (F06-FIX-2)
}

model ListingRevision {
  id        String         @id @default(cuid())
  listingId String
  listing   Listing        @relation(fields: [listingId], references: [id])
  changes   Json
  photoIds  String[]
  status    RevisionStatus @default(PENDING)
  createdAt DateTime       @default(now())
  decidedAt DateTime?
  decidedBy String?
}

model Photo {
  id            String    @id @default(cuid())
  listingId     String
  listing       Listing   @relation(fields: [listingId], references: [id])
  privateKey    String
  publicKeyBase String?
  position      Int
  uploadedBy    Actor
  width         Int?
  height        Int?
  approvedAt    DateTime? // staff approved this photo (ListingApproved/RevisionApproved photoIds); only approved photos are published
  deletedAt     DateTime?
  createdAt     DateTime  @default(now())
}

model TermsAcceptance {
  id           String   @id @default(cuid())
  listingId    String
  listing      Listing  @relation(fields: [listingId], references: [id])
  kind         String   @default("LISTING_RULES")   // LISTING_RULES | RENEWAL_CONSENT (Phase 2)
  rulesVersion String
  acceptedAt   DateTime @default(now())
  ip           String
  userAgent    String
}

model BuyerMessage {
  id          String        @id @default(cuid())
  listingId   String
  listing     Listing       @relation(fields: [listingId], references: [id])
  buyerName   String
  buyerEmail  String
  body        String
  ip          String
  status      MessageStatus
  holdReasons String[]
  sesMessageId String?
  reviewedBy  String?
  reviewedAt  DateTime?
  createdAt   DateTime      @default(now())
  @@index([status, createdAt])     // held list (F07-T1)
  @@index([buyerEmail, createdAt]) // repeat-send rule
  @@index([listingId, createdAt])
}

model AuditEvent {                // APPEND-ONLY: DB trigger rejects UPDATE/DELETE except retention purge role
  id        String   @id @default(cuid())
  listingId String?
  listing   Listing? @relation(fields: [listingId], references: [id])
  actor     Actor
  actorRef  String?
  action    String
  details   Json?
  at        DateTime @default(now())
  @@index([listingId, at])
  @@index([action, at])           // ops' windowed count of PageRetireFailed (F08-FIX-4)
}

model EmailCode {
  id           String     @id @default(cuid())
  invitationId String
  invitation   Invitation @relation(fields: [invitationId], references: [id])
  codeHash     String
  attempts     Int        @default(0)
  expiresAt    DateTime
  usedAt       DateTime?
}

model AlertSubscriber {
  id                   String    @id @default(cuid())
  email                String    @unique
  confirmedAt          DateTime?
  unsubscribedAt       DateTime?
  confirmTokenHash     String?
  unsubscribeTokenHash String
  createdAt            DateTime  @default(now())
}

model AlertQueue {               // first go-live only; edits/renewals never enqueue
  listingId String   @id
  queuedAt  DateTime @default(now())
  sentAt    DateTime?
}

model EmailTemplate {
  key       String   @id
  subject   String
  bodyHtml  String
  version   Int      @default(1)
  updatedBy String?
  updatedAt DateTime @updatedAt
}

model EmailSettings {
  id            Int      @id @default(1)
  senderName    String   @default("Old Coleman Parts")
  fromAddress   String
  replyTo       String?
  staffNotify   String[]            // staff notification address(es), set in Settings
  logoUrl       String?
  buttonColor   String   @default("#C8102E")
  footerText    String?
  phone         String?
  supportEmail  String?
  postalAddress String
}

model EmailSuppression {
  email     String   @id
  reason    String
  createdAt DateTime @default(now())
}

model EmailOutbox {               // the send queue; rows are purged 30 days after they finish
  id             String    @id @default(cuid())
  templateKey    String
  stream         String               // transactional | alerts
  toAddress      String
  replyTo        String?
  vars           Json?                // never stored for emails that carry a code or private link; cleared once sent
  status         String    @default("PENDING") // PENDING | SENDING | SENT | FAILED | DEAD | SUPPRESSED
  attempts       Int       @default(0)
  nextAttemptAt  DateTime  @default(now())
  lastErrorCode  String?
  sesMessageId   String?
  idempotencyKey String?   @unique   // a second send with the same key is skipped
  createdAt      DateTime  @default(now())
  sentAt         DateTime?

  @@index([status, nextAttemptAt])
}

model JobRun {                   // one row per /jobs/run (F08-T1); counts only, kept 30 days
  id          String   @id @default(cuid())
  startedAt   DateTime
  finishedAt  DateTime
  ok          Boolean
  failedTasks String[]
  results     Json     // [{ task, ok, durationMs, summary?, error? }]
  partial     Boolean  @default(false) // a ?task= recovery run (F08-FIX-2); getLastRun() skips it

  @@index([finishedAt])
}

model OpsIncident {              // problem alerts, de-duplicated by key
  id         String   @id @default(cuid())
  key        String   @unique      // e.g. "unmatched-order:<orderGid>"
  kind       String               // PAYMENT | PUBLISHING | EMAIL | JOB | BACKUP
  message    String
  details    Json?
  firstSeen  DateTime @default(now())
  lastSeen   DateTime @default(now())
  resolvedAt DateTime?
  notifiedAt DateTime?
}

model WebhookReceipt {
  id          String    @id
  topic       String
  receivedAt  DateTime  @default(now()) // start of the current claim; reset on take-over
  processedAt DateTime? // set only after the handler succeeded
}
```

### Database-level rules (raw SQL in the initial migration)

- **`AuditEvent` is append-only.** The trigger function `audit_event_append_only()` rejects UPDATE, DELETE and TRUNCATE on `AuditEvent` (SQLSTATE `42501`). The only exception is DELETE by the purge role, and only of a row past retention (F08-T4, migration `audit_purge_past_retention`): a row with a listing once that listing's `purgeAfter <= now()`; a row with no listing once `at <= now() - Settings.recordsRetentionDays` (365 if unset). Everything else is still rejected, so the age rule is enforced by the database.
- **Purge role `classifieds_purge`** (no login, no password): the records purge (F08-T4, `ops.purge-records`) runs as this role with `SET LOCAL ROLE classifieds_purge` inside one transaction per listing (core `runAsPurgeRole()`). It can SELECT and DELETE listing records and `AlertQueue`, SELECT `Settings` (read by the trigger), and UPDATE only `Listing`, `Invitation` and `FeeCharge` (to anonymise).
- Records purge delete order per listing: `AuditEvent`, `Photo` (all with `deletedAt` set), `ListingRevision`, `TermsAcceptance`, `ListingPeriod`, `FeeCharge`, `BuyerMessage`, `AlertQueue`, `ListingTimeAdjustment`, `Listing`, `EmailCode`, `Invitation`. `EmailOutbox`, `JobRun` and `OpsIncident` may name a listing id but have no FK and expire on their own (30 days, 30 days, resolved incidents: no rule yet).
- Global audit retention: listing-less rows past retention are deleted, except `SettingsUpdated` rows whose `details.changes.rulesVersion.to` is the current rules version or one a kept `TermsAcceptance` refers to. `RecordsPurged` (SYSTEM, counts only) is written once per run that purged something.
- Deleting a `Listing` sets `AuditEvent.listingId` to null, which is an UPDATE and is rejected. The purge must delete a listing’s audit rows (as the purge role) before the listing.
- Ops audit actions (F08-FIX-1, F08-FIX-4): `PageRetireFailed` (`{ code }`, SYSTEM) on each failed page retirement; `PageRetireHeld` (`{ failures }`, SYSTEM) when a listing reaches 3 failures in 7 days and is held, at most one per listing per 7-day window.

## Listing state machine

| From                      | Event                                          | To                        | Actor          | Side effects                                                                                                        |
| ------------------------- | ---------------------------------------------- | ------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| —                         | staff creates invitation                       | INVITED                   | STAFF          | token, locked fee and offer scope, `expiresAt = +30d`                                                               |
| INVITED                   | seller opens link (verified)                   | DRAFT                     | SELLER         | `draftStartedAt`, `draftDueBy = +14d`                                                                               |
| INVITED                   | 30 days unused                                 | INVITED (record closed)   | SYSTEM         | close link (invitation EXPIRED); `closeUnusedListing()`: `closedReason = INVITATION_EXPIRED`, `purgeAfter`          |
| INVITED                   | staff revokes the unused link                  | INVITED (record closed)   | STAFF          | close link (invitation REVOKED); `closeUnusedListing()`: `closedReason = INVITATION_REVOKED`, `purgeAfter`          |
| DRAFT                     | seller submits (rules accepted)                | SUBMITTED                 | SELLER         | TermsAcceptance (same transaction); **instant staff notice**; refused once `draftDueBy` has passed                  |
| DRAFT                     | `draftDueBy` passes                            | EXPIRED                   | SYSTEM         | close link; email seller                                                                                            |
| SUBMITTED                 | request changes                                | CHANGES_REQUESTED         | STAFF          | `correctionDueBy = +14d`; email seller                                                                              |
| CHANGES_REQUESTED         | seller resubmits                               | SUBMITTED                 | SELLER         | TermsAcceptance (same transaction); **instant staff notice (corrected)**; refused once `correctionDueBy` has passed |
| CHANGES_REQUESTED         | `correctionDueBy` passes                       | EXPIRED                   | SYSTEM         | close link                                                                                                          |
| SUBMITTED                 | reject                                         | REJECTED                  | STAFF          | close link; nothing charged                                                                                         |
| SUBMITTED                 | approve                                        | APPROVED_AWAITING_PAYMENT | STAFF          | discount code; `paymentDueBy = +7d`; pay email                                                                      |
| APPROVED_AWAITING_PAYMENT | paid (`orders/paid`)                           | LIVE                      | SYSTEM         | fulfil silently; publish; `expiresAt = addMonths(liveAt,1)`; period; live count; **enqueue alert**                  |
| APPROVED_AWAITING_PAYMENT | 7 days pass                                    | LAPSED                    | SYSTEM         | delete discount; staff may re-issue                                                                                 |
| LAPSED                    | staff re-issues                                | APPROVED_AWAITING_PAYMENT | STAFF          | new `paymentDueBy = +7d`; clears `closedAt`, `closedReason`, `purgeAfter`; new discount code and pay email          |
| LIVE                      | price / quantity / availability / remove photo | LIVE                      | SELLER         | immediate metaobject update, no review                                                                              |
| LIVE                      | title / description / add or replace photo     | LIVE + PENDING revision   | SELLER         | approved version stays public; **instant staff notice (edit)**                                                      |
| LIVE                      | revision approved                              | LIVE                      | STAFF          | apply; **no change to `expiresAt`**; never reopens closed listings                                                  |
| LIVE                      | revision rejected                              | LIVE                      | STAFF          | approved version stays public; email seller                                                                         |
| LIVE                      | pause (ORDINARY / INVESTIGATION)               | PAUSED                    | STAFF          | unpublish; `pausedAt`, `pauseReason`                                                                                |
| PAUSED                    | resume                                         | LIVE                      | STAFF          | republish; if INVESTIGATION with no violation → INVESTIGATION_RESTORE adjustment, `expiresAt += paused minutes`     |
| LIVE / PAUSED             | extend (technical)                             | same                      | STAFF          | TECHNICAL_EXTENSION adjustment; `expiresAt += N days`                                                               |
| LIVE / PAUSED             | sold / removed                                 | SOLD / REMOVED            | SELLER / STAFF | unpublish; close link; cancel renewal                                                                               |
| LIVE                      | `expiresAt` reached, no renewal                | EXPIRED                   | SYSTEM         | unpublish (closed page)                                                                                             |
| LIVE                      | renewal paid (Phase 2)                         | LIVE                      | SYSTEM         | `expiresAt += 1 month`; new period; no alert                                                                        |
| LIVE                      | renewal failed at month end (Phase 2)          | PAYMENT_OVERDUE           | SYSTEM         | hide; `overdueSince`                                                                                                |
| PAYMENT_OVERDUE           | paid within 7 days                             | LIVE                      | SYSTEM         | `liveAt = now`, `expiresAt = addMonths(now,1)`; no alert                                                            |
| PAYMENT_OVERDUE           | 7 days pass                                    | EXPIRED                   | SYSTEM         | cancel contract; stop retries                                                                                       |

Terminal: SOLD, EXPIRED, REMOVED, REJECTED, LAPSED (only LAPSED can be re-issued by staff). On entering a terminal state set `closedAt`, `closedReason` and `purgeAfter = closedAt + recordsRetentionDays`. An unused invitation (expired or revoked) closes its INVITED listing record the same way, without a status change and without `ListingClosed` (F01-FIX-3).

### How `transition()` reads this table (F01-T2)

The code is `app/modules/core/lifecycle.js`. Event names: `OPEN`, `SUBMIT`, `REQUEST_CHANGES`, `REJECT`, `APPROVE`, `REISSUE`, `PAY`, `LAPSE`, `APPROVE_REVISION`, `REJECT_REVISION`, `PAUSE`, `RESUME`, `EXTEND`, `MARK_SOLD`, `REMOVE`, `EXPIRE`, `RENEWAL_PAID`, `RENEWAL_FAILED`.

- **Not status changes:** creating an invitation, an invitation expiring or being revoked unused (the listing stays INVITED; core `closeUnusedListing()` sets `closedAt`, `closedReason` and `purgeAfter` under the row lock and writes one `InvitationExpired` / `InvitationRevoked` audit entry, F01-FIX-3) and the two seller live-edit rows. A closed INVITED record refuses every event. Their owning modules handle them.
- **Side effects in other modules** (discount code, emails, publishing, the period row) are done by the modules that subscribe to the event, not by core. `TermsAcceptance` is the exception: workspace writes it through `transition()`'s `beforeCommit(tx, listing)` hook, in the same transaction as `SUBMIT`, so a refused submit leaves none (F01-FIX-6).
- **Timed events** (`EXPIRE`, `LAPSE`) are SYSTEM-only and are refused until the deadline has passed.
- **SUBMIT deadline** (F01-FIX-6): `SUBMIT` is refused once `draftDueBy` (DRAFT) or `correctionDueBy` (CHANGES_REQUESTED) has passed (`deadline <= now`, the moment `EXPIRE` becomes allowed). No deadline set never blocks.
- **Revisions** can be approved or rejected only while LIVE. Neither changes `expiresAt`.
- **Sold / removed:** either the seller or staff may mark a listing sold or remove it.
- **A paused listing doesn’t expire.** It expires on the first job run after it is resumed, if its end date has passed.
- **Resume after an investigation** needs staff to say whether there was a violation. Without one, the paused time is restored in whole minutes, rounded down.
- **Technical extensions** are given in minutes, from 1 minute to 60 days at a time, with a reason.
- **Day windows** (`+7d`, `+14d`, retention) are fixed 24-hour blocks. Only the listing month uses calendar maths (`addMonths` in `SHOP_TIMEZONE`).
- **Phase 2:** `RENEWAL_PAID` and `RENEWAL_FAILED` are refused while the renewals flag is off. A listing already in PAYMENT_OVERDUE can still be paid or expire.
- **`closedReason` values:** `DRAFT_NOT_SUBMITTED`, `CORRECTION_NOT_SUBMITTED`, `REJECTED`, `PAYMENT_WINDOW_PASSED`, `SOLD`, `REMOVED`, `MONTH_ENDED`, `RENEWAL_NOT_PAID`, and for a closed INVITED record `INVITATION_EXPIRED`, `INVITATION_REVOKED`.
- **Photo approval (F03-FIX-2):** only photos with `Photo.approvedAt` set are published or returned by `getPublicUrls()`. `APPROVE` and `APPROVE_REVISION` must carry `photoIds` (the photos staff reviewed; may be empty), which go out on `ListingApproved` / `RevisionApproved`; media stamps `approvedAt` from them. `ListingRevision.photoIds` are the photos a revision adds. `REISSUE` approves nothing new, and `ListingWentLive` (payment, renewal) re-publishes the already approved set.
