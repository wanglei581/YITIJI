-- AlterTable
ALTER TABLE "BenefitGrant" ADD COLUMN     "serviceKey" TEXT;

-- CreateTable
CREATE TABLE "AiQuotaDaily" (
    "endUserId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiQuotaDaily_pkey" PRIMARY KEY ("endUserId","bucket","day")
);

-- CreateTable
CREATE TABLE "AiQuotaReservation" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "endUserId" TEXT,
    "terminalId" TEXT,
    "bucket" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "benefitGrantId" TEXT,
    "resultRef" TEXT,
    "status" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "AiQuotaReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiQuotaReservation_operationKey_key" ON "AiQuotaReservation"("operationKey");

-- CreateIndex
CREATE INDEX "AiQuotaReservation_endUserId_bucket_day_idx" ON "AiQuotaReservation"("endUserId", "bucket", "day");

-- CreateIndex
CREATE INDEX "AiQuotaReservation_status_reservedAt_idx" ON "AiQuotaReservation"("status", "reservedAt");

