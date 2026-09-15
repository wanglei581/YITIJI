ALTER TABLE "ScanTask" ADD COLUMN "lastAttemptHash" TEXT;

CREATE INDEX "ScanTask_terminalId_lastAttemptHash_updatedAt_idx"
ON "ScanTask"("terminalId", "lastAttemptHash", "updatedAt");
