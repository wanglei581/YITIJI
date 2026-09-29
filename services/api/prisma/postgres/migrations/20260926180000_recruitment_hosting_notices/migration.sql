-- 政策发布责任确认字段，以及紧急下架留痕、机构站内通知。
-- 不删岗位 / 招聘会 / 企业表。与 SQLite schema 同形。

ALTER TABLE "PolicyPost" ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PolicyPost" ADD COLUMN "publishConfirmedBy" TEXT;
ALTER TABLE "PolicyPost" ADD COLUMN "publishConfirmedAt" TIMESTAMP(3);
ALTER TABLE "PolicyPost" ADD COLUMN "publishConfirmedContentVersion" INTEGER;

CREATE TABLE "RecruitmentEmergencyHold" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentEmergencyHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentEmergencyHold_targetType_targetId_key" ON "RecruitmentEmergencyHold"("targetType", "targetId");
CREATE INDEX "RecruitmentEmergencyHold_orgId_createdAt_idx" ON "RecruitmentEmergencyHold"("orgId", "createdAt");

CREATE TABLE "PartnerOrgNotice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerOrgNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerOrgNotice_orgId_createdAt_idx" ON "PartnerOrgNotice"("orgId", "createdAt");
