-- 退款加「已提交渠道时间」：向渠道发起过退款的显式记录。本地新建的待人工永远为 null。
ALTER TABLE "Refund" ADD COLUMN "channelSubmittedAt" TIMESTAMP(3);

-- 存量回填：渠道是 sandbox / wechat / alipay 且状态 pending / manual_review 的行，
-- 保守当作已经提交过渠道，回填为创建时间（之后靠查渠道收口）。
UPDATE "Refund" SET "channelSubmittedAt" = "createdAt"
WHERE "channel" IN ('sandbox', 'wechat', 'alipay') AND "status" IN ('pending', 'manual_review');
