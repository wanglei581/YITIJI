# 打印扫描 PS-G1~PS-G4 执行清单

> 状态：执行清单，不代表现场验收已完成。
> 适用范围：正式域名 / HTTPS 仍在审批时，先完成不依赖正式域名的 Mac 本地准备、服务器候选验证、Windows 一体机真机验收。
> 原始截图、命令日志、SQL 输出、真机照片、打印实物照片和 Windows 现场日志必须保存到仓库外私有证据目录；Git 仓库只记录脱敏摘要和证据 ID。

## 一、执行原则

- Mac 负责代码验证、证据包准备、候选构建检查和命令整理。
- 服务器负责 PostgreSQL migration、运行时 hash、API health、Admin / Kiosk 候选入口可达性。
- Windows 主机负责 Terminal Agent、奔图真机出纸、Agent 降级 / 恢复、断网 / 断电、临时文件删除和外设能力验证。
- 正式域名 / HTTPS 审批中时不作为当前阻塞项；使用候选公网 IP、临时入口或内网地址完成非域名 Gate，但最终上线前必须补正式域名 / HTTPS Gate。
- 不把 `PS-G0 Passed Locally` 写成 `PS-G1~PS-G4 Passed`；未执行的现场项保持 `Not Passed Yet`。

## 二、证据目录

所有执行端都使用仓库外目录。不要把截图、日志、数据库备份、`.env`、真实用户文件放进 Git 仓库。

Mac:

```bash
export EVIDENCE_ROOT="/tmp/ai-job-print-evidence/print-scan-$(date +%Y%m%d%H%M%S)"
mkdir -p "$EVIDENCE_ROOT"/{PS-G0,PS-G1,PS-G2,PS-G3,PS-G4}
printf '%s\n' "$EVIDENCE_ROOT"
```

服务器:

```bash
export EVIDENCE_ROOT="/srv/ai-job-print-evidence/print-scan-$(date +%Y%m%d%H%M%S)"
mkdir -p "$EVIDENCE_ROOT"/{PS-G1,PS-G2,PS-G3,PS-G4}
chmod 700 "$EVIDENCE_ROOT"
printf '%s\n' "$EVIDENCE_ROOT"
```

Windows PowerShell:

```powershell
$EvidenceRoot = Join-Path $env:TEMP ("ai-job-print-evidence\print-scan-" + (Get-Date -Format "yyyyMMddHHmmss"))
New-Item -ItemType Directory -Force -Path `
  (Join-Path $EvidenceRoot "PS-G1"), `
  (Join-Path $EvidenceRoot "PS-G2"), `
  (Join-Path $EvidenceRoot "PS-G3"), `
  (Join-Path $EvidenceRoot "PS-G4") | Out-Null
Write-Host $EvidenceRoot
```

## 三、Mac 本地准备（PS-G0）

目标：证明当前候选代码、迁移、CI 门禁和 Agent 静态安全检查都可复验。Mac 不能替代 Windows 真机验收。

```bash
git branch --show-current | tee "$EVIDENCE_ROOT/PS-G0/git-branch.log"
git rev-parse --short HEAD | tee "$EVIDENCE_ROOT/PS-G0/git-head.log"
git status --short --branch | tee "$EVIDENCE_ROOT/PS-G0/git-status.log"

pnpm --filter @ai-job-print/api typecheck 2>&1 | tee "$EVIDENCE_ROOT/PS-G0/api-typecheck.log"
pnpm --filter @ai-job-print/api verify:print-scan-first-release 2>&1 | tee "$EVIDENCE_ROOT/PS-G0/verify-print-scan-first-release.log"
pnpm --filter @ai-job-print/api verify:print-jobs 2>&1 | tee "$EVIDENCE_ROOT/PS-G0/verify-print-jobs.log"
pnpm --filter terminal-agent typecheck 2>&1 | tee "$EVIDENCE_ROOT/PS-G0/terminal-agent-typecheck.log"
pnpm --filter terminal-agent verify:print-scan-agent 2>&1 | tee "$EVIDENCE_ROOT/PS-G0/verify-print-scan-agent.log"
pnpm --filter terminal-agent verify:printer-config 2>&1 | tee "$EVIDENCE_ROOT/PS-G0/verify-printer-config.log"
git diff --check 2>&1 | tee "$EVIDENCE_ROOT/PS-G0/git-diff-check.log"
```

如果 Mac 当前 shell 已安全配置候选 PostgreSQL `DATABASE_URL`，可额外执行 schema 漂移检查；否则把这一步留到服务器 PS-G2：

```bash
if [ -n "$DATABASE_URL" ]; then
  pnpm --filter @ai-job-print/api db:pg:sync:check 2>&1 | tee "$EVIDENCE_ROOT/PS-G0/pg-sync-check.log"
else
  printf '%s\n' "skip: DATABASE_URL is not configured on Mac; run db:pg:sync:check in PS-G2" \
    | tee "$EVIDENCE_ROOT/PS-G0/pg-sync-check-skipped.log"
fi
```

通过标准：

- 所有命令退出码为 0。
- 未配置候选 PostgreSQL 的 Mac 可以跳过 `db:pg:sync:check`，但服务器 PS-G2 必须执行并通过。
- `verify:print-jobs` 输出包含“Agent 降级时后端 claim 二道闸门 → 不下发任务且任务保持 pending”。
- `verify:print-scan-first-release` 输出包含 CI 接线、证据包结构和过度宣称防线 PASS。
- `git status` 中如果存在与本任务无关的脏文件，必须在摘要中标注“未纳入本轮验收候选”。

## 四、服务器候选验证（PS-G1 / PS-G2）

目标：在不依赖正式域名 / HTTPS 的前提下，证明候选服务器 PostgreSQL、migration、API health 和运行时可达。

前置：

- 只使用服务器已有的安全方式加载环境变量；禁止把 `DATABASE_URL`、Redis、COS、JWT、Terminal secret 打印到日志。
- 如果当前服务器不是本次候选部署目标，只做只读预检，不执行 migration。

### 4.1 只读预检

```bash
cd <PREPROD_OR_PROD_ROOT>/current

node -v 2>&1 | tee "$EVIDENCE_ROOT/PS-G1/node-version.log"
pnpm -v 2>&1 | tee "$EVIDENCE_ROOT/PS-G1/pnpm-version.log"
test -f DEPLOY_SOURCE.txt && sed -n '1,80p' DEPLOY_SOURCE.txt | tee "$EVIDENCE_ROOT/PS-G1/deploy-source.log"

curl -fsS "http://127.0.0.1:<API_LOCAL_PORT>/api/v1/health" \
  2>&1 | tee "$EVIDENCE_ROOT/PS-G1/api-health-local.log"

curl -fsS "http://<CANDIDATE_PUBLIC_HOST>:<KIOSK_PORT>/api/v1/health" \
  2>&1 | tee "$EVIDENCE_ROOT/PS-G1/api-health-public.log"
```

通过标准：

- health 返回成功且数据库指向 PostgreSQL。
- 日志不包含任何连接串、token、cookie 或密钥。
- 正式域名未就绪时，记录为“临时入口验收”，不得写成正式域名验收通过。

### 4.2 PostgreSQL 备份和 migration

只在明确选择该服务器作为候选环境时执行：

```bash
cd <PREPROD_OR_PROD_ROOT>/current

test -n "$DATABASE_URL" || { echo "DATABASE_URL missing in current shell"; exit 1; }

pg_dump --format=custom --file="$EVIDENCE_ROOT/PS-G2/PS-G2-01-pre-print-scan.dump" "$DATABASE_URL"
pg_restore -l "$EVIDENCE_ROOT/PS-G2/PS-G2-01-pre-print-scan.dump" \
  2>&1 | tee "$EVIDENCE_ROOT/PS-G2/PS-G2-01-backup-readable.log"

pnpm --filter @ai-job-print/api db:pg:deploy \
  2>&1 | tee "$EVIDENCE_ROOT/PS-G2/PS-G2-02-migrate-deploy.log"

pnpm --filter @ai-job-print/api db:pg:sync:check \
  2>&1 | tee "$EVIDENCE_ROOT/PS-G2/PS-G2-02-pg-sync-check.log"

curl -fsS "http://127.0.0.1:<API_LOCAL_PORT>/api/v1/health" \
  2>&1 | tee "$EVIDENCE_ROOT/PS-G2/PS-G2-04-api-health-after-migration.log"
```

通过标准：

- `pg_restore -l` 能读取备份目录。
- migration 日志显示本次 `TerminalHeartbeat` additive migration 已执行或目标库已 up to date。
- `db:pg:sync:check` 通过。
- migration 后 API health 正常。

## 五、Windows 主机预检（PS-G1）

目标：确认 Windows 环境、Terminal Agent 配置、奔图驱动和 API 连接可用。

在 Windows PowerShell 中执行：

```powershell
cd "<PROJECT_ROOT>"

git branch --show-current | Tee-Object (Join-Path $EvidenceRoot "PS-G1\git-branch.log")
git rev-parse --short HEAD | Tee-Object (Join-Path $EvidenceRoot "PS-G1\git-head.log")
node -v | Tee-Object (Join-Path $EvidenceRoot "PS-G1\node-version.log")
pnpm -v | Tee-Object (Join-Path $EvidenceRoot "PS-G1\pnpm-version.log")

pnpm --filter terminal-agent typecheck 2>&1 | Tee-Object (Join-Path $EvidenceRoot "PS-G1\terminal-agent-typecheck.log")
pnpm --filter terminal-agent verify:printer-config 2>&1 | Tee-Object (Join-Path $EvidenceRoot "PS-G1\verify-printer-config.log")
pnpm --filter terminal-agent verify:print-scan-agent 2>&1 | Tee-Object (Join-Path $EvidenceRoot "PS-G1\verify-print-scan-agent.log")

pnpm --filter terminal-agent list-printers 2>&1 | Tee-Object (Join-Path $EvidenceRoot "PS-G1\list-printers.log")
Get-Printer | Where-Object { $_.Name -like "*Pantum*" } |
  Select-Object Name, DriverName, PortName, PrinterStatus |
  Format-List | Tee-Object (Join-Path $EvidenceRoot "PS-G1\pantum-printer.log")
```

配置文件检查：

```powershell
if (!(Test-Path ".\apps\terminal-agent\config\agent-config.json")) {
  Copy-Item ".\apps\terminal-agent\config\agent-config.example.json" ".\apps\terminal-agent\config\agent-config.json"
  Write-Host "agent-config.json created from example. Fill it before continuing."
}
notepad ".\apps\terminal-agent\config\agent-config.json"
```

`agent-config.json` 必须满足：

- `apiBaseUrl` 指向候选 API，例如 `http://<CANDIDATE_PUBLIC_HOST>:<KIOSK_PORT>/api/v1` 或内网 API 地址。
- `terminalCode` 是本台一体机的逻辑编号。
- `adminSecret` 只在首次注册前填写，注册成功后会被清除。
- `printerName` 必须填写 Windows 真实识别名，不允许留空。
- `localApiAllowedOrigins` 至少包含本机 Kiosk 运行地址。

通过标准：

- `list-printers` 能看到奔图打印机。
- `verify:printer-config` 通过，证明没有可执行默认打印机硬编码。
- `agent-config.json` 不包含明文 `agentToken`；注册后 token 应进入 DPAPI 加密存储。

## 六、Windows Agent 前台启动与心跳（PS-G1）

先用前台模式验收，确认无误后再安装 Windows 服务。

PowerShell 窗口 A：

```powershell
cd "<PROJECT_ROOT>"
pnpm --filter terminal-agent agent 2>&1 | Tee-Object (Join-Path $EvidenceRoot "PS-G1\agent-foreground.log")
```

在 Admin 终端页或后端只读查询中确认：

- 目标终端在线。
- `terminalId` 与本机配置一致。
- `printerStatus`、`diskFreeGB`、`agentVersion` 有心跳记录。
- 不截图或复制 token、cookie、完整 IP、真实用户文件。

通过标准：

- `agent-foreground.log` 显示 `agent ready` 和 `heartbeat: ✓ acknowledged`。
- Admin 终端页显示该终端在线。

## 七、真实打印任务验收（PS-G3）

目标：验证后端任务只被目标终端领取，并且真实出纸状态链路正确。

### 7.1 本地直接打印烟测

先创建一份不含个人信息的测试 PDF。该文件只用于出纸烟测，不包含姓名、手机号、简历正文、头像或真实公司信息。

```powershell
$SampleDir = "C:\ai-job-print-test"
$SamplePdf = Join-Path $SampleDir "sample.pdf"
New-Item -ItemType Directory -Force -Path $SampleDir | Out-Null
$env:SAMPLE_PDF = $SamplePdf
pnpm --filter terminal-agent exec node -e "const fs=require('fs'); const PDFDocument=require('pdfkit'); const doc=new PDFDocument(); doc.pipe(fs.createWriteStream(process.env.SAMPLE_PDF)); doc.fontSize(20).text('AI Job Print Test - no personal data', 72, 120); doc.fontSize(12).text(new Date().toISOString(), 72, 160); doc.end();"
Get-Item $SamplePdf | Select-Object FullName, Length, LastWriteTime |
  Format-List | Tee-Object (Join-Path $EvidenceRoot "PS-G3\sample-pdf-created.log")
```

用 `list-printers` 里看到的真实打印机名称执行打印。下面的 `Pantum CM2800ADN Series` 是已知真机识别名示例；如果现场识别名不同，必须替换为 `list-printers` 的实际值。

```powershell
$PrinterName = "Pantum CM2800ADN Series"
pnpm --filter terminal-agent print --file $SamplePdf --printer $PrinterName --method auto `
  2>&1 | Tee-Object (Join-Path $EvidenceRoot "PS-G3\direct-print-sample.log")
```

通过标准：

- 真实纸张从奔图打印机出纸。
- 日志显示目标打印机存在且打印命令成功。
- 如果未出纸但命令返回成功，必须记录为失败，不得标记 PS-G3 通过。

### 7.2 云端任务链路

在 Kiosk 或受控 API 路径创建一个不含个人信息的测试文件打印任务，目标终端必须是本机 `terminalId`。

观察并记录：

- 创建后任务为 `pending`。
- Windows Agent claim 后任务变为 `claimed`。
- 打印开始时任务变为 `printing`。
- 真实出纸后任务变为 `completed`。
- 如果打印失败，任务必须变为 `failed` 且包含明确错误原因。

证据保存：

```powershell
Copy-Item (Join-Path $EvidenceRoot "PS-G1\agent-foreground.log") (Join-Path $EvidenceRoot "PS-G3\agent-print-task.log") -ErrorAction SilentlyContinue
```

通过标准：

- 只有目标 Windows 终端领取任务。
- 出纸前不得把任务标记为 `completed`。
- 出纸照片必须仓库外保存并遮挡任何个人信息。

### 7.3 Windows PrintService 硬证据补强

适用场景：云端任务链路显示 `backend completed`、Agent 本地库显示完成、Agent 日志显示 download / hash / print / patch completed，但现场没有同步保存 PrintService 事件、打印队列、spool 元数据、设备日志、照片或计数器证据时，必须补跑本节。已完成的 `ptask_kiosk_d984636a0f04a23a` 只能作为系统链路完成证据；因上一轮 `Microsoft-Windows-PrintService/Operational` 未启用，且 Agent 队列监控出现 `job not found in queue after 5 polls; treating as completed`，不得据此宣称物理出纸已确认。

先做只读状态检查，不改变 Windows 配置：

```powershell
$EvidenceRoot = "C:\ai-job-print-evidence"
New-Item -ItemType Directory -Force -Path (Join-Path $EvidenceRoot "PS-G3") | Out-Null
wevtutil gl Microsoft-Windows-PrintService/Operational 2>&1 |
  Tee-Object "C:\ai-job-print-evidence\PS-G3\printservice-operational-status-before.log"
```

如果 `enabled: false`，以下命令属于 Windows 事件日志配置变更，必须先取得现场操作负责人批准，并记录批准人、时间和原因。未获批准时不要执行，只能把本轮判定写为“必须现场确认”：

```powershell
wevtutil sl Microsoft-Windows-PrintService/Operational /e:true
wevtutil sl Microsoft-Windows-PrintService/Operational /ms:16777216
```

在触发下一次 Kiosk / API 打印任务前，先打开队列轮询窗口。`$TaskId` 可先填待补强的任务 ID；如果现场创建新任务，必须替换成新任务 ID。`$PrinterName` 必须使用 `list-printers` 或 `Get-Printer` 看到的真实识别名。

```powershell
$EvidenceRoot = "C:\ai-job-print-evidence"
$TaskId = "ptask_kiosk_d984636a0f04a23a"
$PrinterName = "Pantum CM2800ADN Series"
$ProbeStart = Get-Date
$ProbeStartPath = Join-Path $EvidenceRoot "PS-G3\probe-start-time.log"
$ProbeStart.ToString("o") | Tee-Object $ProbeStartPath
$PrintJobLog = Join-Path $EvidenceRoot "PS-G3\printjob-poll-$TaskId.log"

1..60 | ForEach-Object {
  $Poll = $_
  $PollTime = (Get-Date).ToString("o")
  $Jobs = @(Get-PrintJob -PrinterName $PrinterName -ErrorAction SilentlyContinue)
  if ($Jobs.Count -eq 0) {
    [pscustomobject]@{
      Poll = $Poll; PollTime = $PollTime; ID = $null; Name = "<no print job>";
      JobStatus = "none"; Position = $null; SubmittedTime = $null; Size = $null; TotalPages = $null
    }
  } else {
    $Jobs | Select-Object @{Name="Poll"; Expression={$Poll}},
      @{Name="PollTime"; Expression={$PollTime}},
      ID, Name, JobStatus, Position, SubmittedTime, Size, TotalPages
  }
  Start-Sleep -Milliseconds 500
} | Format-Table -AutoSize | Out-String -Width 240 | Tee-Object $PrintJobLog
```

同时打开 spool 元数据轮询窗口。只记录 `$env:WINDIR\System32\spool\PRINTERS` 下文件的名称、大小、时间和扩展名；禁止复制、打开或导出 `.SPL` / `.SHD` 内容。

```powershell
$EvidenceRoot = "C:\ai-job-print-evidence"
$TaskId = "ptask_kiosk_d984636a0f04a23a"
$SpoolDir = Join-Path $env:WINDIR "System32\spool\PRINTERS"
$SpoolLog = Join-Path $EvidenceRoot "PS-G3\spool-poll-$TaskId.log"

1..60 | ForEach-Object {
  $Poll = $_
  $PollTime = (Get-Date).ToString("o")
  $Files = @(Get-ChildItem $SpoolDir -Force -ErrorAction SilentlyContinue)
  if ($Files.Count -eq 0) {
    [pscustomobject]@{
      Poll = $Poll; PollTime = $PollTime; Name = "<no spool metadata>";
      Extension = $null; Length = $null; CreationTimeUtc = $null; LastWriteTimeUtc = $null
    }
  } else {
    $Files | Select-Object @{Name="Poll"; Expression={$Poll}},
      @{Name="PollTime"; Expression={$PollTime}},
      Name, Extension, Length, CreationTimeUtc, LastWriteTimeUtc
  }
  Start-Sleep -Milliseconds 500
} | Format-Table -AutoSize | Out-String -Width 240 | Tee-Object $SpoolLog
```

任务结束后导出 PrintService 事件。必须使用打印任务触发前记录的 `$ProbeStart`，并只筛选当前打印机、任务 ID 或文档名可关联的事件：

```powershell
$EvidenceRoot = "C:\ai-job-print-evidence"
$TaskId = "ptask_kiosk_d984636a0f04a23a"
$PrinterName = "Pantum CM2800ADN Series"
if (!$ProbeStart) {
  $ProbeStartPath = Join-Path $EvidenceRoot "PS-G3\probe-start-time.log"
  if (Test-Path $ProbeStartPath) {
    $ProbeStart = [DateTime]::Parse((Get-Content $ProbeStartPath -Raw).Trim())
  } else {
    throw "ProbeStart is missing. Set `$ProbeStart = Get-Date before starting the print probe, or provide PS-G3\probe-start-time.log."
  }
}
$PrintServiceLog = Join-Path $EvidenceRoot "PS-G3\printservice-task-filtered.log"

Get-WinEvent -FilterHashtable @{
  LogName = "Microsoft-Windows-PrintService/Operational"
  StartTime = $ProbeStart
} -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Message -like "*$PrinterName*" -or
    $_.Message -like "*$TaskId*"
  } |
  Select-Object TimeCreated, Id, ProviderName, LevelDisplayName, Message |
  Format-List | Tee-Object $PrintServiceLog
```

判定标准：

- 系统链路完成：后端任务状态为 `completed`，Agent 本地 DB 记录为 `completed`，Agent 日志可对应同一任务的 download / hash / print / patch completed。
- Windows 打印事件证据：`Microsoft-Windows-PrintService/Operational` 在 `$ProbeStart` 之后存在可关联到 `$PrinterName`、`$TaskId` 或测试文档名的事件。
- 物理出纸硬证据：现场目视确认、摄像头录像、打印机计数器变化或设备日志至少一种能证明真实纸张输出。
- 必须现场确认：PrintService/Operational 未启用、队列过快导致 60 次轮询仍捕获不到、奔图驱动处于 Retained / 保留状态、或 PrintService 事件无法关联到当前任务 / 打印机 / 文档时，不得仅凭系统链路完成宣称物理出纸。

### 7.4 已完成任务只读复核与照片补证

适用场景：任务已经发生，且当前只允许复核证据、不能再次打印、不能重启 Agent、不能修改配置、不能写数据库。该步骤用于补齐类似 G5 `ptask_kiosk_f05cd3c160ec55c6` 的只读证据链和人工物理出纸确认。

只读复核范围：

- Windows PrintService 事件：Event ID 307 / 842、打印机、端口、页数、Win32 返回码。
- Agent 日志：同一任务的 `claimed -> printing -> print success -> completed` 或失败链路。
- 本地 Agent DB：只读查询任务状态，不执行更新、删除或 vacuum。
- 打印机计数器：`TotalPagesPrinted` / `TotalJobsPrinted` 前后差异。
- 现场人工记录：是否实际看到纸张、照片证据编号、观察人和时间。

禁止动作：

- 不执行 `pnpm --filter terminal-agent print` 或任何会提交新打印作业的命令。
- 不重启 `AIJobPrintAgent`，不安装 / 卸载服务，不清空队列。
- 不修改 `agent-config.json`、环境变量、注册 token、打印机默认设置或驱动配置。
- 不对 API、PostgreSQL、SQLite、Redis、COS 写入任何数据。

`PS-G3-PHYS-01` 现场最小补证步骤：

1. 不操作电脑、不点打印、不重启 Agent，只到目标奔图打印机旁确认是否有本次无个人信息测试页或已遮挡内容的纸张。
2. 确认纸张来自本机 `Pantum CM2800ADN Series / USB001`，并核对页数是否与 PrintService / 计数器证据一致。
3. 拍摄纸张照片或现场视频，遮挡所有个人信息、人员面部、设备序列号、二维码、完整 URL 和 token。
4. 将照片保存到仓库外私有证据目录，命名为 `PS-G3-PHYS-01-physical-paper-observation-<timestamp>` 或同等编号。
5. 填写观察记录；如果现场无法确认纸张来源或照片无法脱敏，保持 `Not Passed Yet`。

`PS-G3-PHYS-01` 现场观察记录模板：

```markdown
# PS-G3-PHYS-01 现场人工物理出纸观察记录

- 观察日期时间：
- 观察人：
- 任务 ID：
- 证据目录 ID：
- 打印机 Windows 识别名：
- 端口：
- 现场看到纸张：是 / 否
- 纸张页数：
- 纸张内容类型：无个人信息测试页 / 已遮挡敏感内容 / 其它
- 照片证据编号：
- 照片脱敏说明：
- PrintService 证据编号：
- 计数器证据编号：
- Agent 日志证据编号：
- 结论：
  - [ ] 人工可见物理出纸已确认
  - [ ] 人工可见物理出纸未确认，需继续补证

备注：
```

## 八、Agent 降级 / 恢复演练（PS-G3）

目标：安全模拟本地任务库不可用，不破坏真实 `%ProgramData%\AIJobPrintAgent\agent.db`。

当前运行时边界（2026-07-06 复核）：Admin 订单动作端点包含 `POST /admin/orders/:id/mark-paid`、`POST /admin/orders/:id/refund`，本分支新增 `POST /admin/orders/:id/cancel` 与 `POST /admin/orders/:id/reassign`，后两者仅允许 `pending` 打印订单；订单与打印任务运营视图分别为 `GET /admin/orders`、`GET /admin/orders/:id`、`GET /admin/print-tasks`。现场恢复领单验收仍必须在候选部署后带 Admin 鉴权复验这些动作，不能把本地 verify 等同于生产可用。

### 8.1 Admin 降级现场截图补证（受控）

目标：补齐 `PS-G3-ADMIN-01` / `PS-G4-04` 的现场 Admin 可见性截图，只证明运营后台能看见 `agent_degraded` 与本地任务库不可用提示；不触发打印、不清队列、不写数据库、不改生产配置。

执行前只读预检：

1. 确认当前没有正在处理的打印任务：目标终端无 `pending` / `claimed` / `printing` 任务，Windows 打印队列和 spool 目录为空。
2. 确认 `AIJobPrintAgent`、打印机和 API 均处于健康状态：服务 `Running`，打印机 `ready` / `isOnline=true`，Admin 终端页能看到目标终端。
3. 确认 Admin 页面只展示目标终端或已完成脱敏过滤；如果页面会暴露手机号、token、真实用户文件、签名 URL、完整 IP、设备序列号或其它无关真实用户信息，先停止截图。
4. 新建仓库外证据目录，例如 `<PRIVATE_EVIDENCE_DIR>\PS-G3-ADMIN-01-<timestamp>`；原始截图和日志不得复制进 Git。

授权要求：

- 停止 Agent、临时替换 `agent.db`、启动前台降级 Agent 均属于现场运行状态变更，必须先取得现场负责人明确授权，并在证据摘要中记录授权人、时间、原因和执行人。
- 如果未获得授权，本节只允许记录“Admin 降级现场截图待补”；不得为了截图临时制造降级。

截图步骤：

1. 打开 Admin 终端页，优先使用当前部署真实入口中的 `/devices?tab=terminals` 或 `/terminals`；只保留目标终端所在区域，裁掉地址栏 query、cookie、token、签名 URL 和无关用户信息。
2. 执行下方受控降级步骤，让目标终端心跳进入 `agent_degraded` 且 `localTaskDatabaseAvailable=false`。
3. 截图必须能看到目标终端和文案“本地任务库不可用，已暂停领取打印任务”，保存为 `PS-G3-ADMIN-01-degraded-terminal-view-<timestamp>.png` 或同等编号。
4. 同步保存一份脱敏摘要 `PS-G3-ADMIN-01-summary-<timestamp>.md`，只记录终端逻辑编号、截图证据编号、降级字段、恢复结果和停止条件是否触发；不得记录 Admin token、cookie、完整 URL、真实用户文件或个人信息。
5. 完成立即按“恢复”步骤还原 Agent，并再次确认 `printer-status` 返回 `ready` / `isOnline=true`，服务为 `Running`，打印队列与 spool 为空。

停止条件：

- 预检发现 active 打印任务、队列 / spool 非空、无法确认目标终端、或页面无法脱敏。
- 降级期间出现任务被领取、任务状态异常推进、Admin 看不到 `agent_degraded` / 本地任务库不可用提示。
- 恢复后 Agent 未回到 online、打印机不是 ready、或队列出现未知作业。

触发任一停止条件时，本轮只记录失败 / 待补，不继续做恢复后领单、打印或其它异常演练。

执行前先停止第六节 PowerShell 窗口 A 中的正常 Agent（按 `Ctrl+C`），并确认没有同一 `terminalId` 的 Agent 仍在运行。否则正常 Agent 会继续上报 `online`，与降级演练窗口交替覆盖心跳，导致 Admin 观察结果不可靠。

PowerShell 窗口 B：

```powershell
cd "<PROJECT_ROOT>"

$AgentDataDir = Join-Path $env:PROGRAMDATA "AIJobPrintAgent"
$AgentDbPath = Join-Path $AgentDataDir "agent.db"
$AgentDbBackup = Join-Path $AgentDataDir ("agent.db.degraded-backup-" + (Get-Date -Format "yyyyMMddHHmmss"))
New-Item -ItemType Directory -Force -Path $AgentDataDir | Out-Null
if (Test-Path $AgentDbPath -PathType Leaf) {
  Move-Item $AgentDbPath $AgentDbBackup
}
if (Test-Path $AgentDbPath -PathType Container) {
  throw "agent.db path is already a directory; stop and inspect $AgentDbPath before continuing"
}
New-Item -ItemType Directory -Path $AgentDbPath | Out-Null

pnpm --filter terminal-agent agent 2>&1 | Tee-Object (Join-Path $EvidenceRoot "PS-G3\agent-degraded-agentdb-directory.log")
```

观察 Admin / API：

- 心跳状态为 `agent_degraded`。
- `localTaskDatabaseAvailable=false`。
- Admin 显示“本地任务库不可用，已暂停领取打印任务”。
- 创建或保留一个 pending 任务时，后端 claim 返回空任务，任务保持 `pending`。

恢复：

先在窗口 B 中按 `Ctrl+C` 停止降级 Agent，确认该进程退出后再执行恢复。否则恢复后启动的新 Agent 会因为 `agent.pid` 实例锁仍存在而退出。

```powershell
$AgentDataDir = Join-Path $env:PROGRAMDATA "AIJobPrintAgent"
$AgentDbPath = Join-Path $AgentDataDir "agent.db"
if (!$AgentDbBackup) {
  $AgentDbBackup = Get-ChildItem $AgentDataDir -Filter "agent.db.degraded-backup-*" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (Test-Path $AgentDbPath -PathType Container) {
  Remove-Item $AgentDbPath -Recurse -Force
}
if ($AgentDbBackup -and (Test-Path $AgentDbBackup -PathType Leaf)) {
  Move-Item $AgentDbBackup $AgentDbPath
}
pnpm --filter terminal-agent agent 2>&1 | Tee-Object (Join-Path $EvidenceRoot "PS-G3\agent-recovered.log")
```

说明：该演练只把 `agent.db` 文件临时替换为同名目录，让 `better-sqlite3` 打开数据库失败；`%ProgramData%\AIJobPrintAgent` 目录、实例锁、DPAPI token 和 Agent 配置仍保持真实路径，因此 Agent 可以启动到心跳阶段并上报 `agent_degraded`。

通过标准：

- 降级期间不领取新任务。
- 恢复后心跳回到 online。
- 同一终端可以继续领取符合当前支付 / 免费模式门禁的 paid 或 allowed pending 任务。若测试任务是 `unpaid` 且 `PRINT_REQUIRE_PAID_BEFORE_CLAIM=true`，恢复后保持 `pending` 属于安全行为，不计为恢复领单失败，也不能作为恢复领单通过证据。

## 九、隐私删除与异常恢复（PS-G4）

目标：证明打印完成 / 失败后不会长期保留用户文件，异常恢复不会制造假成功。

检查本地临时目录：

```powershell
$TempDir = Join-Path $env:PROGRAMDATA "AIJobPrintAgent\temp"
Get-ChildItem $TempDir -Force -ErrorAction SilentlyContinue |
  Select-Object FullName, Length, LastWriteTime |
  Format-Table | Tee-Object (Join-Path $EvidenceRoot "PS-G4\local-temp-after-print.log")
```

断网恢复演练：

1. 停止 Agent。
2. 断开网络或临时阻断 API 访问。
3. 创建或保留一个测试任务。
4. 恢复网络。
5. 启动 Agent。
6. 确认未出纸任务不会被标记为 `completed`。

卡住任务释放：

- 让任务进入 `claimed` 或 `printing` 后停止 Agent。
- 等待后端 claim TTL / stuck recovery 逻辑生效。
- 确认任务回到可处理状态时仍保留原目标 `terminalId`，不会被其它终端领取。

通过标准：

- 临时目录无可打开的用户源文件残留。
- 断网 / 断电场景不会产生假 `completed`。
- stuck task 释放不清空目标 `terminalId`。
- Admin 能看到失败原因、降级、恢复或人工处理状态。

## 十、更新证据包

每完成一项，只把脱敏摘要写回 `docs/acceptance/print-scan-first-release-acceptance-package.md`：

- `状态` 从 `Not Passed Yet` 改为 `Passed` 或 `Blocked`。
- `仓库外证据` 填写私有证据目录中的文件名或编号，不填写真实路径中的用户名、IP、密钥或完整文件名。
- `判定` 段落同步更新。

禁止：

- 把原始截图、日志、SQL 输出、数据库备份或真机照片复制进 Git。
- 把正式域名 / HTTPS 未审批的情况下写成正式公网验收通过。
- 把扫描或 U 盘未接真机的情况下写成已完成。

## 十一、推荐执行顺序

1. Mac 执行 PS-G0 本地准备。
2. 服务器执行 PS-G1 只读预检。
3. 服务器执行 PS-G2 migration 和候选运行时复验。
4. Windows 执行 PS-G1 环境和 Agent 前台心跳。
5. Windows 执行 PS-G3 本地直接打印烟测。
6. Windows 执行 PS-G3 云端打印任务链路。
7. Windows 执行 PS-G3 Agent 降级 / 恢复演练。
8. Windows 执行 PS-G4 隐私删除、卡住任务释放、断网 / 断电恢复。
9. 回到 Mac 更新证据包脱敏摘要并复跑 `verify:print-scan-first-release`。

## 十二、最终口径

```text
正式域名 / HTTPS：审批中，当前不作为 PS-G1~PS-G4 的阻塞项。
Mac：只能证明代码、CI、迁移脚本和证据包准备就绪。
服务器：证明候选环境、PostgreSQL migration 和 API health。
Windows：证明 Terminal Agent、奔图真机、降级恢复、隐私删除和异常恢复。
未完成 Windows 主机 PS-G3 / PS-G4 前，不得宣称打印扫描商用全闭环完成。
```
