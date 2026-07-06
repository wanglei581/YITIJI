-- 一次性终端绑定码：用于 Windows 新主机授权，不在主机端保存 adminSecret。

CREATE TABLE "TerminalBindCode" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "terminalId" TEXT NOT NULL,
  "terminalCode" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdBy" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TerminalBindCode_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TerminalBindCode_codeHash_key" ON "TerminalBindCode"("codeHash");
CREATE INDEX "TerminalBindCode_terminalId_idx" ON "TerminalBindCode"("terminalId");
CREATE INDEX "TerminalBindCode_terminalCode_idx" ON "TerminalBindCode"("terminalCode");
CREATE INDEX "TerminalBindCode_expiresAt_idx" ON "TerminalBindCode"("expiresAt");
CREATE INDEX "TerminalBindCode_usedAt_idx" ON "TerminalBindCode"("usedAt");
CREATE INDEX "TerminalBindCode_revokedAt_idx" ON "TerminalBindCode"("revokedAt");
