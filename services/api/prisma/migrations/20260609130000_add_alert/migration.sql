-- Sprint 1 / Task 3: 运营告警 Alert（CLAUDE.md §2/§8，docs/progress next-tasks Sprint 1）。
--
-- Additive only：
--   - Alert —— 终端 / 设备 / 系统运营告警。处理 / 忽略仅为运营状态记录，
--     不直接远程控制设备（真实设备动作仍由 Terminal Agent 本地执行）。
--
-- 非破坏性建表。沿用本项目既有约定（见 20260609120000_add_order）：
-- 因 dev.db 存在历史 migration drift，本迁移通过 `prisma db execute --file ...` 非破坏性执行，
-- 不跑破坏性 `migrate reset`。PostgreSQL 迁移时随 dev.db drift 统一重整。

CREATE TABLE "Alert" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "alertNo" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'warning',
  "status" TEXT NOT NULL DEFAULT 'new',
  "title" TEXT NOT NULL,
  "message" TEXT,
  "terminalId" TEXT,
  "deviceName" TEXT,
  "payloadJson" TEXT,
  "handledBy" TEXT,
  "handledAt" DATETIME,
  "handleNote" TEXT,
  "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Alert_alertNo_key" ON "Alert"("alertNo");
CREATE INDEX "Alert_status_idx" ON "Alert"("status");
CREATE INDEX "Alert_severity_idx" ON "Alert"("severity");
CREATE INDEX "Alert_type_idx" ON "Alert"("type");
CREATE INDEX "Alert_terminalId_idx" ON "Alert"("terminalId");
CREATE INDEX "Alert_occurredAt_idx" ON "Alert"("occurredAt");
