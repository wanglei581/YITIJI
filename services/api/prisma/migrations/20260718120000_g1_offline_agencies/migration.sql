-- AlterTable: add missing columns to OfflineAgency
ALTER TABLE "OfflineAgency" ADD COLUMN "district" TEXT;
ALTER TABLE "OfflineAgency" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "OfflineAgency" ADD COLUMN "website" TEXT;
ALTER TABLE "OfflineAgency" ADD COLUMN "description" TEXT;
ALTER TABLE "OfflineAgency" ADD COLUMN "logoUrl" TEXT;

-- AlterTable: extend OfflineJob with structured fields
ALTER TABLE "OfflineJob" ADD COLUMN "jobType" TEXT NOT NULL DEFAULT 'fulltime';
ALTER TABLE "OfflineJob" ADD COLUMN "salaryMin" INTEGER;
ALTER TABLE "OfflineJob" ADD COLUMN "salaryMax" INTEGER;
ALTER TABLE "OfflineJob" ADD COLUMN "salaryUnit" TEXT NOT NULL DEFAULT 'month';
ALTER TABLE "OfflineJob" ADD COLUMN "description" TEXT;
ALTER TABLE "OfflineJob" ADD COLUMN "headcount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OfflineJob" ADD COLUMN "location" TEXT;
ALTER TABLE "OfflineJob" ADD COLUMN "education" TEXT;
ALTER TABLE "OfflineJob" ADD COLUMN "experience" TEXT;
