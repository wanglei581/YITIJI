# Print Scan First Release Full Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first-release commercial print-scan service suite: document print, phone/cloud upload, material packs, real scanning, copy, ID photo, USB import, format conversion, signature/stamp layout, pricing/benefits, Admin operations, and AI-assisted file checks, without exposing unfinished or unsafe capability to users.

**Architecture:** Use one `/print-scan` service center with feature gates, device capability checks, and Admin configuration. Keep each capability as an independently verifiable vertical slice: shared contract, API model/service, Terminal Agent/device adapter, Kiosk page, Admin view, audit/cleanup, and verify script. Public user access must fail closed until the slice passes real-device and privacy cleanup gates.

**Tech Stack:** React + Vite + TypeScript + Tailwind/shadcn + lucide-react; NestJS + Prisma + PostgreSQL/SQLite migrations + Redis; Windows Terminal Agent in Node.js; COS/private object storage; existing `packages/shared` contracts and existing verify scripts.

---

## Implementation Guardrails Before Coding

- **Database migrations:** any Prisma model change must update the main SQLite schema, regenerate the PostgreSQL schema with `pnpm --filter @ai-job-print/api db:pg:sync`, add matching migration SQL under both Prisma migration trees, and pass `db:pg:sync:check`, SQLite migrate verification, PostgreSQL client generation, and a scratch PostgreSQL `db:pg:deploy` before the task is accepted.
- **Scanner bridge:** first-release scan/copy implementation must use a Terminal Agent controlled Windows helper, not browser direct device access. Default target is a configured `NAPS2.Console.exe` or equivalent WIA/TWAIN command adapter that writes into an Agent-owned temp directory. If the executable path, scanner profile, or output validation is missing, the capability status is `not_verified` or `unsupported` and task creation fails closed.
- **USB bridge:** first-release USB import must be Agent-only. The Agent enumerates removable drives through Windows CIM/PowerShell (`Win32_LogicalDisk` / volume metadata) or an approved equivalent adapter, returns only sanitized file metadata, never returns absolute paths, and reads file bytes only after a Kiosk-bound one-time confirmation.
- **ID photo AI:** first-release portrait matting and background replacement must run server-side or Agent-side through a configured provider. No production flow may pretend to support AI matting when `PHOTO_MATTING_PROVIDER` and its credential are absent. Missing provider means `id_photo` stays `not_verified`; uploaded photos may not be printed as processed ID photos without a derived output file.
- **Testing mode isolation:** `testing` is not a user-facing availability state. Kiosk routes and API endpoints must reject ordinary users for `testing`, `maintenance`, `unsupported`, and `not_verified` capabilities. Test access must require an Admin/maintenance context or an explicit tester entitlement, and the backend must enforce this even if a user enters a route manually.
- **High-sensitive retention:** ID copy, ID photo, signature/stamp source images, and scanner outputs classified as high-sensitive must be forced short TTL and forced no long-term save. Cleanup must call storage physical delete, verify the object is no longer readable, write audit evidence, and surface cleanup failures as Admin alerts.
- **Printer driver mapping:** Pantum color / duplex / paper-mode values must come from `DeviceCapability` or Admin configuration. Do not hardcode `"color"` or any vendor mode string until the vendor API value is confirmed by real-device evidence.
- **Claim TTL recovery:** every claimed hardware task must have `claimExpiry` or an equivalent lease TTL. If the Agent crashes, disconnects, or stops reporting before completion, the backend must release or fail the task and expire sensitive signed URLs instead of leaving the task permanently `claimed`.

## 0. Non-Negotiable Goals

- 首期做完整功能，不把扫描、证件复印、证件照、U 盘、云上传、格式转换、签名盖章或材料包作为“二期能力”。
- 完整功能不等于无门禁开放。任何未通过端到端验收的能力必须 fail-closed，并且不能对普通用户创建正式任务。
- 不能出现 A 终端下单、B 终端出纸。
- 不能出现 SQLite 损坏后重复打印。
- 不能出现扫描件、身份证、证件照长期保存或无法证明物理删除。
- 不能把 mock、演示动画、静态数据、未接硬件能力包装成生产能力。
- 不能新增平台内投递、收简历给企业、候选人推荐、面试邀约或 Offer 管理。
- 不能让普通用户通过手输 URL 或接口调用进入 `testing` 能力并创建正式任务。

## 1. Release Targets

### User-Facing Targets

- `/print-scan` 成为唯一打印扫描服务中心。
- 用户可以从一个入口看到并使用首期完整能力：文档打印、扫码上传、云上传、U 盘、材料包、扫描、复印、证件照、格式转换、签名盖章、我的文档、打印订单、异常反馈。
- 每个能力都有清晰状态：`可使用`、`测试中`、`维护中`、`设备不支持`、`验收未通过`。
- 失败时给出明确动作：重试、改参数、重新上传、联系工作人员、提交反馈。

### Backend Targets

- 所有任务绑定当前 `terminalId`。
- 所有硬件任务有独立任务模型或明确 `Order.type`，不能把扫描、复印、证件照和材料包塞进普通 `PrintTask`。
- 所有任务有状态日志、任务级 TTL、幂等键、取消 / 失败 / 过期语义。
- 所有高敏文件有 purpose、sensitiveLevel、TTL、物理删除、审计记录。

### Terminal Agent Targets

- SQLite / `better-sqlite3` 不可用时 fail-closed。
- Agent 只 claim 本终端任务。
- U 盘只读枚举，不记录完整目录结构，不打印未确认文件。
- 扫描 / 复印 / 摄像头能力通过独立 helper 或设备 adapter 接入，不放进浏览器直连。

### Admin Targets

- Admin 有统一任务中心、设备中心、文件生命周期、告警、价格 / 权益、统计看板。
- 管理员访问用户文件、生成签名 URL、下载、删除和查看高敏文件必须审计。
- Admin 能看到终端 degraded、打印机异常、扫描仪异常、文件清理失败、状态回传积压。

## 2. Branch And Review Rules

- 从干净 `main` 或独立 worktree 开始每个实施分支。
- 每个任务只改本任务声明的文件。
- 每个任务完成后更新 `docs/progress/current-progress.md` 和 `docs/progress/next-tasks.md`。
- 每个跨前端 / 后端 / Agent 的任务必须运行相关 typecheck / verify。
- 超过 30 行 diff 或涉及 auth/db/crypto/hardware 的任务必须 Claude + Antigravity 双模型审查。
- 涉及硬件能力的任务在没有 Windows 真机证据前，不得把文档状态写成“商用完成”。

## 3. File Ownership Map

### Shared Contracts

- Modify: `packages/shared/src/types/print.ts`
- Modify: `packages/shared/src/types/file.ts`
- Modify: `packages/shared/src/types/device.ts`
- Modify: `packages/shared/src/types/memberPrintOrders.ts`
- Modify: `packages/shared/src/index.ts`

### Kiosk

- Modify: `apps/kiosk/src/pages/home/HomePage.tsx`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx`
- Modify: `apps/kiosk/src/pages/print/PrintUploadPage.tsx`
- Modify: `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx`
- Modify: `apps/kiosk/src/pages/print/PrintPreviewPage.tsx`
- Modify: `apps/kiosk/src/pages/print/PrintConfirmPage.tsx`
- Modify: `apps/kiosk/src/pages/print/PrintProgressPage.tsx`
- Modify: `apps/kiosk/src/pages/print/PrintDonePage.tsx`
- Modify: `apps/kiosk/src/pages/scan/ScanStartPage.tsx`
- Modify: `apps/kiosk/src/pages/scan/ScanSettingsPage.tsx`
- Modify: `apps/kiosk/src/pages/scan/ScanProgressPage.tsx`
- Modify: `apps/kiosk/src/pages/scan/ScanResultPage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Modify: `apps/kiosk/src/services/print/printJobsApi.ts`
- Create: `apps/kiosk/src/services/api/printScan.ts`
- Create: `apps/kiosk/scripts/verify-print-scan-first-release-ui.mjs`

### API

- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Modify: `services/api/src/print-jobs/print-jobs.service.ts`
- Modify: `services/api/src/print-jobs/print-jobs.controller.ts`
- Modify: `services/api/src/terminals/terminals.service.ts`
- Modify: `services/api/src/terminals/dto/claim-tasks.dto.ts`
- Modify: `services/api/src/files/file.types.ts`
- Modify: `services/api/src/files/files.cleanup.task.ts`
- Create: `services/api/src/print-scan/print-scan.module.ts`
- Create: `services/api/src/print-scan/print-scan.controller.ts`
- Create: `services/api/src/print-scan/print-scan.service.ts`
- Create: `services/api/src/print-scan/print-scan.types.ts`
- Create: `services/api/src/print-scan/dto/create-scan-task.dto.ts`
- Create: `services/api/src/print-scan/dto/create-copy-task.dto.ts`
- Create: `services/api/src/print-scan/dto/create-photo-task.dto.ts`
- Create: `services/api/src/print-scan/dto/create-material-pack-task.dto.ts`
- Create: `services/api/scripts/verify-print-scan-first-release.ts`

### Terminal Agent

- Modify: `apps/terminal-agent/src/agent/api-client.ts`
- Modify: `apps/terminal-agent/src/agent/db.ts`
- Modify: `apps/terminal-agent/src/agent/task-runner.ts`
- Modify: `apps/terminal-agent/src/agent/types.ts`
- Modify: `apps/terminal-agent/src/printer/print.ts`
- Create: `apps/terminal-agent/src/devices/capabilities.ts`
- Create: `apps/terminal-agent/src/scanner/scanner.ts`
- Create: `apps/terminal-agent/src/scanner/types.ts`
- Create: `apps/terminal-agent/src/usb/usb-files.ts`
- Create: `apps/terminal-agent/src/photo/photo-layout.ts`
- Create: `apps/terminal-agent/scripts/verify-print-scan-agent.mjs`

### Admin

- Modify: `apps/admin/src/routes/terminals/index.tsx`
- Modify: `apps/admin/src/routes/printers/index.tsx`
- Modify: `apps/admin/src/routes/alerts/index.tsx`
- Modify: `apps/admin/src/routes/files/index.tsx`
- Modify: `apps/admin/src/routes/orders/index.tsx`
- Create: `apps/admin/src/routes/print-scan/index.tsx`
- Create: `apps/admin/src/services/api/printScan.ts`
- Create: `apps/admin/scripts/verify-admin-print-scan-ui.mjs`

### Docs

- Modify: `docs/product/print-scan-commercial-plan.md`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Create: `docs/device/print-scan-first-release-acceptance.md`

## 4. Implementation Tasks

### Task 1: Safety Foundation For Print Tasks

**Files:**
- Modify: `services/api/src/print-jobs/print-jobs.service.ts`
- Modify: `services/api/src/terminals/terminals.service.ts`
- Modify: `services/api/src/terminals/dto/claim-tasks.dto.ts`
- Modify: `apps/terminal-agent/src/agent/db.ts`
- Modify: `apps/terminal-agent/src/agent/task-runner.ts`
- Create: `services/api/scripts/verify-print-scan-first-release.ts`
- Create: `apps/terminal-agent/scripts/verify-print-scan-agent.mjs`

- [ ] **Step 1: Add failing verify for terminal-bound claim**

Run: `pnpm --filter @ai-job-print/api verify:print-scan-first-release`

Expected before implementation: FAIL with message containing `claim must filter pending tasks by terminalId`.

- [ ] **Step 2: Implement target-terminal claim rule**

Change `PrintJobsService.create` so every Kiosk-created print job stores the current terminal id. Change `TerminalsService.claimTasks` so it queries pending tasks using both `status='pending'` and `terminalId=<claimer terminal>`.

Required behavior:
- If a task has `terminalId='terminal-a'`, `terminal-b` gets no task.
- If a legacy task has no `terminalId`, production claim rejects it; local migration script may mark it expired.
- Status updates from a terminal that does not own the task are rejected.
- Claimed tasks have a lease TTL; expired leases are released or failed before any new print attempt.
- Color, duplex, and paper mode values are resolved from terminal device capability/config mapping, never hardcoded vendor strings.

- [ ] **Step 3: Add failing verify for SQLite fail-closed**

Run: `pnpm --filter @ai-job-print/terminal-agent verify:print-scan-agent`

Expected before implementation: FAIL with message containing `sqlite unavailable must stop print loop`.

- [ ] **Step 4: Implement Agent fail-closed**

Change `apps/terminal-agent/src/agent/db.ts` and `task-runner.ts` so a database open failure prevents task polling and sends a degraded heartbeat/status to the API.

Required behavior:
- No physical print call occurs while local task db is unavailable.
- Admin can identify degraded terminals from heartbeat payload.
- Logs say `local task database unavailable; printing disabled`.

- [ ] **Step 5: Run verification**

Run:

```bash
pnpm --filter @ai-job-print/api verify:print-scan-first-release
pnpm --filter @ai-job-print/api verify:print-jobs
pnpm --filter @ai-job-print/api verify:terminal-device-config
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/terminal-agent verify:print-scan-agent
pnpm --filter @ai-job-print/terminal-agent typecheck
git diff --check
```

Expected: all commands pass.

### Task 2: Shared Contracts And Feature Gates

**Files:**
- Modify: `packages/shared/src/types/print.ts`
- Modify: `packages/shared/src/types/file.ts`
- Modify: `packages/shared/src/types/device.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `services/api/src/print-scan/print-scan.types.ts`
- Create: `apps/kiosk/src/services/api/printScan.ts`
- Create: `apps/admin/src/services/api/printScan.ts`

- [ ] **Step 1: Define capability states**

Add shared union types:

```ts
export type PrintScanCapabilityKey =
  | 'document_print'
  | 'phone_upload'
  | 'cloud_upload'
  | 'usb_import'
  | 'material_pack'
  | 'scan'
  | 'copy'
  | 'id_photo'
  | 'format_convert'
  | 'signature_stamp';

export type PrintScanCapabilityStatus =
  | 'available'
  | 'testing'
  | 'maintenance'
  | 'unsupported'
  | 'not_verified';
```

- [ ] **Step 2: Define task types**

Add shared task discriminators:

```ts
export type PrintScanTaskType =
  | 'print'
  | 'scan'
  | 'copy'
  | 'photo'
  | 'material_pack'
  | 'format_conversion'
  | 'signature_stamp';
```

- [ ] **Step 3: Define fail-closed rule**

Add a pure function in shared code:

```ts
export const canCreateFormalPrintScanTask = (
  status: PrintScanCapabilityStatus,
): boolean => status === 'available';

export const canAccessTestingPrintScanCapability = (
  status: PrintScanCapabilityStatus,
  context: 'ordinary_user' | 'tester' | 'admin' | 'maintenance',
): boolean => status === 'testing' && context !== 'ordinary_user';
```

- [ ] **Step 4: Verify contract exports**

Run:

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api verify:print-scan-first-release
pnpm --filter @ai-job-print/kiosk verify:print-scan-first-release-ui
pnpm --filter @ai-job-print/admin verify:admin-print-scan-ui
git diff --check
```

Expected: all commands pass after each verify script exists in its task.

### Task 3: Kiosk Service Center And User Flow

**Files:**
- Modify: `apps/kiosk/src/pages/home/HomePage.tsx`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Create: `apps/kiosk/scripts/verify-print-scan-first-release-ui.mjs`

- [ ] **Step 1: Add failing Kiosk UI verify**

Run: `pnpm --filter @ai-job-print/kiosk verify:print-scan-first-release-ui`

Expected before implementation: FAIL with message containing `/print-scan must be the home print-scan entry`.

- [ ] **Step 2: Route home group to service center**

Change the print-scan home group title action to route to `/print-scan`.

Acceptance:
- The home group still shows individual feature cards.
- The group click no longer jumps directly to `/print/upload?source=document`.

- [ ] **Step 3: Render all first-release capabilities**

`PrintScanHomePage` must render the full first-release list:
- document print
- phone upload
- cloud upload
- USB import
- material pack
- scan
- copy
- ID photo
- format conversion
- signature/stamp
- my documents
- print orders
- feedback

Acceptance:
- Cards are driven by capability status, not hardcoded `available: true`.
- Cards with status other than `available` do not create formal tasks.
- The UI explains status without fake success animation.

- [ ] **Step 4: Run verification**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:print-scan-first-release-ui
pnpm --filter @ai-job-print/kiosk verify:print-entry-source-split
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
git diff --check
```

Expected: all commands pass.

### Task 4: Print Progress, Failure Recovery, And Orders

**Files:**
- Modify: `apps/kiosk/src/pages/print/PrintProgressPage.tsx`
- Modify: `apps/kiosk/src/pages/print/PrintDonePage.tsx`
- Modify: `apps/kiosk/src/pages/print/PrintConfirmPage.tsx`
- Modify: `services/api/src/member-print-orders/member-print-orders.service.ts`
- Modify: `services/api/src/member-print-orders/member-print-orders.types.ts`
- Modify: `packages/shared/src/types/memberPrintOrders.ts`

- [ ] **Step 1: Extend order state contract**

Expose terminal id, task id, status timestamps, error code, retry eligibility, and feedback link target in member print order DTO.

- [ ] **Step 2: Show user-safe progress states**

`PrintProgressPage` must show:
- task id
- target terminal
- submitted
- queued
- claimed
- printing
- completed
- failed
- expired
- unconfirmed

- [ ] **Step 3: Add failure actions**

Failure UI must include:
- retry same file with new signed URL
- submit feedback with related print task id
- go to my documents
- contact staff

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter @ai-job-print/api verify:member-print-orders
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/api typecheck
git diff --check
```

Expected: all commands pass.

### Task 5: Phone Upload, Cloud Upload, And Safe Release

**Files:**
- Modify: `services/api/src/files/files.controller.ts`
- Modify: `services/api/src/files/files.service.ts`
- Modify: `services/api/src/files/dto/create-upload-intent.dto.ts`
- Modify: `apps/kiosk/src/pages/print/PrintUploadPage.tsx`
- Modify: `apps/kiosk/src/services/print/printJobsApi.ts`
- Modify: `packages/shared/src/types/uploadSession.ts`

- [ ] **Step 1: Reuse upload sessions**

Phone upload must reuse existing upload session security model:
- phone receives one-time upload token only
- Kiosk keeps control token
- member ownership binds only after Kiosk confirmation
- URL tokens use fragment, not query

- [ ] **Step 2: Add cloud upload session**

Cloud upload is not remote printing. It creates a file session bound to the current terminal. A file cannot become a `PrintTask` until the current Kiosk confirms it.

- [ ] **Step 3: Add safe release code**

Add an optional release code for jobs submitted from phone/cloud upload. It must be short-lived and bound to task id + terminal id.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter @ai-job-print/api verify:upload-sessions
pnpm --filter @ai-job-print/api verify:upload-sessions:http
pnpm --filter @ai-job-print/kiosk verify:resume-phone-upload-ui
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
git diff --check
```

Expected: all commands pass.

### Task 6: Material Pack And AI File Check

**Files:**
- Create: `services/api/src/print-scan/dto/create-material-pack-task.dto.ts`
- Modify: `services/api/src/materials/dto/create-material-task.dto.ts`
- Modify: `services/api/src/materials/materials.cleanup.task.ts`
- Modify: `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx`
- Create: `apps/kiosk/src/pages/print-scan/material-pack/MaterialPackPage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Modify: `packages/shared/src/types/print.ts`

- [ ] **Step 1: Create material pack task**

Material pack creates one parent task and child print tasks. Child task failures do not erase completed children.

- [ ] **Step 2: AI file check must be advisory unless derived output exists**

If AI detects sensitive data but no redacted derived file exists, UI must say original file is still the print source.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter @ai-job-print/api verify:materials-processing
pnpm --filter @ai-job-print/api verify:job-materials
pnpm --filter @ai-job-print/kiosk verify:job-material-library-ui
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
git diff --check
```

Expected: all commands pass.

### Task 7: Real Scan And Copy

**Files:**
- Create: `services/api/src/print-scan/dto/create-scan-task.dto.ts`
- Create: `services/api/src/print-scan/dto/create-copy-task.dto.ts`
- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Create: matching SQLite and PostgreSQL migration directories for print-scan task models
- Create: `apps/terminal-agent/src/scanner/scanner.ts`
- Create: `apps/terminal-agent/src/scanner/types.ts`
- Modify: `apps/kiosk/src/pages/scan/ScanStartPage.tsx`
- Modify: `apps/kiosk/src/pages/scan/ScanSettingsPage.tsx`
- Modify: `apps/kiosk/src/pages/scan/ScanProgressPage.tsx`
- Modify: `apps/kiosk/src/pages/scan/ScanResultPage.tsx`
- Modify: `services/api/src/files/file.types.ts`

- [ ] **Step 0: Add database migrations**

Add additive Prisma models or fields for scan/copy task state, result file references, terminal binding, task TTL, and status logs.

Required migration checks:

```bash
pnpm --filter @ai-job-print/api db:pg:sync
pnpm --filter @ai-job-print/api db:pg:sync:check
pnpm --filter @ai-job-print/api db:pg:generate
pnpm --filter @ai-job-print/api db:pg:deploy
```

Acceptance:
- SQLite and PostgreSQL schemas expose the same TypeScript shape.
- Migration SQL is additive and has no destructive column/table drop.
- A scratch PostgreSQL deploy succeeds before any Kiosk/Admin UI is marked ready.

- [ ] **Step 1: Add scan task states**

States:
- pending
- claimed
- scanning
- uploaded
- processing
- completed
- failed
- expired

- [ ] **Step 2: Add scanner bridge and copy task flow**

Copy is scan + print. The Agent scanner adapter must invoke a configured WIA/TWAIN helper execution from an Agent-owned temp directory, validate the produced file type/hash/size, upload only validated output, and delete local temp files after upload.

ID copy must produce an A4 layout, use high-sensitive TTL, and be forced to no long-term save.

- [ ] **Step 3: Agent adapter must fail closed**

If scanner capability is unavailable, the task fails with device-not-supported and no fake file is created.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:scan-production-guard
pnpm --filter @ai-job-print/api verify:print-scan-first-release
pnpm --filter @ai-job-print/terminal-agent verify:print-scan-agent
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api verify:audit-logs
git diff --check
```

Expected: all commands pass.

### Task 8: ID Photo, Format Conversion, Signature/Stamp

**Files:**
- Create: `services/api/src/print-scan/dto/create-photo-task.dto.ts`
- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Create: matching SQLite and PostgreSQL migration directories for photo/signature/conversion task models
- Create: `apps/terminal-agent/src/photo/photo-layout.ts`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx`
- Modify: `services/api/src/files/file-validation.ts`
- Modify: `services/api/src/files/file.types.ts`

- [ ] **Step 0: Add migrations and provider gate**

Add additive task/result fields for `photo`, `format_conversion`, and `signature_stamp` flows. Regenerate PostgreSQL schema and add matching migrations as described in Implementation Guardrails.

The ID photo AI path must declare a provider gate:
- `PHOTO_MATTING_PROVIDER` selects the approved matting provider.
- missing provider or missing credential keeps `id_photo` at `not_verified`.
- API rejects creation of a processed ID photo task unless a derived printable output can be produced.

- [ ] **Step 1: ID photo flow**

Supported first version:
- upload photo
- validate size and file type
- create high-sensitive `id_photo` file
- call the configured matting/background provider or fail closed
- generate derived printable PDF layout
- print derived PDF only after user confirmation

- [ ] **Step 2: Format conversion flow**

Format conversion must create a derived file. Print confirmation cannot use an imaginary converted file.

- [ ] **Step 3: Signature/stamp disclaimer**

Every signature/stamp flow must show:

```text
本功能仅提供图形排版层面的签名/印章叠加服务，不属于 CA 数字证书加密的电子签名，不具备电子合同等同法律效力。
```

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/kiosk verify:legal-retention-copy
pnpm --filter @ai-job-print/kiosk verify:print-scan-first-release-ui
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
git diff --check
```

Expected: all commands pass.

### Task 9: USB Import

**Files:**
- Create: `apps/terminal-agent/src/usb/usb-files.ts`
- Modify: `apps/terminal-agent/src/local-api/origin-guard.ts`
- Modify: `apps/terminal-agent/src/local-api/types.ts`
- Modify: `apps/terminal-agent/src/local-api/wire.ts`
- Modify: `apps/kiosk/src/pages/print/PrintUploadPage.tsx`

- [ ] **Step 1: Agent-only USB enumeration**

Browser never reads USB directly. Agent enumerates removable drives through Windows CIM/PowerShell or an approved equivalent adapter, and returns a sanitized list:
- display name
- extension
- size
- safe id
- never absolute path

The safe id is valid only for the current terminal session and cannot be reused after device removal or Kiosk timeout.

- [ ] **Step 2: Validate before upload**

Reject:
- hidden files
- unsupported extension
- mismatched MIME
- oversized files
- path traversal
- Office macro formats until conversion sandbox exists

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter @ai-job-print/terminal-agent verify:local-qr-proxy
pnpm --filter @ai-job-print/terminal-agent verify:direct-http-agents
pnpm --filter @ai-job-print/terminal-agent verify:print-scan-agent
pnpm --filter @ai-job-print/kiosk typecheck
git diff --check
```

Expected: all commands pass.

### Task 10: Admin Operations And Commercial Controls

**Files:**
- Create: `apps/admin/src/routes/print-scan/index.tsx`
- Create: `apps/admin/src/services/api/printScan.ts`
- Create: `apps/admin/scripts/verify-admin-print-scan-ui.mjs`
- Modify: `apps/admin/src/routes/terminals/index.tsx`
- Modify: `apps/admin/src/routes/printers/index.tsx`
- Modify: `apps/admin/src/routes/alerts/index.tsx`
- Modify: `apps/admin/src/routes/files/index.tsx`
- Modify: `apps/admin/src/routes/orders/index.tsx`
- Modify: `services/api/src/admin-orders-readonly/admin-orders-readonly.service.ts`
- Modify: `services/api/src/admin-orders-readonly/admin-orders-readonly.types.ts`
- Modify: `services/api/src/terminals/admin-terminals.controller.ts`
- Modify: `services/api/src/terminals/admin-printers.controller.ts`

- [ ] **Step 1: Unified task center**

Admin page must show:
- print
- scan
- copy
- photo
- material pack
- format conversion
- signature/stamp

- [ ] **Step 2: Define admin task aggregation contract**

`admin-orders-readonly` or the new `print-scan` admin service must expose a discriminated union detail payload for:
- `print`
- `scan`
- `copy`
- `photo`
- `material_pack`
- `format_conversion`
- `signature_stamp`

Acceptance:
- list rows include task type, terminal id, status, user/member reference, created time, expiry time, and last error.
- detail rows include the linked subtype task id and safe user-file metadata, not raw signed URLs.
- Admin retry/cancel/release actions are type-aware and reject unsupported transitions.

- [ ] **Step 3: Device capability center**

Admin can view and configure:
- printer
- scanner
- camera
- USB import
- cloud upload
- Agent version
- degraded status

- [ ] **Step 4: Commercial controls**

Admin can configure:
- pricing
- free quota
- benefit coupon rules
- subsidy labels
- refund/exception workflow status

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @ai-job-print/admin verify:admin-print-scan-ui
pnpm --filter @ai-job-print/admin verify:admin-file-lifecycle-ui
pnpm --filter @ai-job-print/admin verify:admin-orders-readonly-ui
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
pnpm --filter @ai-job-print/api verify:admin-ops
pnpm --filter @ai-job-print/api verify:admin-orders-readonly
git diff --check
```

Expected: all commands pass.

### Task 11: Acceptance Package And Production Gates

**Files:**
- Create: `docs/device/print-scan-first-release-acceptance.md`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `services/api/scripts/verify-production-runtime-gates.ts`
- Modify: `apps/kiosk/scripts/verify-production-real-services.mjs`
- Modify: `services/api/scripts/verify-production-real-services.ts`

- [ ] **Step 1: Write acceptance checklist**

The checklist must include:
- local automated verify
- preproduction PostgreSQL/COS/Redis verify
- Windows Terminal Agent install
- printer output
- scanner input
- ID copy
- ID photo
- USB import
- cloud upload
- file TTL deletion
- Admin audit sampling
- rollback procedure

- [ ] **Step 2: Production gates**

Production runtime gate must reject:
- mock API mode
- mock AI provider for enabled AI features
- disabled OCR for enabled scan OCR
- missing Redis
- missing COS
- missing terminal id
- missing feature gate configuration for print-scan

- [ ] **Step 3: Final verify**

Run:

```bash
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:production-real-services
pnpm --filter @ai-job-print/kiosk verify:production-real-services
pnpm --filter @ai-job-print/kiosk verify:prod-build-config
git diff --check
```

Expected: all commands pass.

## 5. Required Final Review

After all implementation branches are integrated:

- Run all changed package typechecks.
- Run all print-scan verify scripts.
- Run `git diff --check`.
- Run browser verification against Kiosk and Admin.
- Run Windows Terminal Agent real device acceptance.
- Call Antigravity reviewer and Claude reviewer with the final diff and acceptance evidence.
- Fix all Critical findings.
- Do not ship with unverified scan, copy, photo, USB, cloud upload, format conversion, or signature/stamp flows exposed to ordinary users.

## 6. Self-Review

- Spec coverage: all first-release capabilities in `docs/product/print-scan-commercial-plan.md` map to Tasks 1-11.
- Placeholder scan: no unresolved placeholder markers or vague validation deferrals.
- Type consistency: shared capability keys and task type names are defined before Kiosk/API/Admin usage.
- Scope risk: the plan is too large for one branch; implementation must split by task or smaller vertical slices.
