# 管理员安全修改密码需求

## 目标

补齐管理员登录态内修改本人密码的商用闭环，解除生产管理员弱密码对 FREE_MODE 后续步骤的阻塞。

## 功能归位

- Admin 前端：复用现有顶栏用户操作区，不新增侧栏重复入口；提供当前账号信息与修改密码表单。
- API：复用 `AuthController`、`AuthService`、`JwtAuthGuard`、`tokenVersion`、Redis session-state 与审计服务。
- Partner：后端契约允许已登录 partner 修改本人密码；本任务不新增 Partner 前端入口。
- Prisma：不新增字段、不改两套 schema、不创建 migration。
- Terminal Agent、Kiosk、Worker：不涉及。

## 安全要求

1. 只允许 JWT 当前用户修改本人密码，不接受客户端传入 userId。
2. 必须校验当前密码；错误尝试按用户维度限流。
3. 新密码不得与当前密码相同，且必须防止 bcrypt 72 字节静默截断。
4. 并发修改使用乐观条件更新，最多一个请求成功。
5. 成功后 `tokenVersion` 自增、Redis session-state 删除，所有旧 JWT 失效；前端清会话并回登录页。
6. 审计不得包含当前密码、新密码、hash、JWT 或密码长度信息。
7. 不依赖手机号或 OTP，不在代码、日志、聊天或任务文档写入真实凭据。
8. 忘记密码与登录态改密必须使用同一套商用强密码规则，不能通过重置路径降级。
9. 旧会话缓存写入必须保持 tokenVersion 单调，防止改密并发时旧版本回填。
10. 写库 verify 只能使用包装器创建的专用临时 SQLite，结束后删除整库文件。

## 明确不做

- 不直接修改生产数据库、生产账号或生产环境变量。
- 不部署、不 push、不合并 PR。
- 不新增 MFA、密码历史、手机号换绑、账号注销或第二套账号中心。
- 不修改当前 Kiosk 青序 LightFlow 页面、终端状态、价格、支付或打印链路。

## 允许修改文件预算

- `services/api/src/auth/auth.controller.ts`
- `services/api/src/auth/auth.service.ts`
- `services/api/src/auth/dto/internal-auth.dto.ts`
- `services/api/src/common/guards/jwt-auth.guard.ts`
- `services/api/src/common/redis/redis.service.ts`
- `services/api/src/audit/audit.types.ts`
- `services/api/scripts/run-verify-change-password.mjs`
- `services/api/scripts/verify-change-password.ts`
- `services/api/scripts/verify-internal-auth-phone.ts`（仅同步 Redis 会话测试替身）
- `services/api/package.json`
- `apps/admin/src/services/auth/index.ts`
- `apps/admin/src/layouts/AdminLayoutWrapper.tsx`
- `apps/admin/src/routes/index.tsx`
- `apps/admin/src/routes/account-settings/index.tsx`
- `apps/admin/src/routes/login/index.tsx`（仅统一忘记密码强度规则）
- `apps/admin/scripts/verify-admin-account-settings-ui.mjs`
- `apps/admin/package.json`
- `apps/partner/src/routes/login/index.tsx`（仅统一忘记密码强度规则）
- `apps/partner/src/services/auth/index.ts`（仅同步认证网络/响应异常处理）
- `packages/shared/src/types/audit.ts`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`（仅在真实下一步发生变化时）
- `.ccg/tasks/admin-password-security/*`

其他文件默认禁止修改。

`apps/admin/src/routes/login/index.tsx` 与 `apps/partner/src/routes/login/index.tsx` 均已超过 500 行，
本任务只改各自既有的找回密码校验与提示，不新增页面结构或抽象层。拆分会扩大上线前收口范围，
因此记录为后续重构候选，本任务不拆；两文件仍低于 800 行硬上限。

`services/api/src/auth/auth.service.ts` 当前 529 行，超过 500 行的拆分评估阈值但低于 800 行硬上限。
后续可按 OTP / 密码凭据能力拆分；本任务处于上线前安全收口，直接拆服务会扩大回归面，因此只新增
必要的改密闭环与私有辅助函数，不在本任务做行为无关重构。

## 验收标准

- 错误当前密码不修改 hash/tokenVersion。
- 正确修改后旧密码登录失败、新密码登录成功。
- 预热过 Redis session-state 的旧 JWT 立即失效。
- 新 JWT 可正常鉴权。
- 新旧密码相同被后端拒绝。
- 两个并发改密请求恰好一成功一冲突。
- 5 次错误后触发按用户限流。
- 并发错误尝试在 bcrypt 前原子占位，最多 5 次进入密码比较。
- 改密与 Guard 冷缓存并发时，旧 tokenVersion 不能回填覆盖新版本。
- UTF-8 超过 72 字节的新密码被 DTO 拒绝。
- 审计只记录安全动作元数据，不含敏感字段。
- Admin 页面可访问、表单错误可恢复、成功后自动退出。
- Admin 静态防回退门禁覆盖唯一入口、三字段、12 位强密码提示、提交错误和成功退出。
- Admin/Partner 找回密码 UI 与 DTO 统一 12 位、4 类取 3 类、UTF-8 72 字节规则。
- verify 使用专用临时 SQLite 且运行后数据库文件不存在。
- API/Admin typecheck、lint、build 与定向 verify 通过。
