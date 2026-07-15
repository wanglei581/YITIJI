# 管理员登录态自助改密终审记录

## 结论

- 内部代码质量复审：Critical 0 / Warning 0，批准。
- Antigravity 最终只读审查：100/100，Critical 0 / Warning 0，`APPROVE`。
- Claude 最终只读审查：Critical 0 / Warning 0，批准合并；6 项均为非阻断 Info。
- 未连接生产数据库、Redis、账号或环境；未 push、合并或部署。

## 已关闭的审查问题

1. Redis 限流改为单条 Lua 原子额度检查与预留，达到上限不写入。
2. 释放额度只递减仍存在的正计数，成功清零后的迟到释放不会重建 `-1` key。
3. `tokenVersion` 会话缓存使用单调 CAS，Guard 冷缓存旧版本回填被拒后重读新状态。
4. 改密更新使用旧 `passwordHash` 乐观条件，两个并发请求最多一个成功。
5. 前后端统一 Unicode 字符数、UTF-8 72 字节和 12 位 4 类取 3 类规则；重置路径不可降级。
6. Admin / Partner 认证服务统一处理断网与 2xx 非法 JSON；Admin 表单总能恢复提交状态。
7. 验证脚本固定使用包装器创建的专用临时 SQLite，并在结束后删除整库。

## 验证证据

- `verify:change-password`：错误/正确密码、并发冲突、旧/新密码、旧/新 JWT、串行与并发限流、迟到释放、缓存竞态、Partner 后端契约、角色边界、Unicode / bcrypt、审计脱敏全部通过。
- 本地真实浏览器 + HTTP：Admin 账号设置页可用，成功后退出；旧密码 401、新密码 201、旧 token 失效、新 token 可用；无 token 401、注入 `userId` 400、kiosk token 403。
- 浏览器测试使用本地专用账号与数据库；服务、Redis 测试 key、数据库及截图产物均已清理。

## 非阻断后续

- 可在后续独立任务把两条新 verify 接入 CI；本任务先以 package script 固化本地门禁。
- `AuthService`、Admin / Partner 登录页已记录超过 500 行的拆分评估，本次不扩大上线前安全收口范围。

## 最终门禁（2026-07-15）

- API：`verify:change-password`、`verify:internal-auth-phone`、`verify:audit-logs`、typecheck、lint 全部 exit 0。
- Admin：账号设置静态门禁、typecheck、lint、production build 全部 exit 0；仅保留既有 chunk size 提示。
- Partner：typecheck、lint、production build 全部 exit 0。
- Shared：typecheck、lint 全部 exit 0。
- 临时库安全探针：任意 SQLite URL 与 `NODE_ENV=production` 直跑均在连库前拒绝；包装器覆盖调用方数据库 URL，专用库及测试产物均已删除。
- Git：`git diff --check origin/main` 通过；刷新 `origin/main` 后 `behind=0 / ahead=2`，主线无新增漂移；变更文件全部在批准预算内。
