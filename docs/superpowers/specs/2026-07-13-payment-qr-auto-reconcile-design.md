# 扫码支付自动确认设计

## 目标

用户扫屏上微信/支付宝收款码后，支付结果应自动进入打印；支付渠道回调延迟或丢失时，Kiosk 自动通过既有安全查单链路收敛结果，不要求用户手动点击“核实”。

## 事实与根因

- `PrintCashierPage` 每 2.5 秒调用 `getPayStatus`，该接口只读取本库 `Order` 与 `PaymentAttempt` 状态。
- 支付渠道回调成功时会写入本库，下一次轮询会自动进入打印。
- 当前屏上二维码尝试带有 `qrCodeContent`，前端条件明确排除了它的自动 `reconcilePayment`；只有付款码路径自动查单。
- 真实验收订单的审计记录为 `payment.attempt_created → payment.reconciled`，没有本候选库内的成功回调入账。因此用户点击手动核实后才会向渠道查单并进入打印。

## 方案比较

1. 推荐：扩展现有 Kiosk 自动查单条件，使所有真实、`pending` 的支付尝试（含屏上二维码）按现有 3.5 秒节奏调用 `reconcilePayment`。
   - 复用既有支付会话鉴权、服务端 3 秒限流、金额/流水号校验、幂等入账和安全失败映射。
   - 浏览器只调用本系统 API，不直接访问支付渠道；支付回调仍是首选低延迟路径。
2. 不采用：在 `GET /orders/:id/pay-status` 内直接查渠道。
   - 会把原本只读的轮询端点变成渠道侧副作用，难以控制调用频率。
3. 不采用：为二维码新增分钟级 cron。
   - 无法满足付款后立即进入下一步的交互预期，且会引入重复的收敛机制。

## 设计

### 前端行为

`PrintCashierPage` 将付款码专用的 `CODE_PAY_RECONCILE_INTERVAL_MS` 和 `lastCodePayReconcileAtRef` 改为支付方式无关的命名。每轮状态查询后，只要满足以下条件就调用现有 `reconcilePayment`：

- 订单尚未 `paid`；
- 最新尝试为 `pending`；
- 通道不是 `sandbox`；
- 距前一次自动查单至少 3.5 秒。

不再以 `qrCodeContent` 排除屏上二维码。调用成功后按返回的真实 `PayStatusView` 更新页面：`paid` 立即 `proceedToPrint()`；渠道返回 `closed` 或 `failed` 时，既有服务端逻辑将尝试标记失败，既有 `deriveCashierView` 显示“支付未完成”并允许重新出码。

手动“点此核实”保留为网络异常或可见状态延迟时的显式兜底，不再是正常支付的必经步骤。

### 后端与安全边界

不新增 HTTP 端点、不改 `Order` / `PaymentAttempt` 模型、不降低回调验签或 payment-session token 要求。继续使用：

- `OnlinePaymentService.reconcilePayment` 的 payment-session token 校验；
- 每订单进程内 3 秒最小查单间隔；
- `PaymentProvider.queryPayment` 的渠道账本结果；
- 金额、渠道流水号与订单快照一致性校验；
- `handleSuccess` 的幂等入账路径；
- `SAFE_FAIL_TEXT`，不向用户暴露渠道原始错误。

### 部署边界

代码兜底可消除“必须手点核实”的用户阻塞，但不能替代正确的异步回调部署。2026-07-13 只读复核当前运行服务器：`PAYMENT_NOTIFY_BASE_URL=https://zyidai.cn`，该域名解析到当前服务器，HTTPS `/api/v1/health` 返回 `db=postgres`；这不等同未来候选部署自动继承同一一致性。该环境变量必须在部署时指向同一候选 API 实例实际承接的稳定 HTTPS 回调域名；新支付尝试才会携带新通知地址。此配置不写入 Git、不复制密钥，部署前必须做域名、nginx、PM2 实例和数据库归属复核。

## 验收标准

1. 静态回归门禁明确要求真实 `pending` 的屏上二维码也走自动查单，禁止恢复 `!qrCodeContent` 排除条件。
2. 现有付款码自动查单、支付会话鉴权、服务端限流与沙箱隔离继续通过。
3. 真实支付回调正常时，Kiosk 仍由 `getPayStatus` 自动跳转；回调缺失时，自动查单在安全限流下把已付款订单推进至打印。
4. 渠道明确关闭/失败时，界面显示既有失败状态并允许重新出码，绝不伪造已支付或放行打印。
5. 部署后以新订单完成一次“付款不点核实 → 自动进入打印 → 真实出纸”的现场验收；该验收与本地代码验证分别记录。

## 不在范围内

- 不新增支付通道、退款入口、订单状态、后台任务、数据库迁移或依赖。
- 不把支付渠道密钥、回调 URL 或真实流水号写入源码、测试或文档。
- 不对当前订单重放付款或改变任何真实订单状态。
