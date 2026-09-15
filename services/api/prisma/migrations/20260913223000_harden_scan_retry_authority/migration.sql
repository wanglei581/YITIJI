-- Fail before any structural DDL if existing lineage cannot satisfy the new one-to-one contract.
-- SQLite has no top-level RAISE(), so a deterministic integer overflow is used as the abort.
SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM "ScanTask"
    WHERE "retryOfScanTaskId" IS NOT NULL
    GROUP BY "retryOfScanTaskId"
    HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "ScanTask"
    WHERE "retryConsumedByScanTaskId" IS NOT NULL
    GROUP BY "retryConsumedByScanTaskId"
    HAVING COUNT(*) > 1
  )
  THEN abs(-9223372036854775808)
  ELSE 0
END;

ALTER TABLE "ScanTask" ADD COLUMN "retryAuthorityExpiresAt" DATETIME;

DROP INDEX IF EXISTS "ScanTask_retryOfScanTaskId_idx";
DROP INDEX IF EXISTS "ScanTask_retryConsumedByScanTaskId_idx";

CREATE UNIQUE INDEX "ScanTask_retryOfScanTaskId_key"
ON "ScanTask"("retryOfScanTaskId")
WHERE "retryOfScanTaskId" IS NOT NULL;

CREATE UNIQUE INDEX "ScanTask_retryConsumedByScanTaskId_key"
ON "ScanTask"("retryConsumedByScanTaskId")
WHERE "retryConsumedByScanTaskId" IS NOT NULL;
