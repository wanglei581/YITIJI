-- 小程序微信虚拟支付订单与一次服务权益。只加表，不改已有表。
CREATE TABLE "VirtualPayOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endUserId" TEXT,
    "openId" TEXT,
    "serviceKind" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "env" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "outTradeNo" TEXT NOT NULL,
    "wxOrderId" TEXT,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VirtualPayOrder_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VirtualPayOrder_outTradeNo_key" ON "VirtualPayOrder"("outTradeNo");
CREATE INDEX "VirtualPayOrder_status_createdAt_idx" ON "VirtualPayOrder"("status", "createdAt");

CREATE TABLE "MemberServiceCredit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endUserId" TEXT,
    "serviceKind" TEXT NOT NULL,
    "sourceOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "consumedAt" DATETIME,
    "refundedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemberServiceCredit_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MemberServiceCredit_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "VirtualPayOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MemberServiceCredit_sourceOrderId_key" ON "MemberServiceCredit"("sourceOrderId");
CREATE INDEX "MemberServiceCredit_endUserId_status_idx" ON "MemberServiceCredit"("endUserId", "status");
