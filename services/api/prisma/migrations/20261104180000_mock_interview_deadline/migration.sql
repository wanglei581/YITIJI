-- 只有一体机带标记开始的场次才有；空 = 不限时。
ALTER TABLE "MockInterviewSession" ADD COLUMN "deadlineAt" DATETIME;
