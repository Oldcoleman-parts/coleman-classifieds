-- AlterTable
ALTER TABLE "FeeCharge" ADD COLUMN     "appliedAt" TIMESTAMP(3);

-- Charges recorded before F06-FIX-2 were applied inside the webhook request.
UPDATE "FeeCharge" SET "appliedAt" = "createdAt" WHERE "status" = 'PAID';
