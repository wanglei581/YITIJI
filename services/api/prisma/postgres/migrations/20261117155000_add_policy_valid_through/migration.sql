-- 政策截止日期（2026-11-17）：机构发布时选填。空表示一直有效，直到机构自己撤下。
-- 公开读取按北京时间自然日过滤；过了当天不再显示。存量行为空。
ALTER TABLE "PolicyPost" ADD COLUMN "validThrough" TIMESTAMP(3);
