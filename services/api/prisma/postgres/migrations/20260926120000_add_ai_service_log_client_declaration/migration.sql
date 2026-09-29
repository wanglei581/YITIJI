-- 未登录上传 / 录音 / AI 任务的声明快照。可空；只有状态和文案版本，不含个人身份。
ALTER TABLE "AiServiceLog" ADD COLUMN "clientDeclarationJson" TEXT;
