ALTER TABLE "TerminalHeartbeat" ADD COLUMN "scanInputHealth" TEXT;
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "scanInputAction" TEXT;
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "scanInputReason" TEXT;
ALTER TABLE "TerminalHeartbeat" ADD COLUMN "scanInputObservedAt" DATETIME;
