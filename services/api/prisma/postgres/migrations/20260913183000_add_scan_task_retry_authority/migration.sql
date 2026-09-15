-- Additive audit and authorization fields for a one-time, task-bound identical-content rescan.
ALTER TABLE "ScanTask" ADD COLUMN "retryOfScanTaskId" TEXT;
ALTER TABLE "ScanTask" ADD COLUMN "retryContentHash" TEXT;
ALTER TABLE "ScanTask" ADD COLUMN "retryConsumedAt" TIMESTAMP(3);
ALTER TABLE "ScanTask" ADD COLUMN "retryConsumedByScanTaskId" TEXT;

CREATE INDEX "ScanTask_retryOfScanTaskId_idx"
ON "ScanTask"("retryOfScanTaskId");

CREATE INDEX "ScanTask_retryConsumedByScanTaskId_idx"
ON "ScanTask"("retryConsumedByScanTaskId");
