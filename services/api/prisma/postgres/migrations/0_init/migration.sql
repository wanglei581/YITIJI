-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL,
    "terminalCode" TEXT NOT NULL,
    "agentToken" TEXT NOT NULL,
    "deviceFingerprint" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Terminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintTask" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT,
    "endUserId" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileMd5" TEXT NOT NULL,
    "paramsJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedAt" TIMESTAMP(3),
    "claimExpiry" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminalHeartbeat" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "printerStatus" TEXT,
    "agentVersion" TEXT,
    "ipAddress" TEXT,
    "diskFreeGb" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerminalHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintTaskStatusLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintTaskStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "contact" TEXT,
    "contactPhone" TEXT,
    "sceneTemplate" TEXT,
    "enabledModulesJson" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyPost" (
    "id" TEXT NOT NULL,
    "sourceOrgId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'notice',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT,
    "audience" TEXT,
    "category" TEXT,
    "externalUrl" TEXT,
    "publishedDate" TIMESTAMP(3),
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "syncTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "orgId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EndUser" (
    "id" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "nickname" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EndUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSource" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "accessMode" TEXT NOT NULL,
    "syncFreq" TEXT NOT NULL DEFAULT 'manual',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "endpoint" TEXT,
    "authType" TEXT,
    "encryptedCredential" TEXT,
    "webhookSecret" TEXT,
    "webhookSecretRotatedAt" TIMESTAMP(3),
    "responseConfig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
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
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "syncTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "bucket" TEXT NOT NULL DEFAULT 'local-fs',
    "region" TEXT NOT NULL DEFAULT 'local',
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaderId" TEXT,
    "endUserId" TEXT,
    "ownerType" TEXT,
    "ownerId" TEXT,
    "purpose" TEXT NOT NULL,
    "sensitiveLevel" TEXT NOT NULL DEFAULT 'normal',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentProcessTask" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requesterMode" TEXT NOT NULL DEFAULT 'anonymous',
    "accessTokenHash" TEXT,
    "sourceFileId" TEXT NOT NULL,
    "resultFileId" TEXT,
    "endUserId" TEXT,
    "paramsJson" TEXT NOT NULL DEFAULT '{}',
    "resultJson" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentProcessTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiiFinding" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "snippet" TEXT,
    "confidence" DOUBLE PRECISION,
    "action" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PiiFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobFair" (
    "id" TEXT NOT NULL,
    "sourceOrgId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'general',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "mapImageUrl" TEXT,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "trafficInfo" TEXT,
    "expectedAttendance" INTEGER,
    "seekerIntentJson" TEXT,
    "companyCount" INTEGER NOT NULL DEFAULT 0,
    "jobCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "syncTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobFair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FairCompany" (
    "id" TEXT NOT NULL,
    "jobFairId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "industry" TEXT,
    "scale" TEXT,
    "description" TEXT,
    "sourceUrl" TEXT,
    "coverImageUrl" TEXT,
    "founded" TEXT,
    "headquarters" TEXT,
    "registeredCapital" TEXT,
    "honorTags" TEXT NOT NULL DEFAULT '',
    "zoneId" TEXT,
    "boothNumber" TEXT,
    "hiringTags" TEXT NOT NULL DEFAULT '',
    "jobsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FairCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FairCompanyPosition" (
    "id" TEXT NOT NULL,
    "fairCompanyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 0,
    "salary" TEXT,
    "requirements" TEXT,
    "education" TEXT,
    "experience" TEXT,
    "location" TEXT,
    "positionType" TEXT,
    "department" TEXT,
    "sourceUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FairCompanyPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FairZone" (
    "id" TEXT NOT NULL,
    "jobFairId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "city" TEXT,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FairZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FairMaterial" (
    "id" TEXT NOT NULL,
    "jobFairId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "allowPrint" BOOLEAN NOT NULL DEFAULT true,
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FairMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FairVenueGuide" (
    "id" TEXT NOT NULL,
    "jobFairId" TEXT NOT NULL,
    "venueName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FairVenueGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FairVenueHall" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "hallCode" TEXT NOT NULL,
    "hallName" TEXT NOT NULL,
    "industryCategory" TEXT,
    "description" TEXT,
    "boothRange" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FairVenueHall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FairVenueHallCompany" (
    "id" TEXT NOT NULL,
    "hallId" TEXT NOT NULL,
    "fairCompanyId" TEXT NOT NULL,
    "boothNo" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FairVenueHallCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FairVenueFacility" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationLabel" TEXT,
    "relatedHallCode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FairVenueFacility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "syncMode" TEXT NOT NULL,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "addedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "dupCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorFields" TEXT NOT NULL DEFAULT '[]',
    "errorDetail" TEXT,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "dupRows" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "mappingJson" TEXT NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rawDataJson" TEXT NOT NULL DEFAULT '{}',
    "mappedJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "errorsJson" TEXT NOT NULL DEFAULT '[]',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldMappingRule" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "mappingJson" TEXT NOT NULL DEFAULT '{}',
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldMappingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiResumeResult" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "provider" TEXT NOT NULL,
    "endUserId" TEXT,
    "accessTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AiResumeResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitGrant" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT NOT NULL,
    "benefitType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quantityTotal" INTEGER,
    "quantityRemaining" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sourceType" TEXT NOT NULL DEFAULT 'platform',
    "sourceRef" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenefitGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAsset" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" INTEGER NOT NULL DEFAULT 8,
    "source" TEXT NOT NULL DEFAULT 'uploaded',
    "externalUrl" TEXT,
    "aiGenerationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AdAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdPlaylist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AdPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdPlaylistItem" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdPlaylistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminalScreensaverConfig" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "idleTimeoutSec" INTEGER NOT NULL DEFAULT 180,
    "playlistId" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerminalScreensaverConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockInterviewSession" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT,
    "accessTokenHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "interviewerType" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 5,
    "questionTarget" INTEGER NOT NULL DEFAULT 5,
    "interactionMode" TEXT NOT NULL DEFAULT 'text',
    "resumeFileId" TEXT,
    "resumeDigest" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockInterviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockInterviewTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "qType" TEXT,
    "content" TEXT NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "inputMode" TEXT NOT NULL DEFAULT 'text',
    "transcriptText" TEXT,
    "transcriptEdited" BOOLEAN NOT NULL DEFAULT false,
    "answerDurationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockInterviewTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockInterviewReport" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockInterviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_terminalCode_key" ON "Terminal"("terminalCode");

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_agentToken_key" ON "Terminal"("agentToken");

-- CreateIndex
CREATE INDEX "PrintTask_endUserId_idx" ON "PrintTask"("endUserId");

-- CreateIndex
CREATE INDEX "PolicyPost_sourceOrgId_idx" ON "PolicyPost"("sourceOrgId");

-- CreateIndex
CREATE INDEX "PolicyPost_kind_idx" ON "PolicyPost"("kind");

-- CreateIndex
CREATE INDEX "PolicyPost_reviewStatus_publishStatus_idx" ON "PolicyPost"("reviewStatus", "publishStatus");

-- CreateIndex
CREATE INDEX "PolicyPost_publishedDate_idx" ON "PolicyPost"("publishedDate");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_orgId_idx" ON "User"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EndUser_phoneHash_key" ON "EndUser"("phoneHash");

-- CreateIndex
CREATE INDEX "JobSource_orgId_idx" ON "JobSource"("orgId");

-- CreateIndex
CREATE INDEX "Job_sourceOrgId_idx" ON "Job"("sourceOrgId");

-- CreateIndex
CREATE INDEX "Job_sourceId_idx" ON "Job"("sourceId");

-- CreateIndex
CREATE INDEX "Job_reviewStatus_publishStatus_idx" ON "Job"("reviewStatus", "publishStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Job_sourceOrgId_externalId_key" ON "Job"("sourceOrgId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");

-- CreateIndex
CREATE INDEX "FileObject_uploaderId_idx" ON "FileObject"("uploaderId");

-- CreateIndex
CREATE INDEX "FileObject_endUserId_idx" ON "FileObject"("endUserId");

-- CreateIndex
CREATE INDEX "FileObject_ownerType_ownerId_idx" ON "FileObject"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "FileObject_purpose_idx" ON "FileObject"("purpose");

-- CreateIndex
CREATE INDEX "FileObject_status_idx" ON "FileObject"("status");

-- CreateIndex
CREATE INDEX "FileObject_expiresAt_idx" ON "FileObject"("expiresAt");

-- CreateIndex
CREATE INDEX "FileObject_deletedAt_idx" ON "FileObject"("deletedAt");

-- CreateIndex
CREATE INDEX "DocumentProcessTask_kind_idx" ON "DocumentProcessTask"("kind");

-- CreateIndex
CREATE INDEX "DocumentProcessTask_status_idx" ON "DocumentProcessTask"("status");

-- CreateIndex
CREATE INDEX "DocumentProcessTask_requesterMode_idx" ON "DocumentProcessTask"("requesterMode");

-- CreateIndex
CREATE INDEX "DocumentProcessTask_accessTokenHash_idx" ON "DocumentProcessTask"("accessTokenHash");

-- CreateIndex
CREATE INDEX "DocumentProcessTask_sourceFileId_idx" ON "DocumentProcessTask"("sourceFileId");

-- CreateIndex
CREATE INDEX "DocumentProcessTask_resultFileId_idx" ON "DocumentProcessTask"("resultFileId");

-- CreateIndex
CREATE INDEX "DocumentProcessTask_endUserId_idx" ON "DocumentProcessTask"("endUserId");

-- CreateIndex
CREATE INDEX "DocumentProcessTask_expiresAt_idx" ON "DocumentProcessTask"("expiresAt");

-- CreateIndex
CREATE INDEX "PiiFinding_taskId_idx" ON "PiiFinding"("taskId");

-- CreateIndex
CREATE INDEX "PiiFinding_type_idx" ON "PiiFinding"("type");

-- CreateIndex
CREATE INDEX "PiiFinding_action_idx" ON "PiiFinding"("action");

-- CreateIndex
CREATE INDEX "JobFair_sourceOrgId_idx" ON "JobFair"("sourceOrgId");

-- CreateIndex
CREATE INDEX "JobFair_sourceId_idx" ON "JobFair"("sourceId");

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
CREATE INDEX "FairCompanyPosition_fairCompanyId_idx" ON "FairCompanyPosition"("fairCompanyId");

-- CreateIndex
CREATE INDEX "FairZone_jobFairId_idx" ON "FairZone"("jobFairId");

-- CreateIndex
CREATE INDEX "FairZone_category_idx" ON "FairZone"("category");

-- CreateIndex
CREATE UNIQUE INDEX "FairMaterial_storageKey_key" ON "FairMaterial"("storageKey");

-- CreateIndex
CREATE INDEX "FairMaterial_jobFairId_idx" ON "FairMaterial"("jobFairId");

-- CreateIndex
CREATE INDEX "FairMaterial_publishStatus_idx" ON "FairMaterial"("publishStatus");

-- CreateIndex
CREATE INDEX "FairMaterial_deletedAt_idx" ON "FairMaterial"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FairVenueGuide_jobFairId_key" ON "FairVenueGuide"("jobFairId");

-- CreateIndex
CREATE INDEX "FairVenueHall_guideId_idx" ON "FairVenueHall"("guideId");

-- CreateIndex
CREATE UNIQUE INDEX "FairVenueHall_guideId_hallCode_key" ON "FairVenueHall"("guideId", "hallCode");

-- CreateIndex
CREATE INDEX "FairVenueHallCompany_hallId_idx" ON "FairVenueHallCompany"("hallId");

-- CreateIndex
CREATE INDEX "FairVenueHallCompany_fairCompanyId_idx" ON "FairVenueHallCompany"("fairCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "FairVenueHallCompany_hallId_fairCompanyId_key" ON "FairVenueHallCompany"("hallId", "fairCompanyId");

-- CreateIndex
CREATE INDEX "FairVenueFacility_guideId_idx" ON "FairVenueFacility"("guideId");

-- CreateIndex
CREATE INDEX "SyncLog_orgId_idx" ON "SyncLog"("orgId");

-- CreateIndex
CREATE INDEX "SyncLog_sourceId_idx" ON "SyncLog"("sourceId");

-- CreateIndex
CREATE INDEX "SyncLog_createdAt_idx" ON "SyncLog"("createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_orgId_idx" ON "ImportBatch"("orgId");

-- CreateIndex
CREATE INDEX "ImportBatch_sourceId_idx" ON "ImportBatch"("sourceId");

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE INDEX "ImportRecord_batchId_idx" ON "ImportRecord"("batchId");

-- CreateIndex
CREATE INDEX "ImportRecord_status_idx" ON "ImportRecord"("status");

-- CreateIndex
CREATE INDEX "FieldMappingRule_orgId_idx" ON "FieldMappingRule"("orgId");

-- CreateIndex
CREATE INDEX "FieldMappingRule_sourceId_idx" ON "FieldMappingRule"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldMappingRule_sourceId_dataType_key" ON "FieldMappingRule"("sourceId", "dataType");

-- CreateIndex
CREATE INDEX "AiResumeResult_taskId_idx" ON "AiResumeResult"("taskId");

-- CreateIndex
CREATE INDEX "AiResumeResult_endUserId_idx" ON "AiResumeResult"("endUserId");

-- CreateIndex
CREATE INDEX "AiResumeResult_expiresAt_idx" ON "AiResumeResult"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiResumeResult_taskId_kind_key" ON "AiResumeResult"("taskId", "kind");

-- CreateIndex
CREATE INDEX "Favorite_endUserId_idx" ON "Favorite"("endUserId");

-- CreateIndex
CREATE INDEX "Favorite_targetType_targetId_idx" ON "Favorite"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_endUserId_targetType_targetId_key" ON "Favorite"("endUserId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "BenefitGrant_endUserId_idx" ON "BenefitGrant"("endUserId");

-- CreateIndex
CREATE INDEX "BenefitGrant_endUserId_status_idx" ON "BenefitGrant"("endUserId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdAsset_storageKey_key" ON "AdAsset"("storageKey");

-- CreateIndex
CREATE INDEX "AdAsset_status_idx" ON "AdAsset"("status");

-- CreateIndex
CREATE INDEX "AdAsset_type_idx" ON "AdAsset"("type");

-- CreateIndex
CREATE INDEX "AdAsset_deletedAt_idx" ON "AdAsset"("deletedAt");

-- CreateIndex
CREATE INDEX "AdPlaylist_status_idx" ON "AdPlaylist"("status");

-- CreateIndex
CREATE INDEX "AdPlaylistItem_playlistId_idx" ON "AdPlaylistItem"("playlistId");

-- CreateIndex
CREATE INDEX "AdPlaylistItem_assetId_idx" ON "AdPlaylistItem"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AdPlaylistItem_playlistId_assetId_key" ON "AdPlaylistItem"("playlistId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "TerminalScreensaverConfig_terminalId_key" ON "TerminalScreensaverConfig"("terminalId");

-- CreateIndex
CREATE INDEX "TerminalScreensaverConfig_playlistId_idx" ON "TerminalScreensaverConfig"("playlistId");

-- CreateIndex
CREATE INDEX "MockInterviewSession_endUserId_createdAt_idx" ON "MockInterviewSession"("endUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MockInterviewSession_expiresAt_idx" ON "MockInterviewSession"("expiresAt");

-- CreateIndex
CREATE INDEX "MockInterviewTurn_sessionId_idx" ON "MockInterviewTurn"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "MockInterviewTurn_sessionId_idx_key" ON "MockInterviewTurn"("sessionId", "idx");

-- CreateIndex
CREATE UNIQUE INDEX "MockInterviewReport_sessionId_key" ON "MockInterviewReport"("sessionId");

-- CreateIndex
CREATE INDEX "MockInterviewReport_expiresAt_idx" ON "MockInterviewReport"("expiresAt");

-- AddForeignKey
ALTER TABLE "PrintTask" ADD CONSTRAINT "PrintTask_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintTask" ADD CONSTRAINT "PrintTask_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminalHeartbeat" ADD CONSTRAINT "TerminalHeartbeat_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintTaskStatusLog" ADD CONSTRAINT "PrintTaskStatusLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PrintTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyPost" ADD CONSTRAINT "PolicyPost_sourceOrgId_fkey" FOREIGN KEY ("sourceOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_sourceOrgId_fkey" FOREIGN KEY ("sourceOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentProcessTask" ADD CONSTRAINT "DocumentProcessTask_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentProcessTask" ADD CONSTRAINT "DocumentProcessTask_resultFileId_fkey" FOREIGN KEY ("resultFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentProcessTask" ADD CONSTRAINT "DocumentProcessTask_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiiFinding" ADD CONSTRAINT "PiiFinding_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DocumentProcessTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFair" ADD CONSTRAINT "JobFair_sourceOrgId_fkey" FOREIGN KEY ("sourceOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFair" ADD CONSTRAINT "JobFair_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FairCompany" ADD CONSTRAINT "FairCompany_jobFairId_fkey" FOREIGN KEY ("jobFairId") REFERENCES "JobFair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FairCompanyPosition" ADD CONSTRAINT "FairCompanyPosition_fairCompanyId_fkey" FOREIGN KEY ("fairCompanyId") REFERENCES "FairCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FairZone" ADD CONSTRAINT "FairZone_jobFairId_fkey" FOREIGN KEY ("jobFairId") REFERENCES "JobFair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FairMaterial" ADD CONSTRAINT "FairMaterial_jobFairId_fkey" FOREIGN KEY ("jobFairId") REFERENCES "JobFair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FairVenueGuide" ADD CONSTRAINT "FairVenueGuide_jobFairId_fkey" FOREIGN KEY ("jobFairId") REFERENCES "JobFair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FairVenueHall" ADD CONSTRAINT "FairVenueHall_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "FairVenueGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FairVenueHallCompany" ADD CONSTRAINT "FairVenueHallCompany_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "FairVenueHall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FairVenueHallCompany" ADD CONSTRAINT "FairVenueHallCompany_fairCompanyId_fkey" FOREIGN KEY ("fairCompanyId") REFERENCES "FairCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FairVenueFacility" ADD CONSTRAINT "FairVenueFacility_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "FairVenueGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldMappingRule" ADD CONSTRAINT "FieldMappingRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiResumeResult" ADD CONSTRAINT "AiResumeResult_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitGrant" ADD CONSTRAINT "BenefitGrant_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdPlaylistItem" ADD CONSTRAINT "AdPlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "AdPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdPlaylistItem" ADD CONSTRAINT "AdPlaylistItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AdAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminalScreensaverConfig" ADD CONSTRAINT "TerminalScreensaverConfig_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "AdPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockInterviewTurn" ADD CONSTRAINT "MockInterviewTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MockInterviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockInterviewReport" ADD CONSTRAINT "MockInterviewReport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MockInterviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

