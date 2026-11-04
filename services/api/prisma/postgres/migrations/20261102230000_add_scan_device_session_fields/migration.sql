-- 屏上扫描（device 路线）：ScanTask 的 8 个会话字段 + 终端心跳里的扫描仪健康（2 列）。
-- 全部为带默认值或可空的新增列：旧行 startMode 取 'panel'、devicePageCount 取 0，其余为 NULL；
-- 面板扫描路线与旧版终端程序不受影响（旧心跳不带这两项，库里就是 NULL）。
ALTER TABLE "ScanTask" ADD COLUMN "startMode" TEXT NOT NULL DEFAULT 'panel';
ALTER TABLE "ScanTask" ADD COLUMN "deviceSource" TEXT;
ALTER TABLE "ScanTask" ADD COLUMN "deviceColorMode" TEXT;
ALTER TABLE "ScanTask" ADD COLUMN "deviceState" TEXT;
ALTER TABLE "ScanTask" ADD COLUMN "devicePageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScanTask" ADD COLUMN "deviceErrorCode" TEXT;
ALTER TABLE "ScanTask" ADD COLUMN "deviceUpdatedAt" TIMESTAMP(3);
ALTER TABLE "ScanTask" ADD COLUMN "hardExpiresAt" TIMESTAMP(3);

ALTER TABLE "TerminalHeartbeat" ADD COLUMN "scanDeviceHealth" TEXT;
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "scanDeviceObservedAt" TIMESTAMP(3);
