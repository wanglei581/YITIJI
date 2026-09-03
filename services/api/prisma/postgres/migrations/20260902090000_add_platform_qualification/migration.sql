-- 招聘闭环能力闸门（分期方案第 1 刀）。
-- 本迁移只建一张承载「平台自身行政许可事实」的表，刻意不创建任何投递记录、
-- 企业账号、收件箱、通知通道或能力开关。建表本身不解锁任何能力：判据在
-- services/api/src/common/recruitment-capability.ts，且当前零调用点。
--
-- 不复用 QualificationRecord 的理由：后者 organizationId 必填且指向
-- Organization（语义为「来源机构 / 合作机构」），平台自身不是其中一员。

CREATE TABLE "PlatformQualification" (
    "id" TEXT NOT NULL,
    "qualificationType" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "issuerName" TEXT,
    "jurisdiction" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "evidenceFileId" TEXT,
    "verificationSource" TEXT,
    "submittedBy" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformQualification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformQualification_evidenceFileId_fkey"
      FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "PlatformQualification_qualificationType_status_validUntil_idx"
  ON "PlatformQualification"("qualificationType", "status", "validUntil");
CREATE INDEX "PlatformQualification_evidenceFileId_idx"
  ON "PlatformQualification"("evidenceFileId");
CREATE INDEX "PlatformQualification_archivedAt_idx"
  ON "PlatformQualification"("archivedAt");
