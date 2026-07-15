# 首次手机号绑定审查记录

日期：2026-07-15
状态：本地复审通过；Claude 最终复审为 APPROVE，但 Antigravity 未产出有效报告，不能标记为合并就绪。

## 本地复审结论

- Critical：0。新路由同时使用 JWT、角色和 DTO；服务层再次校验账户可用性。
- Critical：0。ticket 以 `userId` 命名空间保存加密手机号，使用 `GETDEL` 一次性消费；跨用户、重放、错误 OTP、二次号码冲突、`phoneEnc=null` CAS 与唯一索引竞争均有验证。
- Critical：0。密码、验证码、ticket、手机号明文不进入 audit payload、响应展示、URL 或浏览器持久化；成功只写脱敏手机号与验证时间。
- Warning（已修）：错误 OTP 会按安全设计消费 ticket，初版 UI 仍停留在验证码页。已先增加静态 RED 门禁，再让 `SMS_CODE_INVALID` / 过期 / ticket 无效 / 冲突等回到第一步，避免用户无效重试。
- Warning（已修）：本账号已绑定时曾复用「该手机号已绑定其他账号」文案。已先将隔离 verify 改为 RED，再新增 `PHONE_SELF_ALREADY_BOUND` 与准确文案；他人手机号占用仍保持 `PHONE_ALREADY_BOUND`。
- Warning（已修）：ticket 已消费后若账户状态失效，前端原本可能停留在验证码页。已先将静态 UI verify 改为 RED，再让 `AUTH_SESSION_INVALID` 立即 `redirectToLogin()`，清除本地会话并整页跳登录。
- Info：认证主服务已超文件规模阈值，因此首次绑定状态机放入同一 `auth` 模块的 `InitialPhoneBindService`，仅复用既有账户可用性判断，未改旧预绑定手机号入口。

## 已执行验证

- `INTERNAL_AUTH_VERIFY_TARGET=isolated` + 迁移生成的 `/tmp` SQLite：`verify:internal-auth-phone` 通过。
- API：typecheck、lint、`db:pg:sync:check` 通过。
- Admin：typecheck、lint、`VITE_API_MODE=http VITE_API_BASE_URL=/api/v1` production build、`verify:admin-account-settings-ui` 通过。
- `git diff --check` 与两个新增文件的 whitespace check 通过。
- 两项 Warning 修复后重新完成 `verify:internal-auth-phone`（迁移生成的临时 SQLite）与 `verify:admin-account-settings-ui`；API/Admin typecheck、lint，以及显式 HTTP API 变量下的 Admin Vite production build 均通过。

## 外部审查状态

- Antigravity：前三次 reviewer 调用均只返回 wrapper 启动信息；最后一次虽返回正文，却被错误路由到另一个旧工作区的 Admin/Partner 主题任务，未读取本候选文件，因此全部不是本任务的有效 APPROVE。
- Claude：完整审查先给出 2 条非阻断 Warning；修复后复审确认 `PHONE_SELF_ALREADY_BOUND` 语义分离、`AUTH_SESSION_INVALID` 清会话跳登录、ticket/OTP 防重放与旧预绑定流程均正确，最终为 **APPROVE（Critical 0 / Warning 0）**。
- 双模型门禁仍缺少 Antigravity 有效报告，且现有 `agy` 路由必须先修复至当前隔离 worktree。后续必须取得该报告，或由用户按项目治理流程明确接受替代审查方案，才可考虑提交/PR。

## 本轮授权结论

用户已授权以 Claude 有效复审与完整本地验证作为本次**仅本地提交**的替代审查依据。该授权不包括 push、PR、GitHub CI、部署、真实短信或任何生产数据/配置变更；也不将 Antigravity 的错路由输出视为有效批准。

## 未做

- 未提交、未推送、未创建 PR、未运行 GitHub CI、未部署。
- 未发送真实短信，未修改生产 User、Redis、环境变量、密钥、支付、终端或打印任务。
- 未做生产管理员、生产浏览器、短信通道或真机验收。
