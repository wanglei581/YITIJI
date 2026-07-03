# 我的页商用闭环 · 第一批实施计划（P0a / P0b / P1）

> **For agentic workers:** 本文件是「我的页商用闭环第一批」的实施计划与准入。执行前必读 `CLAUDE.md`、`AGENTS.md`、`.ccg/spec/guides/index.md`、`docs/compliance/compliance-boundary.md`。每批独立分支 + 独立 worktree，从干净 `origin/main` 开始，禁用 `git add .`，>30 行 diff 双模型审查。**本轮只落计划文档；用户确认本文件后才开 P0a worktree。**

**Goal（第一批）：** 补齐「我的页商用闭环」当前唯一的真实缺口——**打印订单的真实计费与支付状态域（C-5 支付域后端底座，无 live 网关）**，并在此之上真实化我的页订单详单/电子凭证，最后补权益核销落库。

**Architecture：** 在既有 `Order` 底座（`schema.prisma:111`，当前 `amountCents` 恒 0、`payStatus=unpaid`、注释「当前不接真实支付」）上，additive 扩展价格配置与支付来源字段，落地**报价 + 支付状态机 + 退款状态机 + 幂等 + 审计**；真实资金网关（微信/支付宝 Native）**不在本批**，用「线下/免费诚实档」承接，并强制记录支付来源避免被误解成线上已收款。前端只在既有 `/me/*` 骨架内做真实化（UI 冻结 A 档），不新增入口。

**Tech Stack：** NestJS + Prisma（SQLite 主 + PostgreSQL readiness，双 additive migration）+ `packages/shared` SSOT 类型 + React/Vite/TS（Kiosk）+ 既有 `verify:*` node 脚本门禁。

---

## 0. 基线与执行方式

- **基线**：干净 `origin/main`（撰写时 `b90d737b`；P0a worktree 实开于其后的 `d922071d`，PR #123 合入后）。会话根 `codex/worktree-state-reconciliation`（脏）不作为基线，本计划所引事实以 `origin/main` 规范版本 + 实际源码核实为准。
- **不在 `feature/job-master` 上做**（该分支冻结，PR #117 Draft）。task.json 里 `feature/interview-setup-redesign` 为 2026-06-18 旧引用，**弃用**。
- **分支/worktree**：本批只开 **P0a** 一个独立 worktree/分支（从干净 `origin/main`）。P0b、P1 各自到执行时再从当时干净 `origin/main`（或含 P0a 的最新 `main`）另开，独立验证、独立审查。
- **确认门**：计划已经用户确认（2026-07-03：选项 ①、顺序 P0a→P0b→P1、§8 三项已定为决策）。P0a 独立 worktree/分支 `codex/profile-commercial-p0a-payment-foundation` 已从干净 `origin/main` 开出，本文件作为首个 docs commit 带入。

---

## 1. 盘点结论（代码核实，非文档口径）

### 1.1 已是真闭环（勿重做，各有 verify）
我的权益(`verify:member-benefits-admin`) / 通知·反馈(`verify:feedback-notifications`) / 打印订单只读页 `/me/print-orders`(`verify:member-print-orders`) / 打印→反馈关联 / AI 记录页 `/me/ai-records`(`verify:member-assets-c2d`) / 我的简历·文档·收藏 / 文件保存期限(`verify:file-assets-trial-acceptance`) / 权益活动 MVP 发布+领取生成 `BenefitGrant`(`verify:benefit-activities`)。`ProfilePage.tsx` 已 177 行。SMS 真发就绪（腾讯 TC3，prod 门控，当前 log 档）。

### 1.2 真实缺口（本批目标）
| 缺口 | 现状（源码） | 归属 |
|---|---|---|
| 支付 | `Order`(schema.prisma:111) `amountCents @default(0)`、`payStatus @default("unpaid")`，注释「当前不接真实支付」；无 provider/endpoint/service | **P0a** |
| 订单计费/状态机 | 建单即 `amountCents=0`；`/admin/orders`、`/me/print-orders` 只读；无报价/支付/退款状态流转 | **P0a** |
| 电子凭证/退款 | `Order` 有 `refundReason/refundedAt` 字段但无退款 service；无取件凭证生成 | **P0a**(域) + **P0b**(展示) |
| 权益核销落库 | `BenefitGrant` 只展示/领取；`quantityRemaining` 服务点位不扣减，打印/AI 端不校验 `benefitGrantId` | **P1** |
| 会员套餐/tier | ABSENT；Profile「求职打印套餐/AI服务套餐/招聘会扫码凭证」= 硬编码「建设中」占位 | **不进本批** |

---

## 2. 已确认决策（用户 2026-07-03）

1. **支付边界＝选项 ①**：真实后端底座 + 线下/免费诚实档。**第一批不接微信/支付宝 Native live 网关，不录入商户密钥，不执行真实资金交易**；live 网关等商户进件、密钥、真机收款齐备后另开独立任务。
2. **顺序＝P0a → P0b → P1**（P0b 依赖 P0a 的真实金额/状态机；P1 是平台 credit，不解决订单金额缺口，排 P0b 后）。
3. **诚实标注（硬约束）**：线下/免费档不得伪装成线上支付成功；只要 `payStatus=paid`，必须同时记录并返回**支付来源** `paymentSource ∈ {offline, free, manual_confirmed}`（`wechat`/`alipay`/`benefit` 均为未来扩展预留，本批禁止写入），避免被理解为微信/支付宝已真实收款。

---

## 3. 全批红线与不做事项（贯穿验证）

**红线（每批 verify 需断言）**：不补假闭环；「我的」不扩成第二首页、`ProfilePage` 只入口+概览；**禁恢复 `AccountAssetsPanel`/账号资产聚合**；禁虚假补贴/结果文案（到账/已发放/保录用/保面试/通过率）；券=平台 credit 非政府补贴/非真实收款；**只对 打印/AI/材料 计费，绝不对岗位结果或候选人数据计费**；`/me/*` 全走 `EndUserAuthGuard`+本人 `endUserId`，Admin 写动作写 `AuditLog`；合规按钮文案白名单不变；UI 冻结（A 档=既有骨架内真实化可做，B 档=新区块/改信息架构需用户逐项解冻）。

**本批明确不做**：微信/支付宝 live 网关与商户密钥、会员套餐/tier、招聘会扫码凭证、账号注销、AI 助手会话落库、新增任何我的页入口或首页磁贴。

---

## 4. P0a — 打印订单计费与支付状态后端底座（无 live 网关）🔴 高风险（money 域）

### 4.1 功能归位声明
- **业务闭环**：让 `Order` 真实有金额 + 支付/退款状态机，成为支付域 C-5 的最小安全底座；支撑 P0b 我的页订单/凭证真实化。
- **涉及层与目录**：
  - 后端 `services/api`：新增 `src/payment/`（pricing service + order-status 状态机 service + admin 订单动作 controller）；改 `src/print-jobs/print-jobs.service.ts`（建单接真实报价）；`prisma/schema.prisma`（additive）+ SQLite/PG 双 migration；`scripts/verify-order.ts` 扩展。
  - 共享类型 `packages/shared`：`PaymentSource` union、`OrderView`/报价 DTO（SSOT，不在各端硬拷贝）。
  - 前端/终端/共享 UI：**不涉及**。
- **不涉及层**：apps/kiosk、apps/admin、apps/partner、apps/terminal-agent、packages/ui。
- **复用确认**：复用既有 `Order` 模型、`admin-orders-readonly` 只读、`verify:order`、`AuditLog`；不新建订单模型、不新建第二套支付概念。
- **触碰**：DB ✅ additive / 支付 ✅（仅域建模 + 线下/免费档 + 报价，**无 live 网关、无真实扣款、无商户密钥**）/ 打印 ✅（建单报价）/ auth ✅（本人 + Admin 审计）；file / sms / AI ❌。

### 4.2 数据模型（additive，非破坏）
- **新增 `PriceConfig`**：`serviceKey`（如 `print_bw_page`/`print_color_page`/`print_duplex_surcharge`/AI 服务包 key）、`unitCents Int`、`unit`（page/copy/item）、`active Boolean`、`effectiveFrom`、`description`、审计字段。首批以 seed/默认价驱动；**Admin 价格 CRUD UI 不在 P0a**（后续批）。
- **`Order` 追加字段**（全部可空/带默认，向后兼容）：
  - `paymentSource String?` —— 取值 `offline | free | manual_confirmed`（`wechat|alipay|benefit` 均为未来扩展预留，本批禁写）。**约束：`payStatus=paid` ⇒ `paymentSource` 必须为上述三者之一，且非空。**
  - `paidAt DateTime?`、`paidBy String?`（`self`/操作员标识，manual 时记录）。
  - `pickupCode String?`（取件凭证码，`paid` 时生成；P0b 展示）。
  - 复用既有 `amountCents`、`payStatus`、`refundReason`、`refundedAt`。

### 4.3 状态机（payStatus，幂等）
- `unpaid → paid`：要求 `paymentSource ∈ {offline, free, manual_confirmed}`；置 `paidAt`、生成 `pickupCode`；写 `AuditLog`。
- `unpaid → cancelled`：置 `taskStatus=cancelled`（预留，可选）。
- `unpaid → failed`。
- `paid → refunded`：要求 `refundReason` 非空；置 `refundedAt`；写 `AuditLog`。
- **幂等**：重复同态转移返回当前态、不重复副作用/审计；非法转移（如 `unpaid→refunded`、无 `paymentSource` 的 `paid`）以明确错误码拒绝。
- **免费单**：报价为 0（本批仅限零价/测试场景）→ 建单即 `payStatus=paid` + `paymentSource=free`。**P0a 不接权益**；「权益全额覆盖」如何映射 free/来源留 P1 评估。

### 4.4 计费接线
- `print-jobs.service.ts` 建单时经 `PricingService` 按打印参数（页数/彩黑/单双面/份数）计算 `amountCents`（替换硬编码 0）；`amountCents=0` 时按免费单落 `paid+free`，否则 `unpaid`。
- **诚实标注**：任何 `paid` 都带 `paymentSource`；本批 service 层禁止把 `paymentSource` 写成 `wechat/alipay`；返回给上层的 `OrderView` 必含 `paymentSource`，供 P0b 显示「线下收款/免费/人工确认」而非「微信/支付宝已支付」。

### 4.5 后端端点（无 live 网关）
- 内部：建单报价（上述）。
- Admin 线下/人工：`POST /admin/orders/:id/mark-paid`（body `paymentSource ∈ {offline, manual_confirmed}`，审计）、`POST /admin/orders/:id/refund`（body `refundReason`，审计）。仅后端端点 + verify 覆盖；**apps/admin 前端调用 UI 不在 P0a**（后续批）。
- 会员只读：`/me/print-orders`(既有) 响应补 `amountCents/payStatus/paymentSource/pickupCode`（只读，P0b 消费）。

### 4.6 TDD 任务序（先红后绿，每步独立 commit）
1. `packages/shared`：加 `PaymentSource` union + `OrderView`/报价 DTO；shared typecheck。
2. `scripts/verify-order.ts`：**先写失败断言**——报价非 0、`paid` 必带 `paymentSource`、拒绝无来源的 `paid`、`paymentSource` 本批不得为 `wechat/alipay`、退款仅从 `paid` 且需 `refundReason`、幂等转移、免费单=`paid+free`、mark-paid/refund 写审计。运行确认 FAIL。
3. `schema.prisma` + 双 migration（SQLite `prisma migrate` / PG）：加 `PriceConfig`、`Order` 追加字段；`db:pg:sync:check` 通过。
4. `PricingService` + seed 默认价；单测/verify 报价路径转绿。
5. `OrderStatusService`（状态机 + 幂等 + 审计）；`print-jobs.service.ts` 建单接报价。
6. Admin 订单动作 controller（mark-paid/refund，Admin auth + 审计）。
7. `/me/print-orders` 响应补字段（只读）。
8. `verify:order` 全绿（含新断言）+ API typecheck/lint + 空库 `prisma db push` + verify。

### 4.7 验证命令
`pnpm --filter @ai-job-print/api verify:order`、`pnpm --filter @ai-job-print/api db:pg:sync:check`、`pnpm --filter @ai-job-print/api typecheck`、`pnpm --filter @ai-job-print/api lint`、空库 `prisma db push` 后跑 verify、`git diff --check`。CI 保持 SQLite 主 job + `postgres-readiness` 双 job 绿。>30 行 diff → Claude + Antigravity 双模型审查。

### 4.8 文件预算
`print-jobs.service.ts` 改动前先查行数（>500 需评估拆分）；新增 payment service 单一职责、各自 <300 行；不把状态机/报价/controller 堆进同一文件。

### 4.9 docs 同步
`docs/progress/current-progress.md`（支付域 C-5 底座落地、live 网关待商户资质，诚实档口径）、`docs/progress/next-tasks.md`（P0a 完成、P0b 待接、live 网关另立任务）。

---

## 5. P0b — 我的页打印订单详单 + 电子凭证真实化（前端 A 档，UI 冻结内）🟠

> 到执行时再从当时干净 `main` 另开 worktree，并展开为逐步 TDD。以下为准入定义。

- **功能归位声明**：`/me/print-orders` 展示真实 份数/彩黑/单双面/页数/`amountCents`/`payStatus`/`paymentSource`/取件码 + 状态筛选 + 「再打一份」复用既有打印链路；退款状态与状态变更通知接线。**支付来源如实显示「线下收款/免费/人工确认」，不显示「微信/支付宝已支付」。**
- **涉及层**：前端 `apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx`（改动前查行数，超 500 先拆表单/列表/详情）+ 其 service adapter；必要的 `packages/shared` 只读 DTO。**复用 P0a 后端，不加后端业务逻辑。**
- **不涉及层**：services（除只读适配）、admin、partner、terminal-agent、packages/ui。
- **不做**：新增入口/卡片（A 档冻结内）、B 档信息架构改动、恢复 `AccountAssetsPanel`。
- **触碰**：打印 ✅只读展示 / 支付 ✅只读状态+凭证 / auth ✅本人 token；db/file/sms/AI ❌。
- **验证**：`verify:member-print-orders`（扩详单/凭证/筛选/来源诚实文案）、Kiosk typecheck/lint/build、**1080×1920 竖屏浏览器走查**、双模型审查。
- **docs 同步**：`current-progress.md`、`user-data-flow-matrix.md`（订单页真实化，入口不变）。

---

## 6. P1 — 权益核销落库（BenefitGrant → 幂等核销 + 服务点位扣减）🟠（无支付依赖）

> 到执行时另开 worktree 并展开 TDD。**执行前先核实 Kiosk 权益活动/核销页现状（`MyActivityPage.tsx`）与 `benefit-activities.service.ts` 现有事务边界**，避免重复造。

- **功能归位声明**：`BenefitGrant` 从「只展示/领取」升级为真实核销——`quantityRemaining` 在打印/AI 服务点位**幂等扣减** + 核销记录 + 审计；券=平台 credit（非政府补贴、非真实收款）。可与 P0a 免费单来源打通（权益全额覆盖 → `paid+free`/或新增 `benefit` 来源，届时评估）。
- **涉及层**：后端 `services/api/src/benefit-activities/*`（核销 service）、打印/AI 服务点位的 `benefitGrantId` 校验接线、`schema.prisma`（核销记录 additive）+ 双 migration、`packages/shared`；`verify:benefit-activities` 扩展。前端范围以核实结果为准（优先只读展示核销状态）。
- **不涉及层**：admin（除只读）、partner、terminal-agent、packages/ui。
- **不做**：虚假补贴文案、把券包装成资金到账、招聘结果记录。
- **触碰**：DB ✅additive / AI·打印 ✅点位扣减 / auth ✅本人+审计；**支付 ❌（纯配额，不涉资金）**/file/sms ❌。
- **验证**：`verify:benefit-activities`（扩核销+幂等+禁虚假补贴文案）、`db:pg:sync:check`、typecheck/lint、双模型审查。
- **docs 同步**：`current-progress.md`、`next-tasks.md`。

---

## 7. 顺序、验证矩阵与每批 git 协议

| 批次 | 真实闭环 | 关键 verify | 触碰支付资金？ | 前置依赖 |
|---|---|---|---|---|
| P0a | 订单计费+支付/退款状态机（无 live 网关） | `verify:order`(扩) + `db:pg:sync:check` | ❌ 无真实扣款（仅线下/免费/人工档） | 无（干净 main） |
| P0b | 我的页订单详单+电子凭证真实化 | `verify:member-print-orders`(扩) + 竖屏走查 | ❌ 只读展示 | P0a |
| P1 | 权益核销落库+点位扣减 | `verify:benefit-activities`(扩) | ❌ 平台 credit | 可独立（排 P0b 后） |

**每批 git 协议**：从当时干净 `origin/main` 新建独立分支 + 独立 worktree；每步独立 commit，禁 `git add .`；提交信息尾 `Co-Authored-By: Claude ...`；>30 行 diff 双模型审查；完成后同步进度文档 + 跑最小相关 verify；不 push/合并前不宣称上线完成。

---

## 8. 开工前已定决策（用户 2026-07-03 确认）
1. **默认打印价目**：P0a 允许使用「开发默认价目 seed」，**仅用于 verify 与本地开发，不对外宣称最终价格**；Admin 价格 CRUD UI、正式定价策略、运营价格表**另批**。默认 seed 必须集中在**单一 seed/fixture 或 `PriceConfig` 初始化逻辑**里，**禁止散落硬编码**。
2. **Admin mark-paid/refund UI**：P0a 只做**后端端点 + verify**，不做 Admin 前端 UI；Admin 前端联动**另批**，不混入 P0a。
3. **benefit 支付来源**：P0a **不新增 `paymentSource=benefit`**，只允许 `{offline, free, manual_confirmed}`；`wechat`/`alipay`/`benefit` 均为未来扩展，**不得在 P0a 写入**。P1 做权益核销时再评估「权益全额覆盖」如何与 free/来源关联。

> **状态：计划已确认，P0a 执行中。** P0a worktree/分支 `codex/profile-commercial-p0a-payment-foundation` 已从干净 `origin/main`（`d922071d`）开出；本文件为首个 docs commit。按 §4 执行：Task 1 shared 类型 → Task 2 verify 红测 →（Task 3 schema/migration 前停下复核）。不 push，除非用户另行确认。
