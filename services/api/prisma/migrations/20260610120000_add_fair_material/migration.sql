-- 阶段1A: Admin 招聘会管理接真 —— 新增 FairMaterial(招聘会活动资料)。
--
-- Additive only:
--   - FairMaterial —— 招聘会活动资料(日程/展区图/企业名册/岗位汇总/宣传手册)。
--     运营内容,走 AdAsset 同款模式:自带 storageKey、无 TTL 自动清理、
--     Kiosk 经 HMAC 签名短时 URL 读取。
--
-- 合规:资料仅为招聘会现场服务信息,不含求职者数据,不参与招聘闭环。
--
-- 非破坏性建表。沿用本项目既有约定(见 20260607130000_add_favorite_benefit_grant):
-- 因 dev.db 存在历史 migration drift,本迁移通过 `prisma db execute --file ...` 非破坏性执行,
-- 不跑破坏性 `migrate reset`。PostgreSQL 迁移时随 dev.db drift 统一重整。

CREATE TABLE "FairMaterial" (
  "id" TEXT NOT NULL PRIMARY KEY,
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
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "deletedAt" DATETIME,
  CONSTRAINT "FairMaterial_jobFairId_fkey"
    FOREIGN KEY ("jobFairId") REFERENCES "JobFair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FairMaterial_storageKey_key" ON "FairMaterial"("storageKey");
CREATE INDEX "FairMaterial_jobFairId_idx" ON "FairMaterial"("jobFairId");
CREATE INDEX "FairMaterial_publishStatus_idx" ON "FairMaterial"("publishStatus");
CREATE INDEX "FairMaterial_deletedAt_idx" ON "FairMaterial"("deletedAt");
