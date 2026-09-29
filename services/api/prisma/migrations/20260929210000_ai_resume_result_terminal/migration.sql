-- 简历「按原样导出」核对草稿来源：AI 结果记下生成时已验签的一体机编号，见 src/ai/resume/resume-draft-source.service.ts。
ALTER TABLE "AiResumeResult" ADD COLUMN "terminalId" TEXT;

CREATE INDEX "AiResumeResult_terminalId_idx" ON "AiResumeResult"("terminalId");
