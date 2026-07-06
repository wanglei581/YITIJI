-- 数据库高并发/高负载加固：打印任务 claim、超时回收和状态日志读取索引。
-- 全部 additive：仅 create index；不 drop / 不 rename / 不改既有列。

-- CreateIndex：终端高频领取 pending 任务（status + terminalId + createdAt）。
CREATE INDEX IF NOT EXISTS "PrintTask_status_terminalId_createdAt_idx" ON "PrintTask"("status", "terminalId", "createdAt");

-- CreateIndex：claimed 租约过期回收。
CREATE INDEX IF NOT EXISTS "PrintTask_status_claimExpiry_idx" ON "PrintTask"("status", "claimExpiry");

-- CreateIndex：printing 卡住任务回收。
CREATE INDEX IF NOT EXISTS "PrintTask_status_claimedAt_idx" ON "PrintTask"("status", "claimedAt");

-- CreateIndex：Admin 订单详情读取打印任务状态流转日志。
CREATE INDEX IF NOT EXISTS "PrintTaskStatusLog_taskId_createdAt_idx" ON "PrintTaskStatusLog"("taskId", "createdAt");
