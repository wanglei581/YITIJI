# 首次手机号绑定：执行范围

## 功能归位

- 业务闭环：已登录的内部 `admin` / `partner` 在尚未绑定手机号时，以当前密码、短信验证码和一次性绑定凭据安全完成首次绑定；后续可使用既有短信登录与找回密码能力。
- 前端：`apps/admin/src/routes/account-settings/` 与 `apps/admin/src/services/auth/`。
- 后端：`services/api/src/auth/` 与 `services/api/scripts/verify-internal-auth-phone.ts`。
- 终端、Worker、共享类型、共享 UI：不涉及。
- 数据库：复用既有 `User.phoneHash`、`phoneEnc`、`phoneVerifiedAt`；不新增表或迁移。
- 文档：仅在实现与本地验证真实完成后更新 `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。

## 允许文件预算

- `services/api/src/auth/auth.service.ts`
- `services/api/src/auth/initial-phone-bind.service.ts`
- `services/api/src/auth/auth.module.ts`
- `services/api/src/auth/auth.controller.ts`
- `services/api/src/auth/dto/internal-auth.dto.ts`
- `services/api/scripts/verify-internal-auth-phone.ts`
- `apps/admin/src/services/auth/index.ts`
- `apps/admin/src/routes/account-settings/index.tsx`
- `apps/admin/src/routes/account-settings/PhoneBindingCard.tsx`
- `apps/admin/scripts/verify-admin-account-settings-ui.mjs`
- 两份正式进度文档与本任务记录

## 安全不变量和禁止项

- 新端点必须为 JWT 当前用户所有；必须校验当前密码；只能在 `phoneEnc IS NULL` 时以 CAS 写入。
- 绑定 ticket 必须按用户命名空间、短 TTL、一次性消费；手机号、当前密码、验证码、ticket 不得进入日志、审计 payload、浏览器持久化或 URL。
- 不改变旧 `/auth/phone/code`、`/auth/phone/verify` 的预绑定账号语义；不改密码、角色、机构归属、tokenVersion。
- 不改根目录、生产数据库/Redis/环境变量、支付、定价、终端、打印或密钥；不发送真实验证码，不部署、不推送、不创建真实订单。

## 验收证据

- RED→GREEN：认证 verify 覆盖错误当前密码、已绑定/冲突、ticket 跨用户与重放、验证码错误、并发 CAS、审计/响应泄密。
- API/Admin typecheck、lint、Admin build、静态 UI verifier、SQLite 隔离库 verify、PostgreSQL schema 同步检查与 `git diff --check`。
- 交付时明确区分本地模拟、隔离数据库与尚未完成的 CI、部署、真实短信、生产管理员、浏览器/真机验收。
