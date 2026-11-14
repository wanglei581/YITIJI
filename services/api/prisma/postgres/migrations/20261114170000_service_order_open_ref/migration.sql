-- 同一服务、同一 consumedRef，没结案的单只能有一张。
-- Prisma @@unique 表达不了 WHERE，所以索引只写在迁移里，schema 用注释说明。
-- pending 是扫描占位，不参与；退款中及之后腾出名额，结案但仍是 consumed 的继续占着。
ALTER TABLE "ServiceOrder" ADD COLUMN "refundNotifyKey" TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN "refundAnomaly" TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN "channelClosePending" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "ServiceOrder_open_consumed_ref_key"
  ON "ServiceOrder" ("serviceKey", "consumedRef")
  WHERE "consumedRef" IS NOT NULL
    AND "consumedRef" <> 'pending'
    AND "status" IN ('pending', 'paid', 'consumed');
