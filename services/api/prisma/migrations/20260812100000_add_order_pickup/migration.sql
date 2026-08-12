-- M2 first slice: additive Order-only pickup lifecycle.
ALTER TABLE "Order" ADD COLUMN "sourceFileId" TEXT;
ALTER TABLE "Order" ADD COLUMN "sourceFileSha256" TEXT;
ALTER TABLE "Order" ADD COLUMN "sourceFileName" TEXT;
ALTER TABLE "Order" ADD COLUMN "printParamsJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "Order" ADD COLUMN "pickupCodeHash" TEXT;
ALTER TABLE "Order" ADD COLUMN "pickupCodeEnc" TEXT;
ALTER TABLE "Order" ADD COLUMN "pickupCodeCreatedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "pickupCodeExpiresAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "pickupStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Order" ADD COLUMN "pickupClaimedAt" DATETIME;

CREATE UNIQUE INDEX "Order_pickupCodeHash_key" ON "Order"("pickupCodeHash");
CREATE INDEX "Order_pickupStatus_pickupCodeExpiresAt_idx" ON "Order"("pickupStatus", "pickupCodeExpiresAt");
