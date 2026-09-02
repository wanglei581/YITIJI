-- 用户本人自填的求职进度（compliance-boundary.md §4.4A，2026-09-02 具名授权）。
-- 本迁移刻意不创建：任何第三方写入路径、企业侧可读视图、简历与投递的关联外键，
-- 以及任何按岗位 / 企业聚合投递的物化结构。judge 与门禁见
-- services/api/scripts/verify-job-application-track.ts。

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endUserId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'external_self_reported',
    "jobId" TEXT,
    "companyName" TEXT NOT NULL,
    "positionTitle" TEXT NOT NULL,
    "sourceName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'intention',
    "statusSource" TEXT NOT NULL DEFAULT 'self_reported',
    "note" TEXT,
    "appliedAt" DATETIME,
    "resumeFileId" TEXT,
    "consentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JobApplication_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "JobApplication_endUserId_status_updatedAt_idx" ON "JobApplication"("endUserId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "JobApplication_endUserId_createdAt_idx" ON "JobApplication"("endUserId", "createdAt");

-- CreateIndex
CREATE INDEX "JobApplication_jobId_idx" ON "JobApplication"("jobId");

