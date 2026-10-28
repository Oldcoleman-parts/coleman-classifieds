-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "failedTasks" TEXT[],
    "results" JSONB NOT NULL,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_finishedAt_idx" ON "JobRun"("finishedAt");
