# 合作机构账号双通道验证、手机号换绑与安全移除设计

**日期：** 2026-07-18

**状态：** 用户已确认推荐方案；Claude 与 Antigravity 双模型复审通过，实施前契约澄清已合并

**复杂度：** L+
**风险：** 高（认证、凭据、账号删除、手机号唯一性、生产基线协调）

## 1. 背景与已确认事实

Admin 合作机构详情已经存在 Partner 成员账号的启停、重置密码和移除入口。生产服务器于 2026-07-17 受控部署了 `e2b8db7f` 的安全移除窄回补：账号移除采用墓碑式逻辑删除，保留 `User.id` 和历史审计关联，同时禁用账号、递增 `tokenVersion`、释放用户名和手机号，并在可串行化事务中保证机构始终至少有一个已启用且未移除的 Partner 账号。

现有生产行为仍有一个高风险缺口：只要持有有效 Admin 会话即可调用移除接口，目标账号本人不需要提供手机号验证码或账号密码。`e2b8db7f` 提交对象本身不在最新 `origin/main@ff09a692` 的祖先链，但其墓碑 schema/migration、安全删除 API、会话防复活和 Admin UI 已分别由 `61272be8` / `a7ecaa3e` / `0ea52df5` / `5d74fcad` 等价吸收进主线。因此 Wave 0 只做存在性、checksum 和既有门禁核对，不 cherry-pick `e2b8db7f`。

用户已确认新增以下能力：

1. 默认向待操作 Partner 账号已绑定且已验证的手机号发送验证码。
2. 手机号无法接收验证码时，可切换为输入目标账号本人的当前登录密码。
3. 验证成功后可以完成手机号换绑或账号移除。
4. 先完成审查和设计，用户确认书面规格后才进入实施。

## 2. 目标与非目标

### 2.1 目标

- 把既有 Admin 移除入口升级为目标账号本人参与的高风险操作授权流程。
- 支持旧手机号短信验证码和目标账号密码两种授权方式。
- 支持在旧手机号不可用时，通过密码授权后换绑并验证新手机号。
- 删除、换绑、密码重置、启停和自助改密之间具有明确的并发与失效关系。
- 保留既有墓碑删除、最后有效账号保护、会话失效、凭据释放和审计能力。
- 通过短期、单次、操作范围明确的票据避免密码长时间停留、验证码跨用途复用和授权重放。

### 2.2 非目标

- 不新增 Partner 自助注销页面、审批中心、消息中心或重复菜单入口。
- 不删除合作机构主体，不修改岗位、招聘会、政策、支付、打印扫描、文件、终端或求职者数据。
- 不引入邮件、TOTP、实名核验、人工工单或多管理员会签。
- 不在本任务执行生产账号写入验收；生产发布和真实短信验证需要单独授权。
- 不把“密码验证成功”表述为对自然人身份的绝对证明。它只能证明有人掌握目标账号凭据，安全强度低于可达手机号验证码。

## 3. 威胁模型与安全判断

本设计主要防御：

- Admin 会话被盗后直接删除机构账号。
- 管理员误点或重复提交造成不可逆移除。
- 验证码跨登录、找回密码、手机号迁移和账号删除流程复用。
- 密码或验证码暴力尝试。
- 验证完成后目标账号发生改密、重置、启停、换绑或删除，旧授权仍被使用。
- 删除授权被改用于手机号换绑，或换绑授权被升级为删除。
- 两个并发删除让机构失去最后一个有效账号。
- 删除完成后旧 JWT 或晚到 Redis 缓存重新接受墓碑账号。

平台管理员本身属于高权限角色。若一个恶意管理员同时掌握自己的长期凭据、能够重置目标账号密码并主动模拟 Partner 操作，单靠同一平台内的密码无法证明真实自然人身份。为避免把弱保证包装成强保证，本设计采用四层缓解：

1. Admin 自身必须具有近期高风险操作验证。
2. Admin 设置的临时密码不能立即作为目标账号删除或换绑的密码证明。
3. 目标凭据版本发生变化会使全部未完成票据失效。
4. 全流程审计、限流和会话失效保留可追溯证据。

若未来需要抵御恶意超级管理员，必须增加独立于 Admin 权限的因子，例如 TOTP、恢复码、机构负责人线下审批或双管理员会签；本期不实现。

## 4. 方案选择

### 4.1 采用：两阶段、操作绑定的一次性授权票据

验证过程与最终写操作分离：

1. 创建安全挑战并确定操作类型和验证方式。
2. 验证 Admin 近期高风险操作状态，以及目标账号的短信验证码或密码。
3. 签发短期、单次、绑定具体操作的授权票据。
4. 删除或换绑接口消费票据后执行最终事务。

这样密码只在验证请求中短暂存在，前端验证完成后立即清空；换绑等待新手机号验证码时无需保留旧密码。

### 4.2 不采用：最终请求直接携带旧密码或验证码

该方案实现较少，但会让敏感凭据在前端停留更久，也难以同时支持操作范围隔离、换绑的第二个验证码和可靠的单次消费。

### 4.3 暂不采用：Partner 后台审批请求

让目标账号登录 Partner 后台审批可以进一步分离操作者，但会新增页面、通知、请求状态和入口，不符合当前上线前收口范围。

## 5. 核心原则：先选择操作，再进行验证

短信或密码验证成功后不签发“可做任何账号操作”的通用票据。安全挑战创建时就必须选择精确操作：

- `delete_account`：只允许移除该目标账号。
- `rebind_phone`：只允许为该目标账号换绑手机号。

若用户在删除弹窗中改选“换绑手机号”，当前删除挑战和已验证票据立即作废，重新创建 `rebind_phone` 挑战。这样可避免管理员以“只是换手机号”为由取得授权后升级为删除。

## 6. 数据模型

### 6.1 既有墓碑字段

实施基线必须保留生产已使用的 `User.deletedAt` 及 SQLite/PostgreSQL 对称 migration。最新主线若尚未包含，应选择性迁移生产已验证实现，不创建重复列或重复 migration ID。

### 6.2 密码证明来源

为防止 Admin 刚设置的密码立即被当作“目标账号本人密码”，`User` 增加最小化凭据状态字段：

```text
passwordProofState: legacy | temporary | owner_managed
```

状态规则：

- 既有历史账号迁移为 `legacy`。
- Admin 新建账号或重置密码后为 `temporary`。
- Partner 在登录态下完成自助改密，或通过已验证手机号完成找回密码后为 `owner_managed`。
- 墓碑删除后该字段保留无业务意义的安全默认值，不再用于认证。

密码降级授权只接受 `owner_managed`。`legacy` 和 `temporary` 返回可执行错误，提示先让账号本人完成一次自助改密；不能静默退化为 Admin 设置密码也可删除。

该规则会给旧账号增加一次过渡动作，但能够明确关闭“先重置目标密码，再用新密码删除”的直接绕过。任何状态变化均随密码更新一起提交并递增 `tokenVersion`。Partner 自助改密完成后当前旧会话随版本变化失效，需要使用新密码重新登录；这是有意的高风险凭据轮换行为，UI 必须在提交前提示。

上线影响必须显式告知：所有历史账号初始为 `legacy`，在本人完成一次自助改密或通过原绑定手机号找回密码前，密码回退不可用；管理员新建或重置后的 `temporary` 账号同样如此。上线前应在账号列表展示“密码验证尚未就绪”，并通知机构账号本人在手机号仍可用或仍能登录时完成一次自助改密。

如果账号同时满足“原手机号不可用”和“密码证明不是 `owner_managed`”，本功能必须拒绝删除和换绑，不提供超级管理员、客服口令或 Admin 重置密码绕过。此类遗留账号只能进入独立、留痕、线下核验的恢复流程；恢复流程不在本任务范围内，未另行设计和批准前不得实现。

## 7. 服务端组件

新增职责内聚的 `PartnerAccountActionService`，不把票据、OTP、密码验证和换绑事务继续堆入已有较大的 `AdminOrgsService`。

职责划分：

- `AdminOrgsService`：继续负责机构归属检查、最后有效账号保护和墓碑删除事务。
- `PartnerAccountActionService`：安全挑战、Admin 近期验证、目标短信/密码验证、票据签发与消费、换绑事务编排。
- `InternalOtpService`：复用现有限流、发送和验证码原子消费能力，只增加隔离的 purpose。
- `AuthService`：在自助改密和手机号找回密码完成时维护 `passwordProofState`，并继续发布新会话版本。
- Redis：只保存短期挑战与授权票据，不保存明文密码、验证码副本之外的敏感业务数据或完整手机号。

## 8. OTP 用途隔离

新增独立用途，不复用登录、找回密码、首次绑定或 Admin 手机号迁移验证码：

```text
partner_account_delete
partner_phone_rebind_authorize
partner_phone_rebind_new
```

- `partner_account_delete`：发送到目标账号旧手机号，只能授权删除。
- `partner_phone_rebind_authorize`：发送到目标账号旧手机号，只能授权换绑。
- `partner_phone_rebind_new`：发送到新手机号，只能确认新手机号可达。

继续复用现有 60 秒发送冷却、手机号/IP/设备限流、300 秒验证码有效期和 5 次失败尝试上限。验证码内容和消费状态按 purpose 完全隔离；发送额度不能按 purpose 成倍扩张，同一手机号还必须共享覆盖所有 OTP purpose 的全局发送冷却与时间窗配额，IP 和设备维度同样按现有全局策略聚合。

全局冷却 key 的值必须是每次发送独立生成的 `requestId`，不得使用常量 `1`。短信 provider 失败时只能用 Lua 比较 `GET key == requestId` 后删除，防止失败请求误释放后来请求的冷却。

同一验证码累计 5 次失败后进入锁定；锁定期间即使随后输入正确验证码也拒绝，必须等待限制解除并重新开始挑战。

## 9. 挑战与票据

### 9.1 安全挑战

挑战包含：

```text
adminId
adminTokenVersion
orgId
partnerId
partnerTokenVersion
action
verifyMethod
createdAt
```

挑战有效期为 300 秒，并绑定当前 Admin、机构、目标账号、目标账号凭据版本、操作类型和验证方式。

### 9.2 已验证票据

验证成功后签发 90 秒有效的随机不透明票据。Redis 仅保存票据摘要和绑定信息。最终接口必须原子消费票据，重复、过期、跨账号、跨机构、跨 Admin、跨操作使用均失败。

消费票据后即使最终删除因“最后有效账号”冲突而失败，也必须重新验证，避免旧授权在机构状态变化后长期保留。

### 9.3 建议 Redis 命名空间

```text
internal:partner-account-action:active:<adminId>:<partnerId>:<action>
internal:partner-account-action:challenge:<challengeId>
internal:partner-account-action:verified:<ticketHash>
internal:partner-account-action:rebind:<rebindTicketHash>
internal:partner-account-action:admin-recent-verify:<adminId>
internal:partner-account-action:admin-password-fail:<adminId>
internal:partner-account-action:partner-password-fail:<partnerId>
internal:partner-account-action:commit-lock:<orgId>:account-membership
```

- `challengeId` 是至少 128 bit CSPRNG 生成的不可预测标识；`ticketHash` 和 `rebindTicketHash` 是服务端收到随机 bearer ticket 后计算的 SHA-256 摘要，Redis 永不保存明文 ticket。
- `challenge:<challengeId>` 保存待验证挑战，TTL 300 秒。
- `verified:<ticketHash>` 保存已验证操作票据绑定信息，TTL 90 秒。
- `rebind:<rebindTicketHash>` 保存已验证旧因子、`adminId`、`adminTokenVersion`、`orgId`、`partnerId`、`partnerTokenVersion`、新手机号 hash、加密密文及目标版本，TTL 300 秒；不保存手机号明文。
- `active:<adminId>:<partnerId>:<action>` 的值为当前 `challengeId`，TTL 300 秒。同一范围创建新挑战时，用 Lua 原子读取旧 active 值、删除其指向的旧 `challenge:<challengeId>`，再写入新 active 指针和挑战。验证接口必须同时确认传入的 `challengeId` 与当前 active 值完全一致；只检查 challenge key 存在不构成有效验证。
- `admin-recent-verify:<adminId>` 保存 `adminTokenVersion` 和绝对过期时间，TTL 600 秒。
- 删除提交锁按机构而不是目标账号加锁，避免两个不同目标账号并发删除绕过“至少一个有效账号”约束。锁值为服务端 `requestId`，TTL 60 秒，覆盖已有 Serializable 事务最多 3 次重试的理论上界，且只能由持有相同 `requestId` 的请求通过 Lua 安全释放。

Redis 不承担最终授权事实。最终写入前仍须回数据库校验 Admin、机构、Partner、`deletedAt`、`enabled`、`tokenVersion` 和手机号唯一性。

## 10. Admin 近期高风险操作验证

仅凭 Admin JWT 不足以发起删除或换绑。首次创建挑战或近期验证过期时要求 Admin 输入自己的当前密码；成功后在 Redis 保存不超过 10 分钟的近期验证状态，绑定 `adminId` 和 `adminTokenVersion`。已有有效近期验证时，`adminCurrentPassword` 可省略，服务端仍必须重新读取并匹配 Admin 当前 `tokenVersion`。

- Admin 密码失败按 Admin ID 独立限流。
- Admin 改密、重置、禁用、`tokenVersion` 变化时，即使 Redis key 尚存也因版本不匹配而失效；显式退出登录时删除该近期验证 key。
- 前端不得把 Admin 密码写入 localStorage、sessionStorage、全局状态或日志，只保留在当前受控输入框并在请求结束后清空。
- 前端必须明确区分“管理员本人密码”和“目标机构账号密码”，避免输入错误账号凭据。

新增受保护的 `POST /api/v1/auth/logout`，用于在 Admin 显式退出时撤销该 Admin 的近期高风险验证；Partner 调用返回同样的 `{ "loggedOut": true }` 但不影响任何 Admin key。当前内部 JWT 没有单会话 `jti`，因此该端点只负责近期验证撤销，不对外声称服务端已撤销当前 JWT；前端仍按现有方式立即清除本地 token。

## 11. API 契约

所有路径继续位于既有 `/api/v1/admin/orgs/:orgId/accounts/:accountId` 范围内。以下均写完整路径；每个 handler 都必须重新校验当前 Admin 对 `orgId` 的权限，以及 `accountId` 确实属于该机构，不能只信挑战中的旧快照。

### 11.1 创建挑战

```text
POST /api/v1/admin/orgs/:orgId/accounts/:accountId/action-challenges
```

请求：

```json
{
  "action": "delete_account",
  "verifyMethod": "sms",
  "adminCurrentPassword": "..."
}
```

存在有效 Admin 近期验证时省略 `adminCurrentPassword` 字段；不存在或已失效且未提交该字段时返回 `ADMIN_REAUTH_REQUIRED`。前端不预测 Redis 中是否存在近期验证：用户先选择验证方式并调用创建挑战，只在收到 `ADMIN_REAUTH_REQUIRED` 后插入“管理员本人密码”步骤，然后以同一 `action` 和 `verifyMethod` 重试创建挑战。

返回：

```json
{
  "challengeId": "opaque",
  "action": "delete_account",
  "verifyMethod": "sms",
  "phoneMasked": "183****1921",
  "availableMethods": ["sms", "password"],
  "expiresInSeconds": 300,
  "cooldownSeconds": 60
}
```

密码验证方式只返回挑战，不回传任何密码状态或 hash。

账号列表/详情 DTO 只增加 `availableActionVerificationMethods: ("sms" | "password")[]`，用于在打开弹窗前展示可用路径；它不暴露手机号、密码状态枚举或任何凭据值。创建挑战时仍必须重新计算可用方式，不能信任前端快照。请求不可用方式时返回 `ACCOUNT_ACTION_METHOD_UNAVAILABLE`，响应只可附带当前可用方式枚举。

### 11.2 验证挑战

```text
POST /api/v1/admin/orgs/:orgId/accounts/:accountId/action-challenges/:challengeId/verify
```

短信请求体只含 `code`，密码请求体只含 `currentPassword`。服务端先读取 `active:<adminId>:<partnerId>:<action>`，只有它与路径 `:challengeId` 完全一致时才验证；不一致或不存在返回 `ACCOUNT_ACTION_CHALLENGE_UNAVAILABLE`。凭据校验成功后，使用 Redis Lua 再次比较 active/challenge，原子删除挑战和 active 指针并创建唯一的 `verified:<ticketHash>`；并发验证只能有一个请求签出票据。短信方式同时原子消费对应 purpose 的 OTP，密码方式在 bcrypt 校验后以 challenge 的单次 CAS 决定唯一赢家。成功返回 `actionTicket` 和 90 秒有效期，前端立即清空输入值。

关闭弹窗或主动切换操作时调用：

```text
DELETE /api/v1/admin/orgs/:orgId/accounts/:accountId/action-challenges/:challengeId
```

取消接口使用比较并删除 Lua：只有 active 值仍等于路径 `challengeId` 时才删除 active 指针和该挑战，绝不能误删随后创建的新挑战。即使取消请求失败，前端也清空所有敏感输入，服务端挑战最多在 300 秒后自动失效。

验证成功后，如果用户关闭弹窗、返回或切换操作，前端还必须调用：

```text
DELETE /api/v1/admin/orgs/:orgId/accounts/:accountId/action-tickets/current
X-Account-Action-Ticket: <opaque-ticket>
```

服务端只在 ticket 绑定的 `adminId` / `orgId` / `partnerId` 与当前请求完全一致时原子删除该 ticket，成功返回 `204`。不存在或已过期同样返回 `204`，防止把 ticket 存在性变成侧信道。

### 11.3 执行删除

保留既有：

```text
DELETE /api/v1/admin/orgs/:orgId/accounts/:accountId
```

改为必须携带 `X-Account-Action-Ticket`。不带票据的旧调用失败关闭，返回 `403 ACCOUNT_ACTION_STEP_UP_REQUIRED`。部署顺序允许 API 先收紧、Admin UI 后上线；短暂不可删除优于短暂无验证删除。

网关、应用访问日志、异常跟踪和 APM 必须把 `X-Account-Action-Ticket` 与 rebind ticket 字段列入敏感字段脱敏规则，禁止记录 bearer ticket。

### 11.4 新手机号换绑

```text
POST /api/v1/admin/orgs/:orgId/accounts/:accountId/phone-rebind/start
POST /api/v1/admin/orgs/:orgId/accounts/:accountId/phone-rebind/resend-new
POST /api/v1/admin/orgs/:orgId/accounts/:accountId/phone-rebind/verify
```

`start` 消费 `rebind_phone` 的 action ticket，校验新手机号格式与唯一性，向新手机号发送 `partner_phone_rebind_new` 验证码并返回 300 秒有效的独立 rebind ticket。`resend-new` 在 rebind ticket 仍有效、目标版本和新手机号未变化时重发验证码，不重复消费旧因子，也必须遵守 60 秒冷却和全局发送配额。

`start` 请求体只含 `{ "newPhone": "..." }`，action ticket 仅通过 `X-Account-Action-Ticket` 携带。成功返回：

```json
{
  "rebindTicket": "opaque",
  "phoneMasked": "139****5678",
  "expiresInSeconds": 300,
  "cooldownSeconds": 60
}
```

`resend-new` 不轮换 rebind ticket，只通过 `X-Phone-Rebind-Ticket` 携带，成功返回 `{ "phoneMasked": "139****5678", "expiresInSeconds": <当前剩余整秒>, "cooldownSeconds": 60 }`。`verify` 同样通过 `X-Phone-Rebind-Ticket` 携带 ticket，请求体只含 `{ "code": "123456" }`，成功返回 `{ "success": true }`，前端随即重新获取机构详情。

关闭或离开新手机号验证步骤时调用：

```text
DELETE /api/v1/admin/orgs/:orgId/accounts/:accountId/phone-rebind/current
X-Phone-Rebind-Ticket: <opaque-ticket>
```

服务端以与 action ticket 相同的范围比较语义原子撤销，成功或已不存在均返回 `204`。

`start`、`resend-new`、`verify` 每次都必须校验当前请求 Admin 的 `adminId`、`adminTokenVersion` 以及路径 `orgId/accountId` 与 rebind ticket 绑定完全一致。`verify` 仅在新手机号验证码正确时原子消费 rebind ticket 和验证码，然后在同一数据库事务中再次检查目标版本和新 `phoneHash` 唯一性，再更新目标账号：

- 写入新 `phoneHash`、`phoneEnc`、`phoneVerifiedAt`；
- 递增 `tokenVersion`；
- 保持账号启停状态不变；
- 发布新版本会话状态，使旧会话失效；
- 写入脱敏审计。

`phoneHash` 必须由数据库唯一约束兜底。若在 `start` 后的 300 秒窗口内被其他请求占用，最终事务捕获唯一约束冲突并返回 `PHONE_TAKEN`；已成功消费的 rebind ticket 不恢复，用户选择其他手机号后重新验证旧因子。

## 12. 主要错误码

| 错误码 | HTTP | 用户处理 |
| --- | --- | --- |
| `ADMIN_REAUTH_REQUIRED` | 403 | 管理员近期验证不存在或已失效，重新输入管理员本人密码 |
| `ADMIN_CREDENTIAL_INVALID` | 422 | 管理员本人密码错误，留在当前步骤重试 |
| `ADMIN_CREDENTIAL_LOCKED` | 429 | 管理员本人密码尝试超限，等待锁定解除后重试 |
| `ACCOUNT_ACTION_STEP_UP_REQUIRED` | 403 | 重新开始验证 |
| `ACCOUNT_ACTION_CHALLENGE_UNAVAILABLE` | 409 | 挑战过期、已用或不匹配，重新开始 |
| `ACCOUNT_ACTION_TICKET_STALE` | 409 | Admin 或目标账号版本/状态已变化，刷新后重新验证 |
| `ACCOUNT_COMMIT_CONFLICT` | 409 | 当前机构有另一账号变更正在提交，在票据有效期内稍后重试 |
| `ACCOUNT_ACTION_METHOD_UNAVAILABLE` | 422 | 当前验证方式不可用，选择另一方式 |
| `ACCOUNT_PASSWORD_PROOF_NOT_READY` | 409 | 目标密码仍为旧版或管理员临时密码，先完成本人自助改密 |
| `ACCOUNT_CREDENTIAL_INVALID` | 422 | 验证码或目标密码错误，留在当前步骤重试 |
| `ACCOUNT_CREDENTIAL_LOCKED` | 429 | 尝试次数过多，等待后重新开始 |
| `PHONE_TAKEN` | 409 | 更换未占用手机号 |
| `LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED` | 409 | 先新增并启用接替账号 |
| `ACCOUNT_NOT_FOUND` | 404 | 刷新机构详情 |

错误响应不得回传密码 hash、手机号明文、Redis key、票据内容或内部堆栈。

`401` 只表示当前登录会话无效。Admin 或目标账号在高风险操作请求体中提交的错误密码/验证码使用 `422`，避免前端误触发全局退出或登录跳转。

## 13. 删除事务

最终删除继续使用短事务和 PostgreSQL Serializable 隔离，并在 SQLite 验证环境维持同一业务顺序：

1. 使用单个 Redis Lua 脚本读取并校验 `verified:<ticketHash>`、以 `SET NX EX 60` 获得机构级提交锁，并在成功后删除票据。Lua 必须把可信绑定字段 `adminId`、`adminTokenVersion`、`orgId`、`partnerId`、`partnerTokenVersion`、`action` 作为返回值交给应用层；应用层不得用请求参数替代这些版本和范围值。只有锁获取成功才消费票据。
2. 回数据库校验 Admin、机构、目标账号、角色、`deletedAt`，以及 ticket 中的 `adminTokenVersion`、`partnerTokenVersion`。
3. 重新统计有效 Partner 账号；删除后若少于一个则返回 `LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED`。
4. 写入墓碑：`deletedAt`、`enabled=false`、`tokenVersion+1`、`passwordProofState=temporary`、不可登录用户名、随机密码 hash、清空手机号和最后登录信息。
5. 同事务写最小化审计。
6. 提交后发布高版本禁用会话状态，TTL 复用 `INTERNAL_SESSION_CACHE_TTL_SECONDS`，不使用短于统一会话缓存的硬编码值。

无论数据库事务成功、业务冲突或提交失败，只要 Lua 已成功消费票据，该票据都不能恢复，用户必须重新验证。事务结束后以比较锁值和 `requestId` 的 Lua 脚本安全释放锁；进程崩溃时由 60 秒 TTL 兜底。

若机构级锁已被其他请求持有，Lua 返回 `ACCOUNT_COMMIT_CONFLICT` 且不消费票据；客户端可在 action ticket 剩余 90 秒内重试，票据到期后再重新验证。

机构级 Redis 锁是防御性串行化，PostgreSQL Serializable 事务和最终有效账号计数仍是正确性事实来源。不同票据并发删除两个账号时，最多只有一个请求能让有效账号计数减少到一，另一个请求返回 409。SQLite 测试只能验证相同业务顺序和单写者条件，不能证明与 PostgreSQL 完全相同的并发语义；必须另跑 PostgreSQL 并发集成测试。

## 14. 审计与隐私

至少记录：

- Admin 发起挑战、验证成功、验证失败、验证锁定、取消、票据消费失败、提交锁冲突、删除成功、换绑成功。
- `actorId`、`actorRole`、`orgId`、`partnerId`、操作类型、验证方式、结果、时间。
- 验证失败只记录累计失败次数和错误类别，不记录输入内容；必要时记录服务端生成的 request ID 和脱敏手机号。

绝不记录：

- Admin 或 Partner 密码；
- 验证码；
- action ticket、challenge ticket、Redis key；
- 完整手机号、手机号 hash 或加密密文；
- bcrypt hash。

审计保留原目标账号 ID，墓碑删除后仍可追溯，但不把历史身份信息重新复制进新增 payload。

## 15. Admin 界面状态机

现有“移除”入口保留，不新增菜单或页面。删除弹窗按以下阶段运行：

```text
confirm
  -> choose_method
  -> admin_reauth (仅服务端返回 ADMIN_REAUTH_REQUIRED 时)
  -> sms_verify | password_verify
  -> delete_committing
  -> success
```

手机号换绑复用同一业务弹窗组件，但在创建挑战前切换操作：

```text
confirm_rebind
  -> choose_method
  -> admin_reauth (仅服务端返回 ADMIN_REAUTH_REQUIRED 时)
  -> old_sms_verify | password_verify
  -> new_phone_input
  -> new_phone_sms_verify
  -> rebind_committing
  -> success

new_phone_sms_verify
  -- rebind ticket expired --> confirm_rebind
```

交互要求：

- 默认展示短信验证和服务端返回的脱敏手机号。
- 提供“手机号无法接收？使用账号密码”入口。
- 密码页明确写“目标机构账号当前密码”，与 Admin 本人密码分开。
- 提示目标账号持有人应自行输入密码，管理员不得索取、转述或记录他人密码；输入框保持标准遮罩，允许粘贴和密码管理器。
- 从删除切换到换绑时明确告知会重新验证，并废弃现有票据。
- 任一请求忙碌时锁定关闭、返回、发送和提交按钮，防止竞态。
- 验证码只允许 6 位数字，发送后展示 60 秒倒计时。
- action ticket 展示剩余有效时间，在剩余 15 秒时提示即将过期；rebind ticket 展示独立的 300 秒有效期。无障碍播报只在关键状态和 15 秒提醒时触发，不逐秒打扰读屏。
- 密码输入允许粘贴和密码管理器，不通过阻止粘贴制造虚假安全；提交成功、切换方式或关闭弹窗时立即清空。
- 长流程使用稳定挂载的 `role="dialog"`，删除最终确认使用独立挂载的 `role="alertdialog"`，不在同一 DOM node 上动态切换 role；标题/说明关联、Escape、Tab 焦点约束和关闭后的焦点恢复必须保留。
- 如服务端返回的 `availableActionVerificationMethods` 为空，移除和换绑按钮禁用并就地说明：请账号持有人先完成自助改密；原手机号也不可用时只能走独立线下核验，不提供 Admin 绕过。
- 成功后刷新机构详情和账号计数；错误保留当前可恢复步骤，但过期、状态变化和锁定错误要求重新开始。
- action ticket 在最终提交前过期时返回操作起点；rebind ticket 在新手机号验证阶段过期时返回 `confirm_rebind`，重新完成旧因子授权，不能停留在失效步骤继续重发。
- 多管理员并发导致 `ACCOUNT_ACTION_TICKET_STALE`、`ACCOUNT_ACTION_CHALLENGE_UNAVAILABLE` 或账号已变化时，提示“账号信息已被其他操作更新，请刷新后重新开始”，并刷新机构详情。

## 16. 测试策略

实施采用 TDD，先写失败测试，再完成最小实现。

### 16.1 单元测试

- challenge/ticket 序列化、摘要、TTL、操作范围和单次消费。
- Redis Lua：新挑战原子替换 active 并删除旧挑战；验证强校验 active 且并发请求只能签发一个 verified ticket；取消只能比较删除自身挑战；票据消费与机构锁在成功时返回可信绑定字段并删除票据；锁冲突、票据不存在或范围不匹配时不修改状态；锁值不匹配时安全释放脚本不得删除他人锁。
- DTO 联合校验：短信方式只能提交 code，密码方式只能提交 currentPassword。
- Admin 与 Partner 密码失败限流。
- Admin 近期验证绑定 `adminTokenVersion`。
- UI reducer/state machine 不允许跳步、跨操作复用票据或在忙碌状态重复提交。

### 16.2 后端集成与安全测试

- 无票据、伪造、过期、已消费票据均不能删除或换绑。
- A 账号、A 机构、A Admin、`delete_account` 票据不能用于其他目标或 `rebind_phone`。
- 登录/找回密码/迁移手机号验证码不能用于删除或换绑。
- 验证码和密码累计 5 次失败后锁定；锁定期间正确凭据也被拒绝，必须等待限制解除并重新开始。
- 三种新增 OTP purpose 共享手机号、IP、设备全局发送配额，切换 purpose 不能放大发送次数。
- `legacy`、`temporary` 密码不能用于降级授权；`owner_managed` 可以。
- Admin 重置密码、Partner 自助改密、启停、换绑或删除后，旧挑战和票据因 `tokenVersion` 变化失效。
- 新手机号已占用、格式错误、验证码错误或过期时不修改数据库。
- `start` 检查后新手机号被并发占用时，`verify` 由事务内复核和数据库唯一约束返回 `PHONE_TAKEN`，不覆盖他人手机号。
- rebind ticket 在 300 秒内可以按冷却规则重发新手机号验证码；超时后必须重新验证旧因子。
- 换绑成功后旧手机号可按既有唯一性规则复用，旧会话失效。
- 墓碑删除后密码、短信登录、找回密码、改密和手机号绑定全部拒绝。
- 两个删除请求并发时不能让机构失去全部有效账号。
- Redis 写入失败、重复请求和晚到缓存不会恢复旧凭据或旧会话。

### 16.3 前端与 E2E

- 已验证手机号默认进入短信步骤；未绑定/未验证手机号显示密码路径和可执行说明。
- Admin 本人密码与目标账号密码标签、自动完成和清空行为正确。
- resend 倒计时、错误恢复、忙碌锁、取消清理和焦点恢复。
- 删除改选换绑会废弃旧挑战并重新开始。
- 最后账号冲突、新手机号占用、票据过期和账号状态变化显示明确下一步。
- 使用模拟短信发送器和隔离账号完成完整删除与换绑 E2E，不向真实手机号发短信。

### 16.4 工程门禁

- API/Admin typecheck、lint、production build。
- SQLite 主验证和 PostgreSQL readiness/migration 对称性。
- 相关专项 verify、并发验证、Admin UI contract、`git diff --check`。
- 变更完成后 Antigravity 与 Claude 双模型审查；Critical 修复后重新双审。
- 不以测试通过代替生产部署或真实短信验收结论。

## 17. 实施与发布顺序

1. **Wave 0：基线验收。** 从干净 `origin/main` 核对已分拆吸收的墓碑删除、双库 migration、会话失效和 Admin 删除入口；当前主线证据表明无需、且禁止 cherry-pick `e2b8db7f`。仓库 migration 文件缺失、checksum 不符或既有门禁失败时立即停止，先重新审查主线基线，不自动复活旧分支。必须确认生产已应用 migration ID `20260716193000_add_partner_account_tombstone` 与仓库内容一致，绝不生成同义重复 migration。
2. **Wave 1：后端安全挑战。** 先写测试，再实现密码证明状态、Admin 近期验证、OTP purpose、challenge/ticket 和删除接口强制票据。
3. **Wave 2：手机号换绑。** 实现旧因子授权、新手机号 OTP 和原子换绑。
4. **Wave 3：Admin UI。** 把现有确认弹窗升级为受控状态机，不新增页面或菜单。
5. **Wave 4：验证与审查。** 完成双库、并发、安全、前端、构建和双模型审查。
6. **Wave 5：受控发布。** 单独取得发布授权后，备份、迁移、API 先 fail-closed、Admin UI 后切换，再执行只读健康检查；真实账号写入验收需再次单独授权。

## 18. 文件预算

预计只允许修改或新增：

- `services/api/prisma/schema.prisma` 与 PostgreSQL 对称 schema/migration；
- `services/api/src/orgs/` 既有删除 controller/service/DTO；
- `services/api/src/auth/` 的 OTP、改密、找回密码及新的 action service/ticket helper；
- `services/api/src/common/redis/` 仅在缺少必要原子操作时最小扩展；
- `services/api/scripts/` 相关专项验证；
- `apps/admin/src/routes/partners/` 既有账号管理组件；
- `apps/admin/src/services/api/orgsAdmin.ts`；
- 相关 package scripts、CI 门禁和正式进度文档。

禁止修改 Kiosk、Partner 新入口、Worker、Terminal Agent、支付、打印扫描、岗位招聘会、生产配置或密钥。若实施计划发现必须突破预算，必须停止并重新请求确认。

## 19. 完成定义

只有同时满足以下条件才可报告功能完成：

- 不通过目标账号短信或合格密码证明，任何 Admin 都不能删除或换绑目标账号。
- Admin 设置的临时密码不能直接充当目标本人删除证明。
- 所有票据按 Admin、机构、目标账号、操作和版本隔离，并且单次消费。
- 换绑验证新手机号，删除保留最后有效账号并彻底失效旧会话。
- SQLite/PostgreSQL、并发、安全、UI、typecheck、lint、build 和专项 verify 全部通过。
- 双模型复审无未解决 Critical。
- 正式进度文档只记录实际完成和实际部署事实。
