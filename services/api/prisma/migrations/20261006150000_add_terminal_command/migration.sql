-- 远程重启终端程序。同一终端同时只能有一条未结束命令（pending / accepted）。
-- 条件唯一索引：Prisma @@unique 表达不了 WHERE，约束只在本迁移里
-- （先例：ScanTask_terminalId_active_unique、User_single_backup_admin）。

CREATE TABLE "TerminalCommand" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "terminalId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "requestedAt" DATETIME NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "acceptedAt" DATETIME,
  "finishedAt" DATETIME,
  "completedVerified" BOOLEAN,
  "resultCode" TEXT,
  CONSTRAINT "TerminalCommand_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TerminalCommand_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "TerminalCommand_terminalId_requestedAt_idx" ON "TerminalCommand"("terminalId", "requestedAt");
CREATE INDEX "TerminalCommand_status_expiresAt_idx" ON "TerminalCommand"("status", "expiresAt");
CREATE INDEX "TerminalCommand_status_acceptedAt_idx" ON "TerminalCommand"("status", "acceptedAt");
CREATE INDEX "TerminalCommand_requestedById_idx" ON "TerminalCommand"("requestedById");

CREATE UNIQUE INDEX "TerminalCommand_terminalId_open_unique"
  ON "TerminalCommand"("terminalId")
  WHERE "status" IN ('pending', 'accepted');
