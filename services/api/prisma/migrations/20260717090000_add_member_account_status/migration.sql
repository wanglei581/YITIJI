ALTER TABLE "EndUser" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "EndUser" ADD COLUMN "statusChangedAt" DATETIME;
ALTER TABLE "EndUser" ADD COLUMN "closingRequestedAt" DATETIME;
ALTER TABLE "EndUser" ADD COLUMN "anonymizedAt" DATETIME;

UPDATE "EndUser"
SET "status" = 'disabled',
    "statusChangedAt" = CURRENT_TIMESTAMP
WHERE "enabled" = 0;

CREATE INDEX "EndUser_status_idx" ON "EndUser"("status");
