-- B1-1: ScanTask 增加 controlTokenHash（可空，additive）。
-- 用于后续（Task B1-3）扫描会话访问控制 token 校验；本迁移仅加字段，不写入任何业务逻辑。
ALTER TABLE "ScanTask" ADD COLUMN "controlTokenHash" TEXT;
