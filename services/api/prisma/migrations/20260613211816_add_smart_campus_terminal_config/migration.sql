-- 智慧校园恢复(feature/restore-smart-campus):仅含智慧校园增量。
-- 注:本仓 SQLite 迁移链与 schema 存在 main 既有漂移(Organization.contactPhone /
-- JobFair 列),与本功能无关;主 CI 用 `prisma db push` 建库,故此迁移不在 CI 中 deploy。
-- 此处刻意只保留 TerminalSmartCampusConfig + Terminal.orgId,不夹带无关漂移修复。

-- CreateTable
CREATE TABLE "TerminalSmartCampusConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "terminalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "modulesJson" TEXT NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables (Terminal: 新增 orgId + 外键归属 Organization)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Terminal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "terminalCode" TEXT NOT NULL,
    "agentToken" TEXT NOT NULL,
    "deviceFingerprint" TEXT NOT NULL,
    "orgId" TEXT,
    "registeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL,
    CONSTRAINT "Terminal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Terminal" ("agentToken", "deviceFingerprint", "id", "lastSeenAt", "registeredAt", "terminalCode") SELECT "agentToken", "deviceFingerprint", "id", "lastSeenAt", "registeredAt", "terminalCode" FROM "Terminal";
DROP TABLE "Terminal";
ALTER TABLE "new_Terminal" RENAME TO "Terminal";
CREATE UNIQUE INDEX "Terminal_terminalCode_key" ON "Terminal"("terminalCode");
CREATE UNIQUE INDEX "Terminal_agentToken_key" ON "Terminal"("agentToken");
CREATE INDEX "Terminal_orgId_idx" ON "Terminal"("orgId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TerminalSmartCampusConfig_terminalId_key" ON "TerminalSmartCampusConfig"("terminalId");
