# 小程序与一体机共用管理后台 —— 可行性裁定与缺口清单

> 日期：2026-08-16
> 触发：产品所有者问「小程序和当前项目共用一个后台可行吗？后期维护麻烦吗？还是用两套？」
> 方法：Claude 读一手代码 + Codex（glm-5.2 / xhigh）独立审查后合并
> **核实基准：`origin/main`**（本工作区有 153 个未提交在制品，不作为判断依据）

---

## 零、结论

**共用一套，可行，且应当现在定死这个原则。**

判断依据不是「前端入口分不分」，而是**「数据模型分不分」**——
本项目的数据底座已经完全共用，此时分两套后台等于让两个 UI 查改同一张表。

**不需要新建任何管理页**，三处缺口全部并进现有页。

---

## 一、数据底座已经共用（决定性事实）

| 数据 | 共用情况 | 证据 |
| --- | --- | --- |
| `EndUser` | 微信 `wxOpenId` 与手机号**落同一张表**；`member-auth` 与 `print-jobs` 都回填它 | `schema.prisma` EndUser |
| `Order` | 同一张表。一体机下单写 `terminalId`+`endUserId`；小程序云打印下单写的是**同样的字段** | `print-jobs.service.ts`、`member-print-order-create.service.ts` |
| AI 记录 / 简历 / 收藏 / 权益 / 通知 / 浏览记录 | 全部同源 | `/me/*` 系列端点两端共用 |

**小程序在 `origin/main` 上调 30 个端点，全部是一体机后端已有的接口**：

```
member/auth/{login,logout,sms-code,wx-login} · member/me
me/{ai-records,benefits,browse-logs,documents,notifications,print-orders,resumes,ai-consents}
me/print-orders/cloud · print/price-config · files/kiosk-upload · materials/tasks
jobs · companies · job-fairs · policies · terminals/public
assistant/chat · mock-interviews · resume/parse · resume/job-fit
```

→ **没有小程序专属的 Prisma 模型，也没有调用不存在的端点。**

---

## 二、为什么不该分两套

| 分两套的代价 | 说明 |
| --- | --- |
| **同一张表两处查改** | `Order` / `EndUser` 是一套，两个 UI 从不同角度读写，冲突与不一致不可避免 |
| **运营找不到东西** | 用户投诉「我的订单呢」，运营不知道去哪个后台查 |
| **统计口径必然分裂** | 「这个月多少单」要两个后台手工相加，且随时可能重复计数 |
| **改一次要改两遍** | 数据模型加字段，两处 UI 都要跟，**漏一处就是不一致** |
| **权限/审计/登录维护两套** | 成本翻倍，且两套权限模型容易出现越权缝隙 |

### 后期维护：共用反而更省

以「加 `channel` 字段区分渠道」为例：

- **共用**：后端加字段 → 订单页加筛选 → **一次做完，两端都有**
- **分两套**：两个后台各改一遍，还要保证口径一致

且将来若再加入口（H5 / 支付宝小程序 / 企业微信），**共用不需要再建第三个后台**。

### 「混在一起看不清」不是架构问题

那是**筛选问题**——加一个 `channel` 字段 + 一个下拉框即可，不需要为此拆后台。

### 唯一该分的情况

**业务本质不同**时才该分。但小程序与一体机做的是同一件事
（求职者使用打印与 AI 服务），只是入口不同。
且小程序不得演化为招聘闭环（CLAUDE.md §2 红线），因此这个前提不会出现。

---

## 三、三处缺口（都不用新建页面）

### M1 🔴 `Order` 没有渠道字段（一切统计的前提）

现有字段只有：`terminalId`、`endUserId`、`paymentSource`（资金性质：offline/free/manual_confirmed）、
`payChannel`（支付通道标识）——**没有一个表示「这单从哪个入口来」**。

**后果**：一体机会员单与小程序会员单**在库内不可区分**；
目前 Admin 只能靠「匿名 + 有 terminalId」推断是一体机（`admin-orders-readonly.service.ts` 按 `endUserId` 推 ownerType），
**会员单完全无法分辨**。小程序转化率、渠道 ROI 都算不出来。

**做什么**：
- `Order` 增 `channel`（建议取值 `kiosk` / `miniapp_cloud`；未来入口再追加）
- `admin-orders-readonly.controller.ts` 的查询参数加 `channel` 筛选
- Admin 订单页加渠道列与筛选（**并入现有页，不新建**）

### M2 🟠 `pickupStatus` 在 Admin 是盲区

字段**已存在**且有索引：
```
pickupStatus String @default("none")   // none | pending | claimed | used | expired | cancelled
@@index([pickupStatus, pickupCodeExpiresAt])
```
但 **`apps/admin/src/routes/orders/index.tsx` 对它 0 处引用**。

**后果**：小程序云打印的取件生命周期**无人可查**——
用户问「我的件怎么取 / 为什么过期了」，运营看不到状态。

**做什么**：Admin 订单页加 `pickupStatus` 列 + 筛选 + 必要的处置动作（如延期/作废）。

### M3 🟠 Partner 侧边界要提前定

Partner 当前路由只有 terminals/fairs/sync-logs/dashboard/profile/sources/smart-campus/jobs/account/companies/stats/policy
——**对小程序订单、会员、权益零可见**，所以现在不存在越权。

**但若将来要给 Partner 开这个视图，必须按 `orgId` 限定本机构终端**，
否则一家合作机构会看到全平台的小程序会员与订单。

---

## 四、分档建议

### 必须先补
- **M1** `Order.channel` + Admin 订单页渠道筛选 —— 一切分辨与统计的前提
- **M2** `pickupStatus` 接入 Admin 订单视图 —— 否则取件履约无人闭环

### 可以后补
- Partner 按 org 受限查看本机构终端的小程序订单（需 org scope 鉴权，见 M3）
- `PrintMaterialPack` 材料包目录的 Admin 管理页（仅当材料包功能要上线；
  该模型目前是空壳，见 [pricing 方案](./pricing-benefit-campaign-plan-2026-08.md) §三）

### 不该做
- ❌ **不为小程序另建 `Order` / `EndUser` / AI 模型** —— 已同源，重复即数据分裂
- ❌ **不让 Partner 看全量小程序会员与订单** —— 越权
- ❌ **不建第二套后台** —— 见 §二

---

## 五、方法论提醒（本轮第三次踩到）

审查时一度得出「小程序有三条链路调不存在的后端（community/package/daily-report）」
与「API typecheck 是红的」两个结论，**均不成立**——
那些是本工作区 **153 个未提交在制品**中的内容，`origin/main` 上并不存在，CI 也是绿的。

> **核实必须以 `origin/main` 为准，不能以脏工作区为准。**

这与前两次（误判「企业链断点未接」「Admin 无价目配置界面」）是同一类错误，
根因都是**基于不完整或非权威的信息下否定性断言**。
处理办法见 [`fake-capability-audit-2026-08.md`](../reviews/fake-capability-audit-2026-08.md) §四。

---

## 六、交给 Codex 的任务卡（M1 / M2）

> **分工**：Claude 负责审查、方案与规格；**真实功能开发由 Codex 执行**。
> 以下两张卡已消除全部调研不确定性，可直接开工。
> 跨会话协作记录：小程序线（`wechat-mini-app-review`）复核并提供了关键事实，逐条署来源。

### 已确认事实（Codex 不必重复调研）

| # | 事实 | 核实方式 |
| --- | --- | --- |
| **A** | 两条建单链路**完全独立、互不调用**：一体机 `print-jobs.service.ts:392` `tx.order.create`；小程序 `member-print-order-create.service.ts:111` `prisma.order.create`。小程序侧引用一体机 service **0 次** | Claude 按 `origin/main` 核实 |
| **B** | 小程序建单请求体**只有** `fileId` / `terminalId` / `copies` / `colorMode` / `duplex`（`print-pay.js:38-44`），**不含 `amountCents`** | 小程序线提供，Claude 复核 |
| **C** | `amountCents` 在小程序中**纯粹是客户端导航状态**——服务端 `/orders/quote` 算出 → 前端带着它决定显示「免费」还是「¥x」→ **建单时不传回**，后端在 `member-print-order-create.service.ts:105` 自己重新 `quote()` | 小程序线提供，Claude 复核 |
| **D** | 因此 **channel 无需小程序传字段**，两处 `order.create` 各自硬编即可；且该方案**不受小程序 UI 改动影响**（建单参数面不在预览/参数页上） | 小程序线结论 |
| **E** | 小程序侧目前**没有任何地方读或写 channel**（建单不传、订单列表 `toUiItem` 不消费），**落地时小程序零改动** | 小程序线确认 |

### T-M1 🔴 `Order.channel` 渠道字段

**为什么**：`Order` 现有 `terminalId`/`endUserId`/`paymentSource`/`payChannel` 无一表示来源入口；
两端建单写的是**同样的字段**，「匿名 + 有 terminalId」只能判出一体机，**会员单完全分不出**
——而会员单正是小程序主体。渠道对比、转化率、问题定位全部依赖它。

**枚举取值（已定，勿自行更改）**：
```
kiosk          一体机现场下单
miniapp_cloud  小程序云打印（到店取件）
```
- 扩展约定：将来加 H5 / 支付宝小程序 / 企业微信时按 `<platform>_<mode>` **追加**，不改已有值
- **`UserAiConsent` 将来加渠道标识时用同一套取值**（已与小程序线达成一致），不要另起枚举

**改哪里**：

| 位置 | 做什么 |
| --- | --- |
| `schema.prisma` `model Order` | 加 `channel String?`（可空，存量为 null）+ 建议索引 `@@index([channel, createdAt])` |
| `print-jobs.service.ts:392` | `tx.order.create` 硬编 `channel: 'kiosk'` |
| `member-print-order-create.service.ts:111` | `prisma.order.create` 硬编 `channel: 'miniapp_cloud'` |
| `admin-orders-readonly.controller.ts` | 查询参数加 `channel` 筛选（现有只有 type/payStatus/taskStatus/search） |
| `admin-orders-readonly.service.ts` | 返回体加 `channel` 展示字段 |
| `apps/admin/src/routes/orders/index.tsx` | 加渠道列与筛选（现有 9 列，见原型 `admin/orders.html`） |

**存量处理（重要）**：
- **不回填、不推断**。会员存量单无法可靠区分，界面显示「**未标注**」
- ❌ **不要按「匿名 + terminalId → kiosk」批量回填**——那会把一体机匿名单和小程序单的边界猜错，污染统计
- Admin 渠道对比表在有效数据不足时显示「未标注」而非 `0`（显示 0 会让运营误以为小程序没订单）

**验收**：
- 一体机下单 → `channel='kiosk'`；小程序云打印下单 → `channel='miniapp_cloud'`
- Admin 订单页可按渠道筛选，存量单显示「未标注」
- **小程序零改动**（事实 E）——若发现需要改小程序，说明方案理解有误，先停下确认
- 双 CI 保持绿（SQLite + `postgres-readiness`）；schema 改动需同步生成 PG schema

### T-M2 🟠 `pickupStatus` 接入 Admin 订单视图

**为什么**：后端取件链路**已完整实现**——`pickupStatus`（`none|pending|claimed|used|expired|cancelled`）、
`pickupCodeHash`（唯一索引）、`pickupCodeEnc`、`pickupCodeExpiresAt`、`pickupClaimedAt`，
并建了 `@@index([pickupStatus, pickupCodeExpiresAt])`——**索引都为按这两维查询建好了，
但 `apps/admin/src/routes/orders/index.tsx` 对 `pickupStatus` 是 0 处引用**。
用户问「我的件怎么取 / 为什么过期了」，运营看不到任何取件信息。

**改哪里**：Admin 订单页加取件列 + 筛选（见原型 `admin/orders.html`）。
一体机单该列显示「—」并注明是**业务上不存在**（现场即时出纸，无取件环节），不是「无数据」。

**处置动作需产品先确认，本卡不含**：过期件能否延期？能否重发取件码？退款与取件状态如何联动？
——这些是**业务规则**，不该由开发默认。本卡只做**可见性**。

**已知成因，写进界面说明**（小程序线提供）：
> 后端 `cancel()` 实现完整（归属校验 + `pickupStatus:'pending'` 与 `printTaskId:null` 前置 +
> 免费单分支 + 写 `member.print_order.cancel` 审计），`utils/api.js` 也定义了 `cancelCloudPrintOrder`，
> **但小程序页面 0 处调用**——用户建了待到机订单只能等过期。
> 运营看到的「已过期」里有一部分本可被用户取消。**属小程序线缺口**，Admin 侧仅标注成因。

**验收**：Admin 订单页可按取件状态筛选；一体机单显示「—」；不出现任何未经产品确认的处置按钮。

### 顺序建议

**T-M1 先做**——T-M2 的渠道列依赖它，且渠道对比表在 M1 落地前算不出任何数。
