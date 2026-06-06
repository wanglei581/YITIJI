-- Phase A-2: AI求职材料中心材料处理任务骨架。
--
-- Additive only:
--   - DocumentProcessTask tracks inspection / A4 normalization / PII scan /
--     PII redaction / bundle rendering task state.
--   - PiiFinding stores bounded PII hit metadata and user decisions.
--   - No enterprise-side recruiting workflow state exists.

CREATE TABLE "DocumentProcessTask" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "requesterMode" TEXT NOT NULL DEFAULT 'anonymous',
  "accessTokenHash" TEXT,
  "sourceFileId" TEXT NOT NULL,
  "resultFileId" TEXT,
  "endUserId" TEXT,
  "paramsJson" TEXT NOT NULL DEFAULT '{}',
  "resultJson" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DocumentProcessTask_sourceFileId_fkey"
    FOREIGN KEY ("sourceFileId") REFERENCES "FileObject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DocumentProcessTask_resultFileId_fkey"
    FOREIGN KEY ("resultFileId") REFERENCES "FileObject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "DocumentProcessTask_endUserId_fkey"
    FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PiiFinding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "pageNumber" INTEGER,
  "snippet" TEXT,
  "confidence" REAL,
  "action" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PiiFinding_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "DocumentProcessTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DocumentProcessTask_kind_idx" ON "DocumentProcessTask"("kind");
CREATE INDEX "DocumentProcessTask_status_idx" ON "DocumentProcessTask"("status");
CREATE INDEX "DocumentProcessTask_requesterMode_idx" ON "DocumentProcessTask"("requesterMode");
CREATE INDEX "DocumentProcessTask_accessTokenHash_idx" ON "DocumentProcessTask"("accessTokenHash");
CREATE INDEX "DocumentProcessTask_sourceFileId_idx" ON "DocumentProcessTask"("sourceFileId");
CREATE INDEX "DocumentProcessTask_resultFileId_idx" ON "DocumentProcessTask"("resultFileId");
CREATE INDEX "DocumentProcessTask_endUserId_idx" ON "DocumentProcessTask"("endUserId");
CREATE INDEX "DocumentProcessTask_expiresAt_idx" ON "DocumentProcessTask"("expiresAt");
CREATE INDEX "PiiFinding_taskId_idx" ON "PiiFinding"("taskId");
CREATE INDEX "PiiFinding_type_idx" ON "PiiFinding"("type");
CREATE INDEX "PiiFinding_action_idx" ON "PiiFinding"("action");
