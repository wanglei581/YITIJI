-- B1-2: 同一 terminalId 同时只允许一个「活跃」ScanTask（status IN ('waiting', 'matched')）。
-- 目的：阻止攻击者预先创建扫描会话来拦截其他用户的物理扫描（Agent 按「最旧 waiting 任务」匹配，
-- 若同一终端可并存多个活跃会话，先创建的攻击者会话可能抢到本应属于合法用户的扫描文件）。
--
-- 这是 partial unique index（条件唯一索引），Prisma schema.prisma 的 `@@unique` 语法无法表达
-- WHERE 条件表达式，因此本约束只存在于本 migration.sql，不在 schema.prisma 里声明对应字段。
-- completed/cancelled/expired/failed 状态的历史记录不受此约束限制，可以无限累积。
CREATE UNIQUE INDEX "ScanTask_terminalId_active_unique"
  ON "ScanTask"("terminalId")
  WHERE "status" IN ('waiting', 'matched');
