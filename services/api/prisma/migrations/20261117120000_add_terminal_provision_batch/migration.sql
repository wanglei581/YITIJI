-- 批量预建终端的批次号。单台预建保持为空。
ALTER TABLE "Terminal" ADD COLUMN "provisionBatchId" TEXT;
CREATE INDEX "Terminal_provisionBatchId_idx" ON "Terminal"("provisionBatchId");
