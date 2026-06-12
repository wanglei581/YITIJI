-- 企业展示(CompanyProfile,来源企业导览,非招聘平台)+ Job.companyProfileId 展示关联
-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceOrgId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "logoUrl" TEXT,
    "coverImageUrl" TEXT,
    "promoVideoUrl" TEXT,
    "description" TEXT,
    "industry" TEXT,
    "companyType" TEXT,
    "scale" TEXT,
    "foundedAt" DATETIME,
    "province" TEXT,
    "city" TEXT,
    "district" TEXT,
    "address" TEXT,
    "boothNo" TEXT,
    "honorTagsJson" TEXT NOT NULL DEFAULT '[]',
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "fairParticipant" BOOLEAN NOT NULL DEFAULT false,
    "showOpenJobCount" BOOLEAN NOT NULL DEFAULT true,
    "showCity" BOOLEAN NOT NULL DEFAULT true,
    "showEmployeeScale" BOOLEAN NOT NULL DEFAULT true,
    "showBoothNo" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "rejectReason" TEXT,
    "syncTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanyProfile_sourceOrgId_fkey" FOREIGN KEY ("sourceOrgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceOrgId" TEXT NOT NULL,
    "sourceId" TEXT,
    "externalId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "category" TEXT,
    "salary" TEXT,
    "description" TEXT,
    "requirements" TEXT,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "companyProfileId" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "rejectReason" TEXT,
    "syncTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_sourceOrgId_fkey" FOREIGN KEY ("sourceOrgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Job_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Job_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("category", "city", "company", "createdAt", "description", "externalId", "id", "publishStatus", "rejectReason", "requirements", "reviewStatus", "reviewedAt", "reviewedBy", "salary", "sourceId", "sourceName", "sourceOrgId", "sourceUrl", "syncTime", "tagsJson", "title", "updatedAt") SELECT "category", "city", "company", "createdAt", "description", "externalId", "id", "publishStatus", "rejectReason", "requirements", "reviewStatus", "reviewedAt", "reviewedBy", "salary", "sourceId", "sourceName", "sourceOrgId", "sourceUrl", "syncTime", "tagsJson", "title", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_sourceOrgId_idx" ON "Job"("sourceOrgId");
CREATE INDEX "Job_sourceId_idx" ON "Job"("sourceId");
CREATE INDEX "Job_reviewStatus_publishStatus_idx" ON "Job"("reviewStatus", "publishStatus");
CREATE INDEX "Job_companyProfileId_idx" ON "Job"("companyProfileId");
CREATE UNIQUE INDEX "Job_sourceOrgId_externalId_key" ON "Job"("sourceOrgId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CompanyProfile_sourceOrgId_idx" ON "CompanyProfile"("sourceOrgId");

-- CreateIndex
CREATE INDEX "CompanyProfile_reviewStatus_publishStatus_idx" ON "CompanyProfile"("reviewStatus", "publishStatus");

-- CreateIndex
CREATE INDEX "CompanyProfile_province_city_idx" ON "CompanyProfile"("province", "city");

-- CreateIndex
CREATE INDEX "CompanyProfile_industry_idx" ON "CompanyProfile"("industry");

-- CreateIndex
CREATE INDEX "CompanyProfile_companyType_idx" ON "CompanyProfile"("companyType");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_sourceOrgId_externalId_key" ON "CompanyProfile"("sourceOrgId", "externalId");

