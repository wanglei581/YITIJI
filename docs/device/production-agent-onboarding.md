# 生产 Windows Terminal Agent 授权与加固方案

> 目标：商用环境中云端是唯一打印任务源，Windows 主机只作为硬件执行器，避免本地 API 与远程 API 互相“打架”。

## 当前推荐流程

短期可落地方式：使用 `apps/terminal-agent/scripts/install-production-agent.ps1` 在 Windows 主机上固化生产配置。

脚本负责：

- 固定 `apiBaseUrl` 为生产云端 `/api/v1`；
- 固定 `terminalCode` / `terminalId`；
- 校验 Windows 打印机名；
- 使用 Windows DPAPI LocalMachine 加密保存 `agentToken`；
- 安装/启动 `AIJobPrintAgent` Windows 服务，并设置开机自启；
- 校验远程心跳在线。

示例：

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\terminal-agent\scripts\install-production-agent.ps1 `
  -ApiBaseUrl "https://api.example.com/api/v1" `
  -TerminalCode "KSK-001" `
  -TerminalId "t_ksk_001" `
  -AgentToken "<terminal-token>" `
  -PrinterName "Pantum CM2800ADN Series"
```

使用后台一次性绑定码（推荐商用流程）：

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\terminal-agent\scripts\install-production-agent.ps1 `
  -ApiBaseUrl "https://api.example.com/api/v1" `
  -TerminalCode "KSK-001" `
  -TerminalId "t_ksk_001" `
  -BindCode "<一次性绑定码>" `
  -PrinterName "Pantum CM2800ADN Series"
```

如果 token 已经保存在 `%ProgramData%\AIJobPrintAgent\agent.token`：

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\terminal-agent\scripts\install-production-agent.ps1 `
  -ApiBaseUrl "https://api.example.com/api/v1" `
  -TerminalCode "KSK-001" `
  -TerminalId "t_ksk_001" `
  -PrinterName "Pantum CM2800ADN Series" `
  -UseExistingToken
```

## 可靠性 P0：安装、诊断与恢复

本轮可靠性 P0 已在本地代码与静态门禁层完成以下收口：配置文件开头的 UTF-8 BOM 会被兼容；启动时会分类报告无效配置或 token；这两类异常均不得领取打印任务或触发打印。配置与 token 写入采用原子替换；last-known-good 只保留为人工恢复候选，**不会**自动回退覆盖当前配置。启动诊断保持非阻塞，且本地诊断脚本只读。

Windows 服务只配置有限的 SCM 恢复策略：首次失败后等待 60 秒，第二次失败后等待 300 秒，第三次不自动操作；失败计数每天重置。该策略只降低短暂进程失败后的人工介入压力，不证明服务、云端连接或硬件已经恢复。

在 Windows 主机上可复制执行下列只读诊断命令：

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\terminal-agent\scripts\diagnose-production-agent.ps1
sc.exe qfailure AIJobPrintAgent
Get-CimInstance Win32_Service -Filter "Name='AIJobPrintAgent'" | Select-Object Name, State, StartMode, ProcessId, PathName
```

`AGENT_READY` 仅表示本地 Agent 启动成功；云端心跳在线和终端 `enabled` 状态仍须在 Admin 中单独验证，不能由该日志或本地服务状态替代。

### Windows 无打印验收（须另行授权）

以下六步需要 Windows 管理员权限，并且先确认空队列；**不随代码合并自动执行**：

1. 只能在**与目标终端使用同一生产或试运营 API/数据库的经授权运维主机**上，先按[《打印扫描 PS-G1~PS-G4 执行清单》§四「服务器候选验证（PS-G1 / PS-G2）」](../acceptance/print-scan-field-execution-runbook.md#四服务器候选验证ps-g1--ps-g2)的既有环境加载方式执行下列只读 gate。`$DATABASE_URL` 必须由该主机的既有受控环境加载；`$TERMINAL_ID` 必须是已在 Admin 或运行配置中确认的目标终端 ID。不得手填、打印或从聊天复制 `DATABASE_URL`；Mac 本地或浏览器查询不能替代。两次查询各自重复 CTE（PostgreSQL 的 CTE 只作用于紧随其后的语句）：

   ```bash
   if [ -z "${DATABASE_URL:-}" ] || [ -z "${TERMINAL_ID:-}" ]; then
     printf '%s\n' 'DATABASE_URL or TERMINAL_ID is missing; refusing to run the queue gate.' >&2
     exit 1
   fi

   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v terminal_id="$TERMINAL_ID" <<'SQL'
   \pset pager off

   BEGIN READ ONLY;

   WITH active_tasks AS (
     SELECT
       pt."id",
       pt."terminalId",
       pt."status",
       pt."claimedAt",
       pt."claimExpiry",
       pt."completedAt",
       pt."createdAt",
       pt."updatedAt",
       o."id" AS "orderId",
       o."payStatus",
       o."taskStatus",
       o."amountCents"
     FROM "PrintTask" pt
     LEFT JOIN "Order" o ON o."printTaskId" = pt."id"
     WHERE pt."terminalId" = :'terminal_id'
       AND pt."status" IN ('pending', 'claimed', 'printing')
   )
   SELECT COUNT(*) AS active_task_count FROM active_tasks;

   WITH active_tasks AS (
     SELECT
       pt."id",
       pt."terminalId",
       pt."status",
       pt."claimedAt",
       pt."claimExpiry",
       pt."completedAt",
       pt."createdAt",
       pt."updatedAt",
       o."id" AS "orderId",
       o."payStatus",
       o."taskStatus",
       o."amountCents"
     FROM "PrintTask" pt
     LEFT JOIN "Order" o ON o."printTaskId" = pt."id"
     WHERE pt."terminalId" = :'terminal_id'
       AND pt."status" IN ('pending', 'claimed', 'printing')
   )
   SELECT *
   FROM active_tasks
   ORDER BY "createdAt" ASC;

   COMMIT;
   SQL
   ```

   仅当输出同时为 `active_task_count = 0` 且 `SELECT * FROM active_tasks` 为 `0 rows` 时，才可继续 BOM / 服务重启步骤；否则停止，不创建、领取、处置或打印任务。
2. 备份当前 Agent 配置与 token 文件；不得把其内容截图、粘贴或发送到聊天。
3. 只在配置文件开头添加 BOM，除此以外不改配置。
4. 重启 `AIJobPrintAgent` 服务。
5. 运行上述诊断、检查 `qfailure`，并在 Admin 核验云端心跳。
6. 恢复为无 BOM 的原配置，再次确认 `active_task_count = 0` 与 `active_tasks` 为 `0 rows`。

该验收全程禁止打印、禁止 `POST /print`、禁止创建任务；也禁止在聊天中发送配置、token 或其截图。未获 Windows 管理员与空队列确认前，不得把服务恢复、真实心跳或物理打印写为已验证。

## 商用正式方案：后台绑定码

管理员后台已提供“终端授权/重绑”能力：

1. 管理员在后台创建或选择终端；
2. 后台生成 20 位一次性绑定码，默认 10 分钟过期，最长 60 分钟；
3. Windows 主机安装脚本输入绑定码；
4. Agent 用绑定码换取 `terminalId` + `agentToken`；
5. 绑定码立即失效；
6. Agent 写入生产配置，DPAPI 加密保存 token，安装并启动服务。

当前后端 API 已接入该闭环：

```text
POST /api/v1/admin/terminals/:terminalId/bind-code
  管理员生成一次性绑定码，明文只返回一次。

POST /api/v1/auth/terminal/exchange-bind-code
  Windows Agent 安装脚本用绑定码换取 terminalId + terminalToken。
```

安全要求：

- Windows 主机不得保存 `TERMINAL_ADMIN_SECRET`；
- 绑定码只能使用一次，且短时有效；
- 同一终端重新生成绑定码时，旧的未使用 / 未过期绑定码会被撤销；
- 重新绑定同一 `terminalCode` 时旧 token 必须立即失效；
- 生成绑定码、兑换绑定码、重绑必须写审计日志；解绑如后续实现，也必须写审计日志；
- 绑定时记录主机名、MAC、设备指纹、Agent 版本、打印机名；
- 本地调试配置必须与生产配置分离，不允许同一时间两个 Agent 监听同一打印机。

## 环境原则

商用默认：

```text
Kiosk 前端 → 云端 API
Windows Agent → 云端 API
云端数据库 → 唯一任务真相源
Windows 主机 → 只执行打印/扫描/外设交互
```

本地 API 只用于开发调试、工厂测试或离线诊断，不作为商用订单/打印任务来源。

Terminal Agent 运行时已有互斥保护：`agent` 启动时如果发现 `apiBaseUrl` 指向 `localhost` / `127.0.0.1` / `::1` / `0.0.0.0`，默认拒绝启动。只有明确设置以下环境变量时，才允许连接本地 API：

```powershell
$env:AGENT_PROFILE = "local-debug"
node dist/index.js agent
```

该开关只用于开发或现场隔离诊断。商用 Windows 服务不得设置 `AGENT_PROFILE=local-debug`。
