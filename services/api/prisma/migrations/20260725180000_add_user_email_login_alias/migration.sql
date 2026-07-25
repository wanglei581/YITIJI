-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailHash" TEXT;
ALTER TABLE "User" ADD COLUMN "emailEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "emailVerifyMethod" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash");

-- CreateIndex
CREATE INDEX "User_emailVerifiedAt_idx" ON "User"("emailVerifiedAt");
