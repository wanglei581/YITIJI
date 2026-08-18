-- AlterTable: FileObject 增加物理对象删除账本
--
-- 依据 CLAUDE.md §11：文件删除后需要保留删除日志；不长期保存身份证等敏感文件。
--
-- DB tombstone 必须先于对象存储删除写入，两者之间存在一个中间态：库里已标记
-- 删除、对象存储里的实体文件仍在。此前该中间态只有一行 logger.warn，简历 /
-- 身份证扫描件会在对象存储里变成无人知晓的孤儿。这四列把中间态显式落库，
-- 由每小时对账轮次重试到收敛。
--
-- 四列全部可空且不设默认值：存量行没有这本账的真实值，填任何默认值都是伪造
-- 事实。NULL 语义为「未记账」，因此重试对账只捞 storageDeletePendingAt
-- IS NOT NULL 的行，绝不追溯存量。
ALTER TABLE "FileObject" ADD COLUMN "storageDeletedAt" TIMESTAMP(3);
ALTER TABLE "FileObject" ADD COLUMN "storageDeletePendingAt" TIMESTAMP(3);
ALTER TABLE "FileObject" ADD COLUMN "storageDeleteAttempts" INTEGER;
ALTER TABLE "FileObject" ADD COLUMN "storageDeleteError" TEXT;

-- 待重试行相对全表极少，对账选行不能退化成全表扫。
CREATE INDEX "FileObject_storageDeletePendingAt_idx" ON "FileObject"("storageDeletePendingAt");
