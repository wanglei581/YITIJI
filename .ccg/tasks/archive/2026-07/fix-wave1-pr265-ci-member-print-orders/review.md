# Review — PR #265 CI mock 契约修复

## 根因与修复

- CI 在 SQLite 与 PostgreSQL job 中均复现：`verify:member-print-orders` 的 6d 正向账户 mock 只返回 `enabled`。
- `EndUserAuthGuard` 已要求 `enabled && status === 'active'`；缺失 `status` 会 fail-closed，并调用测试 double 不具备的 `unregisterMemberSession`。
- 最小修复只让正向 mock 返回 `status: 'active'`，不修改生产认证、Redis 或限流逻辑。

## 验证

- RED：在正式 SQLite migration 重放库复现 `unregisterMemberSession is not a function`。
- GREEN：`verify:member-print-orders`、API lint/typecheck/build 和 diff check 全通过。
- CI 等价扩展回归：shared typecheck、PostgreSQL schema 同步、会员账户状态/认证/二维码/step-up/资产 E2E 均通过。

## 双模型审查

- Claude：APPROVE，Critical 0；建议补充 fail-closed 分支覆盖。该分支已由 `verify:member-account-status` 在 CI 中覆盖并断言会话撤销，故不在本脚本重复。
- Antigravity：APPROVE；确认补丁正确、最小且不掩盖生产问题。
