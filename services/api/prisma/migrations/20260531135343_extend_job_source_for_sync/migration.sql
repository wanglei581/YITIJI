-- AlterTable
ALTER TABLE "JobSource" ADD COLUMN "authType" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "encryptedCredential" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "endpoint" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "webhookSecret" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "webhookSecretRotatedAt" DATETIME;
