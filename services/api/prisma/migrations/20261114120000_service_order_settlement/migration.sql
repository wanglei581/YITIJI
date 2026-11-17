-- 服务单结案时间、退款租约和渠道受理状态。不新增表。
ALTER TABLE "ServiceOrder" ADD COLUMN "settledAt" DATETIME;
ALTER TABLE "ServiceOrder" ADD COLUMN "refundLeaseUntil" DATETIME;
ALTER TABLE "ServiceOrder" ADD COLUMN "refundChannelState" TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN "refundProcessingTries" INTEGER NOT NULL DEFAULT 0;
