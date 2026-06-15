-- 智慧校园恢复(feature/restore-smart-campus):PG 增量,与 SQLite 迁移 20260613211816 对应。
-- 由 `prisma migrate diff`(旧 PG schema vs 新 PG schema)生成,仅含 TerminalSmartCampusConfig + Terminal.orgId。

-- AlterTable
ALTER TABLE "Terminal" ADD COLUMN     "orgId" TEXT;

-- CreateTable
CREATE TABLE "TerminalSmartCampusConfig" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "modulesJson" TEXT NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TerminalSmartCampusConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TerminalSmartCampusConfig_terminalId_key" ON "TerminalSmartCampusConfig"("terminalId");

-- CreateIndex
CREATE INDEX "Terminal_orgId_idx" ON "Terminal"("orgId");

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
