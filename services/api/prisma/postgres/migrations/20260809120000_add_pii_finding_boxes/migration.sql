-- AlterTable: PiiFinding 增加文字层坐标(隐私遮挡一级能力)
-- boxesJson: JSON 数组 [{ pageNumber, x, y, width, height, pageWidth, pageHeight }],PDF 用户空间点(pt)。
-- 只含坐标,不含 PII 原文。null = 拿不到坐标(扫描件 / DOCX / 图片),该项不可遮挡。
ALTER TABLE "PiiFinding" ADD COLUMN "boxesJson" TEXT;
