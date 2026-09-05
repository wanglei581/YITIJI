-- 材料包逐份履约。additive：历史单仍使用 Order.printTaskId 的既有 1:1 语义。
ALTER TABLE "PrintTask" ADD COLUMN "orderId" TEXT;

CREATE TABLE "OrderItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "fileId" TEXT NOT NULL,
  "colorMode" TEXT NOT NULL,
  "duplex" TEXT NOT NULL,
  "copies" INTEGER NOT NULL,
  "pageRange" TEXT,
  "billablePages" INTEGER NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "printTaskId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "OrderItem_orderId_seq_key" ON "OrderItem"("orderId", "seq");
CREATE INDEX "OrderItem_orderId_status_idx" ON "OrderItem"("orderId", "status");
CREATE INDEX "OrderItem_printTaskId_idx" ON "OrderItem"("printTaskId");
CREATE INDEX "PrintTask_orderId_idx" ON "PrintTask"("orderId");

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
