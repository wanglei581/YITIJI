-- 模拟面试报告失败免费再试与终态防并发保护。不新增表。
ALTER TABLE "ServiceOrder" ADD COLUMN "reportState" TEXT;
CREATE INDEX "ServiceOrder_status_reportState_retryUntil_idx" ON "ServiceOrder"("status", "reportState", "retryUntil");
