-- CreateTable
CREATE TABLE "AiResumeResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "provider" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AiResumeResult_taskId_idx" ON "AiResumeResult"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "AiResumeResult_taskId_kind_key" ON "AiResumeResult"("taskId", "kind");
