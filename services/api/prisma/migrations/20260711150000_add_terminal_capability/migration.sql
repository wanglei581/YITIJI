-- 打印扫描首期 Task 10：新增 TerminalCapability 终端能力开关表。
-- 全部 additive：仅 create table / create index；不 drop / 不 rename / 不改既有列。

-- CreateTable
CREATE TABLE "TerminalCapability" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "terminalId" TEXT NOT NULL,
  "capabilityKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'not_verified',
  "note" TEXT,
  "updatedBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TerminalCapability_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TerminalCapability_terminalId_capabilityKey_key" ON "TerminalCapability"("terminalId", "capabilityKey");
CREATE INDEX "TerminalCapability_terminalId_idx" ON "TerminalCapability"("terminalId");
