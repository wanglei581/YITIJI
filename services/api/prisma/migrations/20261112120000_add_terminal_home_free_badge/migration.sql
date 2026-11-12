-- 一体机首页「免费使用」按机器开关。默认开。价目不是 0 时一体机仍不显示。
ALTER TABLE "Terminal" ADD COLUMN "homeFreeBadge" BOOLEAN NOT NULL DEFAULT true;
