ALTER TABLE "EndUser"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "statusChangedAt" TIMESTAMP(3),
  ADD COLUMN "closingRequestedAt" TIMESTAMP(3),
  ADD COLUMN "anonymizedAt" TIMESTAMP(3);

UPDATE "EndUser"
SET "status" = 'disabled',
    "statusChangedAt" = CURRENT_TIMESTAMP
WHERE "enabled" = false;

CREATE INDEX "EndUser_status_idx" ON "EndUser"("status");
