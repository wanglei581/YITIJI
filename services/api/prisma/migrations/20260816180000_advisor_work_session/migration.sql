-- S3-3 · P26 顾问作业面（/ai/plan）后端建模。
--
-- 纯 additive：只建三张新表，不改任何既有表/列，因此对存量数据零影响。
-- PostgreSQL 侧一一对应 prisma/postgres/migrations/20260816180000_advisor_work_session。
--
-- ⚠️ 刻意不建 AdvisorTurn：设计页对用户的承诺是「对话不保存，只有主动钉住的条目会带进后续步骤」。
-- QA 多轮上下文只留在服务进程内存里（TTL + 上限），重启即失。

CREATE TABLE "AdvisorSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endUserId" TEXT,
    "accessTokenHash" TEXT,
    "skill" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'collecting',
    "topic" TEXT NOT NULL,
    "skillReason" TEXT,
    "skillSource" TEXT NOT NULL DEFAULT 'llm',
    "slotsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

CREATE INDEX "AdvisorSession_endUserId_createdAt_idx" ON "AdvisorSession"("endUserId", "createdAt");
CREATE INDEX "AdvisorSession_expiresAt_idx" ON "AdvisorSession"("expiresAt");

CREATE TABLE "AdvisorPin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "evidenceLevel" TEXT NOT NULL,
    "sourceNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdvisorPin_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AdvisorSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AdvisorPin_sessionId_idx_idx" ON "AdvisorPin"("sessionId", "idx");

CREATE TABLE "AdvisorArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "payloadJson" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "fileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "AdvisorArtifact_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AdvisorSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AdvisorArtifact_sessionId_createdAt_idx" ON "AdvisorArtifact"("sessionId", "createdAt");
CREATE INDEX "AdvisorArtifact_expiresAt_idx" ON "AdvisorArtifact"("expiresAt");
