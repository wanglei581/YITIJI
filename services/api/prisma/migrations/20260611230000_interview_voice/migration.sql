-- 2C+ 语音增强:回合输入方式/转写/耗时(additive)
ALTER TABLE "MockInterviewSession" ADD COLUMN "interactionMode" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "MockInterviewTurn" ADD COLUMN "inputMode" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "MockInterviewTurn" ADD COLUMN "transcriptText" TEXT;
ALTER TABLE "MockInterviewTurn" ADD COLUMN "transcriptEdited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MockInterviewTurn" ADD COLUMN "answerDurationSec" INTEGER;
