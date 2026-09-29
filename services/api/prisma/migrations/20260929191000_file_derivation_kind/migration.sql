-- FileObject 增加 derivationKind：派生件是怎么来的（1.8 P-1，2026-09-29）。
--
-- 背景：打印前隐私检查（src/print-jobs/pii-scan-gate.ts）此前对 assetCategory 为
-- derived / optimized 的文件整类放行。图片转 PDF、Word 转 PDF、签名合成的产物内容就是用户材料
-- （例如身份证照片转成 PDF），却因此绕过了隐私检查。现有字段分不清来源：sourceFileId
-- 合同审查 AI 报告也带，purpose / assetCategory 与 AI 报告相同。
--
-- 取值由应用层校验：'format_conversion' | 'signature' | 'pii_redaction' | 'ai_generated'。
-- Additive only（无 DROP / 无 ALTER TYPE / 无 SET NOT NULL / 无默认值 / 不回填）：
--   存量行保持 NULL，闸门按「要检查」处理（失败关闭），见 src/print-jobs/material-check-policy.ts。

ALTER TABLE "FileObject" ADD COLUMN "derivationKind" TEXT;
