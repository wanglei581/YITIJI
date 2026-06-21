-- Branch 1: 文件资产留存模型基础字段。
--
-- Additive only:
--   - assetCategory 默认 original,兼容历史文件。
--   - sourceFileId 是 nullable 自关联,删除源文件时派生文件保留并置空来源。
--   - retentionPolicy / retentionSetBy 暂为 nullable,后续保存期限服务负责写入策略。
--   - 本迁移不改变 expiresAt 非空约束;long_term 的 expiresAt=null 在后续分支处理。

ALTER TABLE "FileObject" ADD COLUMN "assetCategory" TEXT NOT NULL DEFAULT 'original';
ALTER TABLE "FileObject" ADD COLUMN "sourceFileId" TEXT REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FileObject" ADD COLUMN "retentionPolicy" TEXT;
ALTER TABLE "FileObject" ADD COLUMN "retentionSetBy" TEXT;
ALTER TABLE "FileObject" ADD COLUMN "retentionConsentAt" DATETIME;
ALTER TABLE "FileObject" ADD COLUMN "retentionConsentVersion" TEXT;
ALTER TABLE "FileObject" ADD COLUMN "retentionLockedReason" TEXT;

CREATE INDEX "FileObject_sourceFileId_idx" ON "FileObject"("sourceFileId");
