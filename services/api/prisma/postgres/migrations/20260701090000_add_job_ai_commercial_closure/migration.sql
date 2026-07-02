-- Job AI 商用闭环底座：只记录本人侧 AI 会话、推荐明细、调用元数据和数据权利请求。
-- 合规：不包含平台投递、企业筛选、面试邀约、Offer 或第三方处理结果。

CREATE TABLE "JobAiSession" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT,
    "resumeTaskId" TEXT,
    "operation" TEXT NOT NULL,
    "intentJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT,
    "terminalId" TEXT,
    "accessTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "JobAiSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobAiRecommendation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "fitLevel" TEXT NOT NULL,
    "summary" TEXT,
    "matchPointsJson" TEXT NOT NULL DEFAULT '[]',
    "gapPointsJson" TEXT NOT NULL DEFAULT '[]',
    "actionChecklistJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAiRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiServiceLog" (
    "id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "provider" TEXT,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "tokenUsageJson" TEXT NOT NULL DEFAULT '{}',
    "estimatedCostCny" DOUBLE PRECISION,
    "terminalId" TEXT,
    "endUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiServiceLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserAiConsent" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "terminalId" TEXT,

    CONSTRAINT "UserAiConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserDataRequest" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),
    "handledBy" TEXT,
    "auditRef" TEXT,

    CONSTRAINT "UserDataRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobDataQualitySnapshot" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceOrgId" TEXT NOT NULL,
    "missingFieldsJson" TEXT NOT NULL DEFAULT '[]',
    "qualityLevel" TEXT NOT NULL,
    "sourceUrlReachable" BOOLEAN,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "JobDataQualitySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobAiSession_endUserId_createdAt_idx" ON "JobAiSession"("endUserId", "createdAt");
CREATE INDEX "JobAiSession_resumeTaskId_idx" ON "JobAiSession"("resumeTaskId");
CREATE INDEX "JobAiSession_operation_status_idx" ON "JobAiSession"("operation", "status");
CREATE INDEX "JobAiSession_expiresAt_idx" ON "JobAiSession"("expiresAt");

CREATE UNIQUE INDEX "JobAiRecommendation_sessionId_jobId_key" ON "JobAiRecommendation"("sessionId", "jobId");
CREATE INDEX "JobAiRecommendation_sessionId_rank_idx" ON "JobAiRecommendation"("sessionId", "rank");
CREATE INDEX "JobAiRecommendation_jobId_idx" ON "JobAiRecommendation"("jobId");
CREATE INDEX "JobAiRecommendation_fitLevel_idx" ON "JobAiRecommendation"("fitLevel");

CREATE INDEX "AiServiceLog_operation_createdAt_idx" ON "AiServiceLog"("operation", "createdAt");
CREATE INDEX "AiServiceLog_status_createdAt_idx" ON "AiServiceLog"("status", "createdAt");
CREATE INDEX "AiServiceLog_endUserId_idx" ON "AiServiceLog"("endUserId");

CREATE INDEX "UserAiConsent_endUserId_scope_idx" ON "UserAiConsent"("endUserId", "scope");
CREATE INDEX "UserAiConsent_revokedAt_idx" ON "UserAiConsent"("revokedAt");

CREATE INDEX "UserDataRequest_endUserId_requestType_idx" ON "UserDataRequest"("endUserId", "requestType");
CREATE INDEX "UserDataRequest_status_idx" ON "UserDataRequest"("status");
CREATE INDEX "UserDataRequest_requestedAt_idx" ON "UserDataRequest"("requestedAt");

CREATE INDEX "JobDataQualitySnapshot_jobId_idx" ON "JobDataQualitySnapshot"("jobId");
CREATE INDEX "JobDataQualitySnapshot_sourceOrgId_idx" ON "JobDataQualitySnapshot"("sourceOrgId");
CREATE INDEX "JobDataQualitySnapshot_qualityLevel_idx" ON "JobDataQualitySnapshot"("qualityLevel");
CREATE INDEX "JobDataQualitySnapshot_checkedAt_idx" ON "JobDataQualitySnapshot"("checkedAt");

ALTER TABLE "JobAiSession" ADD CONSTRAINT "JobAiSession_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobAiRecommendation" ADD CONSTRAINT "JobAiRecommendation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "JobAiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobAiRecommendation" ADD CONSTRAINT "JobAiRecommendation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiServiceLog" ADD CONSTRAINT "AiServiceLog_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserAiConsent" ADD CONSTRAINT "UserAiConsent_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserDataRequest" ADD CONSTRAINT "UserDataRequest_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobDataQualitySnapshot" ADD CONSTRAINT "JobDataQualitySnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobDataQualitySnapshot" ADD CONSTRAINT "JobDataQualitySnapshot_sourceOrgId_fkey" FOREIGN KEY ("sourceOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
