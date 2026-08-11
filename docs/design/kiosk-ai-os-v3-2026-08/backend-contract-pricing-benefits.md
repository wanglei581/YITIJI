# 单价与权益 · 前后端字段契约（2026-08-11）

> 面向 06 打印工作台 / 24 权益活动两页的接线。
> **这份文档不从零设计字段**：后端已有的照抄，缺的才提议，提议一律标注「**提议**」。
> 有冲突时以生产仓源码为准，不以本文档为准。

---

## 一、一句话结论

| 问题 | 今天的答案 |
| --- | --- |
| 单价从哪来 | `GET /api/v1/print/price-config`（**匿名可读**，Kiosk 展示价唯一来源） |
| 改价怎么改 | `PUT /admin/billing/price-config/:serviceKey`（**唯一合法路径，必审计**） |
| 改价什么时候生效 | **立即**。计价服务不读 `effectiveFrom`，也没有报价锁价 |
| 权益怎么用 | `POST /orders/:id/redeem`，语义是**整单核销**（`discountCents = order.amountCents`） |
| 能不能部分抵扣 | **不能**。核销时权益只 `decrement: 1`，没有按量扣的能力 |
| 能不能叠加 | **不能**。`RedemptionRecord @@unique([serviceType, serviceRefId])`，一单一权益 |
| 计费数量怎么算 | `quantity = billablePages × copies`（**所选文档页 × 份数**） |
| 双面影响金额吗 | **不影响**。只减少用纸张数，不减少计费页数 |

设计侧因此定的口径：**一次免单券**，不是「每月 N 页额度」。
理由见 §六。

---

## 二、已经能用的（前端按这些渲染）

### 2.1 `GET /api/v1/print/price-config` — 屏上价格的唯一来源

```
PrintPriceConfigItem {
  serviceKey  : string   // 已播种 print_bw_page / print_color_page
  unitCents   : int      // 单价（分），>= 0
  unit        : 'page' | 'copy' | 'item'
  ...
}
```

| 前端怎么用 | 渲染到哪 |
| --- | --- |
| `unitCents / 100` | 06 的「现场公示价」表、`data-site-unit` 两行、权益卡「本单用量 N 计费页 × X 元」 |
| 拉取失败 | 走 `PRICE_CONFIG_UNAVAILABLE` 那一屏（§五） |

- **匿名可读**是关键设计：一体机**不该为了让人看价格而先要他登录**。
  06 的「未认领身份」那一屏就是照这条做的 —— 不显示权益数字，但价格照常显示。
- 设计稿里 `scripts/site-config.js` 的 `price` 段要按「**本机开机时从这个接口拉到的快照**」
  理解，**不是产品常量**。同理 `benefit` 段的 `freeTimesPerMonth` 等值也是快照，
  为空时页面**不显示任何免费字样**。

### 2.2 `quotePrint`（`services/api/src/payment/pricing.service.ts`）— 试算

```
serviceKey    = colorMode === 'color' ? 'print_color_page' : 'print_bw_page'
config        = priceConfig.findUnique({ serviceKey })
if (!config || !config.active) throw BadRequest('PRICE_CONFIG_UNAVAILABLE')
quantity      = billablePages * copies
subtotalCents = config.unitCents * quantity
→ PrintPriceQuote { amountCents, billablePages, billingPageSource, lines }
```

- 与设计稿 `v3Price(faces, mode)` 算的是同一件事（`faces = 页 × 份`），
  **算法没有分歧，分歧只在「值从哪来」**。
- 返回里**没有** `discount / benefit / deduction` 任何字段 ——
  这从接口层面确认：**订单级的"部分抵扣"今天不存在**。

#### `billingPageSource` 与屏上那句「本机还没体检这份文件」

```
BillingPageSource = 'pdf_lightweight_scan' | 'image_single_page'
```

后端**记录了计费页数是怎么来的**，而且只有这两种来源 ——
**用户自己填的页数不在其中**。这正好支撑 06 已有的两条设计：

1. 交接回执写「来源页标注 N 页」「**本机还没体检这份文件，页数与费用以体检为准**」；
2. URL 伪造防护：`?pages=999` 不能成为计费依据。

**前端要做的**：拿到 quote 后用 `billablePages` 覆盖屏上的页数，
并把 `billingPageSource` 作为「这个页数是本机量出来的」的依据；拿不到就继续写「还没体检」。

### 2.3 `BenefitGrant` / `BenefitActivity` — 用户手里的券 / 后台配的活动

```
BenefitType   = 'coupon' | 'free_quota' | 'package_entitlement' | 'subsidy_eligibility_hint'
BenefitStatus = 'active' | 'used_up' | 'expired' | 'revoked'
SourceType    = 'platform' | 'campus' | 'gov' | 'fair' | 'partner'

BenefitGrant    { benefitType, title, description, quantityTotal, quantityRemaining,
                  status, sourceType, sourceRef, validFrom, validUntil }
BenefitActivity { title, description, rulesText, benefitType, sourceType,
                  stockTotal, stockRemaining, claimLimitPerUser, status,
                  validFrom, validUntil, grantValidDays }
```

24 页的每一张卡就是一条 `BenefitGrant`，字段一一对应：

| 屏上 | 字段 |
| --- | --- |
| 卡标题 | `title` |
| 「政府补贴 / 本机自营 / 机构赞助…」 | `sourceType`（映射见下） |
| 「市人社局『就业服务进社区』专项」 | `sourceRef` |
| 「余 1 / 3 次」 | `quantityRemaining / quantityTotal` |
| 「有效期至 8月31日 23:59」 | `validUntil` |
| 状态标签 | `status` + 下面几个**提议字段** |

`sourceType` → 屏上措辞：`gov`→政府补贴、`platform`→本机自营、`partner`→机构赞助、
`campus`→校方提供、`fair`→招聘会主办方。
**这说的是"谁发的这项权益"，不是"这一单的钱谁付了"** —— 见 §七合规。

### 2.4 `POST /orders/:id/redeem` — 核销

语义（源码注释原文）：「券 / 免费次数 / 权益**全额抵扣一个未支付订单**…全额抵扣（**本波不接部分抵扣**）」

```
discountCents: order.amountCents            // 免掉整单金额
data: { quantityRemaining: { decrement: 1 } } // 权益只扣 1
```

`RedemptionRecord.kind` ∈ `coupon | free_quota | package_entitlement`
（`subsidy_eligibility_hint` **不可核销**）。

**DB 级唯一约束**：
```
@@unique([serviceType, serviceRefId])
// 同一服务产物只能被核销一次，即使换不同权益（不同 idempotencyKey）也不行
```
→ **一单一权益**。这条已经落到屏上：06 的权益选项是**单选**，
并且写明「不是本机小气，是核销账本只允许核销一次」。

---

## 三、今天还没有的（**提议**，全部标注为缺口）

> 这一节里的每一个字段后端都**没有**。前端目前在设计稿里用同名的本地配置演示，
> 接线时以后端最终命名为准。

### 3.1 会直接赔钱的三个缺口 — 建议一起补

`discountCents = order.amountCents` **没有任何上限**，也不区分 `benefitType`，
管理员还可以创建任意 `quantityTotal` 的权益。
也就是说：**一张券打 200 页，平台全赔**。屏上必须有四道闸，其中三道后端还没有字段。

| # | 提议字段 | 挂在哪 | 类型 | 拦住什么 | 缺了会怎样 |
| --- | --- | --- | --- | --- | --- |
| ① | `applicableScopes` | Grant / Activity | `string[]` | 只在求职产出上生效 | 拿补贴打自带的任意文件 |
| ② | `maxBillableUnits` | Grant / Activity | `int` | **单次计费总量上限（页 × 份）** | 打大文件、**打多份** |
| ③ | `colorScope` | Grant / Activity | `'bw_only' \| 'all'` | 彩色不覆盖 | 用 7.5 倍单价的彩色薅 |
| ④ | `quantityTotal` | Grant | `int` | 每月 N 次 | —（**这条后端已有**） |

**② 最容易漏，请特别注意**：上限必须加在**计费总量**（`billablePages × copies`）上，
不是文档页数。只限文档页数拦不住 —— 「10 页 × 20 份 = 200 计费页」照样白拿 40 元。
06 的核价卡已经在算这个数（`q-content`：`3 页 × 5 份 = 15 个计费页`），直接用它。

**③ 为什么只覆盖黑白**：黑白 0.20 / 彩色 1.50，**同一个「免 10 计费页」的上限，
彩色值 15 元、黑白只值 2 元（7.5 倍）**。求职材料绝大多数是黑白简历，
「免费只覆盖黑白」既堵洞、口径也简单。

**超出任何一道闸时不做补差价。** 后端只有整单核销，
「先免 10 页、超出的你自付」是部分抵扣，做了就是伪造能力。
正确做法：整单走正常价格 + 一句**可执行**的话
（「减到 10 个计费页以内即可 —— 少打几份，或用页码范围只打要用的那几页」）。

### 3.2 报价 → 可用权益，必须由服务端一起返回

**前端不做资格判定。** `from=` 来自 URL、可以伪造，不是安全边界
（06 自己的交接护栏注释里已经写过这个道理）。

**提议**：`quotePrint` 的返回增加

```
availableBenefits : Array<{
  grantId        : string
  title          : string
  usableForOrder : boolean
  reasonCode?    : 'OUT_OF_SCOPE' | 'OVER_UNITS' | 'COLOR_NOT_COVERED'
                 | 'USED_UP' | 'EXPIRED' | 'REVOKED' | 'NEEDS_IDENTITY'
  // 讲成人话所需的数值，前端不自己算
  maxBillableUnits?: int
  billableUnits?   : int
}>
```

**`reasonCode` 必须是结构化的、分得开的。**
这几种在用户眼里完全不同，合并成一句「不可用」等于没说：

| reasonCode | 屏上说法（已落到 06） |
| --- | --- |
| `OUT_OF_SCOPE` | 「免费打印次数适用于简历、招聘会资料等求职材料；本单为普通打印。」**并且不显示这张券**——摆一个按不动的券比不显示更糟 |
| `OVER_UNITS` | 「本单 3 页 × 8 份 = 24 个计费页，超出 10 页上限。本单按公示价 4.80 元计费。**减到 10 个以内即可。**」 |
| `COLOR_NOT_COVERED` | 「免费打印次数覆盖黑白；本单为彩色。**改回黑白即可。**」 |
| `USED_UP` | 「本月 N 次已用完，下月 1 日恢复。」 |
| `EXPIRED` | 说清失效日期 |
| `REVOKED` | 「券还在你账户里，但发这张券的活动已下线 —— 本机不知道它现在还认不认。」 |
| `NEEDS_IDENTITY` | 「免费次数在你的账户上，先认领身份才能用。」 |

### 3.3 报价锁价（`quoteId` / `expiresAt`）

后端**没有**。Admin 改价立即改 `unitCents`，`serviceKey @unique` 也存不下
「现价 + 未来价」两份，排期调价目前做不到。
于是：**前端先调无状态报价、建单时后端再算一次，两次可能不同**。

- **设计侧的诚实处理**（已落到 06 的「后台刚调过价」那一屏）：
  屏上标出**这份价目是什么时候拉的快照**，并写明
  「后台改价立即生效，本机也不锁价 —— **确认下单时服务端会重新算一次，以那一次的结论为准**」。
- **提议**：报价返回 `quoteId` + `expiresAt` + `priceVersion`，
  建单时带 `quoteId`；服务端发现价格已变则拒绝并回报新价，由用户确认。
  在这之前，屏上不能承诺「你看到的就是你要付的」。

### 3.4 状态不自动过期

`BenefitStatus = 'expired'` **不会自动更新**，权益列表原样返回数据库 `status`。
于是可能出现「权益页显示可用、核销时按时间被拒」的断层。

- **设计侧处理**（已落到 06 与 24）：
  「列表里写着『可用』**不等于一定能用** —— 有效期是发放时写下的，
  本机不替服务端重新判过期；核销那一刻仍可能被判过期或不适用。」
- **提议**：列表接口按当前时间实时计算 `effectiveStatus`（不改库里的 `status`），
  或加定时任务把过期的 grant 落成 `expired`。

---

## 四、计量单位：`page` 到底指什么（**要后端定的口径**）

| 侧 | 现状 |
| --- | --- |
| 后端 | `PriceConfig.unit` 只有 `'page' \| 'copy' \| 'item'`；serviceKey 是 `print_bw_page` |
| 设计稿（改前） | 屏上写「印刷面」，并写「双面一张纸两面按 2 面计」 |
| 设计稿（改后，本轮） | 屏上统一写「**计费页**」，解释语「按所选文档页计费；**打印双面只减少用纸，不减少计费页数**」 |

**为什么必须点破**：`page` 的真实含义是「**所选文档内容页**」，不是纸张，
也不严格等于物理印刷面 —— **双面和「一面排 N 页」都不减少计费数量**。
数值上目前两边同数（3 页 × 5 份 = 15，×0.20 = 3.00），
**风险全在措辞**：后端那个 `page` 一旦被谁理解成「一张纸」，双面单立刻差一倍。

**收口建议（要后端拍板）**：

1. 数据库 `unit='page'` **保留兼容**，不动；
2. API 增加明确的 `billingMetric: 'document_page'`；
3. 屏上统一写「按所选文档页计费」+「打印双面只减少用纸，不减少计费页数」；
4. 未来真要按物理面收费，**再新增 `'printed_side'` 并改公式**，不要复用 `page`。

**不要**新增含义模糊的 `'surface'`，也不要把 `'page'` 口头解释成别的意思。

### 4.1 `print_duplex_surcharge`（未来若启用需注意）

schema 注释举例里出现过这个 serviceKey，但**没播种、也没被读取**，
**不是当前的运行冲突**。若将来启用，它与屏上公示的
「打印双面只减少用纸，不减少计费页数」是**相反口径**，两处必须同时改，
否则用户会按屏上的话算出一个和收款不一样的数。

### 4.2 扫描侧方向相反（易错点）

07 扫描台的「双面」是**扫两面 → 页数翻倍 → 钱翻倍**，
与打印侧「双面只省纸」方向相反。任何通用的「双面」说明都要注明说的是哪一侧。

---

## 五、错误码 → 屏幕状态对照表

> 联调时按这张表对，前端不自己编错误文案。

| 错误码 | 屏上状态 | 屏上说什么 | 能不能收钱 |
| --- | --- | --- | --- |
| `PRICE_CONFIG_UNAVAILABLE` | 06 权益卡「价目拉不到」 | 「本机没能从后台取到现行价目。错误码 `PRICE_CONFIG_UNAVAILABLE`。屏上**不显示金额**，本机**也不收款、不下单**。上一次拉到价目是 09:41 —— **本机不拿旧价当现价**。」 | **不能**。金额位显示「—」，不出收款码 |
| `PRICE_INVALID_PAGES` | 06 参数页页码范围提示 | 「这个范围在 1–N 里一页都没命中，本单没有可打印的页 —— 请改一下再核价。」 | 不能 |
| `PRICE_INVALID_COPIES` | 06 份数步进器脚注 | 「本机单次最多 N 份，已停在 N 份。要更多请分几单，或找现场工作人员。」**超限不许静默截断** | 夹到上限后可 |
| 权益列表拉不到 | 24「本机还没拿到活动配置」 | 「**本机不拿上一次的清单当现在的清单**……你账户里的次数与券没有丢，也没有被扣，只是本机这一刻读不到。」 | 可以（按公示价） |
| 权益列表返回空 | 24「本机现在一项权益都没有」 | 「后台当前没有配任何面向本机的活动……**本机不会为了让这一页看起来有内容而放点什么上去**。」 | 可以（按公示价） |
| 核销失败（过期 / 不适用 / 已被用掉） | 06 结算 | 「核销没过就按公示价收，**不会先扣了你的次数再告诉你不行**。」 | 按公示价 |

**通用纪律**：屏上任何出现价格的地方**必须走同一个来源**。
全站还有若干页硬编码了金额（例如把单价写成 `0.2` 而不是 `0.20`、
把单位写成「页」而不是「计费页」），那些要么改成读同一份配置，
要么标明「预估 · 以打印工作台核价为准」。

---

## 六、为什么选「N 次免单」而不是「页数额度」

**这是本轮最重要的一个产品决定，理由全部是工程事实。**

后端核销的语义是「**一次免掉一整单，权益扣 1**」：

```js
discountCents: order.amountCents
data: { quantityRemaining: { decrement: 1 } }
```

- 把它描述成「**每月 N 次免单**」→ **现有后端代码立刻就是对的，一行都不用改**。
- 把它描述成「**每月 20 页额度**」→ 需要按页拆分抵扣，后端不支持。
  硬接会出现「一张券免掉 3.00 元、额度只扣 1」的账务事故：
  **一个月 20 页的额度能白打 105 页**（20 次 × 上限）。

所以设计稿把 24 页从「免费打印额度 · 每月 20 页」改成「**免费打印 · 每月 N 次**」。
**历史流水的金额一分没动**（省 1.20 / 1.40 / 2.40 / 1.00），
它们本来就是「整单被免掉」的真实金额，与新口径完全自洽 ——
改的只有计量说法：「扣 6 页 · 省 1.20 元」→「第 2 次免单 · 省 1.20 元」。

### 将来若要做「页数额度」，需要补的是：

1. `RedemptionRecord` 支持部分抵扣（`discountCents < order.amountCents`）；
2. 额度的**计量单位**要定死（计费页？文档页？）并写进字段；
3. 按量扣减（`decrement: n` 而不是 `decrement: 1`）；
4. 下单时的**预占**与失败回滚（否则并发下会超扣）；
5. 抵扣顺序规则（多项权益并存时先用哪个）——
   但这条与现有 `@@unique([serviceType, serviceRefId])` 的「一单一权益」冲突，
   要一并决定。

**在这五条齐备之前，屏上不得出现「已抵扣 X 元、还需付 Y 元」。**

---

## 七、合规红线（`packages/shared/src/types/memberBenefits.ts` 顶部原文约束）

1. `subsidy_eligibility_hint` **只能是 info-only**：
   只展示政策说明 / 材料清单 / 官方入口，**绝不**出现「补贴已到账 / 已发放金额」。
   → 24 已把它**单独分栏**为「政策资格参考」，不显示余额 / 金额 / 抵扣 / 绿色勾选，
   并写明「不是券、不能核销、也没有金额」。
2. 「券 / 套餐额度只代表平台内服务 / 打印额度，**不代表录用结果，
   不承诺面试 / 录用 / 补贴到账**。」

### 7.1 已删除的一句话（请复核）

24 原文写着：

> 「你免费打的这些页，**本机是按页向人社结算的** —— 所以这不是我们送你的，是政府买单。」

**本轮已删除。** 理由：现有模型能证明的只有**这一项权益的发放来源分类是 `gov`**，
**证明不了本次打印已经纳入哪一笔财政结算**，更不能替政府向用户承诺付款。

替换为：

> 「这一项的**发放来源登记为政府补贴**（市人社局专项）。
> 本机只做**展示与核销登记**，**不代办、不代领**，也**不替出资方承诺任何款项**。
> **本机能说的只有这些** —— 这一单的钱最后走哪一笔账，不在本机能证明的范围内。」

> ⚠ **这一条需要产品所有者确认**：如果「本机按计费页向人社结算」在合同上确有其事、
> 且有据可查，可以在补上证据来源后恢复原句；在拿到证据之前，屏上不写。

---

## 八、设计稿里对应的位置（联调时对着看）

| 契约条目 | 设计稿位置 |
| --- | --- |
| 价目快照 / `PRICE_CONFIG_UNAVAILABLE` | `06-print-workbench.html` s4 左栏「权益与本单价格」卡，处境切换 `data-ben-btn="unavailable"` |
| 四道闸 | 同上，`SCN` 里的 `applicableScopes` / `maxBillableUnits` / `colorScope` / `quantityTotal` |
| 一单一权益（单选） | 同上，`data-benuse-btn` 选项组 |
| 不可用原因分开说 | 同上，`data-ben-btn` = `ordinary` / `none` / `guest` |
| 改价立即生效、不锁价 | 同上，`data-ben-btn="repriced"` |
| 0 元单不进收银台 | `render()` 末尾按 `B.due === 0` 在 `wait ↔ free` 之间切 `data-pay` |
| 0 元的**成因**要写出来 | 核价卡里的 `#q-benefit` 一行 |
| 权益列表按后台下发渲染 | `24-benefits.html` 页尾渲染脚本，`GRANTS` 数组 |
| 列表三种返回：N 项 / 空 / 拉不到 | 同上，`data-ben-btn` = `normal` / `empty` / `stale` |
| 活动下线但券还在 | 同上，`activityStatus: 'revoked'` 那一条 |
| 本机不认识的新类型 | 同上，`benefitType: 'training_voucher_v2'` 那一条（降级显示，不猜怎么用） |
| 政策资格参考分栏 | 同上，`subsidy_eligibility_hint` 单独一节 |

**设计稿里所有取值都是「一次服务端响应的样例」，不是产品常量。**
接线时全部替换成接口返回；拿不到就走对应的空态 / 错误态，**不要保留样例值**。
