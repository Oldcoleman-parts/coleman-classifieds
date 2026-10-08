-- AlterTable
ALTER TABLE "WebhookReceipt" ADD COLUMN     "processedAt" TIMESTAMP(3);

-- Older receipts are past any Shopify retry: treat them as processed. Recent ones stay
-- unprocessed, so a delivery whose handler never finished is run again on retry.
UPDATE "WebhookReceipt" SET "processedAt" = "receivedAt" WHERE "receivedAt" < CURRENT_TIMESTAMP - INTERVAL '2 days';
