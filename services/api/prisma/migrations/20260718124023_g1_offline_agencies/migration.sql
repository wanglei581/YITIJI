/*
  Warnings:

  - You are about to drop the column `salary` on the `OfflineJob` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BenefitActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "rulesText" TEXT,
    "benefitType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'platform',
    "quantityTotal" INTEGER,
    "stockTotal" INTEGER,
    "stockRemaining" INTEGER,
    "claimLimitPerUser" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "grantValidDays" INTEGER,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BenefitActivity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BenefitActivity" ("benefitType", "claimLimitPerUser", "createdAt", "createdById", "description", "grantValidDays", "id", "quantityTotal", "rulesText", "sourceType", "status", "stockRemaining", "stockTotal", "title", "updatedAt", "validFrom", "validUntil") SELECT "benefitType", "claimLimitPerUser", "createdAt", "createdById", "description", "grantValidDays", "id", "quantityTotal", "rulesText", "sourceType", "status", "stockRemaining", "stockTotal", "title", "updatedAt", "validFrom", "validUntil" FROM "BenefitActivity";
DROP TABLE "BenefitActivity";
ALTER TABLE "new_BenefitActivity" RENAME TO "BenefitActivity";
CREATE INDEX "BenefitActivity_status_idx" ON "BenefitActivity"("status");
CREATE INDEX "BenefitActivity_sourceType_idx" ON "BenefitActivity"("sourceType");
CREATE INDEX "BenefitActivity_validFrom_validUntil_idx" ON "BenefitActivity"("validFrom", "validUntil");
CREATE TABLE "new_BroadcastReadState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endUserId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "readAt" DATETIME,
    "dismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BroadcastReadState_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BroadcastReadState_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "SystemBroadcast" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BroadcastReadState" ("broadcastId", "createdAt", "dismissedAt", "endUserId", "id", "readAt", "updatedAt") SELECT "broadcastId", "createdAt", "dismissedAt", "endUserId", "id", "readAt", "updatedAt" FROM "BroadcastReadState";
DROP TABLE "BroadcastReadState";
ALTER TABLE "new_BroadcastReadState" RENAME TO "BroadcastReadState";
CREATE INDEX "BroadcastReadState_endUserId_idx" ON "BroadcastReadState"("endUserId");
CREATE INDEX "BroadcastReadState_broadcastId_idx" ON "BroadcastReadState"("broadcastId");
CREATE UNIQUE INDEX "BroadcastReadState_endUserId_broadcastId_key" ON "BroadcastReadState"("endUserId", "broadcastId");
CREATE TABLE "new_FeedbackTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endUserId" TEXT NOT NULL,
    "terminalId" TEXT,
    "relatedPrintTaskId" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "contactPhoneEnc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeedbackTicket_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FeedbackTicket" ("category", "contactPhoneEnc", "content", "createdAt", "endUserId", "id", "relatedPrintTaskId", "status", "terminalId", "title", "updatedAt") SELECT "category", "contactPhoneEnc", "content", "createdAt", "endUserId", "id", "relatedPrintTaskId", "status", "terminalId", "title", "updatedAt" FROM "FeedbackTicket";
DROP TABLE "FeedbackTicket";
ALTER TABLE "new_FeedbackTicket" RENAME TO "FeedbackTicket";
CREATE INDEX "FeedbackTicket_endUserId_createdAt_idx" ON "FeedbackTicket"("endUserId", "createdAt");
CREATE INDEX "FeedbackTicket_status_createdAt_idx" ON "FeedbackTicket"("status", "createdAt");
CREATE INDEX "FeedbackTicket_category_createdAt_idx" ON "FeedbackTicket"("category", "createdAt");
CREATE TABLE "new_OfflineAgency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "orgType" TEXT NOT NULL DEFAULT 'recruitment',
    "address" TEXT NOT NULL,
    "district" TEXT,
    "lat" REAL,
    "lng" REAL,
    "openHours" TEXT,
    "phone" TEXT,
    "contactEmail" TEXT,
    "website" TEXT,
    "services" TEXT NOT NULL DEFAULT '[]',
    "description" TEXT,
    "logoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "sourceOrgId" TEXT,
    "externalId" TEXT,
    "syncTime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_OfflineAgency" ("address", "contactEmail", "createdAt", "description", "district", "externalId", "id", "lat", "lng", "logoUrl", "name", "openHours", "orgType", "phone", "publishStatus", "reviewStatus", "services", "sourceOrgId", "status", "syncTime", "updatedAt", "website") SELECT "address", "contactEmail", "createdAt", "description", "district", "externalId", "id", "lat", "lng", "logoUrl", "name", "openHours", "orgType", "phone", "publishStatus", "reviewStatus", "services", "sourceOrgId", "status", "syncTime", "updatedAt", "website" FROM "OfflineAgency";
DROP TABLE "OfflineAgency";
ALTER TABLE "new_OfflineAgency" RENAME TO "OfflineAgency";
CREATE TABLE "new_OfflineJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jobType" TEXT NOT NULL DEFAULT 'fulltime',
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryUnit" TEXT NOT NULL DEFAULT 'month',
    "requirements" TEXT,
    "description" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "location" TEXT,
    "education" TEXT,
    "experience" TEXT,
    "externalUrl" TEXT,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OfflineJob_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "OfflineAgency" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_OfflineJob" ("agencyId", "createdAt", "description", "education", "experience", "externalId", "externalUrl", "headcount", "id", "jobType", "location", "requirements", "salaryMax", "salaryMin", "salaryUnit", "status", "title", "updatedAt") SELECT "agencyId", "createdAt", "description", "education", "experience", "externalId", "externalUrl", "headcount", "id", "jobType", "location", "requirements", "salaryMax", "salaryMin", "salaryUnit", "status", "title", "updatedAt" FROM "OfflineJob";
DROP TABLE "OfflineJob";
ALTER TABLE "new_OfflineJob" RENAME TO "OfflineJob";
CREATE TABLE "new_SystemBroadcast" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" DATETIME,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SystemBroadcast" ("category", "content", "createdAt", "createdBy", "deletedAt", "id", "title", "updatedAt") SELECT "category", "content", "createdAt", "createdBy", "deletedAt", "id", "title", "updatedAt" FROM "SystemBroadcast";
DROP TABLE "SystemBroadcast";
ALTER TABLE "new_SystemBroadcast" RENAME TO "SystemBroadcast";
CREATE INDEX "SystemBroadcast_deletedAt_createdAt_idx" ON "SystemBroadcast"("deletedAt", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
