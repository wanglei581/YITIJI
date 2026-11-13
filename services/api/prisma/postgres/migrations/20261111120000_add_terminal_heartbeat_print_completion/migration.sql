-- 终端心跳记下打印完成判据是否可用。
-- available：Microsoft-Windows-PrintService/Operational 已启用，可以靠 307 事件判断出纸。
-- unavailable：日志没启用或启用失败。旧版终端程序不报这一列，保持空，不能当成可用。
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "printCompletionEvidence" TEXT;
