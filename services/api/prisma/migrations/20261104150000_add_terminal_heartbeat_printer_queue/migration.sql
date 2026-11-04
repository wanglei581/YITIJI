-- 终端心跳只读记下 Windows 打印队列名、端口种类、USB 端口名、驱动五个原值、打印服务状态。
-- 后台用来区分是打印机、打印队列还是 Windows 打印服务。不保存打印机地址。老终端程序不报时这五列为空。
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "printerQueueName" TEXT;
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "printerQueuePortKind" TEXT;
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "printerQueuePortName" TEXT;
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "printerQueueRawStatus" TEXT;
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "printerQueueSpooler" TEXT;
