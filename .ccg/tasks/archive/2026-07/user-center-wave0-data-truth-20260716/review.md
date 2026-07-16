# Wave 0 授权撤回终态保护：本地收尾审查

## 实施结论

- 发现 `revoke_consent` 在创建请求时已经同步执行 `revokeConsent()`，但 Admin 仍可将该工单写为 `rejected` 并产生拒绝审计，导致记录的终态与实际动作矛盾。
- `MemberPrivacyService.handleDataRequest()` 现对 `revoke_consent -> rejected` 返回 `DATA_REQUEST_ALREADY_EXECUTED`，且在调用审计或更新前失败关闭。
- `revoke_consent -> completed` 路径不变，继续写入服务端审计和完成状态。
- 所有前端 Wave 0 基线改动已由 PR #261 进入 `origin/main@0c4cdd57`；本分支 rebase 后只保留该 3 个 API 文件的增量，并同步正式进度与验收事实。

## 验证证据

- TDD：新增 SQLite 真值测试与动态服务守卫后先红（4 个失败），加入服务层保护后转绿。
- `PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-truth`：临时 SQLite PASS。
- `PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:job-ai-privacy`：PASS。
- `pnpm --filter @ai-job-print/api typecheck`、`lint`、`build`：PASS。
- 新建并删除的一次性本机 PostgreSQL 16.14 空库：29 条正式 migration PASS；数据请求真值、会员打印订单、权益核销 verify 全部 PASS。
- `git diff --check origin/main`：PASS；无 schema、migration、生产配置或密钥变更。

## 复审与遗留项

- Claude wrapper 的完整报告异步写入 `/tmp/user-center-wave0-revoke-final-review-20260716/claude.log`，结论为 `APPROVE（Critical 0 / Warning 0）`；该报告提示的终态幂等与撤回创建期审计均为 Wave 1 既有边界。Antigravity 初始 wrapper 未返回有效报告，但之后用 `Gemini 3.5 Flash (High)`、独立新项目和内联精确代码 diff 重新审查，同样得到 `APPROVE（Critical 0 / Warning 0）`。
- 已完成本地逐项 diff 审查：阻断发生在 `audit.write` 与 `userDataRequest.update` 之前，集成测试同时验证无状态、无审计副作用；未发现本增量 Critical/Warning。
- 既有 `auditRef` 可由调用方传入仍是 Wave 1 运营页必须修复的边界，不在本小型终态补丁内扩展。
- 后续远程交付前：在可用账户下补跑有效 Claude + Antigravity 增量审查；获得用户授权后才可 push、PR 和 GitHub CI。
