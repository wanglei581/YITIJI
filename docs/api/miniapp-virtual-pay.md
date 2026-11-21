# 微信小程序虚拟支付接口契约（一期 + 二期）

本文件面向小程序端、一体机端与管理员后台接线。价格与微信道具 ID 不写进仓库，均由管理员后台在运行时配置并落入 `PlatformSetting`。总开关与收费开关默认关闭。

服务种类白名单（`serviceKind` / `serviceKey`）：
- `resume_optimize`：AI 简历优化（单次）
- `mock_interview`：AI 模拟面试（单次）

扫描（`scan`）与打印不走微信小程序虚拟支付。

---

## 一、会员端接口（小程序用）

全部需要会员登录态：`Authorization: Bearer <enduser JWT>`（`EndUserAuthGuard`）。未登录或会话失效返回 `401`（`MEMBER_MISSING_TOKEN` / `MEMBER_TOKEN_INVALID` / `MEMBER_SESSION_EXPIRED` / `ACCOUNT_UNAVAILABLE`）。

### 1. 下单并获取虚拟支付签名

`POST /api/v1/member/virtual-pay/orders`

请求体：
```json
{
  "serviceKind": "resume_optimize",
  "code": "<本次付款前刚调用 wx.login() 获取的临时登录 code>"
}
```

成功返回（`201`）：
```json
{
  "outTradeNo": "vp0123456789abcdef01234567",
  "signData": "{\"offerId\":\"...\",\"buyQuantity\":1,\"env\":0,\"currencyType\":\"CNY\",\"productId\":\"...\",\"goodsPrice\":100,\"outTradeNo\":\"vp...\",\"attach\":\"resume_optimize\"}",
  "paySig": "<64位十六进制>",
  "signature": "<64位十六进制>",
  "mode": "short_series_goods"
}
```

前端调用 `wx.requestVirtualPayment` 注意事项（官方核对表）：
- `signData` 必须是服务端返回的**原样 JSON 字符串**，严禁 `JSON.parse` 后重新序列化（会破坏 `paySig` / `signature` 签名字节一致性）。
- `wx.requestVirtualPayment` 基础库 `2.19.2` 起支持，不支持 Promise 写法，须使用回调写法（`success` / `fail`）。
- 支付成功以后端发货推送（`xpay_goods_deliver_notify`）与每 5 分钟兜底查单为准，前端 `success` 回调可能丢失，付后可轮询 `GET /api/v1/member/service-credits` 刷新权益。
- 失败错误体：`{ "error": { "code": "...", "message": "..." } }`：
  - `400 VPAY_SERVICE_KIND_INVALID`：非 `resume_optimize` / `mock_interview`
  - `401 WX_CODE_INVALID`：`wx.login` code 无效或已过期
  - `403 VPAY_DISABLED`：虚拟支付开关或个人收费总开关未开
  - `409 VPAY_OPENID_MISMATCH`：当前微信 openid 与登录会员不一致
  - `409 VPAY_GOODS_UNCONFIGURED`：后台尚未配置该项道具或单价
  - `502 WX_CODE2SESSION_FAILED`：换码请求微信失败
  - `503 WX_CONFIG_MISSING` / `VPAY_CONFIG_MISSING` / `VPAY_SANDBOX_FORBIDDEN`：服务端未配齐或生产环境禁止沙箱

### 2. 查询本人可用权益

`GET /api/v1/member/service-credits`

- 无论虚拟支付开关是否关闭均正常返回 `200`（已购未用权益不因关开关消失）。
- 只返回本人 `status === 'available'` 的权益，按创建时间倒序；不含价格、道具 ID、openid 或他人权益。

成功返回（`200`）：
```json
{
  "items": [
    {
      "serviceKind": "resume_optimize",
      "createdAt": "2026-11-21T10:00:00.000Z"
    }
  ]
}
```

---

## 二、一体机权益核销接口（Kiosk 用）

### 1. 原子核销小程序已购权益

`POST /api/v1/kiosk/service-orders/redeem-credit`

鉴权与限流：
- 同时校验终端验签身份（`TerminalIdentityGuard`：`x-terminal-id` + `x-terminal-session-token`）与会员登录态（`EndUserAuthGuard`：`Authorization: Bearer <enduser JWT>`）。
- 终端限流：每终端每分钟 10 次。

请求体：
```json
{
  "serviceKey": "resume_optimize",
  "kioskSessionId": "<当前一体机使用周期 UUID>"
}
```

业务与并发约束：
1. `serviceKey` 仅允许 `resume_optimize` 或 `mock_interview`（`scan` 等返回 `400 VPAY_SERVICE_KIND_INVALID`）。
2. 若本机当前生效价 `effectiveCents <= 0`（公共就业点位、个人收费总开关关闭、机构承担或该项 0 元），返回 `409 SERVICE_FREE_ON_THIS_TERMINAL`，**绝不扣除任何权益**。
3. 事务内原子校验 `KioskSession` 未结束、未过期（`endedAt IS NULL AND isExpired = false AND expiresAt > now`）并借会话行锁串行化同会话并发请求：若本会话本项已有尚未占用的 `miniapp_credit` 已付单则拒扣第二张权益（`409 SERVICE_ORDER_IN_USE` 或无余量时 `409 VPAY_CREDIT_UNAVAILABLE`）；随后按 `createdAt ASC, id ASC` 条件 CAS 抢占本人 `status = 'available'` 且 `consumedAt = null` 的权益（跨会话 20 并发抢同一条权益严格 1 次成功、19 次 `409 VPAY_CREDIT_UNAVAILABLE`），同时在同一事务内创建 `ServiceOrder`（`provider: 'miniapp_credit'`, `amountCents: 0`, `status: 'paid'`）并写审计 `virtual_pay.credit_redeemed`。
4. 成功返回标准 `{ "success": true, "data": ServiceOrderView }`（与 `POST /api/v1/kiosk/service-orders` 同形），前端写入 `keepServiceTripOrder` 后即可携带 `x-kiosk-session-id` 与 `x-service-order-id` 发起 AI 优化或模拟面试，跳过每日免费次数限制。
5. **失败与离场自动退回（已完成单严禁退回）**：若该次 AI 简历优化或模拟面试失败且免费再试耗尽、用户离场未用（`onSessionEnded`）、取消关单（`close`）、机器中途改免费或后台退回卡单，服务端在单事务内带 `settledAt = null` 条件把未完成 `ServiceOrder` 置为 `refunded` 并将对应 `MemberServiceCredit` 原子退回 `available`（`consumedAt = null`, `consumedServiceOrderId = null`），写审计 `virtual_pay.credit_restored`，该权益可再次核销；一旦服务已成功完成（`settledAt != null`），任何迟到失败或退回调用均不改态、不退回权益。

错误码：
- `400 VPAY_SERVICE_KIND_INVALID` / `SERVICE_SESSION_REQUIRED` / `PRICE_CONFIG_INVALID`
- `401` 终端身份或会员登录态无效
- `409 SERVICE_FREE_ON_THIS_TERMINAL`（免费机不扣权益）
- `409 SERVICE_ORDER_IN_USE`（当前使用周期已核销过同项待用权益，防双击/并发双扣）
- `409 ACCOUNT_UNAVAILABLE`（会员不可用或注销中）
- `409 VPAY_CREDIT_UNAVAILABLE`（无可用权益或已被并发占用/退款锁定）

---

## 三、微信消息推送接收口（微信服务器回调）

- `GET /api/v1/wechat/miniapp/message`：微信公众平台消息推送 URL 验证（SHA1 验签后 `text/plain` 原样返回 `echostr`）。
- `POST /api/v1/wechat/miniapp/message`：仅接受安全模式（`msg_signature` SHA1 验签 + AES-256-CBC 解密 + 校验明文末尾 `AppID`），支持 XML 与 JSON 推送体；业务处理完成后返回 HTTP `200` 空串（等同 `ErrCode=0`）。
  - `xpay_goods_deliver_notify`：校验 `OutTradeNo` / `OpenId` / `Env` / `ProductId` / `Quantity === 1` / `ActualPrice === priceCents`，幂等标订单 `paid` 并记一条 `MemberServiceCredit`（支持已关单迟到到账补记，绝不解锁 `manual_review`）。
  - `xpay_refund_notify`：校验 `MchOrderId` / `WxOrderId` / `MchRefundId` / `RefundFee === priceCents`；`RetCode === 0` 时原子收敛订单与权益为 `refunded` 并记审计 `virtual_pay.refund_succeeded`；`RetCode !== 0` 时标 `refund_failed`、写诊断与告警、记审计 `virtual_pay.refund_failed`（不盲目解锁权益）。

---

## 四、管理员后台接口（Admin 用）

全部受 `JwtAuthGuard + RolesGuard` 保护，仅 `@Roles('admin')` 可访问；**所有响应绝不返回原始 `openId`**。

| 方法与路径 | 说明 |
|---|---|
| `GET /api/v1/admin/billing/miniapp-virtual-pay` | 读取总开关、是否可售、各服务道具配置与运行环境就绪态（`runtime: { ready, block, env }`，不含任何密钥） |
| `PUT /api/v1/admin/billing/miniapp-virtual-pay` | 切换总开关；`enabled: true` 必须带 `confirm: true` |
| `PUT /api/v1/admin/billing/miniapp-virtual-pay/goods/:serviceKind` | 配置单个服务道具 `{ productId, priceCents, confirm: true }`；`productId` 限 1–20 位 `[A-Za-z0-9_-]`，`priceCents` 整数分 `>= 1` |
| `GET /api/v1/admin/billing/miniapp-virtual-pay/orders` | 分页列表；支持 `status`、`serviceKind`、`outTradeNo`、`page`、`pageSize`（`1..50`）；返回 `{ items, total, pagination }` |
| `GET /api/v1/admin/billing/miniapp-virtual-pay/orders/:id` | 单笔详情（含权益状态、`wxOrderId`、`refundOrderId`、`wxRefundId`、`queryFailCount`、`lastDiagnosticReason`、`refundable`、`refundBlockReason`） |
| `POST /api/v1/admin/billing/miniapp-virtual-pay/orders/:id/refund` | 发起微信官方原路退款（`/xpay/refund_order`），body `{ confirm: true, reason? }` |
| `POST /api/v1/admin/billing/miniapp-virtual-pay/orders/:id/sync` | 单笔主动调微信 `query_order` 同步订单与权益状态 |

### 官方原路退款规则与约束
1. **退款条件**：仅允许 `VirtualPayOrder.status === 'paid'` 且 `MemberServiceCredit.status === 'available'`、会员未注销（`openId` 存在）、且支付时间在 365 天内（超过返回 `409 VPAY_REFUND_WINDOW_EXPIRED`，注销无 `openId` 返回 `409 VPAY_REFUND_OPENID_MISSING`）。
2. **渠道限制（iOS）**：iOS 订单苹果不支持开发者主动退款，需由用户向 App Store 申请。后台二次确认弹窗明确提示运营人员核实。
3. **先查后锁再调微信与参数冻结**：先调 `/xpay/query_order` 获取最新 `left_fee`（仅官方 `status === 8` 用户侧收款完成才收敛为 `refunded`；`status === 5` 商户侧扣款完成即便 `left_fee === 0` 也继续保持 `refunding`；`status === 6` 订单关闭绝不判退款成功）；随后在单事务内原子将 `MemberServiceCredit` 从 `available` 锁为 `refunding`（防在途并发核销），同时将订单置为 `refunding` 并冻结持久化 `refundOrderId`（`vpr` + 24 位十六进制）与 `refundReason`（含 `refund_reason` 枚举码）；最后调 `/xpay/refund_order`（`pay_sig` 签实际 JSON 字节，`refund_reason` 传字符串 `'0'`–`'5'`，`req_from` 按官方枚举传字符串 `'1'` 表示人工客服/后台退款）。对 `268490014` 或网络超时保持 `refunding` 且权益持续锁定，后续同单重试严格复发逐字节一致的请求参数。
4. **终态收敛与不解锁原则**：`/xpay/refund_order` 受理成功、返回 `268490014` 或发生网络超时均保持 `refunding` 且权益锁定；同步查单查到旧支付态 `2/3/4` 或商户扣款态 `5` 时**严禁**将订单改回 `paid` 或把权益解锁回 `available`。仅 `xpay_refund_notify`（`RetCode === 0`）或 `query_order` 官方 `status === 8`（用户侧收款完成）收敛为 `refunded`；`xpay_refund_notify`（`RetCode !== 0`）或 `query_order` `status === 7` 收敛为 `refund_failed`（严格从 `refunding` 单次转入、幂等不重复写审计，且保持权益锁定不自动解锁）。
