-- 用量明细到期前打标；月汇总只有金额和次数，不含个人列。
-- AlterTable
ALTER TABLE "AiUsageRecord" ADD COLUMN "summarizedAt" DATETIME;

-- CreateTable
CREATE TABLE "AiUsageMonthlySummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthKey" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL,
    "measuredCostCny" REAL NOT NULL DEFAULT 0,
    "unmeasuredCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageMonthly_dims_key" ON "AiUsageMonthlySummary"("monthKey", "featureKey", "vendor", "model", "status");

-- CreateIndex
CREATE INDEX "AiUsageRecord_createdAt_idx" ON "AiUsageRecord"("createdAt");
