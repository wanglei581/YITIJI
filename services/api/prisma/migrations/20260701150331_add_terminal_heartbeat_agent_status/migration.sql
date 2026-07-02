ALTER TABLE "TerminalHeartbeat" ADD COLUMN "status" TEXT;
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "localTaskDatabaseAvailable" BOOLEAN;
CREATE INDEX "TerminalHeartbeat_terminalId_createdAt_idx" ON "TerminalHeartbeat"("terminalId", "createdAt");
