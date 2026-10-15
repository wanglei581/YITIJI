-- 清空打印队列回执时记下还剩的作业数。
-- 可空且不设默认值：重启命令、尚未回执的命令、忙或过期都不写这个数。
ALTER TABLE "TerminalCommand" ADD COLUMN "remainingJobs" INTEGER;
