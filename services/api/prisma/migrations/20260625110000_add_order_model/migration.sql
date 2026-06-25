-- Order model foundation: print-operation order records.
--
-- Additive only:
--   - Order carries orderNo / amount / payment state next to PrintTask.
--   - Current implementation does not connect real payment; amountCents stays 0
--     and payStatus defaults to unpaid until quote/payment flow is implemented.

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
