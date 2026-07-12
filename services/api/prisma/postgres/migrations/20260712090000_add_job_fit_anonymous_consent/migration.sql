-- 匿名岗位匹配授权绑定 parse 结果本身；随 parse TTL/删除治理，不创建独立长期同意记录。
ALTER TABLE "AiResumeResult" ADD COLUMN "jobAiConsentVersion" TEXT;
ALTER TABLE "AiResumeResult" ADD COLUMN "jobAiConsentGrantedAt" TIMESTAMP(3);
ALTER TABLE "AiResumeResult" ADD COLUMN "jobAiConsentRevokedAt" TIMESTAMP(3);
