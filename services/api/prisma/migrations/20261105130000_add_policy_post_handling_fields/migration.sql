-- 政策办事三栏（2026-11-05 政策最小闭环，产品负责人拍板）：谁可以申请、要准备的材料、去哪办。
-- 机构发布时分开填，一体机详情与一页办事清单按三栏分块展示。存量行为空，页面写「发布机构没有提供」。
ALTER TABLE "PolicyPost" ADD COLUMN "whoCanApply" TEXT;
ALTER TABLE "PolicyPost" ADD COLUMN "requiredMaterials" TEXT;
ALTER TABLE "PolicyPost" ADD COLUMN "whereToApply" TEXT;
