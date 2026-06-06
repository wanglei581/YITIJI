-- COS 接入:FileObject 扩展为统一文件资产表(FileAsset 语义)。
--
-- 全部为 additive 列,带 DEFAULT 回填既有行,保证向后兼容:
--   - 既有本地文件行 bucket='local-fs' / region='local'(仍可被本地后端读回)。
--   - 既有行 status='active' / visibility='private'(合规默认私有)。
--   - ownerType / ownerId / createdBy 历史行为 NULL,读取路径按 uploaderId/endUserId 兜底。
--
-- 沿用本项目既有约定:因 dev.db 存在历史 migration drift,本迁移通过
-- `prisma db execute --file ...` 非破坏性执行,不跑破坏性 `migrate reset`。

ALTER TABLE "FileObject" ADD COLUMN "bucket" TEXT NOT NULL DEFAULT 'local-fs';
ALTER TABLE "FileObject" ADD COLUMN "region" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "FileObject" ADD COLUMN "ownerType" TEXT;
ALTER TABLE "FileObject" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "FileObject" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';
ALTER TABLE "FileObject" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "FileObject" ADD COLUMN "createdBy" TEXT;

CREATE INDEX "FileObject_ownerType_ownerId_idx" ON "FileObject"("ownerType", "ownerId");
CREATE INDEX "FileObject_status_idx" ON "FileObject"("status");
