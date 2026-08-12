# 后端补齐方案 · 六项能力的实施规格（2026-08-11）

> **这份文件是给实施者照着做的规格，不是讨论稿。**
>
> 产品负责人的指示：「对剩下的 6 个没有功能的后续补进后端就行了，看一下怎么设计补充完善？」
> 由 Codex（gpt-5.6-sol，极高强度）只读评审现有源码后产出，涵盖模型、接口、
> 状态机、幂等与并发、迁移灰度、验收口径。
>
> **前置口径**（已拍板，见 [2026-08-11-pricing-benefits-backend.md](2026-08-11-pricing-benefits-backend.md)
> 与 [2026-08-11-two-line-reconciliation.md](2026-08-11-two-line-reconciliation.md)）：
> 免费打印 = 每月 N 次免单券；四道闸全满足则整单免 + 扣 1 次，否则整单正常价；
> 不补差、不部分抵扣、不叠加；双面不变价；打印链计价单位「计费页」。
>
> **本文新发现一个原六项之外的上线阻塞**（见文末「需要纠正的几点」第 1 条）：
> Terminal Agent 有三条路径在**未确认出纸的情况下上报 completed**，
> 已由 Claude 读 `apps/terminal-agent/src/agent/task-runner.ts:495` 附近的
> doc comment 复核确认（原文写着 conservative completed）。
> 对一台收了钱的无人值守机器，这等于「用户付了钱、纸可能没出来、系统说打好了」。

---

context compacted
codex
方案已经收敛：核心不是再加几张券表，而是把「价、场景证据、权益资格、权益预占、履约尝试」固化成同一条不可变交易链。还有一项需要纠正：当前 Agent 对“队列没出现/普通监控超时”仍存在误报完成路径，这必须列为上线阻塞。
已完成正式文档与源码复核，并据此收敛出分期、模型、接口、迁移及验收方案。
  ✓ 读取正式入口文档、当前进度、合规与工程约束
  ✓ 复核 Prisma、报价/核销、AI、打印 Agent 与退款实现
  ✓ 设计六项能力及报价锁价、权益预占、有效状态方案
  ✓ 整理灰度迁移、并发幂等、失败补偿与自动化验收口径
codex
## 结论

上线前只补三条主链，会员和 AI 收费暂不上：

| 优先级 | 决策 | 范围 |
|---|---|---|
| 上线阻塞 P0 | 必须完成 | 价格版本与报价锁价、可信场景溯源、四道闸判定、月度余额、权益预占、有效状态、履约结果与补偿 |
| 上线阻塞 P0 | 立即止血 | 禁止现有 `/orders/:id/redeem` 按任意 Grant 整单免；修复 Agent 把未确认任务判成完成 |
| 条件性 P0 | 有政府资金才做 | 独立资金预占、结算、冲正账本；没有该账本就不得把免单称为政府补贴或上线政府出资权益 |
| P1 | 可以后做 | `AiUsageLedger` 先 shadow 计量，再决定是否收费；没有闭环前继续免费 |
| P2 | 建议不做 | 打印会员/订阅 MVP，入口继续隐藏；月度 N 次不依赖 Membership |
| 暂不做 | 不需要 | 终端差异价、自动续费、复印/扫描收费闭环，均不是本轮上线阻塞 |

推荐的唯一交易链是：

```text
FileProvenance
    → OrderQuote（价格、参数、场景、资格不可变快照）
        → BenefitReservation
            → Order + RedemptionRecord
                → PrintTask attempt 1..N
                    → Refund 或 RedemptionAdjustment
```

不新增第二套订单或核销账本。`OrderQuote` 是订单前的报价快照，`RedemptionAdjustment` 是现有核销记录的追加冲正，不是替代账本。

---

# P0：统一的数据模型

以下继续使用项目现有的 `String` 状态和 JSON 字符串风格，避免 SQLite/PostgreSQL 双链路漂移。

## ① 四道闸结构化规则

```prisma
model BenefitRuleVersion {
  id                         String   @id @default(cuid())
  ruleCode                   String
  version                    Int
  benefitType                String
  serviceType                String
  redemptionEffect           String   // whole_order_waiver | info_only
  scenarioKeysJson           String   // ["resume", ...]
  allowedProvenanceTypesJson String   // ["system_generated", ...]
  maxBillableQuantity        Int?
  allowedColorModesJson      String   // ["bw"]
  periodType                 String   // none | monthly
  periodQuota                Int?
  timezone                   String   @default("Asia/Shanghai")
  stackPolicy                String   @default("exclusive")
  priority                   Int      @default(100)
  compensationValidDays      Int?
  status                     String   @default("draft") // draft|published|retired
  publishedAt                DateTime?
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt

  @@unique([ruleCode, version])
  @@index([benefitType, serviceType, status])
}
```

现有模型增量：

```prisma
model BenefitActivity {
  // 保留原字段
  ruleVersionId String?
  // rulesText 继续只负责展示，不参与计算
}

model BenefitGrant {
  // 保留原字段
  ruleVersionId    String?
  balanceMode      String @default("grant") // grant | period
  quantityReserved Int    @default(0)
  balanceVersion   Int    @default(0)
}
```

发布校验必须强制：

- 免费打印规则只能是 `whole_order_waiver`。
- 四个场景必须使用固定服务端枚举：
  - `resume`
  - `job_search_material`
  - `job_fair_material`
  - `policy_application_material`
- 上限为 `maxBillableQuantity=10`。
- 只允许 `["bw"]`。
- `periodType=monthly` 时必须有正整数 `periodQuota`。
- `subsidy_eligibility_hint` 只能是 `info_only`，不能预占、核销或形成折扣。
- published 版本不可修改，只能发布新版本。

判定结果必须返回每张候选权益，而不是只返回一个布尔值。原因码至少包括：

```text
AUTH_REQUIRED
BENEFIT_TYPE_UNSUPPORTED
BENEFIT_RULE_MISSING
BENEFIT_NOT_STARTED
BENEFIT_EXPIRED
BENEFIT_STATUS_UNAVAILABLE
BENEFIT_NOT_FOR_SERVICE
BENEFIT_SCENARIO_NOT_ALLOWED
BENEFIT_PROVENANCE_NOT_ALLOWED
BENEFIT_QUANTITY_LIMIT_EXCEEDED
BENEFIT_COLOR_NOT_ALLOWED
BENEFIT_PERIOD_EXHAUSTED
BENEFIT_TEMPORARILY_RESERVED
```

四道闸计算必须是全有或全无：

```text
全部通过：
discountCents = subtotalCents
payableCents = 0
消耗次数 = 1

任一失败：
discountCents = 0
payableCents = subtotalCents
消耗次数 = 0
```

双面只进入打印参数，不改变：

```text
billableQuantity = selectedDocumentPages × copies
```

## ② 服务端场景溯源

不要再把可信信息放进可变的 `FileObject.purpose`，建议增加一对一、写后不可修改的记录：

```prisma
model FileProvenance {
  id                 String   @id @default(cuid())
  fileObjectId       String   @unique
  scenarioKey        String
  provenanceType     String
  sourceRefType      String
  sourceRefId        String
  contentHash        String
  schemaVersion      Int      @default(1)
  derivedBy          String
  derivedAt          DateTime @default(now())

  @@index([scenarioKey, provenanceType])
  @@index([sourceRefType, sourceRefId])
}
```

推导规则：

| 产生方式 | provenanceType | sourceRefId |
|---|---|---|
| 招聘会资料 bridge 且服务端校验通过 | `verified_material` | bridge/material 记录 ID |
| AI 简历、系统生成报告 | `system_generated` | 生成结果 ID |
| 本机 ScanTask + 用户受控分类 | `scan_declared` | ScanTask ID |
| 用户上传 + 受控分类 | `user_declared` | FileObject 或上传会话 ID |

上传或扫描接口可以接受受控的 `materialCategory`，但它只是低可信声明。客户端不能提交：

```text
scenarioKey
provenanceType
sourceRefId
是否符合免费条件
```

`purpose`、`from`、URL 查询参数继续保留兼容，但不得进入资格判断。

政府出资规则默认不应允许 `user_declared`，除非对应资助规则明确批准；平台自费营销券可以配置允许。不要在代码中一刀切。

## ③ 月度周期余额

选择“长期 Grant + 月度余额行”，不选择每月生成新 Grant。

```prisma
model BenefitPeriodBalance {
  id                   String   @id @default(cuid())
  benefitGrantId       String
  ruleVersionId        String
  periodKey            String   // 2026-08
  timezone             String
  startsAt             DateTime
  endsAt               DateTime // exclusive
  quantityTotal        Int
  quantityRemaining    Int
  quantityReserved     Int      @default(0)
  status               String   @default("open") // open|closed
  version              Int      @default(0)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@unique([benefitGrantId, periodKey])
  @@index([status, endsAt])
}
```

理由：

- 用户只领取一次长期权益，不受现有 activity 用户唯一约束影响。
- 每月余额独立，天然清零，不需要篡改上月 Grant。
- 历史月份可以审计。
- 月度补发失败可通过同一唯一键幂等恢复。

边界口径：

- 周期按 `Asia/Shanghai` 的自然月计算，使用 `[startsAt, endsAt)`。
- 不能用“1 月 31 日加一个月”；必须计算“本月第一天”和“下月第一天”。
- 当月未用完不结转。
- 月中首次获得权益时，本月发完整 N 次，不做按日折算。
- 预占 `expiresAt` 必须取 `min(报价过期时间, 周期 endsAt)`。
- 结算发生在月界瞬间时，以数据库事务时间为准；旧周期已结束则返回 `QUOTE_EXPIRED/REQUOTE_REQUIRED`，不能从新旧两个月各扣一次。

周期余额由两层保证：

1. 定时任务提前创建下月余额，唯一键保证幂等。
2. 权益列表和报价时执行 `getOrCreateCurrentPeriod()` 作为自愈。

如果两层都失败，接口返回“权益暂不可用”，不得伪造剩余 N 次。

权益页接口：

```http
GET /api/v1/me/benefits
```

```json
{
  "items": [{
    "grantId": "bg_123",
    "storedStatus": "active",
    "effectiveStatus": "active",
    "ruleVersionId": "brv_2",
    "balance": {
      "periodKey": "2026-08",
      "total": 3,
      "remaining": 2,
      "reserved": 1,
      "available": 1,
      "startsAt": "2026-07-31T16:00:00.000Z",
      "endsAt": "2026-08-31T16:00:00.000Z",
      "nextResetAt": "2026-08-31T16:00:00.000Z"
    }
  }]
}
```

前端展示 `available`，不自行做 `remaining-reserved`。

`BenefitStatus` 不能依赖午夜 cron。每次读取和预占都同步计算：

```text
effectiveStatus =
  stored status 不允许使用 → unavailable
  now < validFrom          → not_started
  now >= validUntil        → expired
  否则                     → active
```

后台任务可以把历史行物化成 expired 便于查询，但它不是资格判断真相来源。

---

# 报价锁价与权益预占

## 价格版本

```prisma
model PriceVersion {
  id             String   @id @default(cuid())
  code           String   @unique
  scopeType      String   @default("global") // global|org|terminal
  scopeRefId     String?
  status         String   @default("draft")  // draft|scheduled|active|retired
  effectiveFrom  DateTime
  effectiveUntil DateTime?
  publishedAt    DateTime?
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([scopeType, scopeRefId, effectiveFrom])
}

model PriceConfig {
  id             String @id @default(cuid())
  priceVersionId String
  serviceKey     String
  unitCents      Int
  unit           String
  active         Boolean @default(true)
  description    String?

  @@unique([priceVersionId, serviceKey])
}
```

迁移完成后移除 `serviceKey @unique`，正式生效时间只放在 `PriceVersion`。

P0 只允许 `scopeType=global`。现在没有采购方、出资方和商业归属模型，不应仅凭 `Terminal.orgId` 假装已经支持终端差异价。

published/scheduled 版本内容不可修改。改价只能：

```http
POST /admin/billing/price-versions
PUT  /admin/billing/price-versions/:id/items/:serviceKey
POST /admin/billing/price-versions/:id/publish
```

发布事务校验同一 scope 的生效区间不重叠。价格解析按数据库时间选择有效版本，即使调度任务没跑也不会继续使用旧价。

## 报价快照

```prisma
model OrderQuote {
  id                     String   @id @default(cuid())
  serviceType            String
  endUserId              String?
  anonymousOwnerHash     String?
  terminalId             String
  fileObjectId           String
  fileProvenanceId       String
  priceVersionId         String
  scenarioKey            String
  provenanceType         String
  sourceRefId            String
  contextHash            String
  paramsJson             String
  documentPageCount      Int
  selectedPageCount      Int
  copies                  Int
  billableQuantity       Int
  billingUnit            String
  billingPageSource      String?
  subtotalCents          Int
  discountCents          Int
  payableCents           Int
  linesJson              String
  benefitDecisionJson    String
  status                 String   @default("open")
  expiresAt              DateTime
  consumedAt             DateTime?
  consumedOrderId        String?  @unique
  createdAt              DateTime @default(now())

  @@index([status, expiresAt])
  @@index([terminalId, createdAt])
}
```

Quote 一旦创建，除状态外不得修改。`Order` 增加 `quoteId @unique`，所有打印尝试通过 Order 引用同一份 Quote；不得在建单或核销时重算场景和价格。

## 权益预占

```prisma
model BenefitReservation {
  id                   String   @id @default(cuid())
  quoteId              String   @unique
  benefitGrantId       String
  periodBalanceId      String?
  endUserId            String
  quantity             Int      @default(1)
  status               String   @default("held")
  expiresAt            DateTime
  committedAt          DateTime?
  releasedAt           DateTime?
  redemptionRecordId   String?  @unique
  idempotencyKey       String   @unique
  version              Int      @default(0)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([benefitGrantId, status, expiresAt])
}
```

预占时不减少 `quantityRemaining`，只增加 `quantityReserved`。可用量：

```text
available = quantityRemaining - quantityReserved
```

提交时在同一事务中：

```text
quantityRemaining -= 1
quantityReserved  -= 1
reservation held → committed
创建 RedemptionRecord
```

超时释放只做 `quantityReserved -= 1`。所有变更使用 `version` CAS；在 PostgreSQL 并发测试中，最后一次额度被两台终端同时请求时，最多一台成功。

`RedemptionRecord` 增加：

```prisma
quoteId              String?
reservationId        String? @unique
ruleVersionId        String?
periodBalanceId      String?
decisionSnapshotJson String?
```

并开始真实写入：

```text
orderId = Order.id
amountCents = quote.discountCents
quantity = 1
```

保留现有 `@@unique([serviceType, serviceRefId])`，它正好表达“一单最多一次权益核销”，不应删除。

## 报价接口

```http
POST /api/v1/orders/quotes
Idempotency-Key: ...
```

```json
{
  "fileObjectId": "file_123",
  "print": {
    "copies": 2,
    "colorMode": "bw",
    "duplex": true,
    "pageRange": "1-5"
  },
  "benefitMode": "auto",
  "supersedesQuoteId": "quote_old_optional"
}
```

禁止接受价格、页数、场景三元组和是否可免单。

响应：

```json
{
  "quoteId": "quote_123",
  "expiresAt": "2026-08-11T08:05:00.000Z",
  "priceVersionId": "pv_202608",
  "context": {
    "scenarioKey": "resume",
    "provenanceType": "system_generated",
    "sourceRefId": "resume_789",
    "contextHash": "sha256:..."
  },
  "billing": {
    "unit": "billing_page",
    "selectedPageCount": 5,
    "copies": 2,
    "billableQuantity": 10,
    "subtotalCents": 1000,
    "discountCents": 1000,
    "payableCents": 0,
    "lines": []
  },
  "benefits": {
    "selected": {
      "grantId": "bg_1",
      "reservationId": "bres_1"
    },
    "candidates": [
      {
        "grantId": "bg_1",
        "eligible": true,
        "reasonCodes": []
      },
      {
        "grantId": "bg_2",
        "eligible": false,
        "reasons": [{
          "code": "BENEFIT_COLOR_NOT_ALLOWED",
          "actual": "color",
          "allowed": ["bw"]
        }]
      }
    ]
  }
}
```

自动选择顺序由服务端固定：规则优先级、最早到期、创建时间、ID。客户端不能决定叠加。

建单改为：

```http
POST /api/v1/print-jobs
Idempotency-Key: ...
```

```json
{
  "quoteId": "quote_123"
}
```

建单事务验证 Quote 所有者、终端、有效期和状态，然后一次完成 Order、首个 PrintTask、预占提交和核销。失败整体回滚；重复请求返回同一 Order。

支付凭证不属于 Quote 响应。一次性支付码只允许直接返回当前受控支付界面，不进 URL、日志、异常、数据库字段或浏览器 storage。

---

# ④ 打印会员/订阅

结论：MVP 不做，入口继续隐藏。

月度 N 次已经由 Grant + PeriodBalance 解决。现在做会员会额外引入购买、续费、退款、已用权益退费和订阅状态争议，却不能解决本轮资损与履约问题。

若以后恢复，最小模型为：

```prisma
model MembershipPlan {
  id              String   @id @default(cuid())
  code            String   @unique
  title           String
  priceServiceKey String
  ruleVersionId   String
  status          String   @default("draft")
  termMonths      Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model MembershipSubscription {
  id                 String   @id @default(cuid())
  endUserId          String
  planId             String
  status             String   // active|cancel_at_period_end|expired|cancelled
  currentTermStartsAt DateTime?
  currentTermEndsAt   DateTime?
  cancelAtPeriodEnd   Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([endUserId, status])
}

model MembershipTerm {
  id             String   @id @default(cuid())
  subscriptionId String
  orderId        String   @unique
  benefitGrantId String?  @unique
  startsAt       DateTime
  endsAt         DateTime
  status         String   // pending|queued|active|expired|cancelled|refunded
  createdAt      DateTime @default(now())
}
```

购买、续费仍复用 `Order(type=membership)` 和现有支付/Refund：

```http
POST   /api/v1/membership/orders
POST   /api/v1/membership/subscriptions/:id/renewals
DELETE /api/v1/membership/subscriptions/:id
```

MVP 最多允许手动续费，不自动扣款。退订表示到期不续；只有尚未使用任何 term 派生权益时才允许自动全额退款，否则进入人工复核。

每个 Term 发一张带结构化规则的 `BenefitGrant`。会员权益和月度免单券仍是 `exclusive`，一单只生成一条 RedemptionRecord，不叠加、不补差。

---

# ⑤ AI 计价与用量账本

结论：先做 shadow 计量，再考虑收费；当前不得增加任何生产 `ai_*` PriceConfig。

```prisma
model AiUsageLedger {
  id                    String   @id @default(cuid())
  orderId               String?  @unique
  quoteId               String?
  operationKey          String
  endUserId             String?
  anonymousOwnerHash    String?
  requestKey            String   @unique
  resultRefType         String?
  resultRefId           String?
  priceVersionId        String?
  quotedAmountCents     Int      @default(0)
  status                String   // reserved|running|succeeded|failed|timed_out
  billingStatus         String   // not_billable|reserved|committed|released|refunded
  cacheSourceLedgerId   String?
  failureCode           String?
  startedAt             DateTime?
  completedAt           DateTime?
  version               Int      @default(0)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([operationKey, status, createdAt])
}

model AiUsageAttempt {
  id               String   @id @default(cuid())
  ledgerId         String
  attemptNo        Int
  provider         String
  providerRequestIdHash String?
  status           String   // started|succeeded|failed|unknown
  inputTokens      Int?
  outputTokens     Int?
  errorCode        String?
  startedAt        DateTime @default(now())
  endedAt          DateTime?

  @@unique([ledgerId, attemptNo])
}
```

收费点：

1. 缓存检查、权限、报价和支付/权益预占完成后，才建立 `running`。
2. 第一次调用模型前记录 Attempt。
3. 只有最终结果通过安全检查并持久化成功，账本才能 `succeeded + committed`。
4. Provider 内部重试只增加 Attempt，不增加 Order 或收费次数。
5. 缓存命中不收费，可留 `not_billable` Ledger。
6. 流式 chunk/token 不是履约完成；客户端断线但最终结果成功落库，可以计费并允许重新获取。
7. Provider 成功但结果落库失败，不计费；已收款走 Refund。
8. 超时无法确认时先 `timed_out`，若 Provider 支持查询则异步核对；不能核对就按未成功处理，不能猜测已完成。
9. 用户在失败后主动重试可以产生新 Ledger，但只对成功的一次收费。

AI 使用同一张 `Order` 表，但必须是独立的 `Order(type=ai)`，不能与打印订单捆成一个 Order，因为二者履约、退款和重试边界不同。

未来接口：

```http
POST /api/v1/ai/quotes
POST /api/v1/ai/operations
GET  /api/v1/ai/operations/:ledgerId
```

生产价格门禁建议增加：

```prisma
model BillingReadiness {
  serviceKey             String   @id
  status                 String   // disabled|shadow|enforced
  ledgerContractVersion  Int
  verifiedAt             DateTime?
  verifiedBy             String?
  evidenceRef            String?
  updatedAt              DateTime @updatedAt
}
```

强制规则：

- seed/迁移脚本不得包含 `ai_*`。
- Admin 发布包含 `ai_*` 的价格版本时，必须已有 `BillingReadiness.status=enforced`。
- 运行时还需 `AI_BILLING_MODE=enforce`。
- 生产启动检查发现“已激活 AI 价格但账本门禁未满足”时直接失败。
- shadow 对账必须证明 `成功 Ledger = 应收费 Order`、失败/超时均有释放或退款，才能进入 enforced。

---

# ⑥ 履约判定与失败补偿

当前一单一 PrintTask 必须扩展成“一单多个物理尝试”，但仍复用 PrintTask。

```prisma
model PrintTask {
  // 保留原字段
  orderId              String?
  attemptNo            Int?
  retryOfTaskId        String?
  complimentaryRetry   Boolean  @default(false)
  dispatchStage        String?  // pre_spool|spool_submitted|queue_observed|device_confirmed
  outputOutcome        String?  // no_output|partial|unknown|complete
  outputOutcomeSource  String?  // agent_preflight|os_queue|device_callback|operator
  outputReportedAt     DateTime?
  outcomeEvidenceJson  String?

  @@unique([orderId, attemptNo])
}

model PrintExceptionCase {
  id              String   @id @default(cuid())
  orderId         String
  printTaskId     String   @unique
  status          String   // open|awaiting_operator|reprint_authorized|compensation_pending|resolved
  outcome         String
  outcomeSource   String
  resolution      String?  // complimentary_reprint|refund|benefit_restore|confirmed_complete
  version         Int      @default(0)
  openedAt        DateTime @default(now())
  resolvedAt      DateTime?

  @@index([orderId, status])
}

model RedemptionAdjustment {
  id                     String   @id @default(cuid())
  redemptionRecordId     String
  orderId                 String
  printTaskId             String
  periodBalanceId         String?
  replacementGrantId     String?
  quantityDelta           Int
  adjustmentType          String   // restore
  reasonCode              String
  status                  String   // pending|applied|failed
  idempotencyKey          String   @unique
  createdAt               DateTime @default(now())
  appliedAt               DateTime?

  @@index([redemptionRecordId])
}
```

`Order` 增加独立履约状态：

```text
fulfillmentStatus =
pending | in_progress | complete | exception_processing | compensated
```

`PrintTask.status` 只表示某次尝试，不能再同时表达退款、权益恢复和订单履约。

可信判定：

| 情况 | outputOutcome |
|---|---|
| 下载、验签、预检失败，尚未提交 spool | `no_output` |
| 设备提供可信零页回执 | `no_output` |
| 可信页计数或工作人员确认只出部分 | `partial` |
| 已提交队列但队列未出现、消失、超时、Agent 崩溃 | `unknown` |
| 设备可信完成回执或工作人员核验 | `complete` |

OS 队列“接受了任务”或“任务后来消失”不能证明出纸完成。当前硬件不能可靠自动判断 partial，就必须返回 unknown。

处理规则：

- `no_output`
  - 已付款：创建现有 Refund，页面显示“退款处理中”，直到支付域确认。
  - 已用券：保留 RedemptionRecord，创建 `RedemptionAdjustment(+1)`。
  - 同一失败只能补偿一次。
- `partial/unknown`
  - Order 保持 `exception_processing`。
  - 不立即退款、不恢复权益。
  - 工作人员可在同一 Order 下授权 attempt 2，`complimentaryRetry=true`。
  - 不重新付款、不重新报价、不再次核销权益。
- `complete`
  - 订单才可显示完成。
- 如果 partial/unknown 后续确认其实没有出纸，再走退款或权益恢复。
- 一次异常只能选择“免费续打”或“退款/恢复权益”，不能两者同时获得。

月内恢复直接增加原 PeriodBalance；原周期已经关闭时，通过同一事务签发一张明确关联该 Adjustment 的补偿 Grant。补偿有效期必须来自已发布规则的 `compensationValidDays`；未配置时不得自动编一个期限，只能转人工处理。

工作人员接口：

```http
POST /api/v1/admin/orders/:orderId/print-resolution
Idempotency-Key: ...
```

```json
{
  "printTaskId": "pt_1",
  "expectedVersion": 3,
  "resolution": "authorize_reprint",
  "operatorNote": "后台核验后批准续打"
}
```

返回：

```json
{
  "exceptionCaseId": "pec_1",
  "status": "reprint_authorized",
  "createdPrintTask": {
    "id": "pt_2",
    "attemptNo": 2,
    "complimentaryRetry": true
  },
  "refundId": null,
  "redemptionAdjustmentId": null
}
```

钱和权益分别使用确定性幂等键，例如：

```text
print:{orderId}:attempt:{attemptNo}:money_refund
print:{orderId}:attempt:{attemptNo}:benefit_restore
print:{orderId}:attempt:{attemptNo}:complimentary_reprint
```

支付机构调用在数据库事务外执行：事务内先创建 pending Refund/outbox，外部调用失败后由对账任务重试；不得提前展示“已退款”。

---

# 政府出资的额外边界

如果某项免费打印确实由政府资金结算，至少需要独立：

```text
FundingProgram
FundingReservation
FundingSettlement
FundingAdjustment
FundingProgramTerminal
```

Quote 的统一决策只能在以下三者中选一个：

```text
政府资金支付 OR BenefitGrant 免单 OR 用户付款
```

不得叠加。资金余额、结算和冲正不能写进 BenefitPeriodBalance，也不能把 `Terminal.orgId` 当成出资方。没有真实对接和结算数据时，页面只能称“平台免单权益”，不能称政府补贴或人社资格认定。

---

# 迁移与灰度

## 第一阶段：止血与 Expand

1. 暂停无规则的直接整单核销。现有 `/orders/:id/redeem` 对打印订单默认拒绝，最终改为只接受已提交的 Reservation，不能继续接受任意 `benefitGrantId`。
2. 新表和字段全部先 nullable，旧代码继续可读。
3. 现有 PriceConfig 复制到一个 `legacy-current` PriceVersion，价格不变。
4. 现有 PrintTask 从 Order 关系回填 `orderId`、`attemptNo=1`。
5. 修复 Agent：未出现队列、普通超时、非 Windows 跳过监控均不得写 complete。
6. 新增有效状态计算，但不批量删除或改写 Grant。

## 第二阶段：历史数据分类

现有 Grant 不允许凭标题或 `benefitType` 猜规则：

- 能从 Activity、发放来源和运营记录证明口径的，人工映射到已发布 RuleVersion。
- 无法证明的返回 `BENEFIT_RULE_MISSING`，暂不可核销。
- 明确是一次性权益的继续使用 `balanceMode=grant`。
- 明确是月度权益的从切换月建立 PeriodBalance；不得把历史“剩 7 次”直接解释为本月 7 次。
- 如需保护历史用户权益，另行签发带迁移审计来源的一次性补偿 Grant。

现有 RedemptionRecord 不删除、不改写金额历史。以后若对应旧订单发生可信失败，可以追加 Adjustment。

## 第三阶段：Shadow

- 新旧计价同时运行，只记录差异，不改变用户金额。
- 资格引擎只输出 shadow 决策，不预占。
- Agent 同时记录新 outcome，但未达到可信标准前不自动补偿。
- SQLite 主 CI 和 PostgreSQL readiness 都必须跑；并发额度测试必须在真实 PostgreSQL 执行。

## 第四阶段：终端灰度

按终端开关：

```text
QUOTE_V2
BENEFIT_RESERVATION_V2
PRINT_OUTCOME_V2
```

新报价先灰度到内部/单台终端。旧 Quote API 暂时保留，但不能使用优惠。

正式改价顺序：

1. Quote V2 已稳定使用 `legacy-current` 版本，用户价格仍不变。
2. 禁止 Admin 原地修改 active PriceConfig。
3. 财务/运营创建新的正式 draft。
4. 发布到未来明确时点。
5. 未过期旧 Quote 继续按旧版本成交；新 Quote 使用新版本。
6. 全部旧 Quote TTL 结束后才停止旧解析路径。

已有订单：

- 已支付、打印中、已完成：绝不重算价格或资格。
- 未支付旧订单：给有界支付窗口；过期后取消并要求重新报价，不能无限期锁旧价。
- 历史 Order 可以生成 `legacy_quote` 审计快照，但 `scenarioKey=unknown`，不得借此补发权益。
- 历史 completed 不批量改成 unknown；新 outcome 规则只对切换后的尝试生效。

---

# 验收口径

| 项目 | 自动化判据 |
|---|---|
| 四道闸 | 4 场景、4 provenance、10/11 计费页、黑白/彩色、月度 0/1 次组成矩阵；任一闸失败必须整单原价 |
| 场景溯源 | 篡改 `from/purpose/scenarioKey` 不改变结论；Quote、Order、所有 PrintTask 的 contextHash 一致 |
| 锁价 | Quote 后发布新价，旧 Quote 在有效期内仍按原价；过期返回 409；active 版本不可编辑 |
| 预占 | 两台终端争最后一次额度，最多一台 held；重复请求返回同一 reservation；过期仅释放一次 |
| 月度周期 | 覆盖 1 月 31 日、闰年 2 月、上海时区 00:00；跨月事务不能双扣；定时失败后读路径可自愈 |
| 权益状态 | DB status=active 但 validUntil 已过，列表返回 effectiveStatus=expired，报价不可预占 |
| 核销 | 一单最多一条 RedemptionRecord；amountCents 等于真实 discount；不存在删核销记录恢复权益 |
| AI | 同一 Ledger 多次 Provider 重试只收费一次；缓存命中、失败、超时、持久化失败均不收费或自动退款 |
| 履约 | 未出现队列/超时不得 complete；no_output 只补偿一次；partial/unknown 的 attempt 2 不产生新支付或核销 |
| 退款与权益 | Refund 与 RedemptionAdjustment 状态独立；PrintTask.status 不能让页面提前显示退款或恢复成功 |
| 灰度 | 新旧计价 shadow 零未解释差异；历史订单总额、核销数、退款数切换前后保持一致 |
| 安全 | 支付码不出现在 API 日志、异常、URL、数据库快照和浏览器 storage |
| 真机 | 奔图真机覆盖成功、spool 前失败、队列未确认、Agent 重启、免费续打；未知状态必须如实展示异常处理中 |

---

# 需要纠正的几点

1. “队列未出现或超时都会进入 `PRINT_JOB_UNCONFIRMED`”并不完全正确。当前 Agent 仍有“队列多次未出现后按完成处理”“普通监控超时按完成处理”“跳过监控按完成处理”的路径，只有部分 Pantum 保留任务超时走 unconfirmed。这是无人值守上线阻塞，见 [task-runner.ts](/Users/wanglei/AI求职打印服务终端/apps/terminal-agent/src/agent/task-runner.ts:495)。

2. `@@unique([serviceType, serviceRefId])` 不是需要移除的障碍。它正好保证一单只核销一次；续打和恢复应通过 PrintTask attempt 与 RedemptionAdjustment 解决。

3. “每月 N 次”不需要 Membership。现在建设会员属于扩大交易和售后面，建议不做。

4. `BenefitStatus` 不应靠定时任务自动改 expired 才正确。同步计算 effectiveStatus 才是强一致口径，定时物化只能是查询优化。

5. `effectiveFrom` 不是补一个查询条件就够了。当前报价是无状态重算，[order-quote.service.ts](/Users/wanglei/AI求职打印服务终端/services/api/src/payment/order-quote.service.ts:12)；现有 PriceConfig 又是全局唯一并允许原地改价，[schema.prisma](/Users/wanglei/AI求职打印服务终端/services/api/prisma/schema.prisma:303)。必须同时引入 PriceVersion 和持久 Quote。

6. 六项中真正不该在本次上线前实现的是 Membership 和 AI 收费。AI 可以增加 shadow 账本，但没有账本、退款和对账闭环时播种生产价目，会把现有免费能力直接变成新的资损入口。
tokens used
306,573
