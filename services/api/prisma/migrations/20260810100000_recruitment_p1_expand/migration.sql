-- Recruitment content governance P1 / Wave 1A (SQLite expand only).
-- Existing tables are changed only with nullable ADD COLUMN statements. This
-- migration deliberately avoids table rebuilds so legacy row ids and counts
-- remain untouched.

ALTER TABLE "Organization" ADD COLUMN "contentTrustStatus" TEXT;
ALTER TABLE "Organization" ADD COLUMN "contentTrustReviewedBy" TEXT;
ALTER TABLE "Organization" ADD COLUMN "contentTrustReviewedAt" DATETIME;
ALTER TABLE "Organization" ADD COLUMN "contentTrustReason" TEXT;
ALTER TABLE "Organization" ADD COLUMN "archivedAt" DATETIME;

ALTER TABLE "JobSource" ADD COLUMN "approvalStatus" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "syncEnabled" BOOLEAN;
ALTER TABLE "JobSource" ADD COLUMN "trustStatus" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "allowedContentDomainsJson" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "redirectPolicy" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "archivedAt" DATETIME;

CREATE TABLE "OfflineAgencyProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "serviceScopeJson" TEXT NOT NULL DEFAULT '[]',
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT,
    "approvedContentHash" TEXT,
    "hashAlgorithmVersion" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "rejectReason" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OfflineAgencyProfile_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "OfflineAgencyBranch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyProfileId" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "provinceCode" TEXT,
    "cityCode" TEXT,
    "districtCode" TEXT,
    "address" TEXT NOT NULL,
    "lat" REAL,
    "lng" REAL,
    "geoSource" TEXT,
    "serviceHours" TEXT,
    "serviceHoursSource" TEXT,
    "publicPhone" TEXT,
    "website" TEXT,
    "status" TEXT NOT NULL DEFAULT 'suspended',
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT,
    "approvedContentHash" TEXT,
    "hashAlgorithmVersion" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "rejectReason" TEXT,
    "lastVerifiedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OfflineAgencyBranch_agencyProfileId_fkey"
      FOREIGN KEY ("agencyProfileId") REFERENCES "OfflineAgencyProfile" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "QualificationRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "qualificationType" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "issuerName" TEXT,
    "jurisdiction" TEXT,
    "appliesToBranchId" TEXT,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT,
    "approvedContentHash" TEXT,
    "hashAlgorithmVersion" TEXT,
    "evidenceFileId" TEXT,
    "verificationSource" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" DATETIME,
    "rejectReason" TEXT,
    "notes" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QualificationRecord_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QualificationRecord_appliesToBranchId_fkey"
      FOREIGN KEY ("appliesToBranchId") REFERENCES "OfflineAgencyBranch" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QualificationRecord_evidenceFileId_fkey"
      FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "OnlinePlatformDirectory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT,
    "neutralDescription" TEXT,
    "officialDomainsJson" TEXT NOT NULL DEFAULT '[]',
    "landingUrl" TEXT NOT NULL,
    "operatorLegalName" TEXT NOT NULL,
    "logoFileId" TEXT,
    "evidenceFileId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT,
    "approvedContentHash" TEXT,
    "hashAlgorithmVersion" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "rejectReason" TEXT,
    "linkCheckStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastLinkCheckedAt" DATETIME,
    "lastLinkCheckError" TEXT,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OnlinePlatformDirectory_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OnlinePlatformDirectory_logoFileId_fkey"
      FOREIGN KEY ("logoFileId") REFERENCES "FileObject" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OnlinePlatformDirectory_evidenceFileId_fkey"
      FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "contentVersion" INTEGER,
    "contentHash" TEXT,
    "hashAlgorithmVersion" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "reason" TEXT,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT,
    "requestId" TEXT,
    "affectedCount" INTEGER,
    "affectedIdsDigest" TEXT,
    CONSTRAINT "ReviewDecision_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "Job" ADD COLUMN "sourceLastSeenAt" DATETIME;
ALTER TABLE "Job" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "Job" ADD COLUMN "contentVersion" INTEGER;
ALTER TABLE "Job" ADD COLUMN "approvedContentHash" TEXT;
ALTER TABLE "Job" ADD COLUMN "hashAlgorithmVersion" TEXT;
ALTER TABLE "Job" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Job" ADD COLUMN "offlineBranchId" TEXT
  REFERENCES "OfflineAgencyBranch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OfflineJob" ADD COLUMN "canonicalJobId" TEXT
  REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineJob" ADD COLUMN "migrationChecksum" TEXT;

CREATE UNIQUE INDEX "OfflineAgencyProfile_organizationId_key"
  ON "OfflineAgencyProfile"("organizationId");
CREATE INDEX "OfflineAgencyProfile_reviewStatus_publishStatus_idx"
  ON "OfflineAgencyProfile"("reviewStatus", "publishStatus");
CREATE INDEX "OfflineAgencyProfile_archivedAt_idx"
  ON "OfflineAgencyProfile"("archivedAt");

CREATE INDEX "OfflineAgencyBranch_agencyProfileId_status_idx"
  ON "OfflineAgencyBranch"("agencyProfileId", "status");
CREATE INDEX "OfflineAgencyBranch_reviewStatus_publishStatus_idx"
  ON "OfflineAgencyBranch"("reviewStatus", "publishStatus");
CREATE INDEX "OfflineAgencyBranch_provinceCode_cityCode_districtCode_idx"
  ON "OfflineAgencyBranch"("provinceCode", "cityCode", "districtCode");
CREATE INDEX "OfflineAgencyBranch_archivedAt_idx"
  ON "OfflineAgencyBranch"("archivedAt");

CREATE INDEX "QualificationRecord_organizationId_status_validUntil_idx"
  ON "QualificationRecord"("organizationId", "status", "validUntil");
CREATE INDEX "QualificationRecord_appliesToBranchId_idx"
  ON "QualificationRecord"("appliesToBranchId");
CREATE INDEX "QualificationRecord_evidenceFileId_idx"
  ON "QualificationRecord"("evidenceFileId");
CREATE INDEX "QualificationRecord_archivedAt_idx"
  ON "QualificationRecord"("archivedAt");

CREATE UNIQUE INDEX "OnlinePlatformDirectory_slug_key"
  ON "OnlinePlatformDirectory"("slug");
CREATE INDEX "OnlinePlatformDirectory_organizationId_idx"
  ON "OnlinePlatformDirectory"("organizationId");
CREATE INDEX "OnlinePlatformDirectory_reviewStatus_publishStatus_idx"
  ON "OnlinePlatformDirectory"("reviewStatus", "publishStatus");
CREATE INDEX "OnlinePlatformDirectory_linkCheckStatus_idx"
  ON "OnlinePlatformDirectory"("linkCheckStatus");
CREATE INDEX "OnlinePlatformDirectory_displayOrder_idx"
  ON "OnlinePlatformDirectory"("displayOrder");
CREATE INDEX "OnlinePlatformDirectory_archivedAt_idx"
  ON "OnlinePlatformDirectory"("archivedAt");

CREATE INDEX "ReviewDecision_targetType_targetId_occurredAt_idx"
  ON "ReviewDecision"("targetType", "targetId", "occurredAt");
CREATE INDEX "ReviewDecision_actorId_idx" ON "ReviewDecision"("actorId");
CREATE INDEX "ReviewDecision_correlationId_idx" ON "ReviewDecision"("correlationId");
CREATE INDEX "ReviewDecision_requestId_idx" ON "ReviewDecision"("requestId");

CREATE INDEX "Organization_contentTrustStatus_idx" ON "Organization"("contentTrustStatus");
CREATE INDEX "Organization_archivedAt_idx" ON "Organization"("archivedAt");
CREATE INDEX "JobSource_approvalStatus_trustStatus_idx"
  ON "JobSource"("approvalStatus", "trustStatus");
CREATE INDEX "JobSource_archivedAt_idx" ON "JobSource"("archivedAt");
CREATE INDEX "Job_sourceId_externalId_idx" ON "Job"("sourceId", "externalId");
CREATE INDEX "Job_offlineBranchId_idx" ON "Job"("offlineBranchId");
CREATE INDEX "Job_archivedAt_idx" ON "Job"("archivedAt");
CREATE UNIQUE INDEX "OfflineJob_canonicalJobId_key" ON "OfflineJob"("canonicalJobId");
