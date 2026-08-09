-- Recruitment content governance P1 / Wave 1A (PostgreSQL expand only).
-- Duplicate (sourceId, externalId) groups remain a Wave 2 preflight blocker;
-- the unique constraint is intentionally deferred until cleanup is complete.

ALTER TABLE "Organization"
  ADD COLUMN "contentTrustStatus" TEXT,
  ADD COLUMN "contentTrustReviewedBy" TEXT,
  ADD COLUMN "contentTrustReviewedAt" TIMESTAMP(3),
  ADD COLUMN "contentTrustReason" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "JobSource"
  ADD COLUMN "approvalStatus" TEXT,
  ADD COLUMN "syncEnabled" BOOLEAN,
  ADD COLUMN "trustStatus" TEXT,
  ADD COLUMN "allowedContentDomainsJson" TEXT,
  ADD COLUMN "redirectPolicy" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Job"
  ADD COLUMN "sourceLastSeenAt" TIMESTAMP(3),
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "contentVersion" INTEGER,
  ADD COLUMN "approvedContentHash" TEXT,
  ADD COLUMN "hashAlgorithmVersion" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "offlineBranchId" TEXT;

ALTER TABLE "OfflineJob"
  ADD COLUMN "canonicalJobId" TEXT,
  ADD COLUMN "migrationChecksum" TEXT;

CREATE TABLE "OfflineAgencyProfile" (
    "id" TEXT NOT NULL,
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
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OfflineAgencyProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfflineAgencyBranch" (
    "id" TEXT NOT NULL,
    "agencyProfileId" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "provinceCode" TEXT,
    "cityCode" TEXT,
    "districtCode" TEXT,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
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
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OfflineAgencyBranch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QualificationRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "qualificationType" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "issuerName" TEXT,
    "jurisdiction" TEXT,
    "appliesToBranchId" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT,
    "approvedContentHash" TEXT,
    "hashAlgorithmVersion" TEXT,
    "evidenceFileId" TEXT,
    "verificationSource" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QualificationRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnlinePlatformDirectory" (
    "id" TEXT NOT NULL,
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
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "linkCheckStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastLinkCheckedAt" TIMESTAMP(3),
    "lastLinkCheckError" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OnlinePlatformDirectory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL,
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
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT,
    "requestId" TEXT,
    "affectedCount" INTEGER,
    "affectedIdsDigest" TEXT,
    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

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

ALTER TABLE "OfflineAgencyProfile"
  ADD CONSTRAINT "OfflineAgencyProfile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineAgencyBranch"
  ADD CONSTRAINT "OfflineAgencyBranch_agencyProfileId_fkey"
  FOREIGN KEY ("agencyProfileId") REFERENCES "OfflineAgencyProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualificationRecord"
  ADD CONSTRAINT "QualificationRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualificationRecord"
  ADD CONSTRAINT "QualificationRecord_appliesToBranchId_fkey"
  FOREIGN KEY ("appliesToBranchId") REFERENCES "OfflineAgencyBranch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualificationRecord"
  ADD CONSTRAINT "QualificationRecord_evidenceFileId_fkey"
  FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OnlinePlatformDirectory"
  ADD CONSTRAINT "OnlinePlatformDirectory_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OnlinePlatformDirectory"
  ADD CONSTRAINT "OnlinePlatformDirectory_logoFileId_fkey"
  FOREIGN KEY ("logoFileId") REFERENCES "FileObject"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnlinePlatformDirectory"
  ADD CONSTRAINT "OnlinePlatformDirectory_evidenceFileId_fkey"
  FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewDecision"
  ADD CONSTRAINT "ReviewDecision_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- These constraints point from populated legacy tables to newly empty tables.
-- Keep validation deferred until the Wave 2 backfill has produced reviewed mappings.
ALTER TABLE "Job"
  ADD CONSTRAINT "Job_offlineBranchId_fkey"
  FOREIGN KEY ("offlineBranchId") REFERENCES "OfflineAgencyBranch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OfflineJob"
  ADD CONSTRAINT "OfflineJob_canonicalJobId_fkey"
  FOREIGN KEY ("canonicalJobId") REFERENCES "Job"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
