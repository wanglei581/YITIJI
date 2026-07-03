-- AlterTable
ALTER TABLE "User" ADD COLUMN "phoneHash" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");

-- CreateIndex
CREATE INDEX "User_phoneVerifiedAt_idx" ON "User"("phoneVerifiedAt");
