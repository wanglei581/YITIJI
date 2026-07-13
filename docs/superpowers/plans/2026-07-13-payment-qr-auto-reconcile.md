# Payment QR Auto Reconcile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让真实屏上收款码在支付回调延迟或丢失时自动、安全地查单并进入既有打印流程。

**Architecture:** Kiosk 保留 `getPayStatus` 作为本库状态轮询；当真实 `pending` 尝试尚未结算时，Kiosk 复用现有 `POST /orders/:id/pay/reconcile`。服务端继续负责 session-token 鉴权、限流、渠道查询、金额/流水号校验与幂等入账，回调仍为首选路径。

**Tech Stack:** React + TypeScript、NestJS payment service、既有 Node 验证脚本。

---

功能归位声明：

- 功能/业务闭环名称：真实二维码付款后的自动确认与打印放行。
- 涉及层和具体目录：
  - 前端：`apps/kiosk/src/pages/print/PrintCashierPage.tsx`，仅收银页自动查单条件。
  - 后端：不改运行时代码；复用已存在的 `OnlinePaymentService.reconcilePayment`。
  - 终端：不涉及。
  - 共享类型：不涉及。
  - 共享 UI：不涉及。
  - 文档：本设计、计划以及完成后的两份 progress 文档。
- 明确不涉及的层：数据库、Prisma migration、支付通道密钥、回调验签、订单状态机、Admin、Terminal Agent。
- 复用确认：付款码已有同一自动查单模式；真实二维码已有相同 HTTP API 与手动兜底。
- 本任务允许修改：
  - `apps/kiosk/src/pages/print/PrintCashierPage.tsx`
  - `services/api/scripts/verify-payment-codepay.ts`
  - `docs/progress/current-progress.md`
  - `docs/progress/next-tasks.md`
- 本任务禁止：新增路由、直接从浏览器调用微信/支付宝、将查单塞入 `GET pay-status`、新增 cron、修改真实密钥或将域名写入 Git。

### Task 1: 先锁定二维码自动查单回归门禁

**Files:**

- Modify: `services/api/scripts/verify-payment-codepay.ts:315-328`
- Test: `services/api/scripts/verify-payment-codepay.ts`

- [ ] **Step 1: 写入失败断言**

把当前对 `CODE_PAY_RECONCILE_INTERVAL_MS` 的静态检查替换为下列约束：

```ts
const automaticallyReconcilesAllRealPendingAttempts =
  /const shouldAutoReconcile =/.test(cashier) &&
  /s\.attempt\?\.status === 'pending'/.test(cashier) &&
  /s\.attempt\.channel !== 'sandbox'/.test(cashier) &&
  !/!s\.attempt\.qrCodeContent/.test(cashier)

if (automaticallyReconcilesAllRealPendingAttempts && /onSubmitCode\(\)/.test(panel) && /maxLength=\{18\}/.test(panel)) {
  pass('cashier auto-reconciles every real pending attempt, including screen QR, and keeps scanner submission')
} else {
  fail('cashier QR auto-reconciliation guard missing')
}
```

- [ ] **Step 2: 运行失败验证**

Run:

```bash
DATABASE_URL='file:./prisma/dev.db' FILE_SIGNING_SECRET="${LOCAL_TEST_FILE_SIGNING_SECRET:?set a non-production test fixture}" pnpm --dir services/api run verify:payment-codepay
```

Expected: 非零退出，错误包含 `cashier QR auto-reconciliation guard missing`，因为旧代码仍以 `!s.attempt.qrCodeContent` 排除屏上二维码。

### Task 2: 统一真实支付的自动查单条件

**Files:**

- Modify: `apps/kiosk/src/pages/print/PrintCashierPage.tsx:49-50,86,251-269`
- Test: `services/api/scripts/verify-payment-codepay.ts`

- [ ] **Step 1: 最小实现**

将付款码专用常量和 ref 重命名为通用含义：

```ts
const POLL_INTERVAL_MS = 2500
const AUTO_RECONCILE_INTERVAL_MS = 3500

const lastAutoReconcileAtRef = useRef(0)
```

将轮询内条件替换为：

```ts
const shouldAutoReconcile =
  s.payStatus !== 'paid' &&
  s.attempt?.status === 'pending' &&
  s.attempt.channel !== 'sandbox' &&
  Date.now() - lastAutoReconcileAtRef.current >= AUTO_RECONCILE_INTERVAL_MS

if (shouldAutoReconcile) {
  lastAutoReconcileAtRef.current = Date.now()
  try {
    const reconciled = await reconcilePayment({ orderId, paymentSessionToken })
    if (cancelRef.current) return
    setSnapshot({ payStatus: reconciled.payStatus, attempt: reconciled.attempt })
    if (reconciled.payStatus === 'paid') proceedToPrint()
  } catch {
    // 自动查单失败不覆盖当前状态；下一周期继续以服务端限流为准重试。
  }
}
```

更新注释，明确“屏上收款码和付款码的真实 pending 尝试都自动查单；sandbox 不查单；回调仍是首选路径”。保留 `handleReconcile` 和按钮作为显式兜底。

- [ ] **Step 2: 运行目标验证**

Run:

```bash
DATABASE_URL='file:./prisma/dev.db' FILE_SIGNING_SECRET="${LOCAL_TEST_FILE_SIGNING_SECRET:?set a non-production test fixture}" pnpm --dir services/api run verify:payment-codepay
DATABASE_URL='file:./prisma/dev.db' FILE_SIGNING_SECRET="${LOCAL_TEST_FILE_SIGNING_SECRET:?set a non-production test fixture}" pnpm --dir services/api run verify:payment-flow
DATABASE_URL='file:./prisma/dev.db' FILE_SIGNING_SECRET="${LOCAL_TEST_FILE_SIGNING_SECRET:?set a non-production test fixture}" pnpm --dir services/api run verify:kiosk-cashier-ui
pnpm --dir apps/kiosk run typecheck
pnpm --dir apps/kiosk run lint
```

Expected: 全部退出码为 0；付款码与二维码共用自动查单门禁，支付会话、金额校验、沙箱隔离与出纸门控均无回归。

### Task 3: 文档和部署前验证口径

**Files:**

- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: 记录真实边界**

在两份进度文档中记录：本分支只完成本地代码/门禁级二维码自动查单；候选环境的 `PAYMENT_NOTIFY_BASE_URL` 必须在部署时与同一 API/数据库实例对齐；正式结论需要新订单的真实“付款不点核实 → 自动进打印 → 出纸”验收。

- [ ] **Step 2: 最终范围与安全检查**

Run:

```bash
git diff --check
git diff -- apps/kiosk/src/pages/print/PrintCashierPage.tsx services/api/scripts/verify-payment-codepay.ts docs/progress/current-progress.md docs/progress/next-tasks.md
git status --short
```

Expected: 无 whitespace 错误；没有密钥、真实支付流水号、回调 URL 或未声明文件。

### Task 4: 部署后的受控验收（不随代码提交执行）

**Files:**

- Modify: none

- [ ] **Step 1: 回调域名一致性预检**

在候选服务器上只读确认 `PAYMENT_NOTIFY_BASE_URL` 的 HTTPS 域名经 nginx 到达运行 Kiosk 所调用的 API PM2 实例，并连接同一 PostgreSQL 库；不得输出或复制支付密钥。

- [ ] **Step 2: 受控真实支付**

使用一份无个人信息的单页 PDF 创建新订单，扫码付款后不点击“核实”。记录订单、PaymentAttempt、审计、PrintTask 的状态时间线和现场出纸确认；完成后按既有留存规则清理测试文件，不删除订单审计。

- [ ] **Step 3: 失败路径演练**

在不产生真实扣款的受控渠道/沙箱场景确认渠道关闭或失败会展示“支付未完成”并允许重新出码，且不会放行 `PrintTask`。

## 计划自检

- 覆盖：自动成功、回调缺失兜底、渠道失败、安全鉴权、限流、沙箱隔离、部署回调一致性均有对应任务。
- 范围：无新增 API、模型、迁移、定时任务或支付依赖；只复用已有路径。
- 一致性：前端间隔为 3.5 秒，后端最小间隔为 3 秒；自动与手动均调用同一端点。
- 占位检查：无 `TODO`/`TBD`；部署项明确标为不随代码提交执行。
