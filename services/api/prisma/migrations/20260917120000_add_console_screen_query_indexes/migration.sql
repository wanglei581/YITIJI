-- 数据大屏查询热路径：今日打印失败按状态日志、外部跳转按时间+来源聚合。
-- Additive only：create index；不 drop / 不 rename / 不改既有列。

CREATE INDEX IF NOT EXISTS "PrintTaskStatusLog_toStatus_createdAt_idx" ON "PrintTaskStatusLog"("toStatus", "createdAt");
CREATE INDEX IF NOT EXISTS "ExternalJumpLog_createdAt_sourceName_idx" ON "ExternalJumpLog"("createdAt", "sourceName");
