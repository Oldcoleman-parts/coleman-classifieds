-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "approvedAt" TIMESTAMP(3);

-- Photos that are already public were published before approval was recorded: treat them as approved.
UPDATE "Photo" SET "approvedAt" = "createdAt" WHERE "publicKeyBase" IS NOT NULL;
