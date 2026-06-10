-- 阶段1D: 政策服务接真 —— 新增 PolicyPost(政策扶持条目 + 政策公告)。
--
-- Additive only。数据流:Partner 录入 → Admin 审核/发布 → Kiosk 政策服务页展示。
-- 合规:info-only(政策说明/材料清单/官方入口),不承诺补贴到账、不代申请;
--       reviewStatus/publishStatus 状态机与 Job/JobFair 一致。
--
-- 沿用既有约定:dev.db 存在历史 drift,本迁移通过 `prisma db execute --file ...`
-- 非破坏性执行;PostgreSQL 迁移时统一重整。

CREATE TABLE "PolicyPost" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceOrgId" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'notice',
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "content" TEXT,
  "audience" TEXT,
  "category" TEXT,
  "externalUrl" TEXT,
  "publishedDate" DATETIME,
  "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
  "publishStatus" TEXT NOT NULL DEFAULT 'draft',
  "reviewedBy" TEXT,
  "reviewedAt" DATETIME,
  "rejectReason" TEXT,
  "syncTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PolicyPost_sourceOrgId_fkey"
    FOREIGN KEY ("sourceOrgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "PolicyPost_sourceOrgId_idx" ON "PolicyPost"("sourceOrgId");
CREATE INDEX "PolicyPost_kind_idx" ON "PolicyPost"("kind");
CREATE INDEX "PolicyPost_reviewStatus_publishStatus_idx" ON "PolicyPost"("reviewStatus", "publishStatus");
CREATE INDEX "PolicyPost_publishedDate_idx" ON "PolicyPost"("publishedDate");
