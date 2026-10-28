-- CreateIndex
CREATE INDEX "BuyerMessage_status_createdAt_idx" ON "BuyerMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BuyerMessage_buyerEmail_createdAt_idx" ON "BuyerMessage"("buyerEmail", "createdAt");

-- CreateIndex
CREATE INDEX "BuyerMessage_listingId_createdAt_idx" ON "BuyerMessage"("listingId", "createdAt");
