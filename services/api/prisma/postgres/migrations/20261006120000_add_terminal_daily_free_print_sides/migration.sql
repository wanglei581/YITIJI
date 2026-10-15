-- 每台终端可覆盖「每天免费打印面数」。null = 用平台设置 print.freeQuota.terminalDailySides。
-- Terminal_planned_update_guard 只拦 UPDATE OF agentToken / lifecycleStatus / credentialGeneration。
-- Terminal_retired_update_guard 只在身份列变化时拦截。改这一列（以及 @updatedAt 刷新 lastSeenAt）两者都不触发。
ALTER TABLE "Terminal" ADD COLUMN "dailyFreePrintSides" INTEGER;
