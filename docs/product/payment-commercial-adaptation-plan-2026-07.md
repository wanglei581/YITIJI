# 支付域商用化适配方案与开发计划（2026-07-06）

> 定位：`docs/product/payment-domain-c5-plan-2026-07.md`（§⓪ 为波次/命名权威口径）的**商用收口延续篇**。
> 本文档回答三件事：① 仓库里有没有第二套支付功能、会不会打架；② 支付模块的目标架构与边界；
> ③ 扫码器收款适配 + 达到「真实可用」商用标准还差什么、按什么顺序做。
> 合规上位：`docs/compliance/compliance-boundary.md` §8.4/§8.5/§8.7 + CLAUDE.md §12。
> 铁律沿用：一窗口=一任务=一分支、一波一 PR、先写范围/文件预算再动代码、双模型审查、verify 进双 CI。

---

## 一、全仓支付能力盘点：有没有第二套支付？

**结论：没有第二套支付闭环。全仓只有一套资金账本（C5 支付域：`Order` / `PaymentAttempt` / `Refund` / `RedemptionRecord` / `PriceConfig`）。** 2026-07-06 全仓扫描（`支付/收款/付费/充值/购买/计费/amountCents/markPaid/payStatus` 关键词 + 逐文件核对）触点全表：

| 触点 | 性质 | 与支付域关系 | 打架风险 |
|---|---|---|---|
| `services/api/src/payment/`（C5-1~C5-6） | **资金 SSOT** | 本体 | — |
| `markPaid`（offline / free / manual_confirmed，P0a） | 非线上入账 | 同一 Order 状态机的三条法定路径 | 无（白名单互斥） |
| `markPaidByRedemption`（voucher，C5-4） | **非资金**核销入账 | 唯一写 voucher 的路径，账本=既有 `RedemptionRecord` | 无 |
| 会员权益 `BenefitGrant` / benefit-activities | 平台 credit，非资金 | 经核销路径接入订单抵扣 | 无 |
| `admin-orders-readonly` / Admin `/orders` | 只读消费 | 读 Order 支付字段 | 无 |
| `member-print-orders`（/me 打印订单） | 只读消费 | 读 Order 支付字段 + pickupCode 可见性 | 无 |
| 政企版 E1「整机免费模式」（gov-enterprise-edition-design） | **配置形态** | 明确复用 C-5 `PriceConfig`（billingEnabled=false → 免费单照常落库） | 无（设计即复用） |
| print-scan-commercial-plan 的「Order 统一壳」 | 规划 | 同一张 Order 表扩 type，非新账本 | 无 |
| Kiosk 文案类命中（百宝箱安全提示 / 帮助中心 / 智慧校园「圈存充值」介绍 / 扫码登录注释） | 纯文案 | 无代码路径 | 无 |

### 真实发现的 3 个漂移/冲突点（须处置）

| 编号 | 问题 | 影响 | 处置 |
|---|---|---|---|
| **P1（商用阻塞）** | `PrintPreviewPage.tsx` 与 `PrintConfirmPage.tsx` 各自硬编码 `PRICE_BW=0.2 / PRICE_COLOR=0.5`，与服务端 `PriceConfig` 是**两套价格真相源**。收银页/实际扣款用服务端价（正确），但预览/确认页展示价是前端常量 —— Admin 一旦改价（C5-7 计费配置页上线后必然发生），用户看到的价格 ≠ 实际扣款价，属价格欺诈级投诉风险；政企 E1 免费模式也要求前端价格 UI 全由服务端配置驱动，当前做不到 | 高 | **W-A 波修复**（见 §四） |
| P2（低危） | `print-jobs/print-pricing.ts` 的 `PRINT_UNIT_PRICE_CENTS` 常量：当前仅作 `price-config.seed` 的开发默认价来源，可接受；但它是第二份单价常量，长期有被误引用的风险 | 低 | W-A 内加注释声明「仅 seed 可引用」，前端守卫禁止引用；运行期真相源唯一=PriceConfig |
| P3（文案同步） | 帮助中心等文案写「不承诺尚未实现的功能（套餐、支付…）」——C5-6 合入且 live 冒烟通过后，「支付」不再是未实现能力 | 低 | live 冒烟通过后随 W-F 文档收口更新文案 |

> 另核对：Kiosk「扫码登录」（ScanQrLoginPanel）是**手机扫屏上二维码**登录，与扫码器（读码硬件）无关；
> 智慧校园「自助圈存与充值」是对校园卡系统能力的**介绍文案**，不是本终端的支付功能。

---

## 二、支付模块目标架构与边界

### 2.1 分层（现状即目标，C5-6 后已成形）

```text
┌─ 消费侧 ─────────────────────────────────────────────────────┐
│ Kiosk 收银页(通道选择/QR/reconcile)   /me 打印订单(只读)      │
│ Admin 订单(只读+mark-paid/refund)     对账页(C5-7)            │
├─ 门禁层 ────────────────────────────────────────────────────┤
│ payment-session-token(出码/查单授权)                          │
│ paid-before-claim(terminals.claimTasks 服务端过滤)            │
│ production-runtime-gates(启动期 fail-closed)                  │
├─ 业务编排 ──────────────────────────────────────────────────┤
│ OnlinePaymentService: 出码/回调(验签→防重放→全字段匹配→      │
│   金额三方比对→幂等入账)/pay-status/reconcile 主动查单        │
├─ 资金状态机（入账唯一路径表）───────────────────────────────┤
│ OrderStatusService.markPaid            ← offline/free/manual  │
│ OrderStatusService.markPaidOnline      ← sandbox/wechat/alipay│
│ OrderStatusService.markPaidByRedemption← voucher              │
│ RefundService（Refund 账本 + refundNo 幂等）                  │
├─ 渠道协议层（Provider 注册表，fail-closed 工厂）─────────────┤
│ SandboxPaymentProvider │ WechatPayProvider │ AlipayProvider   │
│ （C5-8 扩 payByAuthCode/cancelPayment 付款码收款接口）        │
└─ 数据底座：Order/PaymentAttempt/Refund/RedemptionRecord/     │
   PriceConfig + AuditLog（全部动作可审计）────────────────────┘
```

### 2.2 十条硬性不变量（所有后续波次不得回退）

1. **入账唯一路径表**：每种 `paymentSource` 只有一个写入方法（上图状态机层）；任何新收费场景不得新增第四条入账路径。
2. **金额一律整数「分」**；渠道元串换算只走字符串拆解（`yuanToCents`），绝不浮点。
3. **验签先于一切解析**；回调金额必须与 attempt 快照、Order 应付三方一致，缺一即拒。
4. **支付域绝不改 `PrintTask.status`**；打印域只读 `Order.payStatus`（claim 门禁在服务端）。
5. **密钥只存服务端 env**（内联 PEM/文件路径）；仓库/前端/Kiosk/Agent/聊天零凭证；错误信息不回显密钥或路径内容。
6. **fail-closed**：通道缺配置拒启动；生产禁 sandbox；`PRINT_REQUIRE_PAID_BEFORE_CLAIM` 生产必须显式声明，启用真实通道强制 true。
7. **幂等三件套**：`(channel, channelTxnNo)` 唯一入账、`refundNo` 唯一出款、nonce/notify_id 防重放；回调/查单/退款重试永不重复副作用。
8. **全动作审计**：入账/退款/核销/reconcile/改价（C5-7）都写 AuditLog，迟到入账带 `late` 标记。
9. **单一价目表 `PriceConfig`**；前端展示价必须来自服务端（W-A 落地后），不得再有第二份价格常量被业务引用。
10. **合规文案红线**不变：不伪造支付成功、测试通道明示、退款不承诺时效、无招聘闭环文案。

### 2.3 支付入口统一规则（防「第二套支付」再生）

未来任何新收费点（AI 付费点、求职材料包、政企按量计费、复印/扫描收费）**必须**：建 `Order`（type 区分业务）→ 走 `PricingService` 报价 → 走本支付域收款/核销 → paid 后放行履约。禁止新建计费表、直连渠道 SDK、前端算价收款。此规则写入 CLAUDE.md 级约束由 verify 静态守卫（W-A 扩展 `verify:pricing` 断言全仓无第二个渠道 SDK 引用/无硬编码价格）兜底。

---

## 三、扫码器收款（B扫C 付款码）完整适配方案

> 前置：`docs/device/scanner-payment-code-probe.md`（探测步骤/安全红线/立项决策门）。
> 本节是探测**通过后**的实现设计（波次 W-E / C5-8）；探测不通过则维持屏幕动态码单方案，本节不实施。
> 注意扫码器是多用途设备：政企版规划中还承担「电子社保卡二维码登录核验」——输入路由必须按页面态分发。

### 3.1 设备接入层（Kiosk，浏览器内）

- 新增 `useScannerInput` hook：全局 `keydown` 缓冲捕获（HID keyboard-wedge 模式），按**速率特征**（字符间隔 < 50ms、以回车结尾、长度 ≥ 8）判定为扫码输入而非人工键入；支持可配置前后缀剥离。
- **页面态路由**：捕获结果按当前路由/状态分发——收银页「出示付款码」态 → 付款码处理器；登录页扫码核验态（政企）→ 登录处理器；**其余页面一律丢弃**（防扫码注入）。
- 不依赖输入框焦点（Kiosk 触控场景焦点不可靠）；捕获期间阻止默认输入落入任何表单控件。

### 3.2 Kiosk 收银页「出示付款码」模式

- 收银页在通道选择区增加「出示付款码」入口（探测通过 + 服务端开关 `PAYMENT_AUTH_CODE_ENABLED=true` 双门控才渲染）。
- 用户点击 → 全屏引导「请将手机付款码对准扫码口」→ 扫码器读码 → 前端**格式预检**（18 位纯数字，10-15/25-30 前缀路由 wechat/alipay）→ HTTPS 提交 `POST /orders/:id/pay/auth-code`（携带 payment session token）→ 展示「支付确认中」轮询 pay-status。
- **付款码在前端内存即用即弃**：不进 state 持久层、不落日志、失败错误码不回显码值。

### 3.3 服务端（Provider 接口扩展 + 同步扣款状态机）

- `PaymentProvider` 增可选接口：
  - `payByAuthCode?(input: { attemptId; orderId; orderNo; amountCents; authCode }): Promise<{ status: 'paid'|'paying'|'failed'; channelTxnNo }>`（微信付款码支付 / 支付宝当面付 `alipay.trade.pay`；渠道产品需商户平台单独开通）
  - `cancelPayment?(attemptId)`（微信撤销 / 支付宝 `alipay.trade.cancel`，仅付款码路径的超时兜底用）
- `PaymentAttempt` additive 增列 `method: 'qr' | 'auth_code'`（默认 qr，不动既有语义）。
- 状态机：同步返回 paid → 走既有 `handleSuccess` 幂等入账；返回 paying（USERPAYING，用户需在手机输密码）→ 服务端以 `queryPayment` 轮询收敛（最长 60s）；超时/失败 → 调 `cancelPayment` 撤销并置 attempt failed（**绝不把待确认态标 paid**）。
- 服务端二次校验：付款码格式、通道路由与已启用通道一致、订单态门（unpaid/paying）、金额取服务端快照。
- 授权码是敏感支付凭证：**不落库、不进审计 payload、不进错误信息**；审计只记 attemptId/orderId/结果。

### 3.4 验收门禁

- 沙箱先行：sandbox provider 扩 `payByAuthCode` 模拟三态（paid/paying→paid/failed），`verify:payment-auth-code` 覆盖：格式拒绝 / USERPAYING 收敛 / 超时撤销 / 幂等 / 不落日志断言（grep 审计与日志输出无码值）/ claim 门禁不变。
- 真机四条件（probe 文档决策门）全满足 + 商户开通付款码产品，才接真实渠道。

---

## 四、商用化差距清单 → 开发计划（波次表）

> 现状基线：C5-6 已完成（PR #169，双 CI 绿，双模型安审闭环）。以下为达到「真实可用」还需的全部波次。
> 每波独立分支、一波一 PR、开工前按 CLAUDE.md §8.1 写范围声明。

| 波次 | 目标 | 主要范围（允许文件域） | verify 门禁 | 验收标准 | 前置 |
|---|---|---|---|---|---|
| **W-A（C5-6c）价格真相源统一** | 消灭 P1/P2 冲突 | 新增公开只读 `GET /print/price-config`（active 价目，无敏感字段）；Preview/Confirm 改从服务端取价渲染，取价失败 fail-closed 显示「价格暂不可用」并禁止下单（**不回退硬编码**）；删除两页 `PRICE_BW/PRICE_COLOR` 常量；`print-pricing.ts` 注明仅 seed 可引用；预留 `billingEnabled`（政企 E1）字段位 | 扩 `verify:pricing`（端点契约）+ 新 kiosk 守卫（全仓禁止硬编码单价/禁止第二渠道 SDK） | Admin 改价后预览/确认/收银三处展示价与扣款价一致 | PR #169 合入 |
| **W-B（C5-6b）真实渠道退款** | 收真钱前的合规硬前置：wechat/alipay 订单可原路退回 | `WechatPayProvider.refund`（`/v3/refund/domestic/refunds` + 退款结果通知/查单）、`AlipayProvider.refund`（`alipay.trade.refund` 同步）；`RefundService.PROVIDER_REFUND_CHANNELS` 扩 wechat/alipay；`out_refund_no=refundNo` 幂等；退款中间态收敛（pending→success/failed 接渠道真实结果，失败回 paid 可重试）；仍不接部分退款（partial 预留不变）、仍不恢复 BenefitGrant | 新 `verify:refund-real-channels`（本地密钥模拟渠道侧，覆盖幂等/金额/回调验签/失败回滚）+ 既有 refund-idempotent 回归 | Admin 对 wechat/alipay paid 单发起退款 → 渠道退款单创建 → 状态落 refunded，重复请求幂等 | PR #169 合入 |
| **W-C（C5-7）对账 + Admin 计费** | 钱账可对、价格可管 | ① 本地对账：Order/PaymentAttempt/Refund ↔ AuditLog 交叉核对报表（含 `late`/reconcile 单专项清单）；② 渠道对账单拉取（wechat `tradebill` / alipay 对账单接口）与本地账本 diff；③ Admin `PriceConfig` 管理页（改价审计 `price.updated`）+ 订单页金额/支付状态/退款动作接真 | 新 `verify:admin-billing` + `verify:reconciliation` | 任取一天：渠道账单金额 = 本地 paid-refunded 净额；改价留审计且前端价格同步（依赖 W-A） | W-A、W-B |
| **W-D 部署运维线（与 W-B/W-C 并行）** | live 支付的环境前置 | ① https：域名备案/解析 + nginx 证书 → `PAYMENT_NOTIFY_BASE_URL`；② 商户侧：微信 Native + APIv3（公钥模式）/ 支付宝当面付产品开通与费率确认；③ 凭证注入 runbook（沿用 `docs/device/secret-rotation-runbook.md` 口径：只进服务器 env，配置过程不回显）；④ 生产 env 清单更新（`PRINT_REQUIRE_PAID_BEFORE_CLAIM=true` 等）；⑤ 多实例前 Redis 化限流/防重放（单实例期可缓） | `verify:production-runtime-gates`（已有）+ 部署清单逐项签收 | 服务器可接收渠道回调（https 可达、验签通过） | 无（运维线） |
| **W-E（C5-8）扫码器付款码收款** | §三方案落地 | 见 §3.1–3.4；探测门（probe 四条件）通过才开工 | 新 `verify:payment-auth-code` | 真机：手机出示付款码 → 扫码 → 支付成功出纸；USERPAYING/超时/撤销路径真机复验 | 真机探测通过 + 商户开通付款码产品 + W-D |
| **W-F（C5-9）商用验收** | 「真实可用」终验 | 1 分钱 live 冒烟（wechat/alipay 各：下单→支付→回调入账→出纸→退款到账）；异常矩阵演练（断网重连/回调丢失走 reconcile/重复回调/超时关单/迟到支付 late 入账/打印失败人工退款）；帮助中心等文案同步（P3）；docs/progress + 部署清单收口 | 全量 verify 双 CI + `production-acceptance-verify-runbook` 扩支付节 | §五 DoD 全项打勾 | W-A~W-D（W-E 可选） |

**推荐执行顺序**：PR #169 合入 → W-A（小波，1 个窗口）→ W-B 与 W-D 并行 → W-C → W-F；W-E 独立按探测结论择期。

---

## 五、「真实可用」商用验收标准（DoD）

### 资金正确性
- [ ] 展示价 = 报价 = 扣款额 = 渠道账单额（分级一致，改价后仍一致）
- [ ] 同一渠道流水号在任何重试/并发下只入账一次；同一 refundNo 只出款一次
- [ ] 渠道日账单与本地账本 diff 为零（或每笔差异有审计解释：late / reconcile / 人工单）

### 安全
- [ ] 伪造/篡改/重放/跨商户/过期回调 100% 被拒且订单不动（verify 覆盖 + live 抽测）
- [ ] 服务器外零密钥存在点（仓库/前端产物/日志 grep 复核）
- [ ] 未支付订单在任何路径下（含 Agent 伪造上报）不可出纸

### 可用性与异常恢复
- [ ] 回调丢失时用户可经「点此核实」在 ≤10s 内完成入账并出纸
- [ ] 断网恢复后：pending 回调由渠道重试补齐或 reconcile 补齐，无卡死订单
- [ ] 支付超时自动关单，用户可重新发起；迟到支付入账且带 late 审计可退款处理
- [ ] 打印失败的已付订单：Admin 可当日退款，用户可在 /me 看到退款状态

### 合规
- [ ] 无「一键投递」等禁用文案；测试通道绝不出现在生产；免费单照常落库（政企 E1 口径）
- [ ] 退款/收费规则在收银页可见；不承诺未实现能力（P3 文案同步完成）

### 运维可观测
- [ ] 支付失败/回调验签失败/对账差异有日志与审计可查（不含敏感原文）
- [ ] 密钥轮换 runbook 演练过一次；生产 env 清单与实际一致（双人复核）

---

## 六、风险与依赖

| 风险 | 影响 | 缓解 |
|---|---|---|
| 商户资质/产品开通周期（Native、当面付、付款码、退款权限、费率） | W-D/W-F 排期 | 尽早启动商户平台申请；沙箱/本地密钥模拟先行（代码不阻塞） |
| https 域名备案周期 | 回调不可达 → live 全线阻塞 | 与商户申请并行；备案期间可用已备案域名子域过渡 |
| 微信「公钥模式」为当前实现（新商户默认）；老商户「平台证书轮换」模式暂不支持 | 若商户号为老模式需补实现 | 商户开通时确认模式；如需平台证书模式，在 W-D 增补证书下载/轮换实现（provider 内已留 Serial 校验位） |
| 限流/防重放为进程内存态 | 多实例部署弱化（非资金风险） | 单实例 PM2 期可接受；扩实例前完成 Redis 化（W-D ⑤） |
| 付款码产品的真机不确定性（扫码器读屏能力） | W-E 可行性 | 探测决策门前置，不通过则不投入 |
| 部分退款未实现（partial 预留） | 个别客诉场景只能全额退 | 商用初期以全额退款 + 线下补差处理；需求确认后另立波次 |
