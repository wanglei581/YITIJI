-- AlterTable
ALTER TABLE "Job" ADD COLUMN "rejectReason" TEXT;
ALTER TABLE "Job" ADD COLUMN "reviewedAt" DATETIME;
ALTER TABLE "Job" ADD COLUMN "reviewedBy" TEXT;
