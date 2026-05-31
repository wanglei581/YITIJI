-- CreateTable
CREATE TABLE "JobFair" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceOrgId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'general',
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "venue" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "mapImageUrl" TEXT,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "companyCount" INTEGER NOT NULL DEFAULT 0,
    "jobCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "rejectReason" TEXT,
    "syncTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JobFair_sourceOrgId_fkey" FOREIGN KEY ("sourceOrgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FairCompany" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobFairId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "industry" TEXT,
    "scale" TEXT,
    "description" TEXT,
    "sourceUrl" TEXT,
    "hiringTags" TEXT NOT NULL DEFAULT '',
    "jobsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FairCompany_jobFairId_fkey" FOREIGN KEY ("jobFairId") REFERENCES "JobFair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FairZone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobFairId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "city" TEXT,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FairZone_jobFairId_fkey" FOREIGN KEY ("jobFairId") REFERENCES "JobFair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "JobFair_sourceOrgId_idx" ON "JobFair"("sourceOrgId");

-- CreateIndex
CREATE INDEX "JobFair_theme_idx" ON "JobFair"("theme");

-- CreateIndex
CREATE INDEX "JobFair_reviewStatus_publishStatus_idx" ON "JobFair"("reviewStatus", "publishStatus");

-- CreateIndex
CREATE INDEX "JobFair_startAt_idx" ON "JobFair"("startAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobFair_sourceOrgId_externalId_key" ON "JobFair"("sourceOrgId", "externalId");

-- CreateIndex
CREATE INDEX "FairCompany_jobFairId_idx" ON "FairCompany"("jobFairId");

-- CreateIndex
CREATE INDEX "FairZone_jobFairId_idx" ON "FairZone"("jobFairId");

-- CreateIndex
CREATE INDEX "FairZone_category_idx" ON "FairZone"("category");
