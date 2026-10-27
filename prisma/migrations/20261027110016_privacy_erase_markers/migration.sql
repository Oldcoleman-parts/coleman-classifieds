-- CreateTable
CREATE TABLE "EmailSuppressionMarker" (
    "emailHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppressionMarker_pkey" PRIMARY KEY ("emailHash")
);

-- CreateTable
CREATE TABLE "ShopRedactJob" (
    "webhookId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "ShopRedactJob_pkey" PRIMARY KEY ("webhookId")
);
