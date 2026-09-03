-- Derived-alert handling state. Alerts themselves stay computed at read time;
-- this table only records acknowledge / silence / close against a stable subjectKey.
-- Additive: no changes to Terminal, PrintTask, or Order.

CREATE TABLE "AlertDisposition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "subjectKey" TEXT NOT NULL,
  "alertType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "episodeToken" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "note" TEXT,
  "silencedUntil" DATETIME,
  "recoveredAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "AlertDisposition_subjectKey_key" ON "AlertDisposition"("subjectKey");
CREATE INDEX "AlertDisposition_alertType_subjectId_idx" ON "AlertDisposition"("alertType", "subjectId");
CREATE INDEX "AlertDisposition_recoveredAt_idx" ON "AlertDisposition"("recoveredAt");
