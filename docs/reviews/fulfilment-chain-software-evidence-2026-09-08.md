# 履约链路软件侧证据（2026-09-08）

## 为什么做这件事

`docs/progress/current-progress.md` 2026-09-07 条目记载：生产已开通
`PAYMENT_PROVIDER=alipay,wechat`，**「线上自此会真实收款」**。而同一份文档里几乎每条
功能记录都以「未部署、未真机」结尾。

**在收钱，而履约链路没有当场证据** —— 这是本轮走查里优先级最高的一条，四家 CLI 评审
中由 grok 提出，事实经本文核实属实。

本文补的是**软件侧**证据：除了「纸真的从打印机里出来」之外的每一环，都用真实 HTTP
请求跑通并留下可复核的返回。**真机出纸仍未验证，本文不构成生产 GO。**

## 边界

| 项 | 状态 |
|---|---|
| 环境 | 本地 API（SQLite 隔离库 `verify-walkthrough.db`），非生产 |
| 支付 | 订单支付态由 SQL 直接置为 `paid` 模拟；**未走真实渠道回调** |
| 打印机 | 无真机，Agent 行为由真实 HTTP 请求模拟（认证与状态机是真的） |
| 结论适用范围 | **LOCAL SOFTWARE GO**，不是 STAGING GO，更不是 PRODUCTION GO |

## 走通的链路（29 步，全部真实请求）

### 建单
1. 会员短信登录（协议版本强校验、限流生效）
2. 上传 3 页 PDF：`upload-intent` → 签名 PUT → `complete`
3. 打印隐私检查 `pii_scan` → `completed`
4. `POST /me/print-orders` → 订单 `ORD-20260908-323383062A`，**金额 90 分 = 3 页 × 30 分**，
   价目行明细完整（`print_bw_page`）
5. 到机码 `45329523`，未付款即可见，`taskStatus=pending_release`
6. `GET /me/print-orders/cloud` 能看到该单（**对照**：材料包多文件订单看不到，见 #962）

### 到机核销
7. `POST /print/jobs/claim-pickup` + `x-terminal-id` → `released:false` + 金额明细 +
   付款会话令牌 —— **未付款不放行，先进收银**
8. 不带 `x-terminal-id` → `TERMINAL_ID_REQUIRED`
9. 心跳超过 5 分钟 → `PRINT_TERMINAL_NOT_READY`（实测：心跳过期一小时时被挡）
10. 错误到机码 → 同样先撞终端就绪检查，**不泄漏码是否存在**

### 放行闸门（三道，全部拦对）
11. 未付款 + 有效令牌 → `ORDER_NOT_PAID`
12. 已付款 + 无令牌 → `PAYMENT_SESSION_REQUIRED`
13. 已付款 + 有效令牌 + **换一台终端** → `PRINT_TERMINAL_NOT_FOUND`
14. 已付款 + 本机 + 有效令牌 → `released:true`，建出 `ptask_pickup_d2b128dee54e7ba7`
15. **幂等**：重复放行返回同一个 taskId，未重复建任务

### Agent 领任务
16. 无 Authorization → `AUTH_TOKEN_INVALID`
17. 错误 agentToken → `AUTH_TOKEN_INVALID`
18. 正确 agentToken → 领到任务，载荷含签名限时 `fileUrl`、`fileMd5`、
    带 nonce 与过期时间的 `actionToken`、`claimExpiresAt` 租约、完整打印参数
19. **租约生效**：租约未到期时再次 claim 返回空，任务不重复派发

### 文件取用（这一环最关键，直接关系用户材料安全）
20. 签名 URL 取回 1161 字节，**sha256 与任务声明的 `fileMd5` 逐字节一致**
21. 篡改 `sig` → **401**
22. 换 `fileId` → **401**
23. 去掉签名裸取 → **401**

### 状态回报
24. 无认证上报 → `AUTH_TOKEN_INVALID`
25. 用本机 token 但 `x-terminal-id` 写成另一台 → `TERMINAL_NOT_REGISTERED`
26. `printing` → `acknowledged:true`
27. `completed` → 订单 `taskStatus=completed`，`PrintTask.completedAt` 落库
28. 用户侧 `GET /me/print-orders` 返回该单：状态 completed、金额 90、支付 paid、
    计费页数 3、页数来源 `pdf_lightweight_scan`、`refundedAmountCents:0`、
    `refundRequired:false`

### 异常与保护
29. **退款闸门**：订单置 `refunded` 后凭码核销 → `ORDER_REFUNDED`，文案
    「本单已退款，不再出纸。款项按原路退回，可在小程序『我的 → 打印订单』查看退款进度。」
30. **过期到机码** → `PICKUP_CODE_EXPIRED`「到机码已过期，请在小程序重新下单」
31. **重复核销已完成的单** → 返回同一 taskId 且状态 completed，**该订单全程只有 1 个
    PrintTask**（无双重出纸风险）

## 审计留痕

`AuditLog` 覆盖：`member.print_order.create`、`print_order.pickup_claim`（含失败尝试）、
`print_order.release`、`file.direct_upload_completed`、`auth.password_login`、
`member.package_order.create` 等。

**未进 AuditLog 的**：Agent 上报的 `printing` / `completed` 状态变更。这两个状态记在
`PrintTask` 行上（`status` / `completedAt`），不是管理员操作，按 CLAUDE.md §12
「所有管理员操作记录日志」的口径不算缺口，但如果将来要做「谁在什么时候打了什么」的
运营核查，需要另外落表。

## 仍未验证（真机清单）

以下每一条都**必须在 Windows 一体机 + 奔图真机上实做**，软件侧证据不能替代：

1. Agent 拿到签名 `fileUrl` 后能真的下载并交给本地驱动
2. 打印参数（份数 / 黑白 / 单双面 / A4）真的作用到出纸
3. 出纸失败时 Agent 上报 `failed`，用户侧看到的是失败而不是完成
4. 断网后重连，租约过期的任务被重新派发且不重复出纸
5. 真实支付渠道回调（本文用 SQL 模拟了 `paid`）
6. 退款后真机确实不出纸（本文只验到接口层拒绝）

对应清单：`docs/device/production-deployment-and-windows-host-checklist.md`。

## 结论

**LOCAL SOFTWARE GO / PRODUCTION NO-GO。**

软件侧履约链路完整且各道闸门 fail-closed，未发现缺陷。阻塞生产 GO 的是上面 6 条真机
验证 —— 在收款已经开通的前提下，这 6 条应当优先于任何新功能。
