-- 一体机服务单：简历优化、模拟面试、扫描按次付款。金额在建单时冻住。
CREATE TABLE "ServiceOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "terminalId" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "kioskSessionId" TEXT NOT NULL,
    "endUserId" TEXT,
    "provider" TEXT NOT NULL,
    "providerOrderNo" TEXT NOT NULL,
    "qrCodeContent" TEXT,
    "prepayId" TEXT,
    "channelTxnNo" TEXT,
    "paidAt" DATETIME,
    "consumedAt" DATETIME,
    "consumedRef" TEXT,
    "failureReason" TEXT,
    "retryUntil" DATETIME,
    "refundReason" TEXT,
    "refundedAt" DATETIME,
    "refundAttempts" INTEGER NOT NULL DEFAULT 0,
    "refundNo" TEXT,
    "channelRefundNo" TEXT,
    "nextRefundAt" DATETIME,
    "closeReason" TEXT,
    "paymentFailed" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceOrder_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ServiceOrder_providerOrderNo_key" ON "ServiceOrder"("providerOrderNo");
CREATE UNIQUE INDEX "ServiceOrder_refundNo_key" ON "ServiceOrder"("refundNo");
CREATE INDEX "ServiceOrder_terminalId_kioskSessionId_status_idx" ON "ServiceOrder"("terminalId", "kioskSessionId", "status");
CREATE INDEX "ServiceOrder_status_expiresAt_idx" ON "ServiceOrder"("status", "expiresAt");
CREATE INDEX "ServiceOrder_status_nextRefundAt_idx" ON "ServiceOrder"("status", "nextRefundAt");
