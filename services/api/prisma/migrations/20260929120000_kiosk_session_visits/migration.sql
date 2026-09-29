-- 服务人次：一体机会话真写入（只存匿名字段），见 src/kiosk-session。
ALTER TABLE "KioskSession" ADD COLUMN "orgId" TEXT;
ALTER TABLE "KioskSession" ADD COLUMN "clientSessionId" TEXT;
ALTER TABLE "KioskSession" ADD COLUMN "endedAt" DATETIME;
ALTER TABLE "KioskSession" ADD COLUMN "endReason" TEXT;
ALTER TABLE "KioskSession" ADD COLUMN "categoriesJson" TEXT NOT NULL DEFAULT '[]';

CREATE UNIQUE INDEX "KioskSession_terminalId_clientSessionId_key" ON "KioskSession"("terminalId", "clientSessionId");
CREATE INDEX "KioskSession_orgId_startedAt_idx" ON "KioskSession"("orgId", "startedAt");
CREATE INDEX "KioskSession_terminalId_startedAt_idx" ON "KioskSession"("terminalId", "startedAt");
