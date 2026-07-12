# 退款异常处置与对账巡检 SOP（C5-6 运营口径）

> 适用范围：微信（Native/付款码）与支付宝线上支付的退款异常处置、每日对账巡检、以及 FREE_MODE → 付费模式切换的前置检查。
> 权威代码口径：`services/api/src/payment/refund.service.ts`（状态机与三分法）、`reconciliation.service.ts`（差异码）、`refund-convergence.task.ts`（自动收敛）。
> 回归门禁：`verify:wechat-refund-regression`（3 组场景、6 项组合断言）+ 既有 5 个退款/对账 verify，均在双 CI。
> 上位文档：`docs/product/payment-commercial-adaptation-plan-2026-07.md`（波次与 DoD）、`docs/operations/print-rollout-deployment-matrix.md`（运营模式门禁）。

---

## 一、核心不变量（读懂再操作）

1. **退款只有一个入口**：`POST /admin/orders/:id/refund`（JWT + admin 角色，走 `RefundService`）。**Admin 订单页当前为只读，无退款按钮**——本 SOP 中所有「发起/重试退款」均指由运维人员持 admin 凭证调用该受控 API（或后续接线的 Admin 操作入口）。禁止直改数据库、禁止绕过服务改 `Order.payStatus` / `Refund.status`。
2. **一单一退款号**：`refundNo = RFD-<orderNo>`。**任何重试都用同号**（渠道以 `out_refund_no` 幂等，同号绝不二次出款）；**换号重试 = 可能双倍退款，绝对禁止**。
3. **渠道结果三分法**：
   - **明确成功**（SUCCESS）→ `refunded`（终态）；
   - **明确失败**（4xx 业务拒绝 / ABNORMAL / CLOSED）→ `Refund=failed`、订单回 `paid`，可同号重试；
   - **结果不可知**（5xx / 超时 / 429 / 验签失败）→ `Refund=pending`、订单停 `refunding`，**绝不判失败**，等收敛。
4. 退款不触碰打印任务状态（支付域与打印域解耦）；已 `SUCCESS` 的退款不会被迟到的 CLOSED 通知回退。

## 二、每日对账巡检（试运营期间每日一次）

1. 打开 Admin「计费与对账」页（后端 `GET /admin/billing/reconciliation`），或按需带 `from/to` 窗口。
2. 核对 `summary`：`grossPaidCents / refundedCents / netCents` 与当日预期一致；`refundingCount` 应为 0 或有对应在办事项。
3. `discrepancies` 逐条按下表处置（**为空即巡检通过，截图/记录留档**）：

| 差异码 | 含义 | 处置 |
|---|---|---|
| `STUCK_REFUNDING` | 退款中订单超 30 分钟无进展 | 按 §三 处置 |
| `PAID_WITHOUT_SUCCESS_ATTEMPT` | **线上通道**（wechat/alipay/sandbox）paid 单无成功支付尝试 | 升级排查（线下 mark-paid / 核销单不产生此差异，若出现即异常） |
| `REFUND_SUCCESS_ORDER_NOT_REFUNDED` | 退款成功但订单状态未同步 | 记录 orderId 升级处理，禁止手改库 |
| `REFUND_AMOUNT_MISMATCH` | 订单退款额与成功退款记录之和不符 | 升级排查（可能部分退款/历史数据），禁止手改库 |
| `ORDER_REFUNDED_WITHOUT_REFUND_ROW` | 账实不符：订单已退款但无退款记录 | 按 §五「退款缺失」排查树 B 型处理 |
4. `attention.latePaid / reconciled` 为复核项（迟到入账 / 主动查单入账），非错误：确认对应订单履约状态合理即可。
5. **渠道账单 diff（微信商户平台/支付宝账单 ↔ 本地账本）目前未实现自动化**：试运营期间按周人工抽样 3–5 笔，对比商户平台交易/退款记录与 Admin 订单页金额、状态；不一致按 §五 处理。不得宣称已有自动渠道对账。

## 三、STUCK_REFUNDING 处置（超龄退款中）

1. **先看自动收敛是否开启**：生产 env `REFUND_AUTO_CONVERGE_ENABLED=true` 时，定时任务每 10 分钟对 pending 退款向渠道查证收敛（查证成功补完成、明确失败回滚、查无此单同号重发）。已开启 → 等一个周期后复查对账，多数 STUCK 自愈。
2. 未开启或未自愈：由运维持 admin 凭证对该订单**再次调用退款 API**（同号幂等，等价手动收敛）：
   - 返回成功 → 已收敛为 `refunded`，复查对账清零；
   - 返回 `REFUND_CHANNEL_FAILED` → 渠道明确拒绝，订单已回 `paid`；查明拒绝原因（审计 `refund.channel_error` 有渠道原始错误）后可同号重试；
   - 仍 pending → 渠道仍受理中或查证网络异常，记录后下一巡检周期复查；连续 24h 不收敛升级处理。
3. **禁止**：换 refundNo 重试；在商户平台手工发起同单退款（会与系统账本脱钩，制造 `ORDER_REFUNDED_WITHOUT_REFUND_ROW`）。

## 四、渠道失败分级处置

| 现象 | 系统行为 | 运营动作 |
|---|---|---|
| 明确失败（`REFUND_CHANNEL_FAILED`，审计 `refund.channel_error`） | `failed` + 订单回 `paid` | 看审计里渠道原始错误：余额不足→商户账户充值后同号重试；参数/权限类→核对商户后台退款权限后升级 |
| 结果不可知（审计 `refund.channel_ambiguous`） | `pending` + `refunding` | **不要当失败处理**，走 §三 收敛流程 |
| 渠道 CLOSED 通知 | pending/failed 单回滚 `paid`（审计 `refund.channel_error`，`REFUND_NOTIFY_CLOSED`） | 与用户确认是否重新发起 |

## 五、退款缺失排查树（用户称「没收到退款」）

先查该单状态与 Refund 记录（Admin 订单页当前只展示订单级 `refundedAt/refundReason`，Refund 明细与 `channelRefundNo` 需查询数据库只读副本或由开发协助查询），按三型分流：

- **A 型：本地有 Refund 且 `success`** → 渠道已确认退回。让用户核对原支付账户（微信零钱/银行卡到账有延迟）；仍未到账则用 `channelRefundNo` 在商户平台查退款单，向渠道客服追进度。
- **B 型：订单 `refunded` 但无 Refund 记录**（对账 `ORDER_REFUNDED_WITHOUT_REFUND_ROW`）→ 账实不符，多为绕过系统的手工操作造成。在商户平台按订单号查是否真实出款：已出款→补记事件说明留档；未出款→该单状态失真，升级处理，禁止再次直接改状态。
- **C 型：本地 Refund 停 `pending`，商户平台查无此退款单** → 原请求可能从未到达渠道。同号再次调用退款 API（系统会查证 unknown 后**同号重发**），成功后复查对账。
- 收到「未知退款单」告警（`REFUND_NOTIFY_UNKNOWN_REFUND`）：系统已拒绝且不改任何本地单；若频繁出现，核对是否有人在商户平台手工退款（回归 B 型）。

## 六、FREE_MODE → 付费模式切换前置检查（决策：首台试运营用 FREE_MODE）

切换到 live 付费模式前，逐项确认：

1. `docs/operations/print-rollout-deployment-matrix.md` 付费模式门禁全项通过（`PAYMENT_PROVIDER` 真实通道、`PRINT_REQUIRE_PAID_BEFORE_CLAIM=true`、正式价目）。
2. `REFUND_AUTO_CONVERGE_ENABLED=true` 已在生产 env 显式开启（注意：收敛任务**仅在扫到 pending 退款时输出日志**，空闲期无日志属正常，不能以"无日志"判定未生效；可用一笔受控 pending 单验证）。
3. 本 SOP 已指派到具体值守人；对账巡检从「每日」起步。
4. 1 分钱 live 冒烟：支付 → 退款 → 退款回调 → 对账无差异，并在 `docs/progress/` 留正式验收记录；换环境/换凭证后须重做。
5. 商户平台退款权限、可用余额、回调 URL（https 公网 `PAYMENT_NOTIFY_BASE_URL`）复核；密钥按 `docs/device/secret-rotation-runbook.md` 管理。

## 七、留档要求

每次异常处置在工单/运营记录中登记：orderId、refundNo、现象（差异码/用户反馈）、处置动作、结果、操作人。系统侧审计（`refund.created/processing/retried/blocked/channel_error/channel_ambiguous/notify_amount_mismatch`）已自动留痕，人工记录用于对外口径与复盘。
