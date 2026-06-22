-- Branch 2: 保存期限策略支持 long_term。
--
-- SQLite 不支持直接 DROP NOT NULL,通过重建 FileObject 表将 expiresAt 改为 nullable。
-- 仅改变 FileObject.expiresAt 空值能力,不修改 AiResumeResult.expiresAt 的历史 null 语义。

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_FileObject" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "storageKey" TEXT NOT NULL,
  "bucket" TEXT NOT NULL DEFAULT 'local-fs',
  "region" TEXT NOT NULL DEFAULT 'local',
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "uploaderId" TEXT,
  "endUserId" TEXT,
  "ownerType" TEXT,
  "ownerId" TEXT,
  "purpose" TEXT NOT NULL,
  "sensitiveLevel" TEXT NOT NULL DEFAULT 'normal',
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "expiresAt" DATETIME,
  "deletedAt" DATETIME,
  "deletedBy" TEXT,
  "deleteReason" TEXT,
  "assetCategory" TEXT NOT NULL DEFAULT 'original',
  "sourceFileId" TEXT,
  "retentionPolicy" TEXT,
  "retentionSetBy" TEXT,
  "retentionConsentAt" DATETIME,
  "retentionConsentVersion" TEXT,
  "retentionLockedReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FileObject_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "FileObject_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "FileObject_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "FileObject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_FileObject" (
  "id",
  "storageKey",
  "bucket",
  "region",
  "filename",
  "mimeType",
  "sizeBytes",
  "sha256",
  "uploaderId",
  "endUserId",
  "ownerType",
  "ownerId",
  "purpose",
  "sensitiveLevel",
  "visibility",
  "status",
  "createdBy",
  "expiresAt",
  "deletedAt",
  "deletedBy",
  "deleteReason",
  "assetCategory",
  "sourceFileId",
  "retentionPolicy",
  "retentionSetBy",
  "retentionConsentAt",
  "retentionConsentVersion",
  "retentionLockedReason",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "storageKey",
  "bucket",
  "region",
  "filename",
  "mimeType",
  "sizeBytes",
  "sha256",
  "uploaderId",
  "endUserId",
  "ownerType",
  "ownerId",
  "purpose",
  "sensitiveLevel",
  "visibility",
  "status",
  "createdBy",
  "expiresAt",
  "deletedAt",
  "deletedBy",
  "deleteReason",
  "assetCategory",
  "sourceFileId",
  "retentionPolicy",
  "retentionSetBy",
  "retentionConsentAt",
  "retentionConsentVersion",
  "retentionLockedReason",
  "createdAt",
  "updatedAt"
FROM "FileObject";

DROP TABLE "FileObject";
ALTER TABLE "new_FileObject" RENAME TO "FileObject";

CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");
CREATE INDEX "FileObject_uploaderId_idx" ON "FileObject"("uploaderId");
CREATE INDEX "FileObject_endUserId_idx" ON "FileObject"("endUserId");
CREATE INDEX "FileObject_ownerType_ownerId_idx" ON "FileObject"("ownerType", "ownerId");
CREATE INDEX "FileObject_purpose_idx" ON "FileObject"("purpose");
CREATE INDEX "FileObject_status_idx" ON "FileObject"("status");
CREATE INDEX "FileObject_expiresAt_idx" ON "FileObject"("expiresAt");
CREATE INDEX "FileObject_deletedAt_idx" ON "FileObject"("deletedAt");
CREATE INDEX "FileObject_sourceFileId_idx" ON "FileObject"("sourceFileId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
