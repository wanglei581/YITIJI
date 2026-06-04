-- AlterTable: 简历派生结果留存治理(CLAUDE.md §11) — 新增到期时间列
ALTER TABLE "AiResumeResult" ADD COLUMN "expiresAt" DATETIME;

-- CreateIndex: cleanup cron 按 expiresAt < now 扫描，建索引避免全表扫
CREATE INDEX "AiResumeResult_expiresAt_idx" ON "AiResumeResult"("expiresAt");
