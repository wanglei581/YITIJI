-- Durable, PII-safe cloud receipt for expired `_unclaimed` scan deletion events.
-- Additive only: no existing table or column is rewritten or removed.
CREATE TABLE "TerminalScanDeletionAudit" (
  "terminalId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "identifierHash" TEXT NOT NULL,
  "eventCreatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "result" TEXT NOT NULL,
  "deleteAttempts" INTEGER NOT NULL,
  "lastDeleteAttemptAt" TIMESTAMP(3) NOT NULL,
  "lastErrorCode" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TerminalScanDeletionAudit_pkey" PRIMARY KEY ("terminalId", "eventId")
);

CREATE INDEX "TerminalScanDeletionAudit_eventCreatedAt_idx"
  ON "TerminalScanDeletionAudit"("eventCreatedAt");

CREATE INDEX "TerminalScanDeletionAudit_result_updatedAt_idx"
  ON "TerminalScanDeletionAudit"("result", "updatedAt");

ALTER TABLE "TerminalScanDeletionAudit"
  ADD CONSTRAINT "TerminalScanDeletionAudit_terminalId_fkey"
  FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
