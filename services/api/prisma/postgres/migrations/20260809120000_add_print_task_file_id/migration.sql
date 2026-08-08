-- PrintTask 增加 fileId：把文件血缘接到"实际出纸"这一跳。
--
-- 背景：PrintTask 此前只有 fileUrl（带 TTL 的重签名串，不是稳定标识），
-- 建单时解析出的 fileId 只写进 AuditLog payload。结果是 FileObject.sourceFileId
-- + assetCategory('original'|'optimized'|'derived') 的血缘再完整，也断在打印这一跳：
-- 数据库里问不出"这个文件被打印过几次、打的是原件还是遮挡件"。
--
-- Additive only（无 DROP / 无 ALTER TYPE / 无 SET NOT NULL）：
--   - fileId 可空：历史 PrintTask 没有该值，回填由后续任务按需处理。
--   - ON DELETE SET NULL：文件被留存策略清理后，打印任务与订单/审计记录必须保留。

-- AlterTable
ALTER TABLE "PrintTask" ADD COLUMN "fileId" TEXT;

-- CreateIndex
CREATE INDEX "PrintTask_fileId_idx" ON "PrintTask"("fileId");

-- AddForeignKey
ALTER TABLE "PrintTask" ADD CONSTRAINT "PrintTask_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
