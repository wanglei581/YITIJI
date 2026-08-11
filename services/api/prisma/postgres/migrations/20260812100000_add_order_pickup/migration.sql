-- M2 first slice: additive Order-only pickup lifecycle.
ALTER TABLE "Order"
  ADD COLUMN "sourceFileId" TEXT,
  ADD COLUMN "sourceFileSha256" TEXT,
  ADD COLUMN "sourceFileName" TEXT,
  ADD COLUMN "printParamsJson" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "pickupCodeHash" TEXT,
  ADD COLUMN "pickupCodeEnc" TEXT,
  ADD COLUMN "pickupCodeCreatedAt" TIMESTAMP(3),
  ADD COLUMN "pickupCodeExpiresAt" TIMESTAMP(3),
  ADD COLUMN "pickupStatus" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "pickupClaimedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_pickupCodeHash_key" ON "Order"("pickupCodeHash");
CREATE INDEX "Order_pickupStatus_pickupCodeExpiresAt_idx" ON "Order"("pickupStatus", "pickupCodeExpiresAt");
