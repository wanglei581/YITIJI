-- 修复 wxOpenId partial index → full unique index
-- 原迁移 20260802100000 使用了 WHERE "wxOpenId" IS NOT NULL 导致与
-- schema.prisma 中 @unique 声明生成的标准全列唯一索引存在结构漂移。
-- 本补丁仅用于已部署生产实例；CI 全新环境直接跑修复后的原迁移。
DROP INDEX IF EXISTS "EndUser_wxOpenId_key";
CREATE UNIQUE INDEX "EndUser_wxOpenId_key" ON "EndUser"("wxOpenId");
