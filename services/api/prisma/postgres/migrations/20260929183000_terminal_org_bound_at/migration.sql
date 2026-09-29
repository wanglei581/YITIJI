-- Terminal.orgBoundAt：当前 orgId 从什么时候开始生效。orgId 为空的行保持 NULL。
--
-- 回填只处理已经绑了机构的终端（orgId IS NOT NULL）：
--   1. 审计 terminal.org.update，payloadJson.newOrgId = 当前 orgId，
--      targetType = terminal 且 targetId = terminalCode
--   2. 审计 terminal.asset.create_planned，payloadJson.orgId = 当前 orgId，同样按 terminalCode
--   取这两者里较晚的一条。对不上当前机构的审计不用。
--   两条都没有时，用 Terminal.registeredAt（创建 / 注册时间）。
-- 解绑审计的 newOrgId 是 JSON null，不会被选进非空 orgId 的回填。
-- payloadJson 是 TEXT，按 JSON 取出机构 id。审计写入始终是 JSON.stringify 的对象。
ALTER TABLE "Terminal" ADD COLUMN "orgBoundAt" TIMESTAMP(3);

UPDATE "Terminal"
SET "orgBoundAt" = COALESCE(
  (
    SELECT MAX("createdAt")
    FROM "AuditLog"
    WHERE "targetType" = 'terminal'
      AND "targetId" = "Terminal"."terminalCode"
      AND (
        (
          "action" = 'terminal.org.update'
          AND ("payloadJson"::json->>'newOrgId') = "Terminal"."orgId"
        )
        OR (
          "action" = 'terminal.asset.create_planned'
          AND ("payloadJson"::json->>'orgId') = "Terminal"."orgId"
        )
      )
  ),
  "registeredAt"
)
WHERE "orgId" IS NOT NULL;
