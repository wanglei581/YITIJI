-- P1-2a AI 逐次计量账（每次真的发出的大模型请求一行），额度与将来收费的计量底座，见 src/ai/usage。
-- 只存元数据，不存正文 / 文件名 / 提示词；costCny 为空 = 取不到用量（不是 0）。
-- CreateTable
CREATE TABLE "AiUsageRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dayKey" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costCny" REAL,
    "costMeasured" BOOLEAN NOT NULL DEFAULT false,
    "terminalId" TEXT,
    "terminalVerified" BOOLEAN NOT NULL DEFAULT false,
    "orgId" TEXT,
    "endUserId" TEXT,
    CONSTRAINT "AiUsageRecord_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiUsageRecord_dayKey_idx" ON "AiUsageRecord"("dayKey");

-- CreateIndex
CREATE INDEX "AiUsageRecord_dayKey_terminalId_idx" ON "AiUsageRecord"("dayKey", "terminalId");

-- CreateIndex
CREATE INDEX "AiUsageRecord_dayKey_endUserId_idx" ON "AiUsageRecord"("dayKey", "endUserId");

-- CreateIndex
CREATE INDEX "AiUsageRecord_orgId_dayKey_idx" ON "AiUsageRecord"("orgId", "dayKey");

-- CreateIndex
CREATE INDEX "AiUsageRecord_endUserId_idx" ON "AiUsageRecord"("endUserId");

