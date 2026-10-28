CREATE TABLE "AiServiceFact" (
    "id" TEXT NOT NULL,
    CONSTRAINT "AiServiceFact_pkey" PRIMARY KEY ("id"),
    "serviceType" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AiServiceFact_serviceType_serviceKey_key" ON "AiServiceFact"("serviceType", "serviceKey");
CREATE INDEX "AiServiceFact_orgId_occurredAt_idx" ON "AiServiceFact"("orgId", "occurredAt");
