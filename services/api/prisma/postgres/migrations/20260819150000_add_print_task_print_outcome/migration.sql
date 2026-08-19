-- Admin 现场核查结果：与 PRINT_JOB_UNCONFIRMED 历史原因正交。
-- Additive only：可空列，历史任务保持未核查。

ALTER TABLE "PrintTask" ADD COLUMN "printOutcome" TEXT;
