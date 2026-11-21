-- 小程序微信虚拟支付二期：订单退款字段与权益关联一体机服务单（非唯一，失败退回后可再次核销）。只加列与索引。
ALTER TABLE "VirtualPayOrder" ADD COLUMN "refundOrderId" TEXT;
ALTER TABLE "VirtualPayOrder" ADD COLUMN "wxRefundId" TEXT;
ALTER TABLE "VirtualPayOrder" ADD COLUMN "refundReason" TEXT;
ALTER TABLE "VirtualPayOrder" ADD COLUMN "refundedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "VirtualPayOrder_refundOrderId_key" ON "VirtualPayOrder"("refundOrderId");

ALTER TABLE "MemberServiceCredit" ADD COLUMN "consumedServiceOrderId" TEXT;
CREATE INDEX "MemberServiceCredit_consumedServiceOrderId_idx" ON "MemberServiceCredit"("consumedServiceOrderId");
