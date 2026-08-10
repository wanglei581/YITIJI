-- Durable, PII-safe cloud receipt for expired `_unclaimed` scan deletion events.
-- Additive only: no existing table or column is rewritten or removed.
CREATE TABLE "TerminalScanDeletionAudit" (
  "terminalId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "identifierHash" TEXT NOT NULL,
  "eventCreatedAt" DATETIME NOT NULL,
  "deletedAt" DATETIME,
  "result" TEXT NOT NULL,
  "deleteAttempts" INTEGER NOT NULL,
  "lastDeleteAttemptAt" DATETIME NOT NULL,
  "lastErrorCode" TEXT,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,

  PRIMARY KEY ("terminalId", "eventId"),
  CONSTRAINT "TerminalScanDeletionAudit_terminalId_fkey"
    FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TerminalScanDeletionAudit_eventCreatedAt_idx"
  ON "TerminalScanDeletionAudit"("eventCreatedAt");

CREATE INDEX "TerminalScanDeletionAudit_result_updatedAt_idx"
  ON "TerminalScanDeletionAudit"("result", "updatedAt");
