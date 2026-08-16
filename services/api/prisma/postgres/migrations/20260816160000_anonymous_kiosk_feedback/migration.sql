-- S1 匿名一体机反馈：受限的免登录提交面，复用 FeedbackTicket。
-- PostgreSQL 侧与 prisma/migrations/20260816160000_anonymous_kiosk_feedback 一一对应。
--
-- 为什么必须改列而不是只加表：一体机是公共位设备，绝大多数用户不登录，
-- 而 FeedbackTicket.endUserId 原本 NOT NULL —— 打印完成页的「问题上报 / 满意度」和
-- 打印 Hub 的「缺纸 / 质量 / 费用」在匿名场景下无处可落。
--
-- 变更四项，全部 additive（不删列、不改既有列语义）：
--   1. endUserId → nullable。存量行 endUserId 全部非空，语义不变。
--   2. submitterType（默认 'member'）：区分会员工单与匿名一体机工单，后台分开处置。
--      存量行按默认值落 'member' —— 这是真值：改动前唯一的提交面就是 POST /me/feedback。
--   3. relatedScanTaskId：与 relatedPrintTaskId 对称，允许关联扫描任务。
--   4. satisfaction：打印完成页满意度三档（good/fair/bad），独立成列以便按终端聚合。
--   5. dedupKey + UNIQUE：匿名提交幂等键。会员提交恒为 NULL，
--      PostgreSQL 的 UNIQUE 索引允许多个 NULL，因此不影响存量行。

ALTER TABLE "FeedbackTicket"
  ALTER COLUMN "endUserId" DROP NOT NULL;

ALTER TABLE "FeedbackTicket"
  ADD COLUMN "submitterType" TEXT NOT NULL DEFAULT 'member',
  ADD COLUMN "relatedScanTaskId" TEXT,
  ADD COLUMN "satisfaction" TEXT,
  ADD COLUMN "dedupKey" TEXT;

CREATE UNIQUE INDEX "FeedbackTicket_dedupKey_key" ON "FeedbackTicket"("dedupKey");

CREATE INDEX "FeedbackTicket_submitterType_terminalId_createdAt_idx"
  ON "FeedbackTicket"("submitterType", "terminalId", "createdAt");
