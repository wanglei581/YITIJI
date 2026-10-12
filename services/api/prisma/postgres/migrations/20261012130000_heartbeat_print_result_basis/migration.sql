-- 终端心跳多收两个只读事实：Windows 打印完成记录开没开、本次启动以来靠推断记成打好了的单数。
-- 可空。老版本终端不带这两个字段时写成 null，心跳照常接受。
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "printCompletionLog" TEXT;
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "printResultsInferred" INTEGER;
