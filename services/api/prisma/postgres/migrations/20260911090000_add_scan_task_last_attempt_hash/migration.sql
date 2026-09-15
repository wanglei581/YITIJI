-- AlterTable
ALTER TABLE "ScanTask" ADD COLUMN "lastAttemptHash" TEXT;

-- CreateIndex
CREATE INDEX "ScanTask_terminalId_lastAttemptHash_updatedAt_idx"
ON "ScanTask"("terminalId", "lastAttemptHash", "updatedAt");
