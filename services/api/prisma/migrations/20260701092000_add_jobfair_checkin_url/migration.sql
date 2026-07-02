-- 招聘会来源签到入口：真实第三方/官方 checkinUrl，可空。
-- 仅用于 Kiosk 展示二维码和记录打开来源入口，不建模签到结果。

ALTER TABLE "JobFair" ADD COLUMN "checkinUrl" TEXT;
