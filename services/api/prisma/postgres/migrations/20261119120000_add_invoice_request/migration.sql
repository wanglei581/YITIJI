-- 开票申请。打印订单与服务单都用 orderKind + orderId 关联。
-- 同一订单至多一条未退回的申请。Prisma @@unique 表达不了 WHERE，索引只写在迁移里。
CREATE TABLE "InvoiceRequest" (
    "id" TEXT NOT NULL,
    "orderKind" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "endUserId" TEXT NOT NULL,
    "titleType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "taxId" TEXT,
    "email" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "issuedAt" TIMESTAMP(3),
    "invoiceNo" TEXT,
    "returnReason" TEXT,
    "operatorId" TEXT,
    "emailClearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceRequest_endUserId_createdAt_idx" ON "InvoiceRequest"("endUserId", "createdAt");
CREATE INDEX "InvoiceRequest_orderKind_orderId_idx" ON "InvoiceRequest"("orderKind", "orderId");
CREATE INDEX "InvoiceRequest_status_updatedAt_idx" ON "InvoiceRequest"("status", "updatedAt");

CREATE UNIQUE INDEX "InvoiceRequest_open_order_key"
  ON "InvoiceRequest" ("orderKind", "orderId")
  WHERE "status" <> 'returned';

ALTER TABLE "InvoiceRequest" ADD CONSTRAINT "InvoiceRequest_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
