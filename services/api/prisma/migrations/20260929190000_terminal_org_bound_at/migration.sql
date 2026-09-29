-- Terminal.orgBoundAt：当前 orgId 从什么时候开始生效。orgId 为空的行保持 NULL。
--
-- 回填只处理已经绑了机构的终端（orgId IS NOT NULL）：
--   1. 审计 terminal.org.update，payloadJson.newOrgId = 当前 orgId，
--      targetType = terminal 且 targetId = terminalCode
--   2. 审计 terminal.asset.create_planned，payloadJson.orgId = 当前 orgId，同样按 terminalCode
--   取这两者里较晚的一条。对不上当前机构的审计不用。
--   两条都没有时，用 Terminal.registeredAt（创建 / 注册时间）。
-- 解绑审计的 newOrgId 是 JSON null，不会被选进非空 orgId 的回填。
-- AuditLog.payloadJson 是字符串列：只对上面两种动作、且 json_valid 通过的行取值（CASE 保证先判后取），
-- 库里任何一行不是合法 JSON 都不会让迁移失败。
ALTER TABLE "Terminal" ADD COLUMN "orgBoundAt" DATETIME;

UPDATE "Terminal"
SET "orgBoundAt" = COALESCE(
  (
    SELECT MAX("createdAt")
    FROM "AuditLog"
    WHERE "targetType" = 'terminal'
      AND "targetId" = "Terminal"."terminalCode"
      AND "action" IN ('terminal.org.update', 'terminal.asset.create_planned')
      AND (
        CASE
          WHEN json_valid("payloadJson") = 0 THEN NULL
          WHEN "action" = 'terminal.org.update' THEN json_extract("payloadJson", '$.newOrgId')
          ELSE json_extract("payloadJson", '$.orgId')
        END
      ) = "Terminal"."orgId"
  ),
  "registeredAt"
)
WHERE "orgId" IS NOT NULL;
