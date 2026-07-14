# 未领取未支付打印任务受控关闭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有 Admin 打印扫描详情页中，安全关闭一笔明确指定、未领取、未支付且没有任何支付尝试的打印任务。

**Architecture:** 复用 `AdminPrintScanController` 的 Admin 会话鉴权与 `AdminPrintScanService` 的任务状态机，不新增维护脚本或数据库结构。新增一个专用的关闭端点和 DTO；服务端在单个 Prisma transaction 内用 `updatedAt`、任务/订单/支付尝试状态做 compare-and-set，并将订单原子转为 `closed`，写状态日志和审计。Admin 页面使用既有详情面板和 API adapter 做显式确认、填写原因、成功后刷新。

**Tech Stack:** NestJS、Prisma、class-validator、React + TypeScript、现有 `verify-admin-print-scan` Node 验证脚本。

---

## 前置门禁

- 有效的 Claude 与前端模型审查均须完成；当前 Antigravity 因地区服务限制、Claude CLI 因未返回结果而未形成有效报告。
- 不运行可能连接预生产/生产数据库的 `verify:print-jobs`；先确认本地 `DATABASE_URL` 指向隔离数据库，再运行本计划的专用 verify。
- 生产任务只读复核、部署和实际关闭属于后续独立授权，不在本计划实施阶段执行。

### Task 1: 定义关闭契约与后端失败用例

**Files:**

- Create: `services/api/src/admin-print-scan/dto/cancel-unpaid-print-task.dto.ts`
- Modify: `services/api/src/admin-print-scan/admin-print-scan.controller.ts`
- Modify: `services/api/src/admin-print-scan/admin-print-scan.service.ts`
- Modify: `services/api/src/admin-print-scan/admin-print-scan.types.ts`
- Test: `services/api/scripts/verify-admin-print-scan.ts`

- [ ] **Step 1: 写会失败的验证场景**

在 `verify-admin-print-scan.ts` 增加隔离 fixture，并断言：合格 `pending/unpaid` 任务可关闭；支付尝试为 `created`、`pending`、`expired`、`success` 或 `failed` 的任务都被拒绝（避免失败尝试的迟到回调重开订单）；`paid`、`paying`、已领取和过期 `updatedAt` 被拒绝；第一次成功后重试没有新增状态日志或审计；关闭后 `payStatus=closed`、`taskStatus=cancelled`，金额和支付来源保持不变。还要验证旧 payment-session 不能为 `closed` 订单新建二维码/付款码，Admin `mark-paid` 同样拒绝，并发的 Agent claim 与关闭只能有一方提交。

```ts
await expectError(
  () => service.cancelUnpaidPrintTask(taskId, context),
  'PRINT_SCAN_CANCEL_PAYMENT_RECONCILIATION_REQUIRED',
)
assert.equal(order.payStatus, 'closed')
assert.equal(task.status, 'pending')
```

- [ ] **Step 2: 运行验证并确认失败**

Run: `pnpm --filter @ai-job-print/api verify:admin-print-scan`

Expected: 新增的受控关闭场景因方法/路由尚不存在而失败；不得连接生产或预生产数据库。

- [ ] **Step 3: 实现专用 DTO、端点和事务服务**

新增 DTO：`reason` 为 10–500 字符，`expectedUpdatedAt` 为 ISO 日期。新增 `POST /admin/print-scan/tasks/print/:taskId/close-unpaid`，从 `@CurrentUser()` 传入操作上下文。服务实现必须以以下条件读取与 CAS 更新：

```ts
where: {
  id: taskId,
  status: 'pending',
  claimedAt: null,
  claimExpiry: null,
  updatedAt: new Date(expectedUpdatedAt),
}
```

事务内先确认关联订单存在并且没有任何付款尝试，再让任务与订单 CAS 各命中一行。订单 CAS 必须同时限定 `printTaskId=taskId`、`payStatus: 'unpaid'`、`taskStatus: 'pending'`，并写入 `payStatus: 'closed', taskStatus: 'cancelled'`；任务写入 `status: 'cancelled'`。同一事务直接 `tx.auditLog.create`，不能使用会吞错的 `AuditService.write`。若任务已经以同一受控错误码关闭且订单为 `closed/cancelled`，则返回幂等结果，不能再写日志或审计。任何状态的支付尝试存在时都必须拒绝关闭。

- [ ] **Step 4: 运行后端验证**

Run: `pnpm --filter @ai-job-print/api verify:admin-print-scan`

Expected: 全部 PASS；fixture 清理后无遗留任务、订单、支付尝试、状态日志或审计记录；模拟 `tx.auditLog.create` 失败时任务和订单更新也必须回滚。

- [ ] **Step 5: 提交后端原子改动**

```bash
git add services/api/src/admin-print-scan services/api/scripts/verify-admin-print-scan.ts
git commit -m "fix(print): add controlled unpaid task cancellation"
```

### Task 2: 接入 Admin 详情页并保护误操作

**Files:**

- Modify: `apps/admin/src/services/api/printScan.ts`
- Create: `apps/admin/src/routes/print-scan/CloseUnpaidPrintTaskForm.tsx`
- Modify: `apps/admin/src/routes/print-scan/index.tsx`
- Test: `apps/admin/src/routes/print-scan/index.tsx` 的现有可用验证或最小 typecheck

- [ ] **Step 1: 先添加会失败的适配器契约检查**

在现有前端 API 模块中声明专用调用，不复用扫描取消的通用 action：

```ts
cancelUnpaidPrintTask(taskId: string, body: { reason: string; expectedUpdatedAt: string }): Promise<AdminCloseUnpaidPrintTaskResult>
```

调用路径必须为 `/admin/print-scan/tasks/print/${encodeURIComponent(taskId)}/close-unpaid`。

- [ ] **Step 2: 实现二次确认 UI**

后端详情契约增加只读 `closeUnpaidEligible` 与安全阻断提示；仅当它为 true 时显示按钮。将原因表单拆到 `CloseUnpaidPrintTaskForm.tsx`，以可见 label、textarea、字符限制、取消按钮和危险操作确认实现，不复用 `window.confirm`。提交用当前 `detail.updatedAt` 作为 `expectedUpdatedAt`，并显示“将关闭订单，后续不能继续支付或领取；仅未支付、未领取且无待核对支付尝试可关闭”。成功后加载服务端详情和列表；刷新失败只提示“操作已执行成功，请刷新查看”，不触发重复提交。打印状态筛选增加 `cancelled` 以支持回查。

- [ ] **Step 3: 运行前端检查**

Run: `pnpm --filter @ai-job-print/admin typecheck`

Expected: PASS，且既有打印重试/扫描取消操作仍保持原行为。

- [ ] **Step 4: 提交前端原子改动**

```bash
git add apps/admin/src/services/api/printScan.ts apps/admin/src/routes/print-scan/index.tsx
git commit -m "feat(admin): expose controlled unpaid print cancellation"
```

### Task 3: 复核、文档与交付门禁

**Files:**

- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Test: `services/api/scripts/verify-admin-print-scan.ts`

- [ ] **Step 1: 运行范围验证**

Run:

```bash
pnpm --filter @ai-job-print/api verify:admin-print-scan
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/admin typecheck
git diff --check
```

Expected: 所有命令退出码为 0，且没有触发生产/预生产网络写入。

- [ ] **Step 2: 完成双模型 diff 审查**

提交前必须让 Claude 与前端模型分别审查 `git diff origin/main...HEAD`。任何 Critical 问题先修复并重新审查；Antigravity 无有效报告时不得把它写成已通过。

- [ ] **Step 3: 如实同步进度文档**

记录“本地代码/verify 已完成”与“生产部署/生产实际关闭仍未执行”两个事实；不得写入真实用户文件、订单金额、付款凭据、token 或原始日志。

- [ ] **Step 4: 最终提交**

```bash
git add docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "docs(print): record controlled cancellation readiness"
```

## 验收边界

本计划完成只代表本地实现、验证和审查通过。生产环境的只读预检、发布、Admin 实际关闭指定任务、发布后验证，均需单独获得授权；不能把本地验证写成生产处置已经完成。
