-- C5-2 线上扫码支付沙箱底座：PaymentAttempt 新表 + Order 线上 additive 补列。
-- 全部 additive：仅 add table / add column / create index；不 drop / 不 rename / 不改既有列。
-- Order 新增列可空或带默认值，不破坏现有行。channel 本波只允许 sandbox（无 live 网关）。

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "prepayId" TEXT,
    "qrCodeContent" TEXT,
    "channelTxnNo" TEXT,
    "failReason" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_channel_channelTxnNo_key" ON "PaymentAttempt"("channel", "channelTxnNo");

-- CreateIndex
CREATE INDEX "PaymentAttempt_orderId_idx" ON "PaymentAttempt"("orderId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_status_idx" ON "PaymentAttempt"("status");

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "payChannel" TEXT;
ALTER TABLE "Order" ADD COLUMN "itemsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Order" ADD COLUMN "expiresAt" DATETIME;
