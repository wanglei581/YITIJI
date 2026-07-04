# 支付域 C-5 完整方案（2026-07）

> 生成日期：2026-07-03　分支：`feature/payment-c5`（从干净 `main` `3ad10d10` 新建，独立分支）
> 性质：**方案文档**，待用户确认后再动代码。支付涉及资金安全，按治理规则独立分支 + 独立评审 + 独立验收。
> 上位与约束：
> ① 合规边界 `docs/compliance/compliance-boundary.md` §8.4/§8.5/§8.7（支付/核销/退款/收费边界）
> ② 打印接口安全 `CLAUDE.md` §12（appSecret 只存服务端、回调验签、幂等、防重放）
> ③ 商用方案 `docs/product/commercial-grade-feature-plan-2026-07.md` §三（四层收入结构）
> ④ 市场定价对标 `docs/product/market-research-2026-07.md`
> ⑤ 现状：`Order` 底座已随每个 `PrintTask` 创建（`print-jobs.service.ts:212`，`amountCents=0` / `payStatus=unpaid`），支付域即把此链路「接真」。

---

## ⓪ 命名与波次校准（2026-07-03 更新，权威口径）

> C5-1 已通过**选择性吸收 codex P0a 支付底座**（`a9d856e6`，已复核）落到 `feature/payment-c5` 完成。为避免本文档把两套命名当并列标准，此节为**唯一权威口径**；下文 §三 的线上模型设计一律按此节重新定位（是 C5-2~C5-4 的 additive 扩展，不是与 C5-1 并列的另一套）。

**唯一价目表 = `PriceConfig`**（`serviceKey / unitCents / unit / active / effectiveFrom`）。下文 §3.5 的 `PriceRule` 名称**作废**，不得再建第二张价目表；运行期价目真相源即 `PriceConfig`（开发默认价由 `price-config.seed` 幂等 seed）。

**C5-1 已交付的 `Order` 支付列**（P0a 命名，全部 additive-nullable）：`paymentSource`（`offline | free | manual_confirmed`）/ `paidAt` / `paidBy` / `pickupCode`(@unique) / `billablePages` / `billingPageSource`。

**C5-1 的 `payStatus` 取值**：`unpaid | paid | refunded | failed`（线下 / 免费 / 人工确认闭环）。`paying / refunding / closed` 等线上中间态在 C5-2+ 引入。

**本波红线**：`paymentSource` 白名单只允许 `offline / free / manual_confirmed`；`wechat / alipay / benefit` **本波禁写**（状态机 + Admin 端点 + `verify:order` 三处按名断言拒绝），线上渠道到 C5-6 才接真。**无 live 网关、无商户密钥、无真实资金交易。**

**下文线上模型的定位**（叠加在 C5-1 baseline 之上，不替换、不并列）：

| 下文原写 | 现定位 |
|---|---|
| §3.1 `paidAmountCents / discountCents / payChannel / expiresAt / itemsJson` | `payChannel`/`itemsJson`/`expiresAt` **已随 C5-2 落地**；`paidAmountCents`/`discountCents`（券抵扣）留 C5-4 |
| §3.2 `PaymentAttempt` | **已随 C5-2 落地**（含 `expiresAt` 码有效期列 + `(channel, channelTxnNo)` 幂等唯一键） |
| §3.3 `Refund` | C5-4 退款域（当前退款走 `OrderStatusService.refund` 整单退款 + 审计，尚无独立退款表） |
| §3.4 `RedemptionRecord` | C5-4 券 / 权益核销时新增 |
| §3.5 `PriceRule` | **作废**，已由 `PriceConfig` 实现 |

**C5-2 设计决策定版（2026-07-03，经用户硬约束确认）**：

1. `paymentSource` 新增 `sandbox` 取值（诚实标注测试通道入账，非真实收款），**只能由回调成功入账路径**（`OrderStatusService.markPaidOnline`）写入；Admin mark-paid 仍只允许 `offline/manual_confirmed`，`wechat/alipay/benefit` 继续按名拒绝（`verify:payment-flow` 覆盖）。
2. `payStatus` 增线上态 `paying`（已出码）/ `closed`（超时关单，惰性判定，不引入后台任务）。**`closed → paid` 仅限「已存在 `PaymentAttempt` 的有效迟到回调」**：`attemptId/prepayId/orderId/channel/amountCents` 全字段匹配缺一即拒，任意 closed 订单不可能被伪造回调打成 paid；迟到入账审计 `order.mark_paid_online` 带 `late=true`（C5-4 前不自动退款，对账凭此追踪）。
3. 回调验签 base 为 `POST\n/api/v1/payment/callback/:channel\ntimestamp\nnonce\nrawBody`，**签名绑定渠道回调路径**，同一签名不能跨路径 / 跨渠道复用。
4. fail-closed：`PAYMENT_PROVIDER=sandbox` 时 `SANDBOX_PAYMENT_SECRET` 缺失/过短启动即拒；生产配 sandbox 双重拦截（工厂 + production-runtime-gates）；未知渠道取值（含 wechat/alipay）启动即拒，**C5-6 前不引入任何 live 商户密钥**。
5. `Order.itemsJson` 建单时快照 `PricingService` 计费明细（`PrintPriceLine[]`），只存计费明细、不引入商品体系；C5-3 收银 UI 只读它。
6. `PaymentProvider.queryPayment?` 为可选接口位：主动查单兜底在 C5-6 真实渠道（有外部账本）时实现；sandbox 的真相源即本库 DB，不做假查单、不伪造能力。

---

## 一、目标与非目标

### 1.1 目标（本域交付）

在**不触碰招聘闭环红线**的前提下，补齐全仓缺失的支付能力，让「打印计费 + AI 增值单次包」真正收得到钱、退得了款、对得上账、审计得清：

1. **真实计价**：`Order.amountCents` 由服务端按 Admin 可配价目表真实计算，不再恒 0。
2. **扫码支付**：微信 / 支付宝**屏上动态码**（用户手机扫一体机屏），单笔即付；一体机不装受理设备。
3. **回调闭环**：支付结果回调**验签 + 幂等 + 防重放**，落库，驱动订单状态机。
4. **退款**：幂等退款，落库审计；退款按订单域建模，**不挂靠 `PrintTask`**。
5. **对账**：服务端对账任务，账单可导出，异常可追。
6. **核销**：券 / 免费次数 / 会员权益核销，幂等 + 落库审计，**免费单也落库**。
7. **Admin 计费配置** + **Kiosk 收银 UI**：价目可配、支付前展示价格与退款规则。
8. **沙箱→生产**：先用沙箱/mock 通道端到端跑通，真实商户凭证一插即用。

### 1.2 非目标（明确不做）

- 不做平台内投递 / 收简历 / 候选人 / 面试 / Offer（红线不变）。
- 不卖「录用结果」；套餐文案禁止「保面试 / 保录用 / 补贴必到账 / 名企内推」。
- 不承诺「补贴券核销 = 政府补贴金到账」。
- 一体机**不装 POS / 刷卡 / NFC 受理设备**；一律手机扫屏上动态码。
- 本域**不申请商户号**（营业执照 + 审批是业务/法务并行任务，非代码）；本域只做到「沙箱跑通 + 凭证一插即用」。

---

## 二、合规红线映射（每条对应到设计约束）

| 合规条款（§8.5 / §12 / §8.7） | 本方案落地约束 |
|---|---|
| 支付密钥只存服务端，前端不保存 | `appId/mchId/apiKey/apiV3Key/证书` 只存服务端 env + 加密列；前端只读 `payConfigured:boolean` |
| 回调验签 + 5min 时间窗 + nonce 防重放 | 复用 W3 Webhook 已有模式（HMAC/签名 + 时间窗 + nonce LRU）；微信 V3 用平台证书验签，支付宝用 RSA2 验签 |
| 退款幂等 | 退款以 `(orderId, refundNo)` 为幂等键；重复请求返回既有退款记录，不重复出款 |
| 券/免费核销幂等 + 落库审计；免费单也落库 | 核销以 `成果版本ID / FileObject / 券ID` 为幂等键；`RedemptionRecord` 落库；`amountCents=0` 的免费单同样建 Order + 审计 |
| 支付异常不得伪装成打印状态 | 支付状态在 `Order.payStatus` + `PaymentAttempt`；`PrintTask.status` 只承载打印履约；两者解耦，回调只改支付域 |
| 退款/重复扣费按订单域建模，不挂靠 PrintTask | `Refund` 关联 `Order`，不加字段到 `PrintTask` |
| 付费前展示价格/抵扣/退款规则 | Kiosk 收银页强制展示价目、券抵扣、退款/重试规则后才出码 |
| 同一成果不重复扣同一导出权益 | 导出/打印权益核销以服务端成果版本 ID / 内容哈希 / FileObject 为幂等键；内容改 → 新版本重新计费 |
| 只卖工具 + 打印服务 | 计费项白名单：打印页数、AI 增值单次包、材料包、证件照；**无录用类计费项** |

---

## 三、数据模型（additive-only，不改已有列语义）

现有 `Order` 保留并扩展（不改已有字段含义，只补列）；新增 3 张表。

### 3.1 Order（扩展，additive）

> ⚠️ 见 §⓪：C5-1 实际交付的 `Order` 支付列是 P0a 命名（`paymentSource/paidAt/paidBy/pickupCode/billablePages/billingPageSource`）。**下列 `paidAmountCents/discountCents/payChannel/expiresAt/itemsJson` 是 C5-2~C5-4 的 additive 补列，C5-1 未建。**

沿用现有 `id/orderNo/type/printTaskId/endUserId/terminalId/amountCents/currency/payStatus/taskStatus/refundReason/refundedAt`。C5-2+ 新增：

- `paidAmountCents Int @default(0)` — 实付（区分应付 `amountCents` 与实付，券/优惠抵扣后）
- `discountCents Int @default(0)` — 抵扣合计（券 + 会员权益）
- `payChannel String?` — `wechat | alipay | free | voucher`（免费/全额券抵扣单为 `free`）
- `paidAt DateTime?`
- `expiresAt DateTime?` — 未支付订单超时关单时间（出码后 N 分钟）
- `itemsJson String @default("[]")` — 计费明细快照（项目、单价、数量、金额；下单时定价快照，防价目改动影响历史单）

`payStatus` 取值扩展沿用现注释：`unpaid | paying | paid | refunding | refunded | closed | failed`。

### 3.2 PaymentAttempt（新增）——每次发起支付一条

```
model PaymentAttempt {
  id            String   @id @default(cuid())
  orderId       String
  order         Order    @relation(fields: [orderId], references: [id])
  channel       String   // wechat | alipay | sandbox
  amountCents   Int
  status        String   @default("created") // created | pending | success | failed | expired
  prepayId      String?  // 渠道预支付标识
  qrCodeContent String?  // 屏上动态码内容（code_url / 支付宝 qr_code），前端据此渲染二维码
  channelTxnNo  String?  // 渠道支付流水号（回调回填）
  failReason    String?  // 安全文案，不透传渠道原始错误
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([orderId])
  @@index([status])
}
```

### 3.3 Refund（新增）——不挂靠 PrintTask

```
model Refund {
  id            String   @id @default(cuid())
  orderId       String
  order         Order    @relation(fields: [orderId], references: [id])
  refundNo      String   @unique // 幂等键
  amountCents   Int
  status        String   @default("pending") // pending | success | failed
  reason        String?
  channel       String
  channelRefundNo String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([orderId])
}
```

### 3.4 RedemptionRecord（新增）——券/免费/权益核销，幂等+审计

> **⚠️ 落地分工（2026-07-04 定，权威口径）**：`RedemptionRecord` **不由 C5-4 首建**，而由「我的页商用闭环 P1 权益核销」（分支 `feature/benefit-redemption-p1`）**先落地为核销 SSOT**，本表即那一批建的**唯一**核销账本。P1 批只写「平台 credit / 无 Order」子集：`benefitRef=benefitGrantId`，并按服务点位需要补 `serviceType`/`serviceRefId`/`quantity` 字段；`orderId` 恒 null、`amountCents` 恒 0（券=平台 credit，非资金、非收款）。**C5-4 在同一张 `RedemptionRecord` 上 additive 扩展**：回填 `orderId`、写 `amountCents` 抵扣额、加 `POST /orders/:id/redeem` 与 Order 免费单联动；**不得重建第二套 `BenefitRedemption`/`RedemptionRecord` 账本**（违反 §8.1「禁两套并列标准」）。下方 model 为 C5-4 视角的最终形态（含 orderId/amountCents），P1 批交付的是其子集 + `serviceType`/`serviceRefId`/`quantity`；`idempotencyKey` 语义在 P1 批为 `hash(benefitGrantId + serviceType + serviceRefId)`（对齐 §8.5「同一成果不重复扣同一权益」），C5-4 接 Order 后按 `hash(kind + benefitRef + orderId)` 归一。

```
model RedemptionRecord {
  id            String   @id @default(cuid())
  endUserId     String?
  orderId       String?
  kind          String   // voucher | free_quota | membership
  benefitRef    String   // 券ID / 成果版本ID / FileObject / 权益ID（幂等键组成）
  idempotencyKey String  @unique // hash(kind + benefitRef + orderId)
  amountCents   Int      @default(0) // 抵扣金额
  createdAt     DateTime @default(now())
  @@index([endUserId])
}
```

### 3.5 PriceConfig（价目表，Admin 可配）

MVP 可先用**服务端配置文件 + Admin 只读展示**，或落一张 `PriceRule` 表。倾向落表以便 Admin 改价审计：

```
model PriceRule {
  id          String  @id @default(cuid())
  sku         String  @unique // print_bw_page | print_color_page | resume_optimize_export | material_pack | id_photo ...
  label       String
  unitCents   Int
  unit        String  // page | copy | item | pack
  enabled     Boolean @default(true)
  updatedAt   DateTime @updatedAt
}
```

迁移策略：SQLite + PostgreSQL 双 additive migration；空库 `migrate deploy` + seed 通过；不改已有列。

---

## 四、支付渠道抽象（复用 AI Provider 模式）

仿 `AiProvider` 的可切换抽象，避免业务耦合具体渠道：

```
interface PaymentProvider {
  createQrPayment(order, attempt): Promise<{ qrCodeContent, prepayId }>
  verifyCallback(headers, rawBody): Promise<{ valid, channelTxnNo, orderNo, paidAmountCents }>
  refund(order, refund): Promise<{ channelRefundNo, status }>
  queryPayment(attempt): Promise<{ status }>  // 主动查单兜底
}
```

- `PAYMENT_PROVIDER=sandbox`（默认，开发/联调）：本地沙箱，出伪二维码，提供「模拟支付成功/失败」测试端点，全链路可演示、零外部费用。
- `PAYMENT_PROVIDER=wechat` / `alipay`：真实渠道，凭证从服务端 env / 加密列读；**生产运行时门禁禁止 sandbox**（仿 `SMS_PROVIDER` 生产禁 log）。

签名/验签：
- 微信支付 V3：请求用商户 API v3 密钥 + 证书；回调用微信平台证书验签 + 时间戳窗口 + 报文解密（AEAD_AES_256_GCM）。
- 支付宝：RSA2 签名/验签。
- 统一在 `verifyCallback` 内做**验签 + 时间窗 + nonce 防重放 + 金额一致性校验**（回调金额必须等于订单应付，防篡改）。

---

## 五、订单/支付状态机

```
下单(创建Order,itemsJson定价快照) 
   → [免费/全额券] → redeem核销 → paid(free) → 履约(打印/导出)
   → [需付费] → 出码(PaymentAttempt: created→pending, 屏上动态码)
        → 用户手机扫码支付
        → 回调(验签+幂等+金额校验) → paid → 履约
        → 超时未支付 → attempt expired + order closed(可重新下单)
        → 支付失败 → attempt failed(安全文案) + order 保持 unpaid(可重试出码)
   paid → [申请退款] → refunding → Refund(幂等) → refunded
```

关键解耦：**打印履约（PrintTask）在 `paid` 之后才真正 claim 出纸**；支付回调只改支付域，绝不改 `PrintTask.status`。打印失败走既有 `failureReasonForUser` 安全文案，与支付退款是两条独立链路。

---

## 六、端到端链路（Kiosk ↔ API ↔ Admin）

### 6.1 Kiosk 收银
- 确认打印/AI 导出 → 服务端计价（按 PriceRule + 券/权益抵扣）→ 收银页**展示价目明细 + 抵扣 + 退款/重试规则** → 用户确认 → 出屏上动态码 → 轮询 `GET /orders/:id/pay-status` → paid 后进入履约（打印/下载）。
- 免费/全额抵扣单：跳过出码，直接核销 → 履约；免费单同样落 Order + 审计。
- 退款入口：`我的 → 打印订单 / AI服务记录` 内，本人可对符合规则的订单申请退款（是否允许退款按 SKU 规则）。

### 6.2 后端 API（`/api/v1`）
- `POST /orders/quote`（计价，返回明细 + 可用券/权益，不落库）
- `POST /orders`（下单，落 Order + itemsJson 快照）
- `POST /orders/:id/pay`（发起支付，建 PaymentAttempt，返回 qrCodeContent）
- `GET /orders/:id/pay-status`（轮询）
- `POST /payment/callback/:channel`（渠道回调，验签+幂等+防重放）
- `POST /orders/:id/refund`（本人退款申请，幂等）
- `POST /orders/:id/redeem`（券/权益核销，幂等）

### 6.3 Admin
- **计费配置页**：PriceRule 增改（改价写审计）；`payConfigured:boolean` 展示渠道是否配置，**不回显密钥**。
- **订单管理页扩展**：现有只读订单页补真实金额/支付状态/退款记录/对账状态（当前是 amountCents=0 占位，接真后展示实付）。
- **对账页**：按日对账任务结果，异常单列表，可导出账单。
- 所有支付相关 Admin 操作（改价、手动退款复核）落审计。

---

## 七、对账

- 定时任务（BullMQ，复用现有队列）按日拉渠道账单 ↔ 本地 Order/PaymentAttempt 比对：金额、笔数、状态一致性。
- 差异（本地 paid 渠道无、渠道有本地无、金额不符）落 `ReconciliationDiff`（可后置为 MVP 后一波），Admin 对账页展示。
- MVP 阶段可先做「本地账单导出 + 手工对账」，自动对账差异表列为 C-5 后续增强。

---

## 八、分波交付（每波独立可验收、可回退）

| 波 | 内容 | 门禁 |
|----|------|------|
| **C5-0 方案确认** | 本文档 + 用户确认 + 合规复核 | 用户确认 |
| **C5-1 数据底座** ✅ **已完成（2026-07-03）** | 提取自 P0a `a9d856e6`（已复核）：`Order` 6 additive 列 + `PriceConfig` 表 + 双 additive migration（`20260703160000_add_payment_foundation`）+ 开发默认价 seed + `PricingService`（fail-closed 计价）+ `PrintPageCountService`（SSRF 安全、后端识别页数）+ `OrderStatusService`（线下/免费/人工确认 CAS 幂等状态机 + pickupCode + 审计）+ Admin `mark-paid`/`refund` 端点 + `/me/print-orders` 支付字段接真 | ✅ 空库 sqlite migrate deploy 过；`db:pg:sync:check` 过；`typecheck`/`lint` 过；`verify:order`/`verify:pricing`/`verify:print-jobs`/`verify:member-print-orders`/`verify:materials-processing`/`verify:admin-orders-readonly` 全 PASS（wechat/alipay/benefit 禁写按名断言） |
| **C5-2 沙箱线上支付闭环** ✅ **已完成（2026-07-03，分支 `feature/payment-c5-2`，本地 verify 级）** | `PaymentAttempt` 表 + `Order` 补列（`payChannel`/`itemsJson`/`expiresAt`）+ 双 additive migration（`20260703210000_add_payment_attempt_online`）+ `PaymentProvider` 抽象 + `SandboxPaymentProvider`（HMAC 验签绑定 `POST+回调路径`）+ fail-closed 工厂 + `OnlinePaymentService`（出码/回调/轮询/惰性过期）+ `markPaidOnline`（唯一写 `paymentSource=sandbox` 的路径）+ 生产禁 sandbox 门禁 + 沙箱模拟端点（仅非生产） | ✅ `verify:payment-flow` 54 PASS（成功/失败/超时/重放/金额篡改/伪造回调/跨路径签名/closed 迟到入账/线下回归全断言）已接双 CI；空库 migrate deploy / 全仓 typecheck / lint / `db:pg:sync:check` / 既有 6 个支付相关 verify 回归全过 |
| **C5-3 Kiosk 收银 UI** | 收银页（价目展示+退款规则+动态码+轮询）+ 履约衔接（paid 后才打印） | `verify:kiosk-cashier-ui`；浏览器 E2E 沙箱付款→打印 |
| **C5-4 退款 + 核销** ✅ **已完成（2026-07-04，分支 `feature/payment-c5-4`，本地 verify 级，Draft PR）** | `Refund` 表（`refundNo` 幂等键）+ 双 additive migration（`20260704130000_add_refund_and_order_discount`）+ Order `discountCents`/`refundedAmountCents` + `payStatus` 增 `refunding`/`partial_refunded`；`PaymentProvider.refund` + `SandboxPaymentProvider.refund` + **`RefundService`**（全额 paid→refunding→refunded，sandbox 调 provider / offline·manual·free·voucher 不调 provider、免费/权益单不恢复权益额度、审计 `refund.created`）；Admin refund 端点升级（**仅 admin auth/role**，无自助退款入口）；**核销扩展既有 `RedemptionRecord`（禁重建）**：`redeemForOrder` 回填 orderId/amountCents（`order_redeem` 一单一核销）+ `markPaidByRedemption`（唯一写 `voucher`，全额核销 → paid+pickupCode）+ `POST /orders/:id/redeem`（会员 EndUserAuthGuard，无前端按钮）；C5-3 门控回归只放行 paid。**partial_refunded 仅预留，不接部分退款动作**。 | ✅ `verify:refund-idempotent`（25）+ `verify:redemption-audit`（16）已接双 CI；回归 `verify:order`（升级 Admin 退款断言）/`verify:payment-flow`/`verify:benefit-redemption`/`verify:kiosk-cashier-ui`/`verify:print-jobs`/`verify:member-print-orders` + typecheck/lint/`db:pg:sync:check`/kiosk build 全过。未做 C5-5/C5-6/live/新密钥 |
| **C5-5 Admin 计费配置 + 订单接真 + 对账** | PriceRule 配置页 + 订单页金额接真 + 对账页 + 审计 | `verify:admin-billing` |
| **C5-6 微信/支付宝真实渠道适配** | wechat/alipay Provider 实现 + 生产运行时门禁禁 sandbox | 沙箱回归；真实渠道待商户号 live 冒烟（并行依赖） |
| **C5-7 商用验收** | 全链路（下单→付款→打印→退款→对账）+ 合规复核 + 文档收口 | 全 verify + 预生产冒烟 |

**真收款依赖（并行，非本域代码）**：微信支付 / 支付宝商户号。**2026-07-03 更新：商户号已就绪**，故 C5-6 的真实 live 冒烟不再被申请周期阻塞。执行顺序不变：C5-2~C5-5 先用沙箱端到端跑通验收，C5-6 再把商户凭证配进**服务端 env / 加密列**（绝不进前端 / 聊天 / 仓库，见 CLAUDE.md §12）做 live 冒烟。

---

## 九、安全与诚实性底线（贯穿全域）

1. 密钥只存服务端 env / 加密列；前端只读布尔位；日志不打密钥、不打回调原始报文敏感段。
2. 回调必验签 + 时间窗 + nonce 防重放 + 金额一致性；处理幂等（同一渠道流水号只入账一次）。
3. 退款幂等；支付异常不伪装成打印状态；打印履约与支付/退款解耦。
4. 无真实支付结果不展示「已支付」；沙箱模式 UI 明示「测试支付通道」，生产门禁禁 sandbox。
5. 金额一律整数「分」；itemsJson 下单快照，价目改动不影响历史单。
6. 免费单/券核销同样落库审计。
7. 计费项白名单，无任何录用类收费；套餐文案合规白名单校验。

## 十、验收标准（C-5 全域对账）

- 数据模型 additive、空库 migrate+seed 通过、双 CI（SQLite + postgres-readiness）绿。
- 沙箱全链路：下单→出码→（模拟）支付→回调入账→打印履约→退款→核销，状态机正确。
- 幂等：回调重放、退款重复、券重复核销均不产生重复入账/出款/抵扣。
- 防篡改：回调金额与订单不符被拒。
- 解耦：支付失败/退款不改 PrintTask.status；打印失败不改支付域。
- 合规：无录用类计费项；套餐文案白名单；补贴券文案不承诺到账；密钥不回显。
- Admin 改价/退款复核落审计；订单页展示实付；对账可导出。
- 真实渠道 live 冒烟在商户号就绪后单独执行并记录（不阻塞前六波验收）。
