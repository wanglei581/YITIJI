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

`data` 是数组，按订单创建时间从新到旧。每一项：

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
