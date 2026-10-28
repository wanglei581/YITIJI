CREATE TABLE "AiServiceFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceType" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AiServiceFact_serviceType_serviceKey_key" ON "AiServiceFact"("serviceType", "serviceKey");
CREATE INDEX "AiServiceFact_orgId_occurredAt_idx" ON "AiServiceFact"("orgId", "occurredAt");
