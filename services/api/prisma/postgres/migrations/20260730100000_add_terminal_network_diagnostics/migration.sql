-- Stores only Agent-calculated link-state enums. No network identifier or credential is persisted.
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "wiredNetworkStatus" TEXT;
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "printerNetworkStatus" TEXT;
