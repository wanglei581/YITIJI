-- 修复 SQLite 迁移链与 schema.prisma 的历史漂移(additive-only)。
--
-- 背景:全新空库 `prisma migrate deploy` 后 `db:seed` 报
-- `no such column: main.Organization.contactPhone`。原因:
--   1. Organization.contactPhone 自 20260610130000_org_partner_profile 起在
--      schema.prisma 正式声明,但该迁移因开发机 dev.db 已有此列(历史 drift)
--      刻意未执行 ADD COLUMN → 空库缺列。
--   2. JobFair.sourceId(+ JobFair_sourceId_idx + 外键 → JobSource)在 schema
--      中存在,但 SQLite 迁移链从未添加过 → 空库缺列,任何 JobFair 默认查询
--      (Prisma select 全字段)都会失败。
-- PostgreSQL 侧不受影响:prisma/postgres/migrations/0_init(2026-06-12 重整)
-- 已包含上述两列/索引/外键,postgres-readiness CI 因此未拦截;SQLite 主 CI
-- 使用 `prisma db push`,同样绕过了迁移链。
--
-- 兼容已带 drift 列的旧 dev.db:本迁移在这类库上会因 duplicate column 失败,
-- 处理方式为标记跳过(列已存在,语义等价):
--   npx prisma migrate resolve --applied 20260703100000_repair_drift_org_contactphone_jobfair_sourceid
--
-- 已知残留噪音(不影响功能,刻意不修):BenefitActivity / BroadcastReadState /
-- FeedbackTicket / SystemBroadcast 四表 updatedAt 在迁移里带
-- DEFAULT CURRENT_TIMESTAMP,schema @updatedAt 不带默认值;`migrate diff`
-- 会显示 RedefineTables。additive-only 无法在 SQLite 去掉列默认值,
-- Prisma client 始终显式写 updatedAt,保持现状。

ALTER TABLE "Organization" ADD COLUMN "contactPhone" TEXT;

ALTER TABLE "JobFair" ADD COLUMN "sourceId" TEXT
  REFERENCES "JobSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "JobFair_sourceId_idx" ON "JobFair"("sourceId");
