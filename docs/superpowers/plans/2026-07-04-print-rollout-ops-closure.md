# Print Rollout Ops Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the fixed Kiosk upload-to-print path from a technical system-chain pass into a safe first-terminal rollout path without claiming unproven physical paper output.

**Architecture:** Keep the Kiosk upload URL hotfix and `/print/jobs` security boundary unchanged. First close operational risk with a deployment matrix, a Windows print evidence runbook, and guard checks for unsafe price/payment/gate combinations. Do not implement live payment here; use free mode or supervised offline mark-paid until C5-6 live payment is ready.

**Tech Stack:** NestJS API, Prisma PostgreSQL/SQLite, React Kiosk Vite build, Windows Terminal Agent, Pantum CM2800ADN Series, PowerShell PrintService/Operational.

---

## Scope

This plan covers four next problems after `ptask_kiosk_d984636a0f04a23a` reached system `completed`:

- Windows print hard evidence for the next probe.
- Payment/claim policy around `PRINT_REQUIRE_PAID_BEFORE_CLAIM`.
- Formal `PriceConfig` rollout versus temporary preprod prices.
- Kiosk cashier deployment risk when live payment is unavailable.

This plan does not implement WeChat/Alipay live payment, refunds, redemption, C5-5 pricing admin UI, terminal-specific pricing, member entitlement deduction, or physical paper confirmation for the already completed task.

## Task 1: Deployment Matrix Documentation

**Files:**
- Create: `docs/operations/print-rollout-deployment-matrix.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `docs/progress/current-progress.md`

- [ ] **Step 1: Create the deployment matrix doc**

Create `docs/operations/print-rollout-deployment-matrix.md` with these sections:

```markdown
# 打印链路上线部署矩阵

## 当前已验证

- Kiosk 上传返回内部 HMAC content URL。
- `/print/jobs` 拒绝外部 COS URL。
- 预生产真实建单 HTTP 201。
- `ptask_kiosk_d984636a0f04a23a` 已由 `t_ksk_001` claim 并回传 `completed`。
- Windows Agent 本地 DB 和日志证明系统链路完成。
- 物理出纸尚未确认。

## 安全部署组合

| 模式 | PriceConfig | PAYMENT_PROVIDER | PRINT_REQUIRE_PAID_BEFORE_CLAIM | Kiosk 用户路径 | 结论 |
|---|---:|---|---|---|---|
| 免费试运营 | `unitCents=0` | unset 或 `disabled` | `true` | 不进 cashier，直接 progress | 推荐 |
| 有人值守线下收款 | `unitCents>0` | unset 或 `disabled` | `true` | cashier 等待 Admin mark-paid | 仅限有人值守 |
| Live 支付后出纸 | `unitCents>0` | live provider | `true` | cashier 支付成功后 progress | C5-6 后再启用 |

## 禁止部署组合

| 组合 | 风险 |
|---|---|
| 正价 + 无 live 支付 + 无线下 mark-paid SOP | 用户卡在 cashier |
| 正价 + `PRINT_REQUIRE_PAID_BEFORE_CLAIM=false` | unpaid 任务可能出纸 |
| production + `PAYMENT_PROVIDER=sandbox` | 生产运行时应拒启动 |
| 缺失 PriceConfig 代表免费 | 报价 fail-closed，不是免费策略 |

## 当前推荐

首台试运营采用免费模式：显式设置 `print_bw_page=0`、`print_color_page=0`，保持 active，`PAYMENT_PROVIDER` unset/disabled，开启 `PRINT_REQUIRE_PAID_BEFORE_CLAIM=true`。
```

- [ ] **Step 2: Update next tasks**

In `docs/progress/next-tasks.md`, under `P0：上线前真实验收`, add unchecked bullets for:

```markdown
- [ ] 打印运营模式决策：C5-6 live 支付完成前，推荐首台试运营使用免费模式；若必须正价，只能采用有人值守线下收款 + Admin mark-paid + `PRINT_REQUIRE_PAID_BEFORE_CLAIM=true`。
- [ ] 打印部署矩阵落地：补齐并遵守 `docs/operations/print-rollout-deployment-matrix.md`，禁止“正价 + 无 live + 无线下 mark-paid SOP”的 Kiosk 用户面部署。
```

- [ ] **Step 3: Update current progress**

In `docs/progress/current-progress.md`, append a short note:

```markdown
2026-07-04 追加：完成 Kiosk 打印链路上线前运营收口研究，结论为系统链路已完成但物理出纸未确认；C5-6 live 支付完成前，最小安全路径是免费模式或有人值守线下 mark-paid，不采用正价无人值守 cashier。
```

- [ ] **Step 4: Verify docs**

Run:

```bash
rg -n '打印链路上线部署矩阵|免费试运营|有人值守线下收款|正价 \\+ 无 live' docs/operations docs/progress
git diff --check
```

Expected: all new matrix and progress lines are found; `git diff --check` exits 0.

## Task 2: Windows Print Evidence Runbook

**Files:**
- Modify: `docs/acceptance/print-scan-field-execution-runbook.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: Add PrintService evidence section**

Add a section titled `Windows PrintService 硬证据补强` to `docs/acceptance/print-scan-field-execution-runbook.md`.

Include this PowerShell status check:

```powershell
$EvidenceRoot = "C:\ai-job-print-evidence"
$TaskId = "ptask_kiosk_d984636a0f04a23a"
$PrinterName = "Pantum CM2800ADN Series"
New-Item -ItemType Directory -Force -Path (Join-Path $EvidenceRoot "PS-G3") | Out-Null

wevtutil gl Microsoft-Windows-PrintService/Operational |
  Tee-Object (Join-Path $EvidenceRoot "PS-G3\printservice-operational-status-before.log")
```

Include this configuration-change command, clearly labeled as requiring operator approval:

```powershell
wevtutil sl Microsoft-Windows-PrintService/Operational /e:true
wevtutil sl Microsoft-Windows-PrintService/Operational /ms:16777216
```

- [ ] **Step 2: Add queue and spool evidence commands**

Add the queue poll:

```powershell
$ProbeStart = Get-Date
$ProbeStart.ToString("o") | Tee-Object (Join-Path $EvidenceRoot "PS-G3\probe-start-time.log")

1..60 | ForEach-Object {
  $now = Get-Date -Format o
  "=== $now ==="
  Get-PrintJob -PrinterName $PrinterName -ErrorAction SilentlyContinue |
    Select-Object ID, JobId, DocumentName, JobStatus, SubmittedTime, Size, TotalPages
  Start-Sleep -Milliseconds 500
} | Tee-Object (Join-Path $EvidenceRoot "PS-G3\printjob-poll-$TaskId.log")
```

Add the spool metadata poll:

```powershell
$SpoolDir = Join-Path $env:WINDIR "System32\spool\PRINTERS"
1..60 | ForEach-Object {
  $now = Get-Date -Format o
  "=== $now ==="
  Get-ChildItem $SpoolDir -Force -ErrorAction SilentlyContinue |
    Select-Object Name, Length, CreationTimeUtc, LastWriteTimeUtc
  Start-Sleep -Milliseconds 500
} | Tee-Object (Join-Path $EvidenceRoot "PS-G3\spool-poll-$TaskId.log")
```

- [ ] **Step 3: Add event export command**

Add:

```powershell
Get-WinEvent -FilterHashtable @{
  LogName = "Microsoft-Windows-PrintService/Operational"
  StartTime = $ProbeStart.AddMinutes(-1)
} |
  Where-Object { $_.Message -like "*$PrinterName*" -or $_.Message -like "*$TaskId*" } |
  Select-Object TimeCreated, Id, Message |
  Format-List |
  Tee-Object (Join-Path $EvidenceRoot "PS-G3\printservice-task-filtered.log")
```

- [ ] **Step 4: Add judgment criteria**

Add criteria:

```markdown
- 系统链路完成：后端 task completed + Agent 本地 DB completed + Agent 日志显示下载、校验、调用打印、PATCH completed。
- Windows 打印事件证据：PrintService/Operational 在 probe 时间窗内出现同打印机或同 task/document 的打印事件。
- 物理出纸硬证据：现场目视、摄像头、打印机计数器、或设备日志能证明纸张输出。
- 必须现场确认：PrintService 未启用、队列过快消失、Pantum `Printing, Retained`、或事件无法关联 task。
```

- [ ] **Step 5: Verify docs**

Run:

```bash
rg -n 'Windows PrintService 硬证据补强|wevtutil sl Microsoft-Windows-PrintService/Operational|printjob-poll|spool-poll|物理出纸硬证据' docs/acceptance/print-scan-field-execution-runbook.md
git diff --check
```

Expected: all runbook commands and criteria are present; whitespace check passes.

## Task 3: Add Unsafe Rollout Guard

**Files:**
- Create: `services/api/scripts/verify-print-rollout-config.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Implement guard script**

Create `services/api/scripts/verify-print-rollout-config.ts` that checks these static conditions:

```typescript
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf-8')

const failures: string[] = []
const pass = (msg: string) => console.log(`PASS ${msg}`)
const fail = (msg: string) => failures.push(msg)

const terminalsService = read('src/terminals/terminals.service.ts')
const providerFactory = read('src/payment/payment-provider.factory.ts')
const runtimeGates = read('src/config/production-runtime-gates.ts')
const cashierPage = path.resolve(root, '../../apps/kiosk/src/pages/print/PrintCashierPage.tsx')
const cashierSource = fs.readFileSync(cashierPage, 'utf-8')

if (terminalsService.includes("process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] === 'true'")) {
  pass('paid-before-claim gate remains explicit opt-in')
} else {
  fail('paid-before-claim gate must remain explicit true check')
}

if (terminalsService.includes("payStatus: 'paid'") && terminalsService.includes('order: null')) {
  pass('claim query allows paid orders and legacy/no-order tasks only when gate is enabled')
} else {
  fail('claim query must keep paid-or-no-order condition when gate is enabled')
}

if (providerFactory.includes("PAYMENT_PROVIDER=sandbox is not allowed in production")) {
  pass('provider factory rejects sandbox in production')
} else {
  fail('provider factory must reject sandbox in production')
}

if (runtimeGates.includes('PAYMENT_PROVIDER=sandbox') && runtimeGates.includes('Production cannot use sandbox payment provider')) {
  pass('production runtime gate rejects sandbox payment provider')
} else {
  fail('production runtime gate must reject sandbox payment provider')
}

if (cashierSource.includes('import.meta.env.DEV') && cashierSource.includes('simulateSandboxPayment')) {
  pass('sandbox simulate action remains DEV-gated in source')
} else {
  fail('sandbox simulate action must be DEV-gated')
}

if (failures.length > 0) {
  for (const item of failures) console.error(`FAIL ${item}`)
  process.exit(1)
}

console.log('ALL PASS verify-print-rollout-config')
```

- [ ] **Step 2: Add package script**

Add to `services/api/package.json` scripts:

```json
"verify:print-rollout-config": "node -r @swc-node/register scripts/verify-print-rollout-config.ts"
```

- [ ] **Step 3: Add CI command**

In `.github/workflows/ci.yml`, add the API verify step near other payment/print verify commands:

```bash
pnpm --filter @ai-job-print/api verify:print-rollout-config
```

- [ ] **Step 4: Run the guard**

Run:

```bash
pnpm --filter @ai-job-print/api verify:print-rollout-config
git diff --check
```

Expected: `ALL PASS verify-print-rollout-config`; whitespace check exits 0.

## Task 4: Add Kiosk Production Bundle Guard

**Files:**
- Modify: `apps/kiosk/scripts/verify-prod-build-config.mjs`

- [ ] **Step 1: Extend dist scan**

In `apps/kiosk/scripts/verify-prod-build-config.mjs`, add a production bundle scan that fails if user-visible DEV sandbox button labels are present in `apps/kiosk/dist`.

Use these forbidden terms:

```javascript
const forbiddenProdCashierText = [
  '[DEV] 沙箱模拟',
  '模拟支付成功',
]
```

Allow `/payment/sandbox/simulate` to remain in code if existing helper strings are bundled; do not fail on that endpoint string alone.

- [ ] **Step 2: Add exact failure message**

Failure message:

```text
production kiosk bundle must not expose DEV sandbox payment buttons
```

- [ ] **Step 3: Build and verify**

Run:

```bash
pnpm --filter @ai-job-print/kiosk build
pnpm --filter @ai-job-print/kiosk verify:prod-build-config
git diff --check
```

Expected: build passes; verify passes; forbidden button labels are absent from production dist.

## Task 5: Preprod Strategy Probe

**Files:**
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: Choose exactly one preprod strategy**

For the next preprod probe, choose one:

```text
FREE_MODE
```

Do not run正价无人值守 cashier. If the business insists on收费 before C5-6, use:

```text
SUPERVISED_OFFLINE_MARK_PAID
```

- [ ] **Step 2: FREE_MODE DB expectations**

Before running a new Kiosk upload-to-print probe, the operator must confirm via read-only SQL:

```sql
SELECT "serviceKey", "unitCents", "unit", "active", "description"
FROM "PriceConfig"
WHERE "serviceKey" IN ('print_bw_page', 'print_color_page')
ORDER BY "serviceKey";
```

Expected for free mode:

```text
print_bw_page     unitCents=0     active=true
print_color_page  unitCents=0     active=true
```

- [ ] **Step 3: FREE_MODE env expectations**

Read-only env expectation:

```text
PAYMENT_PROVIDER unset or disabled
PRINT_REQUIRE_PAID_BEFORE_CLAIM=true
NODE_ENV=production
```

- [ ] **Step 4: FREE_MODE HTTP expectation**

After Kiosk upload and `/print/jobs`, response must show:

```text
amountCents=0
payStatus=paid
paymentSource=free
```

Kiosk must go to `/print/progress`, not `/print/cashier`.

- [ ] **Step 5: Record in next tasks**

Update `docs/progress/next-tasks.md` with the selected strategy and probe result. If physical output is still not visually confirmed, keep it separate from system-chain completion.

## Self-Review

- Spec coverage: covers the four requested next problem domains and keeps physical出纸 confirmation separate.
- Placeholder scan: no `TBD`; commands use concrete current task id where relevant and named strategy values.
- Type consistency: uses existing names `PRINT_REQUIRE_PAID_BEFORE_CLAIM`, `PAYMENT_PROVIDER`, `PriceConfig`, `print_bw_page`, `print_color_page`, `PrintService/Operational`.
- Scope control: does not implement live payment, price admin, refunds, redemption, or terminal-specific pricing.
