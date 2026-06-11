-- 2C 模拟面试:会话 / 对话轮次 / 报告(additive)
CREATE TABLE "MockInterviewSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endUserId" TEXT,
    "accessTokenHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "interviewerType" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 5,
    "questionTarget" INTEGER NOT NULL DEFAULT 5,
    "resumeFileId" TEXT,
    "resumeDigest" TEXT,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL
);
CREATE INDEX "MockInterviewSession_endUserId_createdAt_idx" ON "MockInterviewSession"("endUserId", "createdAt");
CREATE INDEX "MockInterviewSession_expiresAt_idx" ON "MockInterviewSession"("expiresAt");

CREATE TABLE "MockInterviewTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "qType" TEXT,
    "content" TEXT NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MockInterviewTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MockInterviewSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MockInterviewTurn_sessionId_idx_key" ON "MockInterviewTurn"("sessionId", "idx");
CREATE INDEX "MockInterviewTurn_sessionId_idx" ON "MockInterviewTurn"("sessionId");

CREATE TABLE "MockInterviewReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "MockInterviewReport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MockInterviewSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MockInterviewReport_sessionId_key" ON "MockInterviewReport"("sessionId");
CREATE INDEX "MockInterviewReport_expiresAt_idx" ON "MockInterviewReport"("expiresAt");
