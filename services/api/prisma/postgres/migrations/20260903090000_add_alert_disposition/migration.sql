-- Derived-alert handling state. Alerts themselves stay computed at read time;
-- this table only records acknowledge / silence / close against a stable subjectKey.
-- Additive: no changes to Terminal, PrintTask, or Order.

CREATE TABLE "AlertDisposition" (
  "id" TEXT NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "alertType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "episodeToken" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "note" TEXT,
  "silencedUntil" TIMESTAMP(3),
  "recoveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AlertDisposition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertDisposition_subjectKey_key" ON "AlertDisposition"("subjectKey");
CREATE INDEX "AlertDisposition_alertType_subjectId_idx" ON "AlertDisposition"("alertType", "subjectId");
CREATE INDEX "AlertDisposition_recoveredAt_idx" ON "AlertDisposition"("recoveredAt");
