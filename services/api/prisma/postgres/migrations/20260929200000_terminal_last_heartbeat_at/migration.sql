-- 走查 W-04：从没连过的终端在后台显示「最近心跳 刚刚」。
-- 新增 Terminal.lastHeartbeatAt，只在 Agent 心跳时写；null = 从未心跳。
-- 存量按心跳表回填最近一条（心跳表保留 90 天，更早的只能留空）。
ALTER TABLE "Terminal" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);

UPDATE "Terminal" AS t
SET "lastHeartbeatAt" = h."latest"
FROM (
  SELECT "terminalId", MAX("createdAt") AS "latest" FROM "TerminalHeartbeat" GROUP BY "terminalId"
) AS h
WHERE h."terminalId" = t."id";
