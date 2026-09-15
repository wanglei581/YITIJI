-- Two-phase scan delivery: Agent must not lease a waiting task until Kiosk
-- ACKs that it durably holds that task's control credentials.
ALTER TABLE "ScanTask" ADD COLUMN "deliveryAckedAt" DATETIME;

-- In-flight legacy waiting/matched rows were already leasable; keep them armed.
UPDATE "ScanTask"
SET "deliveryAckedAt" = "createdAt"
WHERE "status" IN ('waiting', 'matched')
  AND "deliveryAckedAt" IS NULL;

CREATE INDEX "ScanTask_terminalId_deliveryAckedAt_idx"
ON "ScanTask"("terminalId", "deliveryAckedAt");
