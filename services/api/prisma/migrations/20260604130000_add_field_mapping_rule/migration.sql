-- T1: FieldMappingRule — 按 (sourceId, dataType) 保存可复用的 Excel 字段映射规则。
-- 让合作机构二次导入时自动回填上次映射,无需重复手工映射列。
-- mappingJson 只存 { standardField: excelColumnHeader } 结构,不含任何行数据 / PII。
--
-- 注:dev.db 存在历史 drift(本地迁移与 _prisma_migrations 表不一致),
-- 沿用 AiResumeResult expiresAt 的先例,本迁移通过 `prisma db execute` 非破坏性应用,
-- 不做 `migrate dev` 破坏性 reset。

-- CreateTable
CREATE TABLE "FieldMappingRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "mappingJson" TEXT NOT NULL DEFAULT '{}',
    "updatedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FieldMappingRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FieldMappingRule_sourceId_dataType_key" ON "FieldMappingRule"("sourceId", "dataType");

-- CreateIndex
CREATE INDEX "FieldMappingRule_orgId_idx" ON "FieldMappingRule"("orgId");

-- CreateIndex
CREATE INDEX "FieldMappingRule_sourceId_idx" ON "FieldMappingRule"("sourceId");
