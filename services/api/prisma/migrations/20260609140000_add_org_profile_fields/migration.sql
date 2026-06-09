-- Sprint 1 / Task 4: 合作机构资料字段（Partner Profile 可编辑）。
--
-- Additive only：给 Organization 增 6 个可空列，承载 Partner Profile 可编辑信息。
--   contactName 复用既有 "contact" 列（单一真相源），故此处不新增。
--   reviewStatus / publishStatus 不适用于机构主体，未引入；机构状态用既有 "enabled"。
--
-- 非破坏性 ADD COLUMN。沿用本项目既有约定（见 20260609130000_add_alert）：
-- 因 dev.db 存在历史 migration drift，本迁移通过 `prisma db execute --file ...` 非破坏性执行，
-- 不跑破坏性 `migrate reset`。PostgreSQL 迁移时随 dev.db drift 统一重整。

ALTER TABLE "Organization" ADD COLUMN "creditCode" TEXT;
ALTER TABLE "Organization" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "Organization" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "Organization" ADD COLUMN "address" TEXT;
ALTER TABLE "Organization" ADD COLUMN "description" TEXT;
ALTER TABLE "Organization" ADD COLUMN "websiteUrl" TEXT;
