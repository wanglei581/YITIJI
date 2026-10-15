-- 权益计价三要素：面值 / 抵扣上限 / 适用服务范围。additive，全部可空，存量留 NULL。
--
-- 根因补齐：此前 BenefitGrant 只有 quantityTotal / quantityRemaining（次数额度），
-- 没有任何「这张券值多少钱」的字段，订单核销只能按 discountCents = order.amountCents
-- 整单免单（P0 资损，曾用 REDEEM_PRINT_ORDER_UNSUPPORTED 止血闸临时关死打印订单核销）。
--
-- 存量一律 NULL 而非回填：既有权益从未定义过面值，任何回填值都是凭空捏造的金额。
-- amountCents IS NULL 在服务层被判为「未定义面值 → 不可用于订单金额抵扣」(BENEFIT_NOT_VALUED)，
-- 因此本迁移**不会**让任何存量权益凭空获得抵扣能力 —— 迁移前后可抵扣集合都是空集。
--
-- 合规：面值 = 可抵扣的平台服务额度（平台 credit），非资金、非可提现金额，不表述为补贴发放。

ALTER TABLE "BenefitGrant" ADD COLUMN "amountCents" INTEGER;
ALTER TABLE "BenefitGrant" ADD COLUMN "maxDiscountCents" INTEGER;
ALTER TABLE "BenefitGrant" ADD COLUMN "serviceScope" TEXT;

-- 活动侧模板列：claim 时逐字复制到 BenefitGrant，保证 fail-closed 一路贯穿。
ALTER TABLE "BenefitActivity" ADD COLUMN "amountCents" INTEGER;
ALTER TABLE "BenefitActivity" ADD COLUMN "maxDiscountCents" INTEGER;
ALTER TABLE "BenefitActivity" ADD COLUMN "serviceScope" TEXT;
