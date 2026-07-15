# 管理员安全改密 PR 发布记录

## 结果

- 分支：`codex/admin-password-security-20260715`
- PR：[#241](https://github.com/wanglei581/YITIJI/pull/241)
- 基线：rebase 到 `origin/main@781fc1c7`，`behind=0`
- 边界：已 push / 已建 PR；未合并、未部署、未操作生产账号或运行时。

## 主线整合

- 同时保留 `INTERNAL_AUTH_VERIFY_TARGET=isolated` 生产误用守卫、`RecordingAudit` 与禁止全局清理 AuditLog 的主线修复。
- 同时保留 `MemoryRedis.setJsonIfVersionNotOlder`、改密专用临时 SQLite wrapper 与 Admin 自助改密全部能力。
- 两份进度文档保留主线 verify 安全事实与本分支改密候选事实。

## Rebase 后验证

- `verify:change-password`、`verify:internal-auth-phone:target-guard`、隔离临时库 `verify:internal-auth-phone`、`verify:audit-logs` 全部通过。
- API / Admin / Partner / shared typecheck 与 lint 全部通过。
- API / Admin / Partner production build 与 Admin 账号设置静态门禁全部通过。
- Antigravity 与 Claude 最终复审均为 Critical 0 / Warning 0 / APPROVE。
