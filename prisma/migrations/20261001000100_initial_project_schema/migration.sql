-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('INVITED', 'DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED_AWAITING_PAYMENT', 'LIVE', 'PAUSED', 'PAYMENT_OVERDUE', 'SOLD', 'EXPIRED', 'REMOVED', 'REJECTED', 'LAPSED');

-- CreateEnum
CREATE TYPE "AccessSource" AS ENUM ('STAFF_INVITE', 'PUBLIC_SUBMISSION');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('OPEN', 'USED', 'CLOSED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OfferScope" AS ENUM ('FIRST_MONTH', 'ALL_RENEWALS');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('ONE_MONTH', 'AUTO_RENEW');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PauseReason" AS ENUM ('ORDINARY', 'INVESTIGATION');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('TECHNICAL_EXTENSION', 'INVESTIGATION_RESTORE');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('DELIVERED', 'HELD', 'RELEASED', 'DISCARDED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "Actor" AS ENUM ('STAFF', 'SELLER', 'BUYER', 'SYSTEM');

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "baseFeeCents" INTEGER NOT NULL DEFAULT 3000,
    "promoFeeCents" INTEGER,
    "paymentWindowDays" INTEGER NOT NULL DEFAULT 7,
    "paymentReminderDaysBefore" INTEGER NOT NULL DEFAULT 2,
    "inviteExpiryDays" INTEGER NOT NULL DEFAULT 30,
    "draftWindowDays" INTEGER NOT NULL DEFAULT 14,
    "draftReminderDaysBefore" INTEGER NOT NULL DEFAULT 3,
    "correctionWindowDays" INTEGER NOT NULL DEFAULT 14,
    "expiryReminderDays" INTEGER NOT NULL DEFAULT 3,
    "renewalReminderDays" INTEGER NOT NULL DEFAULT 3,
    "renewalGraceDays" INTEGER NOT NULL DEFAULT 7,
    "maxPhotos" INTEGER NOT NULL DEFAULT 12,
    "photoRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "recordsRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "heldMessageRules" JSONB NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "rulesText" TEXT NOT NULL,
    "emailCodeRequired" BOOLEAN NOT NULL DEFAULT true,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "renewalsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "openSubmissionsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "feeProductGid" TEXT,
    "feeVariantGid" TEXT,
    "sellingPlanGid" TEXT,
    "storefrontTokenEnc" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "source" "AccessSource" NOT NULL DEFAULT 'STAFF_INVITE',
    "tokenHash" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "sellerEmail" TEXT NOT NULL,
    "sellerPhone" TEXT,
    "itemSummary" TEXT NOT NULL,
    "feeRegularCents" INTEGER NOT NULL,
    "feeOfferedCents" INTEGER NOT NULL,
    "offerScope" "OfferScope" NOT NULL DEFAULT 'FIRST_MONTH',
    "status" "InvitationStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'INVITED',
    "title" TEXT,
    "description" TEXT,
    "askingPriceCents" INTEGER,
    "quantityAvailable" INTEGER,
    "availabilityNote" TEXT,
    "condition" TEXT,
    "knownIssues" TEXT,
    "contents" TEXT,
    "city" TEXT,
    "state" TEXT,
    "arrangements" TEXT[],
    "arrangementsNote" TEXT,
    "sellerDisplay" TEXT,
    "metaobjectGid" TEXT,
    "metaobjectHandle" TEXT,
    "billingMode" "BillingMode",
    "agreedRenewalCents" INTEGER,
    "discountCodeId" TEXT,
    "subscriptionContractGid" TEXT,
    "renewalOn" BOOLEAN NOT NULL DEFAULT false,
    "nextBillingAt" TIMESTAMP(3),
    "draftStartedAt" TIMESTAMP(3),
    "draftDueBy" TIMESTAMP(3),
    "changesRequestedAt" TIMESTAMP(3),
    "correctionDueBy" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "paymentDueBy" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pauseReason" "PauseReason",
    "overdueSince" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "refundFlag" BOOLEAN NOT NULL DEFAULT false,
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingTimeAdjustment" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "staff" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingTimeAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingPeriod" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "chargeId" TEXT,

    CONSTRAINT "ListingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeCharge" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderGid" TEXT,
    "billingAttemptGid" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingRevision" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "photoIds" TEXT[],
    "status" "RevisionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,

    CONSTRAINT "ListingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "publicKeyBase" TEXT,
    "position" INTEGER NOT NULL,
    "uploadedBy" "Actor" NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermsAcceptance" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LISTING_RULES',
    "rulesVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,

    CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerMessage" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "holdReasons" TEXT[],
    "sesMessageId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "listingId" TEXT,
    "actor" "Actor" NOT NULL,
    "actorRef" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCode" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "EmailCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "confirmTokenHash" TEXT,
    "unsubscribeTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertQueue" (
    "listingId" TEXT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "AlertQueue_pkey" PRIMARY KEY ("listingId")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EmailSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "senderName" TEXT NOT NULL DEFAULT 'Old Coleman Parts',
    "fromAddress" TEXT NOT NULL,
    "replyTo" TEXT,
    "staffNotify" TEXT[],
    "logoUrl" TEXT,
    "buttonColor" TEXT NOT NULL DEFAULT '#C8102E',
    "footerText" TEXT,
    "phone" TEXT,
    "supportEmail" TEXT,
    "postalAddress" TEXT NOT NULL,

    CONSTRAINT "EmailSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "OpsIncident" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "OpsIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_sellerEmail_idx" ON "Invitation"("sellerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_invitationId_key" ON "Listing"("invitationId");

-- CreateIndex
CREATE INDEX "Listing_status_idx" ON "Listing"("status");

-- CreateIndex
CREATE INDEX "Listing_expiresAt_idx" ON "Listing"("expiresAt");

-- CreateIndex
CREATE INDEX "Listing_purgeAfter_idx" ON "Listing"("purgeAfter");

-- CreateIndex
CREATE UNIQUE INDEX "ListingPeriod_chargeId_key" ON "ListingPeriod"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeCharge_orderGid_key" ON "FeeCharge"("orderGid");

-- CreateIndex
CREATE UNIQUE INDEX "FeeCharge_billingAttemptGid_key" ON "FeeCharge"("billingAttemptGid");

-- CreateIndex
CREATE INDEX "AuditEvent_listingId_at_idx" ON "AuditEvent"("listingId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "AlertSubscriber_email_key" ON "AlertSubscriber"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OpsIncident_key_key" ON "OpsIncident"("key");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingTimeAdjustment" ADD CONSTRAINT "ListingTimeAdjustment_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPeriod" ADD CONSTRAINT "ListingPeriod_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeCharge" ADD CONSTRAINT "FeeCharge_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingRevision" ADD CONSTRAINT "ListingRevision_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerMessage" ADD CONSTRAINT "BuyerMessage_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCode" ADD CONSTRAINT "EmailCode_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Retention purge role (used by F07 with SET LOCAL ROLE inside a transaction).
-- Roles are cluster-wide, so creation is guarded: dev, test and shadow databases share one cluster.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'classifieds_purge') THEN
    CREATE ROLE classifieds_purge NOLOGIN;
  END IF;
END $$;

-- AuditEvent is append-only: UPDATE, DELETE and TRUNCATE are rejected, except DELETE by the purge role.
CREATE FUNCTION audit_event_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'classifieds_purge' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AuditEvent is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();

CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_append_only();

-- Purge role grants: delete expired records, and anonymise rows that must stay linked to an order.
DO $$ BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO classifieds_purge', current_schema());
  EXECUTE format('GRANT classifieds_purge TO %I', current_user);
END $$;

GRANT SELECT, DELETE ON "AuditEvent", "FeeCharge", "ListingPeriod", "TermsAcceptance",
  "BuyerMessage", "Photo", "ListingRevision", "ListingTimeAdjustment", "EmailCode",
  "Listing", "Invitation" TO classifieds_purge;
GRANT UPDATE ON "Listing", "Invitation", "FeeCharge" TO classifieds_purge;

