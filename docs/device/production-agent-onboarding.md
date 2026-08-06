# 生产 Windows Terminal Agent 授权与加固方案

> 目标：商用环境中云端是唯一打印任务源，Windows 主机只作为硬件执行器，避免本地 API 与远程 API 互相“打架”。

## 当前推荐流程

对 `0.3.1` 及后续 MSI/EXE 候选，推荐使用安装后的图形配置向导：

1. 管理员后台进入「设备管理」，预创建设备并生成短时一次性绑定码；
2. Windows 开始菜单打开「AI求职打印终端配置」并通过 UAC；
3. 确认生产 API，粘贴绑定码，从 Windows 真实打印机列表中选择打印机；
4. 填写 Kiosk Origin；只有打印机面板到 SMB 已配置时才填写扫描接收目录，按需输入本地桥接令牌；
5. 点击「激活并启动」，完成后在 Admin 核对三分钟内心跳、Agent 版本、链路诊断和打印机状态；
6. 使用一页无敏感内容 PDF 做一次受控真机出纸。扫描另按打印机面板 → SMB 接收目录验收，不能由服务 Running 代替。

BindCode 和 bridge token 只在已提升的 GUI 进程内以 `SecureString` 传递，不进入快捷方式、子进程命令行或 PowerShell 历史。后台不再生成带明文 `-BindCode` 的命令。首次配置不会自动选择排序第一的打印机，也不会默认创建扫描目录；操作员必须显式选择真实打印机，扫描目录留空不会启动 watcher。换发 BindCode 前先停止旧 Agent，避免旧 token 的 401 在换发窗口重新写入 unauthorized latch；向导只在 token 文件哈希确实变化时提示“新凭据已保存”，无效/过期绑定码不会被磁盘上的旧凭据掩盖。未激活时服务保持 Manual/Stopped；向导成功后才切换 Automatic/Running。

从 `0.3.0` 升级时直接运行新版 EXE。升级必须保留 `%ProgramData%\AIJobPrintAgent`；未激活主机仍保持 Manual/Stopped。已经存在受保护凭据的主机，升级后从开始菜单打开向导，保持「使用这台电脑已保存的设备凭据重新配置」并点击「激活并启动」，不生成或重复使用旧绑定码。Windows CI 会覆盖 `0.3.0 → 0.3.1` 未激活升级；已激活服务的 Running 状态和真实心跳仍以隔离真机验收为准。

既有 `apps/terminal-agent/scripts/install-production-agent.ps1` 保留为受控运维回退入口，不作为普通装机人员的默认操作。

脚本负责：

- 固定 `apiBaseUrl` 为生产云端 `/api/v1`；
- 固定 `terminalCode` / `terminalId`；
- 校验 Windows 打印机名；
- 通过 `-PromptForBindCode` 安全交互输入一次性绑定码（推荐），或复用已有 DPAPI token 文件（`-UseExistingToken`）；兼容参数 `-BindCode` 仅用于受控旧流程，因为它会进入进程命令行；
- 写入真实 Kiosk Origin、可选 SMB 扫描目录和本地桥接配置；重装未显式传入时保留现有可选配置；
- **不再接受**长期 `-AgentToken` 命令行入参（Gate 0.4：避免 token 进入进程 argv / PowerShell 历史）；
- 使用 Windows DPAPI LocalMachine 加密保存 `agentToken`；
- 将 `%ProgramData%\AIJobPrintAgent`（及 `agent.token`）ACL 收紧为 **SYSTEM + Administrators**，并禁用继承；
- 安装/启动 `AIJobPrintAgent` Windows 服务，并设置开机自启；
- 在停止旧服务后记录云端心跳基线，并只接受本次服务启动后更晚的新心跳；最近五分钟内的旧 `isOnline` 状态不能单独判定激活成功。

受控 CLI 回退流程：

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\terminal-agent\scripts\install-production-agent.ps1 `
  -ApiBaseUrl "https://api.example.com/api/v1" `
  -TerminalCode "KSK-001" `
  -TerminalId "t_ksk_001" `
  -PromptForBindCode `
  -PrinterName "<Get-Printer 返回的准确名称>" `
  -LocalApiAllowedOrigins "https://kiosk.example.com" `
  -ScanWatchFolder "C:\AIJobPrint\scan-inbox"
```

如启用 QR / U 盘本地桥接，再增加 `-PromptForLocalApiBridgeToken`，并在提示中输入与受控 Kiosk 发布配置一致的令牌。绑定码和桥接令牌均不得直接写入命令、聊天、工单或安装日志。`ScanWatchFolder` 必须是现存本地目录且不能是 reparse point；LocalSystem 服务不要使用当前登录用户的映射盘符。

重装未显式传值时，脚本只从 ACL 已受保护的现有配置保留 `scanWatchFolder`、`localApiAllowedOrigins`、`localApiPort` 与 `localApiBridgeToken`。需要撤销已下线、失控或误配的历史 Origin 时，增加 `-ReplaceLocalApiAllowedOrigins` 并传入新的完整额外 Origin 列表；仅传替换开关而不传列表，可清除全部历史额外 Origin，但仍固定保留 API 同源 Origin 与本机开发 Origin。`-KioskOrigins` / `-ReplaceKioskOrigins` 仅为旧命令兼容别名，新运维记录统一使用正式参数，禁止直接编辑受保护配置。

如果 token 已经保存在 `%ProgramData%\AIJobPrintAgent\agent.token`：

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\terminal-agent\scripts\install-production-agent.ps1 `
  -ApiBaseUrl "https://api.example.com/api/v1" `
  -TerminalCode "KSK-001" `
  -TerminalId "t_ksk_001" `
  -PrinterName "<Get-Printer 返回的准确名称>" `
  -UseExistingToken
```

> 生产安装不得从可被 Kiosk 用户或普通登录用户写入的 Git checkout 运行。安装脚本会在兑换 BindCode 前递归校验 Agent runtime、Node 依赖树和 `node.exe` 的 owner、写权限与 reparse point；校验失败会拒绝启动服务。请先由受控发布流程把完整 runtime 放入受保护目录（通常为 `Program Files` 下的签名发布目录），再执行下列命令。

> Gate 0.4 Wave A 说明：静态门禁可证明安装脚本移除了 CLI token 入参并写入 ACL 逻辑；Windows 真机 ACL / 服务仍需另行授权验收，不得仅凭静态 verify 宣称现场完成。

### Gate 0.4 Wave B：凭证失效本地 fail-closed

API 返回 **401**（吊销 / 过期 / 无效 token）时，Agent **无法**再通过心跳上报云端“unauthorized”状态（该请求本身会被拒）。因此：

- 进程内 latch：停止 claim / 新打印 / offline status 重试；
- 本地诊断码：`AGENT_UNAUTHORIZED`（`%ProgramData%\AIJobPrintAgent\last-startup-diagnostic.json`）；
- 恢复：Admin 重新签发 BindCode → Windows 开始菜单图形配置向导重新激活；受控运维也可用安装脚本 `-PromptForBindCode` 换发并重启服务（或成功 `persistRegistration` 后清除 latch）。

`agent_degraded`（本地 SQLite 不可用）与 `AGENT_UNAUTHORIZED`（云端凭证失效）是两条独立路径，不得互相冒充。

### Gate 0.4 11c：Windows 真机验收清单（须另授写操作）

静态 verify / 安装脚本合同**不能**替代本表。执行前确认目标终端空队列（无 `pending/claimed/printing` 打印任务、无 `waiting/matched` 扫描任务），且已取得用户点名授权（含是否允许紧急吊销演练）。

| # | 步骤 | 通过标准 | 证据 |
|---|---|---|---|
| 1 | 只读诊断 | `diagnose-production-agent.ps1` 可运行；服务 `AIJobPrintAgent` Running / Auto | 命令输出截图 |
| 2 | ProgramData / runtime ACL | `diagnose-production-agent.ps1` 输出 `programDataAclStatus=ok`、`tokenFileAclStatus=ok` 且 `runtimeRootAclStatus=ok`（ProgramData 继承已禁用，仅 SYSTEM `S-1-5-18` + Administrators `S-1-5-32-544`；服务加载的 Agent runtime、Node 依赖树和配置目录不得被普通用户写入）；普通用户读 token 失败 | 诊断对象 + `icacls` 佐证 |
| 3 | 无 CLI Token | 当前/历史安装命令未使用 `-AgentToken` 或明文 `-BindCode`；普通装机使用图形向导，受控回退使用 `-PromptForBindCode` 或 `-UseExistingToken` | 安装记录 |
| 4 | 紧急吊销（另授） | Admin 对目标终端执行紧急吊销后，Agent 停止 claim；本地诊断出现 `AGENT_UNAUTHORIZED`；云端不得仅凭“心跳 unauthorized 态”判定（401 无法上报） | Admin 审计 + 本地 `last-startup-diagnostic.json` |
| 5 | BindCode 恢复（另授） | 新一次性 BindCode + 安装脚本换发后 latch 清除，心跳恢复，可再 claim | 心跳时间 + 一笔受控打印（若另授出纸） |
| 6 | 回归 | 吊销/恢复后打印机 `ready`、无残留 active 任务 | DB/Admin 只读 |

禁止：未授权吊销生产终端；把静态 `verify:agent-unauthorized` 写成现场完成；把 `agent_degraded` 与 `AGENT_UNAUTHORIZED` 混记；把 `runtimeRootAclStatus=too_permissive` 的仓库目录注册为 LocalSystem 商用 runtime。

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
