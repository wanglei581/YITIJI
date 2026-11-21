# 会员开票接口

给小程序用。一体机扫码填写走 `/api/v1/kiosk/invoice-sessions`，不在这里。小程序页面不在本包。开票码前缀是 `/k/i/`，不在微信「扫普通链接二维码打开小程序」已登记的 `/k/u/`、`/k/l/` 规则里。

本文只写路径、入参、返回、错误码和状态取值。不写价格。

会员编号只来自登录态。请求体里带了会员编号（或别的本文没写的字段），整单 400，`code` 为 `VALIDATION_FAILED`，不会采用。

## 登录

```
Authorization: Bearer <会员 token>
```

令牌 audience 为 `enduser`，并且 Redis 里仍有这次会话，账号也还可用。缺登录、令牌无效、会话失效、账号不可用的错误码与现有会员接口相同（会员守卫 `services/api/src/common/guards/end-user-auth.guard.ts`）：

| HTTP | code | message |
|---|---|---|
| 401 | `MEMBER_MISSING_TOKEN` | 缺少登录凭证 |
| 401 | `MEMBER_TOKEN_INVALID` | 登录已失效,请重新登录 |
| 401 | `MEMBER_SESSION_EXPIRED` | 会话已失效,请重新登录 |
| 401 | `ACCOUNT_UNAVAILABLE` | 账号停用、注销中或已注销。message 沿用会员守卫的现有原句，页面请按 code 显示本端自己的话 |
| 503 | `MEMBER_SESSION_STORE_UNAVAILABLE` | 登录状态暂时无法核验，请稍后重试 |

成功响应都是 `{ "success": true, "data": ... }`。失败响应是 `{ "success": false, "error": { "code", "message" } }`。

## 能不能开

与一体机扫码会话、后台标已开前的复核同一套判断：订单属于本人、已付、实付金额是正数、没有在途或成功的退款、没有未退回的申请。只看订单自己的事实（付款状态、实付金额、退款记录），不看终端现在绑的机构：终端改绑后，原先付过钱的单照样能开。公共就业点位永不收费，那里的订单实付是 0，按 `zero_amount` 开不了。

不能开时 `POST` 返回 409，`code` 为 `INVOICE_NOT_ALLOWED`，`message` 为下表对应句子。

| blockCode | message |
|---|---|
| `not_owner` | 这不是你的订单。 |
| `not_paid` | 没付成的单，开不了发票。 |
| `refunded` | 已退款的单，开不了发票。 |
| `refund_in_progress` | 退款还没完成的单，开不了发票。 |
| `partial_refund` | 部分退款的单，开不了发票。 |
| `zero_amount` | 这一单没有实付金额，开不了发票。 |
| `already_requested` | 这一单已经提交过开票申请。 |

订单不存在时按 `not_owner` 返回，不说明库里有没有这张单。

## GET /api/v1/me/invoice-orders

本人现在可以申请开票的订单，以及本人已经有开票申请的订单。别人的订单不出现。没付成、已退款、部分退款、退款还没完成、实付不是正数，并且还没有申请的，不出现。已经提交过、后来又不能开的，仍返回状态和原因。

分页读。查询参数：

| 参数 | 约束 |
|---|---|
| `limit` | 一页最多几张，整数 1–50，不传是 20 |
| `cursor` | 上一页返回的 `nextCursor`，原样带回；第一页不传 |

`limit` 不在 1–50、不是整数，或 `cursor` 不是本接口给出的，都是 400 `VALIDATION_FAILED`（英文 message，只供排错）。

`data` 是 `{ "items": [...], "nextCursor": "..." | null }`。`items` 按订单创建时间从新到旧，同一时刻服务单排在打印单前面。`nextCursor` 为 `null` 表示读完了；不为 `null` 时带上它读下一页，下一页也可能是空的。服务端每一页只批量读几次库，不对每张单逐个查。

`items` 每一项：

| 字段 | 取值 |
|---|---|
| `orderKind` | `print` 打印订单，`service` 服务单 |
| `orderId` | 订单编号 |
| `amountCents` | 整数，单位分。还没申请时按当前实付计算；已有申请时仍是按同一口径算出的实付，不是价目 |
| `canRequest` | 现在能不能再提交 |
| `blockCode` | 不能提交时的原因码，能提交时为 `null` |
| `blockMessage` | 上表对应的中文；能提交时为空字符串 |
| `invoiceStatus` | `none` 还没有申请；`submitted` 已提交；`issued` 已开；`returned` 已退回 |
| `requestId` | 已有申请时的申请编号，否则 `null` |

这张表不返回抬头、税号、邮箱。

## POST /api/v1/me/invoice-requests

入参：

| 字段 | 约束 |
|---|---|
| `orderKind` | `print` 或 `service` |
| `orderId` | 字符串，最长 80 |
| `titleType` | `personal` 个人，或 `company` 单位 |
| `title` | 个人写姓名，单位写单位名称。不能空，最长 80 个字 |
| `taxId` | 个人不填。单位填写统一社会信用代码，18 位，数字与大写字母，末位校验位要正确 |
| `email` | 接收电子发票的邮箱 |

成功时 HTTP 201（Nest `@Post` 默认），`data`：

| 字段 | 取值 |
|---|---|
| `id` | 申请编号 |
| `orderKind` | 与入参相同 |
| `orderId` | 与入参相同 |
| `status` | `submitted`（已提交） |
| `amountCents` | 这一次写入的实付金额快照，整数，单位分 |

抬头、税号、邮箱填错是 400，下表每一行都能经 HTTP 拿到（门禁 `verify:invoice-http` 逐条打过）。一体机手机填写页的提交口（`POST /api/v1/kiosk/invoice-sessions/:sessionId/submit`）回同样的码和句子：

| 情形 | code | message |
|---|---|---|
| `titleType` 不是 `personal` 或 `company`，或没传 | `INVOICE_TITLE_INVALID` | 抬头要选个人或单位。 |
| `title` 没传、不是字符串或只有空格 | `INVOICE_TITLE_INVALID` | 抬头。个人写姓名，单位写单位名称。 |
| `title` 去掉首尾空格后超过 80 个字 | `INVOICE_TITLE_INVALID` | 抬头请控制在 80 个字以内。 |
| 个人填了 `taxId` | `INVOICE_TAX_ID_FORBIDDEN` | 个人不用填税号。 |
| 单位没填 `taxId` | `INVOICE_TAX_ID_REQUIRED` | 单位请填写名称和统一社会信用代码。 |
| 单位的 `taxId` 不是 18 位或校验位不对 | `INVOICE_TAX_ID_INVALID` | 统一社会信用代码需为 18 位（数字与大写字母，末位校验位正确） |
| `email` 没传、超过 120 个字符或格式不对 | `INVOICE_EMAIL_INVALID` | 接收邮箱格式不对。电子发票发到这个邮箱。 |

`orderKind`、`orderId` 不合要求，或请求体带了本文没写的字段，是 400 `VALIDATION_FAILED`，`message` 是英文的字段说明，只供排错，页面不要直接显示。

同一订单已有未退回申请时，顺序再提交是 409，`code` 为 `INVOICE_NOT_ALLOWED`，`message` 为「这一单已经提交过开票申请。」两笔同时通过资格判断时，后写入的被唯一约束挡住，409，`code` 为 `INVOICE_ALREADY_REQUESTED`，句子相同。两种都只留下一条。

开出的是电子发票（普通发票）。个人不需要提供身份证号。本接口不收专用发票所需的地址、电话、开户行和账号。

## GET /api/v1/me/invoice-requests/:id

只返回本人的这一份。别人的申请，或编号不存在，都是 404，`code` 为 `INVOICE_REQUEST_NOT_FOUND`，`message` 为「没有找到这份开票申请。」

这组会员接口一体机带会员令牌也能调，而一体机永远不该拿到完整税号和邮箱，所以响应里没有完整的 `taxId`、`email`，只有打码后的 `taxIdMasked`、`emailMasked`；退回原因里抄到的邮箱和统一社会信用代码也按同样规则打码。完整值只在后台订单详情给管理员开票用。

`data`：

| 字段 | 取值 |
|---|---|
| `id` | 申请编号 |
| `orderKind` | `print` 或 `service` |
| `orderId` | 订单编号 |
| `titleType` | `personal` 或 `company` |
| `title` | 抬头 |
| `taxIdMasked` | 单位的统一社会信用代码，只留前 4 位和后 4 位，中间是星号，例如 `9100**********000N`；个人为 `null` |
| `emailMasked` | 接收邮箱，只留第一个字符和 `@` 后面的域名，例如 `f***@example.com`。按个人信息保留规则清掉后为 `null` |
| `amountCents` | 提交时的实付金额快照，整数，单位分 |
| `status` | `submitted` 已提交；`issued` 已开；`returned` 已退回 |
| `issuedAt` | 标已开的时间，ISO 8601；还没开是 `null` |
| `invoiceNo` | 发票号码，选填，没有是 `null` |
| `returnReason` | 退回原因；没退回是 `null`。里面的邮箱、统一社会信用代码已打码 |
| `createdAt` | 提交时间，ISO 8601 |

不返回操作人。

## 会员数据导出里的开票申请

本人申请「导出我的资料清单」时，导出包（`member-data-export-v1`）多一个分区 `sections.invoiceRequests`，是本人的全部开票申请，按提交时间从新到旧。每一项：

| 字段 | 取值 |
|---|---|
| `id` | 申请编号 |
| `orderKind` | `print` 或 `service` |
| `orderId` | 订单编号 |
| `titleType` | `personal` 或 `company` |
| `title` | 抬头。会员注销后，个人抬头是 `[已去标识]` |
| `taxIdMasked` | 与上面单条接口同样打码的统一社会信用代码；个人为 `null` |
| `emailMasked` | 与上面单条接口同样打码的接收邮箱；清掉后为 `null` |
| `amountCents` | 提交时的实付金额快照，整数，单位分 |
| `status` | `submitted`、`issued` 或 `returned` |
| `issuedAt` | 标已开的时间，没开是 `null` |
| `invoiceNo` | 发票号码，没有是 `null` |
| `returnReason` | 退回原因，其中的邮箱与统一社会信用代码已打码；没退回是 `null` |
| `createdAt` | 提交时间 |

不导出操作人。税号和邮箱只给打码后的样子，与会员接口同一口径。

## GET /api/v1/me/service-orders（自助开票二期）

会员侧 AI/扫描服务单只读列表，供一体机「我的订单」混排与开发票入口使用。受 `EndUserAuthGuard` 保护（401 错误码同上），响应头带 `Cache-Control: no-store`。

查询参数（多余参数 400 `VALIDATION_FAILED`）：

| 参数 | 约束 |
|---|---|
| `pageSize` | 正整数，不传默认 20，超过 50 封顶 50；非正整数返回 400 `VALIDATION_FAILED` |
| `cursor` | 上一页返回的 `nextCursor`，原样带回；非法游标返回 400 `VALIDATION_FAILED` |

数据范围：仅返回当前登录会员名下、`amountCents > 0`、`paymentFailed = false`、且 `status` 属于 `paid` / `consumed` / `refunding` / `refunded` / `refund_failed` 的 `ServiceOrder`（不回未付草稿 `pending`、关闭单 `closed`、0 元单）。按 `createdAt DESC, id DESC` 排序。

`data` 为 `{ "items": [...], "nextCursor": "..." | null, "total": number }`。`items` 每项只包含零 PII 安全字段：

| 字段 | 取值 |
|---|---|
| `id` | 服务单编号 |
| `serviceKey` | `resume_optimize` / `mock_interview` / `scan` |
| `serviceName` | `AI 简历优化` / `AI 模拟面试` / `扫描` |
| `status` | `paid` / `consumed` / `refunding` / `refunded` / `refund_failed` |
| `amountCents` | 整数，单位分 |
| `paidAt` / `settledAt` / `refundedAt` | ISO 8601 或 `null` |
| `refundReason` | 退款原因码或 `null` |
| `createdAt` | ISO 8601 |
| `canInvoice` | 布尔，同源复用 `assessInvoiceEligibility` 判定 |
| `invoiceStatus` | `none` / `submitted` / `issued` / `returned`（同一单优先取未退回申请 `submitted`/`issued`，否则取最近 `returned`） |
| `invoiceRequestId` | 最新对应开票申请编号，无申请时为 `null` |

绝不返回 `taxId`、`email`、`title`、`qrCodeContent`、`prepayId`、`channelTxnNo`、`providerOrderNo`、`wxOpenId`、`endUserId`。

同源补齐：`GET /api/v1/me/print-orders` 对已关联 `Order` 且 `amountCents > 0` 的打印单，只增可选字段 `canInvoice`、`invoiceStatus`、`invoiceRequestId`（复用同一 `assessInvoiceEligibility` 判据，零 PII；免费单与无 `Order` 历史单不增加多余字段）。

## 一体机自助开发票扫码屏（`/me/orders/invoice`）

1. 用户在一体机 `/me/print-orders`（「我的订单」）点击某张可开票服务单或收费打印单右侧的「开发票」，进入 `/me/orders/invoice?kind=service|print&id=<orderId>`。
2. 页面带会员 Bearer 与终端验签头调用 `POST /api/v1/kiosk/invoice-sessions`（入参 `{ orderKind, orderId }`），在头部白底码框展示返回的 `codeUrl`（`/k/i/<scene>`）二维码。
3. 凭据 `controlToken` 仅保存在组件内存 ref 中，严禁写入 `localStorage`、`sessionStorage` 或 URL；屏幕绝不出现抬头、税号、邮箱输入框。
4. 页面每 3 秒带终端验签头与 `x-invoice-control` 轮询 `GET /api/v1/kiosk/invoice-sessions/:sessionId`（遵守 60/min 限流、页面可见性暂停与 429 `Retry-After` 退避）：
   - 变为 `已提交`：更新状态胶囊并展示确认句，立停轮询并清空内存 `controlToken`；点「填好了，返回订单」返回 `/me/print-orders` 刷新列表。
   - 变为 `已过期` 或本地越过 `expiresAt`：隐藏失效二维码、立停轮询，主按钮切换为「重新生成开票码」。
   - 离开页面、退出登录或换人时立停轮询并清空内存状态。
5. 本机免费且直接无参访问，或服务端以 0 元实付拒单时，展示免费兜底屏；跨点位历史收费单在免费机上仍按订单自身事实允许开票。
