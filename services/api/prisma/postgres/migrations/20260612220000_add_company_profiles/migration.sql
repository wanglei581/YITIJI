-- 企业展示(CompanyProfile)+ Job.companyProfileId
-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "companyProfileId" TEXT;

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL,
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
    "foundedAt" TIMESTAMP(3),
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
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "syncTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

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

-- CreateIndex
CREATE INDEX "Job_companyProfileId_idx" ON "Job"("companyProfileId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_sourceOrgId_fkey" FOREIGN KEY ("sourceOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

