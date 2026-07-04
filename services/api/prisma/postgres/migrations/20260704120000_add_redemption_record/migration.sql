-- P1 权益核销：RedemptionRecord 新表（核销 SSOT）。
-- 全部 additive：仅 create table / create index；不 drop / 不 rename / 不改既有列。
-- 本批只用「平台 credit / 无 Order」子集：orderId 恒 null、amountCents 恒 0；
-- C5-4 在同一表 additive 扩展 Order 抵扣，禁重建第二套账本。

-- CreateTable
CREATE TABLE "RedemptionRecord" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT,
    "orderId" TEXT,
    "kind" TEXT NOT NULL,
    "benefitRef" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "serviceRefId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedemptionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RedemptionRecord_idempotencyKey_key" ON "RedemptionRecord"("idempotencyKey");

-- CreateIndex（一产物一核销硬不变量：同一 serviceType+serviceRefId 只能核销一次，防并发绕过）
CREATE UNIQUE INDEX "RedemptionRecord_serviceType_serviceRefId_key" ON "RedemptionRecord"("serviceType", "serviceRefId");

-- CreateIndex
CREATE INDEX "RedemptionRecord_endUserId_idx" ON "RedemptionRecord"("endUserId");

-- CreateIndex
CREATE INDEX "RedemptionRecord_benefitRef_idx" ON "RedemptionRecord"("benefitRef");
