-- 开票申请。打印订单与服务单都用 orderKind + orderId 关联。
-- 同一订单至多一条未退回的申请。Prisma @@unique 表达不了 WHERE，索引只写在迁移里。
CREATE TABLE "InvoiceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderKind" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "endUserId" TEXT NOT NULL,
    "titleType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "taxId" TEXT,
    "email" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "issuedAt" DATETIME,
    "invoiceNo" TEXT,
    "returnReason" TEXT,
    "operatorId" TEXT,
    "emailClearedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InvoiceRequest_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "InvoiceRequest_endUserId_createdAt_idx" ON "InvoiceRequest"("endUserId", "createdAt");
CREATE INDEX "InvoiceRequest_orderKind_orderId_idx" ON "InvoiceRequest"("orderKind", "orderId");
CREATE INDEX "InvoiceRequest_status_updatedAt_idx" ON "InvoiceRequest"("status", "updatedAt");

CREATE UNIQUE INDEX "InvoiceRequest_open_order_key"
  ON "InvoiceRequest" ("orderKind", "orderId")
  WHERE "status" <> 'returned';

-- 防止注销中或已注销会员被迟到的开票提交写入明文抬头和邮箱（与其余会员表同口径）。
CREATE TRIGGER "InvoiceRequest_closed_member_insert" BEFORE INSERT ON "InvoiceRequest"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "InvoiceRequest_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "InvoiceRequest"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
