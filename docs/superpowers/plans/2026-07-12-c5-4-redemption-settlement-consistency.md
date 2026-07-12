# C5-4 核销与线上支付结算一致性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保证订单的券/权益核销、付款码支付和扫码支付只有一个结算者；任何落库的 `RedemptionRecord` 都必须与同一事务内的 `Order paid(voucher)` 一致。

**Architecture:** 以 `Order.payStatus='unpaid'` 的 CAS 作为唯一结算锁。订单核销将“订单置 voucher 已支付、权益扣减、核销账本写入”置于同一 Prisma 事务；扫码支付在调用外部 Provider 之前先 CAS 预留为 `paying`，因此不能在可付款二维码已发出后再被券核销。审计仍在事务提交后同步写入，沿用现有“不因审计失败回滚业务”的契约。

**Tech Stack:** NestJS、TypeScript、Prisma（SQLite/PostgreSQL）、既有 `verify:redemption-audit` 与 `verify:payment-flow`。

**功能归位声明：**

- 后端：`services/api/src/benefit-redemption/`、`services/api/src/payment/`。
- 验证：`services/api/scripts/`。
- 文档：本计划及进度入口。
- 不涉及：Kiosk/Admin/Partner/Terminal Agent、共享类型、数据库 schema/migration、Payment Provider、退款与真实环境。

**允许修改：**

- `services/api/src/benefit-redemption/benefit-redemption.service.ts`
- `services/api/src/payment/order-status.service.ts`
- `services/api/src/payment/online-payment.service.ts`
- `services/api/scripts/verify-redemption-audit.ts`
- `services/api/scripts/verify-payment-flow.ts`
- `services/api/scripts/verify-payment-codepay.ts`
- `docs/superpowers/plans/2026-07-12-c5-4-redemption-settlement-consistency.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

**禁止修改：**

- `services/api/prisma/**`、`packages/**`、`apps/**`、`services/api/src/payment/providers/**`、`services/api/src/payment/refund.service.ts`、CI、部署配置、密钥与真实环境。

---

### Task 1: 写出三个确定性的并发红测

**Files:**

- Modify: `services/api/scripts/verify-redemption-audit.ts`
- Modify: `services/api/scripts/verify-payment-flow.ts`

- [x] **Step 1: 在核销 verify 中暂停提交后的 `benefit.redeem` 审计**

在 `verify-redemption-audit.ts` 的普通场景后新增一个 100 分订单和 1 次权益；把 `audit.write` 临时包装为仅在 `action === 'benefit.redeem'` 时暂停：

```ts
let resumeBenefitAudit: (() => void) | undefined
let enteredBenefitAudit: (() => void) | undefined
const benefitAuditEntered = new Promise<void>((resolve) => { enteredBenefitAudit = resolve })
const resumeGate = new Promise<void>((resolve) => { resumeBenefitAudit = resolve })
const originalAuditWrite = audit.write.bind(audit)
audit.write = async (args) => {
  if (args.action === 'benefit.redeem') {
    enteredBenefitAudit?.()
    await resumeGate
  }
  return originalAuditWrite(args)
}
```

启动 `redeemForOrder`，等待 gate 后调用 `orderStatus.markPaid(orderId, { paymentSource: 'offline' })`，再释放 gate。断言最终只能有一种一致状态：

```ts
const order = await prisma.order.findUnique({ where: { id: orderId } })
const recordCount = await prisma.redemptionRecord.count({ where: { orderId } })
const grant = await prisma.benefitGrant.findUnique({ where: { id: grantId } })
assert(
  (order?.paymentSource === 'voucher' && recordCount === 1 && grant?.quantityRemaining === 0) ||
  (order?.paymentSource === 'offline' && recordCount === 0 && grant?.quantityRemaining === 1),
  '并发结算后订单、权益与核销账本保持同一结算来源',
)
```

- [x] **Step 2: 运行核销红测并确认旧实现失败**

Run: `pnpm --filter @ai-job-print/api verify:redemption-audit`

Expected: 新断言失败，旧实现会出现 `paymentSource='offline'` 但核销账本已存在且权益已扣。

- [x] **Step 3: 在支付 verify 中暂停 QR Provider**

在 `verify-payment-flow.ts` 增加有归属的订单与权益 fixture，临时包装 `provider.createQrPayment`：

```ts
let releaseQr: (() => void) | undefined
let enteredQr: (() => void) | undefined
const qrEntered = new Promise<void>((resolve) => { enteredQr = resolve })
const qrRelease = new Promise<void>((resolve) => { releaseQr = resolve })
const originalCreateQrPayment = provider.createQrPayment.bind(provider)
provider.createQrPayment = async (input) => {
  enteredQr?.()
  await qrRelease
  return originalCreateQrPayment(input)
}
```

启动 `payment.createPayAttempt`，等待 Provider gate 后请求 `redemption.redeemForOrder`。断言核销返回 `ORDER_NOT_REDEEMABLE`、权益未扣、无 `order_redeem` 账本；释放 gate 后支付尝试仍返回 `pending` 且订单为 `paying`。

- [x] **Step 4: 运行支付红测并确认旧实现失败**

Run: `pnpm --filter @ai-job-print/api verify:payment-flow`

Expected: 新断言失败，旧 QR 出码在 Provider 调用后才把订单切换为 `paying`，因此核销可以错误成功。

- [x] **Step 5: 在付款码 verify 中锁定既有 reservation**

`verify-payment-codepay.ts` 是不连接数据库的内存状态机夹具，暂停 `createCodePayment` Provider 调用后，断言付款码路径已把订单 CAS 为 `paying` 且仅存在一条 `created` 尝试。实际 `redeemForOrder` 与此状态锁的联动由同一轮 `verify-payment-flow.ts` 的数据库并发用例覆盖：它断言任何进入 `paying` 的支付预留都会拒绝核销，不改付款码运行时代码。

### Task 2: 抽出事务内的 voucher 结算原语

**Files:**

- Modify: `services/api/src/payment/order-status.service.ts`

- [x] **Step 1: 使用现有事务客户端类型**

```ts
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
```

- [x] **Step 2: 新增无审计的事务内结算方法**

```ts
async settleRedemptionInTransaction(
  tx: PrismaTransactionClient,
  orderId: string,
  opts: { discountCents: number },
): Promise<OrderRecord> {
  const order = await tx.order.findUnique({ where: { id: orderId } })
  if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
  if (order.payStatus !== 'unpaid') {
    throw new BadRequestException(order.payStatus === 'paid' ? 'ORDER_ALREADY_PAID' : 'ORDER_INVALID_TRANSITION')
  }
  if (!Number.isInteger(opts.discountCents) || opts.discountCents < order.amountCents) {
    throw new BadRequestException('REDEEM_REQUIRES_FULL_COVERAGE')
  }
  for (let attempt = 0; attempt < PICKUP_MAX_ATTEMPTS; attempt += 1) {
    const pickupCode = await this.generateUniquePickupCode(tx)
    try {
      const result = await tx.order.updateMany({
        where: { id: orderId, payStatus: 'unpaid' },
        data: {
          payStatus: 'paid', paymentSource: 'voucher', payChannel: 'voucher',
          discountCents: order.amountCents, paidAt: new Date(), paidBy: 'redemption', pickupCode,
        },
      })
      if (result.count === 1) return this.requireOrderFrom(tx, orderId)
    } catch (error) {
      if (isPickupCodeUniqueConflict(error)) continue
      throw error
    }
    const fresh = await tx.order.findUnique({ where: { id: orderId } })
    throw new BadRequestException(fresh?.payStatus === 'paid' ? 'ORDER_ALREADY_PAID' : 'ORDER_INVALID_TRANSITION')
  }
  throw new BadRequestException('PICKUP_CODE_UNAVAILABLE')
}
```

将 `generateUniquePickupCode` 与 `requireOrder` 拆出可接受 `PrismaService | PrismaTransactionClient` 的内部版本；`markPaidByRedemption` 保留公开契约，但在自己的 `$transaction` 中复用该结算原语，再在提交后写原有 `order.mark_paid_redemption` 审计。

- [x] **Step 3: 运行定向 typecheck**

Run: `pnpm --filter @ai-job-print/api typecheck`

Expected: exit 0。

### Task 3: 把订单核销收敛为单一事务

**Files:**

- Modify: `services/api/src/benefit-redemption/benefit-redemption.service.ts`

- [x] **Step 1: 保留普通服务核销路径**

不得改动 `redeem()` / `redeemOnce()` 的简历等非订单服务语义。

- [x] **Step 2: 新增订单专用事务路径**

```ts
const idempotencyKey = createHash('sha256')
  .update(`${benefitGrantId}:order_redeem:${orderId}`)
  .digest('hex')
const outcome = await this.prisma.$transaction(async (tx) => {
  const order = await tx.order.findUnique({ where: { id: orderId } })
  if (!order || (order.endUserId && order.endUserId !== endUserId)) {
    throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: '订单不存在或不属于本人' } })
  }
  const existing = await tx.redemptionRecord.findFirst({
    where: { serviceType: 'order_redeem', serviceRefId: orderId },
  })
  if (existing) {
    if (existing.endUserId === endUserId && existing.benefitRef === benefitGrantId) {
      return { record: existing, order, idempotent: true as const }
    }
    throw new ConflictException({ error: { code: 'BENEFIT_OUTPUT_ALREADY_REDEEMED', message: '该订单已用其他权益核销，不能重复核销' } })
  }
  if (order.payStatus !== 'unpaid') {
    throw new BadRequestException({ error: { code: 'ORDER_NOT_REDEEMABLE', message: '订单当前不可核销抵扣' } })
  }
  if (order.amountCents <= 0) {
    throw new BadRequestException({ error: { code: 'REDEEM_NOT_REQUIRED', message: '免费单无需核销' } })
  }

  const grant = await tx.benefitGrant.findUnique({ where: { id: benefitGrantId } })
  if (!grant || grant.endUserId !== endUserId) {
    throw new NotFoundException({ error: { code: 'BENEFIT_GRANT_NOT_FOUND', message: '权益不存在或不属于本人' } })
  }
  if (!(REDEEMABLE_BENEFIT_TYPES as readonly string[]).includes(grant.benefitType)) {
    throw new BadRequestException({ error: { code: 'BENEFIT_NOT_REDEEMABLE', message: '该权益类型不支持核销' } })
  }
  if (grant.status !== 'active') {
    throw new ConflictException({ error: { code: 'BENEFIT_NOT_ACTIVE', message: '权益当前不可用' } })
  }
  const now = new Date()
  if (grant.validFrom && grant.validFrom.getTime() > now.getTime()) {
    throw new ConflictException({ error: { code: 'BENEFIT_NOT_STARTED', message: '权益未到生效时间' } })
  }
  if (grant.validUntil && grant.validUntil.getTime() < now.getTime()) {
    throw new ConflictException({ error: { code: 'BENEFIT_EXPIRED', message: '权益已过期' } })
  }
  if (grant.quantityRemaining === null) {
    throw new BadRequestException({ error: { code: 'BENEFIT_NOT_QUANTIFIED', message: '该权益无可核销额度' } })
  }
  const settledOrder = await this.orderStatus.settleRedemptionInTransaction(tx, orderId, {
    discountCents: order.amountCents,
  })
  const cas = await tx.benefitGrant.updateMany({
    where: { id: benefitGrantId, status: 'active', quantityRemaining: { gt: 0 } },
    data: { quantityRemaining: { decrement: 1 } },
  })
  if (cas.count !== 1) throw new ConflictException({ error: { code: 'BENEFIT_USED_UP', message: '权益次数已用完' } })
  const after = await tx.benefitGrant.findUnique({ where: { id: benefitGrantId } })
  if ((after?.quantityRemaining ?? 0) <= 0) {
    await tx.benefitGrant.update({ where: { id: benefitGrantId }, data: { status: 'used_up' } })
  }
  const record = await tx.redemptionRecord.create({
    data: {
      endUserId, orderId, kind: grant.benefitType, benefitRef: benefitGrantId,
      serviceType: 'order_redeem', serviceRefId: orderId, quantity: 1,
      amountCents: settledOrder.amountCents, idempotencyKey,
    },
  })
  return { record, order: settledOrder, idempotent: false as const }
})
```

事务提交后才写 `benefit.redeem` 与 `order.mark_paid_redemption` 审计；若订单 CAS、权益 CAS 或唯一约束任一失败，整个事务回滚，绝不留“已扣权益但未 voucher 结算”的状态。对事务中的唯一约束或订单 CAS 冲突，在事务外重新读取 `RedemptionRecord`：仅“同订单本人 + 同权益”返回幂等回放；不同权益或不同用户保持 `BENEFIT_OUTPUT_ALREADY_REDEEMED`，无记录时重抛原始订单状态错误。

- [x] **Step 3: 运行核销回归**

Run: `pnpm --filter @ai-job-print/api verify:redemption-audit`

Expected: 全部通过，包含 Task 1 的一致性断言。

### Task 4: 在外部 QR 可见前预留订单

**Files:**

- Modify: `services/api/src/payment/online-payment.service.ts`

- [x] **Step 1: 对齐付款码支付已使用的 reservation 模式**

在 `createPayAttempt` 的未完成尝试检查后，将 `unpaid → paying` 的 CAS 与 `PaymentAttempt(created)` 创建放进**同一 Prisma transaction**：

```ts
if (order.payStatus === 'paying') {
  throw new BadRequestException('PAYMENT_ATTEMPT_PENDING')
}
const attempt = await this.prisma.$transaction(async (tx) => {
  const reserved = await tx.order.updateMany({
    where: { id: order.id, payStatus: 'unpaid' },
    data: { payStatus: 'paying', expiresAt: order.expiresAt ?? new Date(now + this.orderTtlSeconds * 1000) },
  })
  if (reserved.count !== 1) throw new BadRequestException('PAYMENT_ATTEMPT_PENDING')
  return tx.paymentAttempt.create({ data: { orderId: order.id, channel: provider.channel, status: 'created', expiresAt: attemptExpiresAt } })
})
```

本地 `paymentAttempt.create` 失败由事务整体回滚 reservation；Provider 调用在事务提交后，任何 Provider 异常保持 `created/pending + paying` 并交由既有惰性过期/查单收敛，不得回退为可核销状态。`applyLazyExpiry` 必须把未过期 `created` 与 `pending` 都视为活跃。付款码路径采用同一原语；新增真实 SQLite 回归强制 `tx.paymentAttempt.create` 抛错，断言无残留 `paying`/Attempt。

- [x] **Step 2: 运行支付回归**

Run: `pnpm --filter @ai-job-print/api verify:payment-flow`

Expected: 全部通过，包含 QR reservation 与核销互斥断言。

### Task 5: 完整验证、审查与收口

**Files:**

- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [x] **Step 1: 运行完整本地门禁**

```bash
pnpm --filter @ai-job-print/api verify:redemption-audit
pnpm --filter @ai-job-print/api verify:payment-flow
pnpm --filter @ai-job-print/api verify:payment-codepay
pnpm --filter @ai-job-print/api verify:refund-idempotent
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api db:pg:sync:check
git diff --check
```

- [x] **Step 2: 复核范围与秘密**

确认 diff 只在允许文件内；确认没有渠道密钥、真实订单、手机号、支付 token、二维码内容或预生产地址。

- [x] **Step 3: 双模型审查（已尝试；外部结果不可用，不计作批准）**

必须同时运行 Antigravity 与 Claude 对最终 `git diff` 做只读审查；任一不可用时记录为未通过的外部审查缺口，不能宣称双模型 Ready。

- [x] **Step 4: 同步文档**

仅在验证通过后，把“核销、线上支付与 QR 出码的单一结算锁”及本地验证结果写入进度入口；明确未做部署、真实支付、预生产迁移或试运营。

- [x] **Step 5: 提交**

```bash
git add services/api/src/benefit-redemption/benefit-redemption.service.ts \
  services/api/src/payment/order-status.service.ts \
  services/api/src/payment/online-payment.service.ts \
  services/api/scripts/verify-redemption-audit.ts \
  services/api/scripts/verify-payment-flow.ts \
  docs/superpowers/plans/2026-07-12-c5-4-redemption-settlement-consistency.md \
  docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "fix(payment): atomically settle redemption and payment reservation"
```
