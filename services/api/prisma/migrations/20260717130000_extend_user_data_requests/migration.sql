-- Wave 1-B Slice 1：资料导出账本字段与约束。账户注销仍只在应用层 fail closed，
-- 不创建 delete 请求、不会依赖本表触发任何删除或状态迁移。
ALTER TABLE "UserDataRequest" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "activeKey" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "executionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserDataRequest" ADD COLUMN "executionStep" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "progressJson" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "workerJobId" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "exportFileId" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "exportExpiresAt" DATETIME;
ALTER TABLE "UserDataRequest" ADD COLUMN "downloadConsumedAt" DATETIME;
ALTER TABLE "UserDataRequest" ADD COLUMN "failureCode" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserDataRequest" ADD COLUMN "lastAttemptAt" DATETIME;

-- SQLite 与 PostgreSQL 对 NULL 都允许多行；历史无 key 的请求不需要回填。
CREATE UNIQUE INDEX "UserDataRequest_endUserId_idempotencyKey_key"
  ON "UserDataRequest"("endUserId", "idempotencyKey");
CREATE UNIQUE INDEX "UserDataRequest_activeKey_key" ON "UserDataRequest"("activeKey");
CREATE UNIQUE INDEX "UserDataRequest_exportFileId_key" ON "UserDataRequest"("exportFileId");
CREATE INDEX "UserDataRequest_exportExpiresAt_idx" ON "UserDataRequest"("exportExpiresAt");
