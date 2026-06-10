-- 阶段1B: Admin 合作机构管理接真 —— Organization 增加机构档案字段。
--
-- Additive only(SQLite ALTER TABLE ADD COLUMN):
--   - sceneTemplate       场景模板(shared SceneTemplate,可空)
--   - enabledModulesJson  启用模块 JSON 数组(shared EnabledModule;招聘闭环模块服务端硬拒绝)
--
-- contactPhone 列在 dev.db 已作为历史 drift 存在(连同 creditCode/contactEmail/address/
-- description/websiteUrl 等废弃分支残留列,均无代码引用),本迁移不再重复 ADD;
-- schema.prisma 自本迁移起正式声明 contactPhone。PostgreSQL 迁移重整时,
-- contactPhone 应作为正式列保留,其余无引用 drift 列丢弃。
--
-- enabled 字段已存在,作为授权总开关复用(登录 + 导入双重校验)。
--
-- 沿用本项目既有约定:dev.db 存在历史 drift,本迁移通过 `prisma db execute --file ...`
-- 非破坏性执行;PostgreSQL 迁移时统一重整。

ALTER TABLE "Organization" ADD COLUMN "sceneTemplate" TEXT;
ALTER TABLE "Organization" ADD COLUMN "enabledModulesJson" TEXT NOT NULL DEFAULT '[]';
