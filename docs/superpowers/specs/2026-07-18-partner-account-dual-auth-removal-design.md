# 合作机构账号双通道验证、手机号换绑与安全移除设计

**日期：** 2026-07-18

**状态：** 用户已确认推荐方向，待书面规格复核后编写实施计划

**复杂度：** L+
**风险：** 高（认证、凭据、账号删除、手机号唯一性、生产基线协调）

## 1. 背景与已确认事实

Admin 合作机构详情已经存在 Partner 成员账号的启停、重置密码和移除入口。生产服务器于 2026-07-17 受控部署了 `e2b8db7f` 的安全移除窄回补：账号移除采用墓碑式逻辑删除，保留 `User.id` 和历史审计关联，同时禁用账号、递增 `tokenVersion`、释放用户名和手机号，并在可串行化事务中保证机构始终至少有一个已启用且未移除的 Partner 账号。

现有生产行为仍有一个高风险缺口：只要持有有效 Admin 会话即可调用移除接口，目标账号本人不需要提供手机号验证码或账号密码。生产已部署窄回补也尚未进入最新 `origin/main@ff09a692`，因此后续开发不能直接续写旧候选分支，必须从干净主线建立集成基线，选择性迁移已验证能力。

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

该规则会给旧账号增加一次过渡动作，但能够明确关闭“先重置目标密码，再用新密码删除”的直接绕过。任何状态变化均随密码更新一起提交并递增 `tokenVersion`。

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

继续复用现有 60 秒发送冷却、手机号/IP/设备限流、300 秒验证码有效期和 5 次验证尝试上限。不同 purpose 的 Redis key 完全隔离。

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
internal:partner-account-action:challenge:<ticketHash>
internal:partner-account-action:verified:<ticketHash>
internal:partner-account-action:admin-password-fail:<adminId>
internal:partner-account-action:partner-password-fail:<partnerId>
internal:partner-account-action:commit-lock:<partnerId>:<action>
```

Redis 不承担最终授权事实。最终写入前仍须回数据库校验 Admin、机构、Partner、`deletedAt`、`enabled`、`tokenVersion` 和手机号唯一性。

## 10. Admin 近期高风险操作验证

仅凭 Admin JWT 不足以发起删除或换绑。创建挑战时要求 Admin 输入自己的当前密码；成功后可在服务端保存不超过 10 分钟的近期验证状态，绑定 `adminId` 和 `adminTokenVersion`。

- Admin 密码失败按 Admin ID 独立限流。
- Admin 改密、重置、禁用、`tokenVersion` 变化或退出登录后，近期验证立即失效。
- 前端必须明确区分“管理员本人密码”和“目标机构账号密码”，避免输入错误账号凭据。

## 11. API 契约

所有路径继续位于既有 `/api/v1/admin/orgs/:orgId/accounts/:accountId` 范围内。

### 11.1 创建挑战

```text
POST /action-challenges
```

请求：

```json
{
  "action": "delete_account",
  "verifyMethod": "sms",
  "adminCurrentPassword": "..."
}
```

返回：

```json
{
  "challengeId": "opaque",
  "action": "delete_account",
  "verifyMethod": "sms",
  "phoneMasked": "183****1921",
  "expiresInSeconds": 300,
  "cooldownSeconds": 60
}
```

密码验证方式只返回挑战，不回传任何密码状态或 hash。

### 11.2 验证挑战

```text
POST /action-challenges/:challengeId/verify
```

短信请求体只含 `code`，密码请求体只含 `currentPassword`。成功返回 `actionTicket` 和 90 秒有效期；服务端随后立即销毁挑战，前端立即清空输入值。

### 11.3 执行删除

保留既有：

```text
DELETE /admin/orgs/:orgId/accounts/:accountId
```

改为必须携带 `X-Account-Action-Ticket`。不带票据的旧调用失败关闭，返回 `403 ACCOUNT_ACTION_STEP_UP_REQUIRED`。部署顺序允许 API 先收紧、Admin UI 后上线；短暂不可删除优于短暂无验证删除。

### 11.4 新手机号换绑

```text
POST /phone-rebind/start
POST /phone-rebind/verify
```

`start` 消费 `rebind_phone` 的 action ticket，校验新手机号格式与唯一性，向新手机号发送 `partner_phone_rebind_new` 验证码并返回独立 rebind ticket。`verify` 原子消费 rebind ticket 和新手机号验证码后更新目标账号：

- 写入新 `phoneHash`、`phoneEnc`、`phoneVerifiedAt`；
- 递增 `tokenVersion`；
- 保持账号启停状态不变；
- 发布新版本会话状态，使旧会话失效；
- 写入脱敏审计。

## 12. 主要错误码

| 错误码 | HTTP | 用户处理 |
| --- | --- | --- |
| `ACCOUNT_ACTION_STEP_UP_REQUIRED` | 403 | 重新开始验证 |
| `ACCOUNT_ACTION_CHALLENGE_UNAVAILABLE` | 409 | 挑战过期、已用或不匹配，重新开始 |
| `ACCOUNT_ACTION_TICKET_STALE` | 409 | 目标账号状态已变化，刷新后重新验证 |
| `ACCOUNT_ACTION_METHOD_UNAVAILABLE` | 422 | 当前验证方式不可用，选择另一方式 |
| `ACCOUNT_PASSWORD_PROOF_NOT_READY` | 409 | 目标密码仍为旧版或管理员临时密码，先完成本人自助改密 |
| `ACCOUNT_CREDENTIAL_INVALID` | 401 | 验证码或目标密码错误 |
| `ACCOUNT_CREDENTIAL_LOCKED` | 429 | 尝试次数过多，等待后重新开始 |
| `PHONE_TAKEN` | 409 | 更换未占用手机号 |
| `LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED` | 409 | 先新增并启用接替账号 |
| `ACCOUNT_NOT_FOUND` | 404 | 刷新机构详情 |

错误响应不得回传密码 hash、手机号明文、Redis key、票据内容或内部堆栈。

## 13. 删除事务

最终删除继续使用短事务和 PostgreSQL Serializable 隔离，并在 SQLite 验证环境维持同一业务顺序：

1. 原子消费 `delete_account` action ticket并获得提交锁。
2. 回数据库校验 Admin、机构、目标账号、角色、`deletedAt` 和 ticket 中的 `partnerTokenVersion`。
3. 重新统计有效 Partner 账号；删除后若少于一个则返回 `LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED`。
4. 写入墓碑：`deletedAt`、`enabled=false`、`tokenVersion+1`、不可登录用户名、随机密码 hash、清空手机号和最后登录信息。
5. 同事务写最小化审计。
6. 提交后发布高版本禁用会话状态，TTL 复用 `INTERNAL_SESSION_CACHE_TTL_SECONDS`，不使用短于统一会话缓存的硬编码值。

不同票据并发删除两个账号时，仍必须保证最多只有一个请求能让有效账号计数减少到一，另一个请求返回 409。

## 14. 审计与隐私

至少记录：

- Admin 发起挑战、验证成功、验证锁定、取消、删除成功、换绑成功。
- `actorId`、`actorRole`、`orgId`、`partnerId`、操作类型、验证方式、结果、时间。
- 必要时记录服务端生成的 request ID 和脱敏手机号。

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
  -> admin_reauth
  -> choose_method
  -> sms_verify | password_verify
  -> delete_committing
  -> success
```

手机号换绑复用同一业务弹窗组件，但在创建挑战前切换操作：

```text
confirm_rebind
  -> admin_reauth
  -> choose_method
  -> old_sms_verify | password_verify
  -> new_phone_input
  -> new_phone_sms_verify
  -> rebind_committing
  -> success
```

交互要求：

- 默认展示短信验证和服务端返回的脱敏手机号。
- 提供“手机号无法接收？使用账号密码”入口。
- 密码页明确写“目标机构账号当前密码”，与 Admin 本人密码分开。
- 从删除切换到换绑时明确告知会重新验证，并废弃现有票据。
- 任一请求忙碌时锁定关闭、返回、发送和提交按钮，防止竞态。
- 验证码只允许 6 位数字，发送后展示 60 秒倒计时。
- 密码输入允许粘贴和密码管理器，不通过阻止粘贴制造虚假安全；提交成功、切换方式或关闭弹窗时立即清空。
- `role="alertdialog"`、标题/说明关联、Escape、Tab 焦点约束和关闭后的焦点恢复必须保留。
- 成功后刷新机构详情和账号计数；错误保留当前可恢复步骤，但过期、状态变化和锁定错误要求重新开始。

## 16. 测试策略

实施采用 TDD，先写失败测试，再完成最小实现。

### 16.1 单元测试

- challenge/ticket 序列化、摘要、TTL、操作范围和单次消费。
- DTO 联合校验：短信方式只能提交 code，密码方式只能提交 currentPassword。
- Admin 与 Partner 密码失败限流。
- Admin 近期验证绑定 `adminTokenVersion`。
- UI reducer/state machine 不允许跳步、跨操作复用票据或在忙碌状态重复提交。

### 16.2 后端集成与安全测试

- 无票据、伪造、过期、已消费票据均不能删除或换绑。
- A 账号、A 机构、A Admin、`delete_account` 票据不能用于其他目标或 `rebind_phone`。
- 登录/找回密码/迁移手机号验证码不能用于删除或换绑。
- 验证码和密码第 6 次尝试被锁定，正确凭据也必须重新开始。
- `legacy`、`temporary` 密码不能用于降级授权；`owner_managed` 可以。
- Admin 重置密码、Partner 自助改密、启停、换绑或删除后，旧挑战和票据因 `tokenVersion` 变化失效。
- 新手机号已占用、格式错误、验证码错误或过期时不修改数据库。
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

1. **Wave 0：基线协调。** 从干净 `origin/main` 选择性迁移生产已部署的墓碑删除、双库 migration、会话失效和 Admin 删除入口，证明内容与生产事实一致。
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
