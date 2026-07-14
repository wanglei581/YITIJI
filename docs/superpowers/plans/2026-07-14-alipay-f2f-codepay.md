# 支付宝当面付扫码枪付款码支付 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有 Kiosk 收银页启用支付宝当面付“商户扫用户付款码”，并继续由服务端的金额校验、查单收敛和 paid-before-claim 门禁控制打印。

**Architecture:** 复用现有 `OnlinePaymentService.createCodePayAttempt` 订单互斥与收敛状态机，只在 `AlipayProvider` 增加 `alipay.trade.pay` 适配。Kiosk 只解除支付宝付款码入口的临时禁用；扫码枪已验证为 18 位，因此继续使用既有输入长度，服务端再以支付宝前缀防误路由。

**Tech Stack:** React + TypeScript、NestJS、Prisma（仅既有运行时）、Node `crypto` RSA2、现有 verify 脚本。

---

## 文件归位和边界

| 文件 | 职责 |
| --- | --- |
| `services/api/src/payment/providers/alipay.provider.ts` | 支付宝条码支付请求、结果映射与生产收敛门禁。 |
| `apps/kiosk/src/pages/print/PrintCashierPage.tsx` | 允许支付宝选择既有“扫付款码”方式。 |
| `services/api/scripts/verify-payment-real-channels.ts` | 使用本地签名假网关验证真实 Provider/服务状态链。 |
| `services/api/scripts/verify-payment-codepay.ts` | 验证 UI 契约没有重新禁用支付宝和既有防双扣不变量仍在。 |
| `docs/progress/*.md` | 只在验证实际完成后记录本地证明与线上未验收边界。 |

不涉及 `apps/terminal-agent`、数据库 schema/migration、共享类型、Admin/Partner、退款和支付宝控制台设置。

### Task 1: 先写支付宝条码支付失败用例

**Files:**

- Modify: `services/api/scripts/verify-payment-real-channels.ts`
- Modify: `services/api/scripts/verify-payment-codepay.ts`

- [ ] **Step 1: 扩展假支付宝网关状态夹具。**

在 `startFakeGateway()` 中捕获 `alipay.trade.pay` 的 `biz_content`，根据可控的签名响应节点返回 `alipay_trade_pay_response`。夹具只记录方法、订单号、金额和场景；不得输出或保存 `auth_code`。

- [ ] **Step 2: 先写会失败的完整通道用例。**

在 `verify-payment-real-channels.ts` 中，使用一个固定的假 18 位支付宝付款码（25 前缀）断言：

```ts
const codePay = await payment.createCodePayAttempt(order.orderId, order.token, '251234567890123456', 'alipay')
assert(codePay.status === 'success')
assert(lastAlipayCodePayBiz?.scene === 'bar_code')
assert(lastAlipayCodePayBiz?.product_code === 'FACE_TO_FACE_PAYMENT')
assert(lastAlipayCodePayBiz?.out_trade_no === codePay.attemptId)
```

追加三个独立订单，分别令假网关返回 `10003`、`40004`、`20000`；断言 `10003/20000` 使订单与 Attempt 维持 `paying/pending`，`40004` 使订单回 `unpaid` 且返回安全失败文案。测试不得把假付款码拼入失败输出、审计断言或日志。

- [ ] **Step 3: 运行失败用例确认 RED。**

Run:

```bash
pnpm --filter @ai-job-print/api verify:payment-real-channels
```

Expected: `alipay.trade.pay` 尚未被 Provider 实现，新增支付宝付款码断言失败；既有二维码/回调断言仍不应被修改为失败。

- [ ] **Step 4: 补充静态 UI 契约失败断言。**

在 `verify-payment-codepay.ts` 的 `verifyKioskContract()` 中断言：

```ts
!/'当前支付通道暂不支持扫付款码'/.test(cashier)
! /const canUseCodePay = selectedChannel !== 'alipay'/.test(cashier)
/selectedChannel === 'alipay'/.test(cashier)
```

最后一条仅用于确认页面仍按通道进行支付请求与错误处理；不得改成“支付宝一律禁用”。保留 `CashierPaymentPanel.tsx` 的 `maxLength={18}` 断言，匹配终端现场口径。

- [ ] **Step 5: 运行付款码 verify 确认 RED。**

Run:

```bash
pnpm --filter @ai-job-print/api verify:payment-codepay
```

Expected: 因 Kiosk 仍包含支付宝禁用提示或禁用条件而失败。

### Task 2: 实现支付宝 Provider 的条码支付

**Files:**

- Modify: `services/api/src/payment/providers/alipay.provider.ts`
- Test: `services/api/scripts/verify-payment-real-channels.ts`

- [ ] **Step 1: 导入现有付款码类型。**

将 `CodePaymentCreateInput` 与 `CodePaymentCreateResult` 加到现有 `payment-provider.types` type import；不新增另一个 Provider 接口。

- [ ] **Step 2: 实现 fail-closed 的 `createCodePayment`。**

在 `AlipayProvider` 中新增方法：先拒绝非 18 位数字或非 `25–30` 前缀；生产环境且 `PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED !== 'true'` 时在任何 HTTP 请求前返回 `failed`。调用既有 `call()`：

```ts
const node = await this.call('alipay.trade.pay', {
  out_trade_no: input.attemptId,
  scene: 'bar_code',
  auth_code: input.authCode,
  product_code: 'FACE_TO_FACE_PAYMENT',
  subject: `打印服务订单 ${input.orderNo}`,
  total_amount: centsToYuan(input.amountCents),
  timeout_express: '5m',
  ...(input.terminalId ? { terminal_id: input.terminalId.slice(0, 32) } : {}),
})
```

只有 `trade_no` 和 `total_amount` 都有效时返回 `success`。捕获 `call()` 的安全错误码：`10003`、`20000`、HTTP/超时和响应验证错误一律返回 `paying`；`40004` 与付款码/余额等明确业务拒绝返回 `failed`。错误文案只能使用固定安全文本，绝不包含付款码、请求 body、签名或原始渠道报文。

- [ ] **Step 3: 运行新的真实渠道验证确认 GREEN。**

Run:

```bash
pnpm --filter @ai-job-print/api verify:payment-real-channels
```

Expected: 新增的 `10000/10003/40004/20000` 断言通过；既有 RSA2 回调、金额不符、查单和 paid-before-claim 全部继续通过。

### Task 3: 启用 Kiosk 支付宝付款码入口

**Files:**

- Modify: `apps/kiosk/src/pages/print/PrintCashierPage.tsx`
- Test: `services/api/scripts/verify-payment-codepay.ts`

- [ ] **Step 1: 删除支付宝专属的付款码禁用。**

从 `selectPaymentMethod()` 删除只针对 `selectedChannel === 'alipay'` 的返回分支；删除 `canUseCodePay` 的支付宝禁用条件。支付方式按钮继续保留 `!selectedChannel || issuing || codeSubmitting || hasActivePaymentAttempt` 的禁用条件，使 Sandbox、微信和支付宝的既有状态机行为一致。

- [ ] **Step 2: 保持扫码枪输入契约。**

不更改 `CashierPaymentPanel` 的 18 位输入上限。`submitCodePayment()` 继续用 18 位数字进行前置校验，Provider 再校验支付宝前缀；任何前端校验仅改善体验，服务端仍是最终边界。

- [ ] **Step 3: 运行 UI/状态机验证确认 GREEN。**

Run:

```bash
pnpm --filter @ai-job-print/api verify:payment-codepay
pnpm --filter @ai-job-print/api verify:kiosk-cashier-ui
```

Expected: 静态契约确认支付宝未被禁用；付款码不持久化、并发互斥、未知结果 pending、出纸门禁继续通过。

### Task 4: 回归、文档和审查

**Files:**

- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/alipay-f2f-codepay-20260714/task.json`
- Create: `.ccg/tasks/alipay-f2f-codepay-20260714/review.md`

- [ ] **Step 1: 运行类型、格式与全部相关验证。**

Run:

```bash
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/api verify:payment-codepay
pnpm --filter @ai-job-print/api verify:payment-real-channels
pnpm --filter @ai-job-print/api verify:kiosk-cashier-ui
git diff --check
```

Expected: 每条命令退出码为 0；不把本地模拟验证描述为真实商户扣款、生产部署或扫码枪现场验收。

- [ ] **Step 2: 双模型审查 diff。**

并行运行 Claude 与前端模型，审查支付状态分类、auth code 是否可能泄露、支付宝输入与扫码枪兼容性、二维码回归与 paid-before-claim。将 Critical/Warning/Info 写入 `review.md`；Critical 必须修复并重新审查。

- [ ] **Step 3: 更新正式进度文档和任务状态。**

仅记录实际通过的本地验证、未做的生产环境变量配置、密钥安装、真实付款、Windows 扫码枪和物理打印验收。将任务 `currentPhase` 更新为 `review`，通过最终验证后再改为 `completed` 并按仓库流程归档。
