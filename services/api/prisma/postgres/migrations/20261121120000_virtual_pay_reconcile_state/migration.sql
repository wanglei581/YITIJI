-- 小程序虚拟支付订单：查单连续失败计数与按单诊断限频状态。只加列，不改已有列。
ALTER TABLE "VirtualPayOrder" ADD COLUMN "queryFailCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VirtualPayOrder" ADD COLUMN "lastDiagnosticReason" TEXT;
