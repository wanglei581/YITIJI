-- 招聘会资料打印桥接：新增 FairMaterialPrintBridge。
-- 全部 additive：仅 create table / create index；不 drop / 不 rename / 不改既有列。

CREATE TABLE "FairMaterialPrintBridge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "materialId" TEXT NOT NULL,
  "fileObjectId" TEXT,
  "sourceSha256" TEXT NOT NULL,
  "sourceSizeBytes" INTEGER NOT NULL,
  "sourceMimeType" TEXT NOT NULL,
  "activeKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'creating',
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "revokeReason" TEXT,
  "leaseUntil" DATETIME,
  "leaseToken" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FairMaterialPrintBridge_materialId_fkey"
    FOREIGN KEY ("materialId") REFERENCES "FairMaterial" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FairMaterialPrintBridge_fileObjectId_fkey"
    FOREIGN KEY ("fileObjectId") REFERENCES "FileObject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FairMaterialPrintBridge_fileObjectId_key" ON "FairMaterialPrintBridge"("fileObjectId");
CREATE UNIQUE INDEX "FairMaterialPrintBridge_activeKey_key" ON "FairMaterialPrintBridge"("activeKey");
CREATE INDEX "FairMaterialPrintBridge_materialId_sourceSha256_status_idx" ON "FairMaterialPrintBridge"("materialId", "sourceSha256", "status");
CREATE INDEX "FairMaterialPrintBridge_status_expiresAt_idx" ON "FairMaterialPrintBridge"("status", "expiresAt");
CREATE INDEX "FairMaterialPrintBridge_leaseUntil_idx" ON "FairMaterialPrintBridge"("leaseUntil");
