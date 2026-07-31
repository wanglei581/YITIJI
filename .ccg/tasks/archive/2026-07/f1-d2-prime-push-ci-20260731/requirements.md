# F1 D2 Prime 推送与 CI 核对

- 用户已在“先授权推送；固定远端 commit 并确认 CI”建议后明确回复“可以，继续”。
- 只允许推送 `codex/f1-d2-prime-main-integration-20260731`；不建 PR、不合并、不部署。
- 推送前必须确认 `origin/main` 仍为审查基线、工作区干净、提交后本地门禁已通过。
- 推送后只核对该精确远端 commit 的 CI；若分支 push 不触发 CI，诚实记录，不用 PR 或 main push 绕过。
- productionF1 继续 NO-GO，D3 未授权，禁止 full drill、SSH、迁移、切流或生产操作。
