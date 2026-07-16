# 管理员与合作机构账号手机号安全转移设计

> 状态：用户已批准“保留机构账号、一次性安全转移手机号”的方案方向；本规格等待用户书面复核。
> 基线：`origin/main@e62a9789`。
> 分支：`codex/admin-partner-phone-transfer-20260716`。

## 1. 背景与问题

内部 Admin 与 Partner 账号都存储在 `User` 模型中，`phoneHash` 在该模型内全局唯一。当前严格管理员首次绑定只接受尚未属于任何内部账号的手机号，因此已经绑定到 Partner 的手机号会被统一拒绝。

用户只有一个手机号，但需要继续使用合作机构账号。允许两个 `User` 记录共享同一手机号会让短信登录和密码找回无法唯一定位账号，并扩大跨角色接管风险；删除整个 Partner 账号又会失去机构登录能力。因此，本任务采用一次性安全转移：在证明 Admin 密码和手机持有权后，原子地从 Partner 释放手机号并绑定给当前 Admin，同时保留 Partner 的用户名密码登录能力。

## 2. 方案比较

### 2.1 独立安全转移状态机（采用）

新增 Admin 专用手机号转移服务和端点，复用现有 OTP、手机号加密、Redis ticket、限流与审计基础设施。转移在一个数据库事务中先清 Partner、再绑 Admin。优点是边界清楚、不污染刚完成安全加固的严格首次绑定服务，且可以单独验证和回滚；代价是新增一组小型端点与 UI 状态。

### 2.2 扩展现有严格首次绑定服务（不采用）

现有服务的核心不变量是“候选手机号无内部账号所有者”。把“无主初绑”和“有主转移”塞入同一状态机会增加分支和误用风险，也可能使普通首次绑定成为跨账号修改入口。

### 2.3 删除 Partner 账号后重新绑定（不采用）

安全删除候选会释放手机号，但也会撤销机构账号认证能力。即使以后重建 Partner 账号，手机号已经属于 Admin，仍无法再次绑定，因此不能解决“同一个人同时保留两端使用权”的需求。

## 3. 架构与边界

新增 `AdminPhoneTransferService`，不修改 `AdminInitialPhoneBindService` 的所有者为空不变量。新服务只服务当前已登录 Admin，且仅接受手机号当前所有者为 `role=partner` 的场景。

功能归位声明：

- 前端：仅在 `apps/admin` 既有账号设置入口增加独立转移组件，不新增页面或导航。
- 后端：仅在 `services/api/src/auth` 新增转移状态机和路由接线。
- 数据库：复用现有可空手机号字段和唯一约束，不新增 schema 或 migration。
- Redis：复用现有 OTP、ticket、CAS 和会话缓存机制，新增独立命名空间 key。
- Partner：不新增自助解绑入口，不修改 Partner 页面。
- Kiosk、Terminal Agent、Worker、支付、订单、价格、打印、扫描、文件与生产配置：均不涉及。
- 共享类型/UI：除非审计动作枚举确有需要，否则不新增。

## 4. API 与状态机

### 4.1 开始转移

```http
POST /auth/admin/phone/transfer/start
```

请求沿用严格初绑的输入边界：`currentPassword`、`phone`、可选 `deviceId`。端点要求有效 Admin JWT、Admin 角色与严格限流。

处理顺序：

1. Admin 必须启用、尚未绑定手机号，且三个手机号字段均为空。
2. 使用现有密码尝试预约锁和 bcrypt 校验当前密码；所有非可操作失败统一返回不可用错误。
3. 规范化并校验中国大陆手机号，计算 `phoneHash`。
4. 按 `phoneHash` 查唯一内部所有者：
   - 无所有者：拒绝，继续由既有严格首次绑定端点处理；
   - 所有者不是 Partner：拒绝，不发送短信；
   - 所有者是 Partner：进入转移流程。
5. 为当前 Admin 创建唯一活动 ticket。Ticket 加密或仅存不可逆/加密字段，包含：Admin ID 与 tokenVersion、Partner ID 与 tokenVersion、`phoneHash`、加密手机号。
6. 使用独立 `transfer_phone` OTP 目的向该手机号发送验证码，避免与严格首次绑定的冷却、验证码和尝试计数互相污染。
7. 返回 ticket、冷却/过期时间，以及 Admin 本来有权查看的最小来源摘要：Partner 用户名、机构名称、脱敏手机号。不得返回内部手机号字段或其他机构数据。

除短信供应商的可操作错误外，所有账号不存在、角色不符、密码错误、状态变化和并发冲突均返回统一的 `AUTH_PHONE_TRANSFER_UNAVAILABLE`，避免形成新的匿名枚举面。

### 4.2 明示同意与验证

```http
POST /auth/admin/phone/transfer/verify
```

UI 收到 start 成功响应后展示来源机构账号和以下不可省略的后果：

1. 该手机号将从所示机构账号转移至当前管理员账号；
2. 机构账号仍可使用用户名和密码登录；
3. 机构账号将失去手机号短信登录和短信找回能力；
4. 机构账号现有登录会话将失效；以后忘记密码需由管理员重置。

用户必须主动勾选确认后，才能提交验证码。确认只保存在组件内存，不写本地存储、日志或 DOM 隐藏字段。

验证顺序：

1. 读取并解析 ticket，复核当前 Admin 仍符合严格未绑定条件，且 Admin tokenVersion 未变化。
2. 解密手机号并复核 `hashPhone(phone) === ticket.phoneHash`。
3. 获取每 ticket 的随机值验证锁；未获得锁的并发请求统一失败且不得消费 OTP。
4. 验证 OTP。可重试的错误验证码不消费 ticket；过期、锁定或不可判定失败清理 ticket。
5. 使用 CAS 消费 ticket 和当前 Admin 的活动 ticket。
6. 执行单个 Prisma 事务，按固定顺序：
   - `updateMany` 清空 Partner 的 `phoneHash`、`phoneEnc`、`phoneVerifiedAt`，并递增 `tokenVersion`；where 必须包含 Partner ID、`role=partner`、ticket 中的 `phoneHash` 和 Partner tokenVersion；`count !== 1` 回滚。
   - `updateMany` 给 Admin 写入 ticket 的手机号字段和验证时间；where 必须包含 Admin ID、`role=admin`、`enabled=true`、三个手机号字段为空及 Admin tokenVersion；`count !== 1` 回滚。
   - 在同一事务写入 Admin 完成事件和 Partner 释放事件；审计不得含手机号明文、hash、密文、密码、OTP 或 ticket。Admin 完成事件可沿用脱敏手机号，Partner 释放事件 payload 保持为空。
7. 事务提交后删除 Partner 会话状态缓存。删除失败记录不含敏感数据的 warn，但不把已提交成功伪装为失败；数据库 `tokenVersion` 是最终真值，缓存 TTL 到期后必须拒绝旧 token。
8. Admin 不递增 tokenVersion，当前会话保持有效。

### 4.3 取消

```http
POST /auth/admin/phone/transfer/cancel
```

取消只使用 CAS 清理当前 Admin 对应的 ticket、活动 ticket 和验证锁，不修改任何数据库字段。取消结果不确定时，前端沿用严格初绑的保守策略，清空内存状态并要求重新登录。

## 5. 原子性、并发与失败恢复

- PostgreSQL 唯一约束默认在语句结束时检查，因此事务中必须先清 Partner，再绑 Admin；顺序相反会触发唯一冲突。
- 清 Partner 与绑 Admin 不得拆成两个事务或普通连续请求。任一 CAS 更新失败必须整体回滚，不能留下手机号悬空。
- 两个 Admin 并发转移同一个 Partner 手机号时，Partner 的 `phoneHash + tokenVersion` CAS 保证最多一个成功；失败者得到统一不可用错误。
- 同一 Admin 双标签页验证由每 ticket 验证锁和活动 ticket CAS 保证最多一次生效。
- OTP 已正确验证但数据库事务失败时，验证码和 ticket 已消费；用户必须重新发起流程。这与现有严格初绑的失败语义一致，UI 必须明确提示“状态已变化，请重新开始”。
- start 与 verify 之间 Partner 被禁用、改号、改密或被并行删除时，tokenVersion/phoneHash CAS 失败并整体回滚。禁用状态本身不作为转移授权条件；转移不自动启用或停用账号。
- Redis 会话缓存删除失败的残余窗口以既有缓存 TTL 为上限；专项测试必须证明缓存过期回源后旧 Partner token 被拒绝。

## 6. 安全与隐私

- 授权因子：有效 Admin 会话、正确 Admin 当前密码、目标手机号 OTP，三者缺一不可。
- 新端点必须具有与严格初绑相同或更严格的控制器 Guard、IP/账号/手机号/设备限流和密码失败节流。
- 新服务必须复用严格初绑现有的 `internal:admin:phone-initial-bind:password-fail:<adminId>` 失败额度键；两个入口合计最多 5 次/300 秒，不能各自获得一份密码尝试额度。
- 转移服务必须使用独立 `transfer_phone` OTP purpose；`bind_phone` 与 `transfer_phone` 的验证码、冷却和尝试计数不能跨流程消费或互相覆盖。
- 不允许转移另一 Admin 或任何非 Partner 角色的手机号。
- start/verify/cancel 的非短信错误使用统一文案，客户端不能依据错误区分手机号是否属于某个内部角色。
- 日志只记录 Admin ID、Partner ID、动作结果和非敏感错误分类；不得记录候选手机号、掩码以外的手机号数据、OTP、ticket、密码或 Redis payload。
- `EndUser` 属于独立账号域，本任务不查询、不修改，也不承诺跨域唯一。
- Partner 转移后唯一恢复路径是 Admin 的既有重置密码能力；UI 和运维说明必须诚实披露。

## 7. 前端交互

既有严格初绑卡片保持默认路径。在同一账号设置区域提供“该号码已用于机构账号？安全转移”次级操作，切换到独立的 `AdminPhoneTransferCard`；不新增第二个页面或导航入口。

转移组件分为三态：

1. 身份确认：输入当前 Admin 密码和手机号；
2. 来源确认：显示 Partner 用户名、机构名称、脱敏手机号、验证码输入、四项影响说明和必选确认框；
3. 完成：刷新当前用户资料，显示 Admin 已绑定的脱敏手机号，并清除组件内全部密码、手机号、OTP 和 ticket 状态。

“重新填写”必须调用 cancel；提交中禁用所有按钮；ticket 过期自动清空状态；未知网络结果执行保守冷却，不重复发送短信。不得使用 `localStorage`、`sessionStorage`、URL 参数或控制台保存敏感状态。

## 8. 测试策略

必须执行 RED→GREEN→REFACTOR，并新增独立 verifier，避免继续膨胀现有严格初绑验证脚本。

后端至少覆盖：

- 正常转移与字段结果；
- 事务第二步失败时 Partner 清空整体回滚；
- 先清后绑不触发手机号唯一冲突；
- Partner 旧 token 失效、Admin 当前 token 保持有效；
- 会话缓存删除失败后数据库真值最终拒绝旧 token，并产生脱敏 warn；
- start 后 Partner 改号、改密、禁用或被删除时 CAS 失败且无部分写入；
- 所有者是另一 Admin、无所有者或非 Partner 时拒绝且不发送 OTP；
- 密码错误、密码尝试限流、OTP 错误可重试、OTP 过期/锁定；
- 严格初绑与安全转移交替提交错误密码时仍共享 5 次/300 秒总额度；
- `bind_phone` 与 `transfer_phone` 的验证码、冷却和尝试计数不能跨流程消费或互相污染；
- 同 Admin 双 verify 和两个 Admin 抢同一 Partner 手机号；
- 两条审计存在且不包含手机号明文、hash、密文、密码、OTP 或 ticket；
- 转移后 Partner 用户名密码登录成功，短信登录/找回失败，Admin 重置密码仍可用。

Admin 静态 verifier 与浏览器冒烟至少覆盖：

- 入口只存在于既有账号设置区；
- 必须显示来源摘要、完整影响说明和确认框；
- 未确认时不能提交；
- 取消、过期、未知结果和重复提交的保守行为；
- 成功后刷新用户资料且不在本地持久化敏感状态。

交付验证：API/Admin typecheck、lint、Admin HTTP 生产构建、专项 verifier、SQLite 主验证、PostgreSQL readiness/schema 同步检查、`git diff --check`。代码完成后执行 Antigravity + Claude 双模型终审；任一模型不可用都必须真实记录，不得宣称双审通过。

## 9. 文件预算

预计允许修改或新增：

- `services/api/src/auth/admin-phone-transfer.service.ts`（新增，控制在 400 行内；如状态机超过预算，拆 ticket/错误纯函数）；
- `services/api/src/auth/internal-otp.service.ts`（仅扩展 `transfer_phone` purpose）；
- `services/api/src/auth/auth.controller.ts`；
- `services/api/src/auth/auth.module.ts`；
- `services/api/src/auth/dto/internal-auth.dto.ts`（优先复用，仅确需新字段时修改）；
- `services/api/src/audit/audit.types.ts`、`packages/shared/src/types/audit.ts`（仅确需登记新动作时修改）；
- `services/api/scripts/verify-admin-phone-transfer.ts` 与 package/CI 接线；
- `apps/admin/src/services/auth/index.ts`；
- `apps/admin/src/routes/account-settings/AdminPhoneTransferCard.tsx`（新增）；
- `apps/admin/src/routes/account-settings/index.tsx`；
- `apps/admin/scripts/verify-admin-phone-transfer-ui.mjs` 与 package/CI 接线；
- `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`；
- 本规格、实施计划与 `.ccg/tasks/admin-partner-phone-transfer-20260716/`。

禁止修改 Prisma schema/migration、Partner 页面、Kiosk、Terminal Agent、支付、订单、打印扫描、生产配置，以及未合并的 Partner 安全删除工作区。

## 10. 上线与操作边界

本任务的代码交付、合并、部署和真实手机号转移是四个不同授权阶段。实现阶段只产出代码、测试、审查和 PR 候选；不得自动部署、发送真实短信或修改生产账号。

未来真实执行前必须再次确认：生产代码版本与 CI、Admin 当前仍未绑定手机号、来源仍是预期 Partner、无活动认证 ticket、短信供应商可用、数据库备份与回滚手册就绪。真实转移必须由用户在 Admin 页面输入密码和验证码，Codex 不读取、不保存密码或验证码。

基线安全审计另发现 API 直接依赖 `multer@2.1.1` 存在深层字段 DoS。该问题不是本功能引入，也不得混入认证功能分支；但在本功能部署前，必须由独立 P0 升级到 `>=2.2.0` 并完成上传链路回归。

## 11. 外部分析状态

- Claude 只读架构分析：实际模型为 Claude Opus 4.8（1M context），结论为方案可实现，并提出独立服务、事务顺序、会话失效和角色限制等安全要求；这些要求已并入本规格。
- Antigravity：本轮实际角色配置显示 Gemini 3.5 Flash，并非用户要求的 Claude Opus 4.6；同时账号配额耗尽，未产生有效报告，不能计为分析通过。完成代码前必须在 Antigravity 可用且模型配置符合用户要求后重新运行。

## 12. 设计自检

- 无 `TODO`、`TBD` 或未定义成功条件。
- 不弱化唯一约束，不直改数据库，不删除机构账号。
- API、事务、会话、审计、UI、测试和上线授权边界一致。
- 与严格首次绑定、Partner 安全删除候选和生产 `CLOSED_MODE` 的边界明确，无文件依赖或实现交叉。
