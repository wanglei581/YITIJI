-- 3.9 内部账号名册 + 备用管理员（见 src/admin-internal-accounts）。
ALTER TABLE "User" ADD COLUMN "isBackupAdmin" BOOLEAN NOT NULL DEFAULT false;

-- 全局最多 1 个未删除的备用管理员。
-- 这是条件唯一索引（partial unique index）：Prisma schema 的 @@unique 表达不了 WHERE，
-- 因此约束只在本迁移里（先例见 20260713160000_add_scan_task_active_session_unique）。
-- 服务层在事务里先查再建、并把撞索引翻译成 409；这里是并发下的最后一道闸。
CREATE UNIQUE INDEX "User_single_backup_admin"
  ON "User"("isBackupAdmin")
  WHERE "isBackupAdmin" = true AND "deletedAt" IS NULL;
