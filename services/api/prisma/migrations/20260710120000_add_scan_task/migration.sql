-- 首期真实扫描：新增 ScanTask 表。
-- 全部 additive：仅 create table / create index；不 drop / 不 rename / 不改既有列。

-- CreateTable
CREATE TABLE "ScanTask" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "terminalId" TEXT NOT NULL,
  "scanType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'waiting',
  "endUserId" TEXT,
  "fileId" TEXT,
  "matchedFileMtime" DATETIME,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ScanTask_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScanTask_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ScanTask_terminalId_status_createdAt_idx" ON "ScanTask"("terminalId", "status", "createdAt");
CREATE INDEX "ScanTask_endUserId_idx" ON "ScanTask"("endUserId");
