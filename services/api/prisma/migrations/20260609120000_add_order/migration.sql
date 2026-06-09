-- Sprint 1 / Task 1: 打印运营订单 Order（CLAUDE.md §2/§10/§12，docs/progress next-tasks Sprint 1）。
--
-- Additive only：
--   - Order —— 承载 PrintTask 无法承载的「金额 / 支付状态」业务层，与设备任务层(PrintTask)解耦。
--
-- 合规与产品边界：
--   - 这是**线下打印运营订单**，不是招聘业务，不涉及任何招聘闭环 / 简历投递。
--   - 本阶段**不接真实支付**：payStatus 默认 'unpaid'，amountCents 默认 0。
--     amountCents=0 是当前最诚实状态——后端拿不到可靠页数，绝不用 pageCount=1 伪造金额。
--     单价真相源见 src/print-jobs/print-pricing.ts；真实计费待页数 / 报价流程接通后再算。
--   - taskStatus 镜像 PrintTask.status，便于 Admin 订单页一屏读全（真相源仍是 PrintTask）。
--
-- 非破坏性建表。沿用本项目既有约定（见 20260607130000_add_favorite_benefit_grant）：
-- 因 dev.db 存在历史 migration drift，本迁移通过 `prisma db execute --file ...` 非破坏性执行，
-- 不跑破坏性 `migrate reset`。PostgreSQL 迁移时随 dev.db drift 统一重整。

CREATE TABLE "Order" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderNo" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'print',
  "printTaskId" TEXT,
  "endUserId" TEXT,
  "terminalId" TEXT,
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "payStatus" TEXT NOT NULL DEFAULT 'unpaid',
  "taskStatus" TEXT NOT NULL DEFAULT 'pending',
  "refundReason" TEXT,
  "refundedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Order_printTaskId_fkey"
    FOREIGN KEY ("printTaskId") REFERENCES "PrintTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");
CREATE UNIQUE INDEX "Order_printTaskId_key" ON "Order"("printTaskId");
CREATE INDEX "Order_type_idx" ON "Order"("type");
CREATE INDEX "Order_payStatus_idx" ON "Order"("payStatus");
CREATE INDEX "Order_taskStatus_idx" ON "Order"("taskStatus");
CREATE INDEX "Order_endUserId_idx" ON "Order"("endUserId");
CREATE INDEX "Order_terminalId_idx" ON "Order"("terminalId");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
