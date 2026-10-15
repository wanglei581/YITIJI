ALTER TABLE "BenefitGrant" ADD COLUMN "serviceKey" TEXT;
CREATE TABLE "AiQuotaDaily" (
  "endUserId" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AiQuotaDaily_pkey" PRIMARY KEY ("endUserId", "bucket", "day")
);
CREATE TABLE "AiQuotaReservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "operationKey" TEXT NOT NULL,
  "endUserId" TEXT,
  "terminalId" TEXT,
  "bucket" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "benefitGrantId" TEXT,
  "resultRef" TEXT,
  "status" TEXT NOT NULL,
  "reservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" DATETIME
);
CREATE UNIQUE INDEX "AiQuotaReservation_operationKey_key" ON "AiQuotaReservation"("operationKey");
CREATE INDEX "AiQuotaReservation_endUserId_bucket_day_idx" ON "AiQuotaReservation"("endUserId", "bucket", "day");
CREATE INDEX "AiQuotaReservation_status_reservedAt_idx" ON "AiQuotaReservation"("status", "reservedAt");
