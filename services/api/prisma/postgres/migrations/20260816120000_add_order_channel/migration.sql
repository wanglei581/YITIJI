-- M1: 下单渠道（来源入口）。additive，可空，存量留 NULL。
-- PostgreSQL 侧与 prisma/migrations/20260816120000_add_order_channel 一一对应。
--
-- 为什么必须显式存而不是推断：一体机与小程序建单写的是同样的字段
-- （terminalId 在小程序侧是用户选的门店），「匿名 + 有 terminalId」只能判出一体机，
-- 会员单完全分不出来——而会员单正是小程序主体。
--
-- 存量一律 NULL：会员存量单无法可靠区分，禁止按「匿名+terminalId → kiosk」批量回填，
-- 那会猜错边界并污染统计。前端对 NULL 显示「未标注」。
ALTER TABLE "Order"
  ADD COLUMN "channel" TEXT;

CREATE INDEX "Order_channel_createdAt_idx" ON "Order"("channel", "createdAt");
