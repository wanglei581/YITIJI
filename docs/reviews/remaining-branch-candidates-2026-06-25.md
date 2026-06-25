# 剩余分支 / worktree 候选定级（2026-06-25，完成态）

> 本报告记录 2026-06-25 分支 / worktree 治理的最终状态。后续已完成 QR 登录安全重做、#91/#92 合入、Sprint1 订单 / Admin orders / Partner dashboard/profile 选择性迁移或取舍、#100 旧面试预览页清理，以及全部旧候选本地 / 远程 head 收口。

## 复核基线

- 主线：`main == origin/main == 4e574dee`
- 当前开放 PR：0
- 本地分支完成态：1 个（`main`；本 docs 分支合入并清理后达到）
- worktree：1 个（主仓）
- 远程候选 head：无；远程仅保留 `origin/main`
- 已删除旧候选：`origin/fix/expert-audit-stage-a`、`origin/feature/sprint1-order-model`、`origin/feature/sprint1-partner-dashboard`
- 已关闭候选：`codex/qr-ticket-login` 已由 #91 安全实现取代并清理；`codex/qr-login-local-agent-bridge`、`docs/qr-login-cleanup-progress`、`codex/remove-interview-setup-preview` 过渡分支已清理。
- 已删除本地旧候选：`feature/interview-setup-redesign`、`backup/interview-b65d6e48`、本地 `keep/b65d6e48` tag，以及无独有内容的 `codex/kiosk-design-style-sample` worktree / 分支 / 残留目录。

## 定级结论

| 对象 | 当前状态 | 定级 | 下一步 |
| --- | --- | --- | --- |
| `feature/interview-setup-redesign` | 已删除。本地深审确认旧分支本体混入历史 CCG 归档、smart-campus / fair / scan / 生产门禁等混合改动，并会回退当前页面 / 路由；唯一可单独收口的运行时点是旧 `/interview/setup-preview`。 | 已放弃整分支；唯一价值已由 #100 收口 | 不复活、不 rebase、不 merge；如未来重做面试 UI，只能从当前 `main` 另起新分支。 |
| `backup/interview-b65d6e48` | 已删除，连同本地 `keep/b65d6e48` tag 清理。其 fair verify residue 防回退已由当前 `main` 的 `verify-public-fair-demo-guard`、`verify-fair-residue` lib helper 和 CI 调用覆盖。 | 已放弃备份候选 | 不复活；如未来扩展 fair verify，只在当前 `main` 上增量修改现有 verify。 |

## 禁止事项

- 不把已删除的 `feature/interview-setup-redesign` 或 `backup/interview-b65d6e48` 重新创建后直接 rebase / merge 到 `main`。
- 不复活已删除的旧远程候选分支，不从旧 Sprint1 栈整分支迁回代码。
- 不用 `git remote prune` / `git gc` 做“顺手清理”。
- 不把 `.ccg/tasks/` 草稿或归档重新带回正式 Git 跟踪。

## 已执行顺序

1. `feature/interview-setup-redesign`：已只读对比当前 `main` 面试页，确认不能整分支迁移；唯一可取运行时价值为删除旧 `/interview/setup-preview`。
2. `backup/interview-b65d6e48`：已确认 fair verify residue 防回退由当前 `main` 覆盖。
3. #100：已从干净 `main` 合入旧预览页清理，正式 `/interview/setup` 真实链路未受影响。
4. 本地 / 远程过渡分支、两个旧 interview 本地候选分支、本地备份 tag 和无独有内容的 `codex/kiosk-design-style-sample` worktree / 分支 / 残留目录均已清理。

清理后的目标状态已达到：主线只保留 `main`，无额外本地分支、无额外 worktree、无远程候选 head；所有已放弃旧分叉都有审查证据；所有采纳能力均从干净 `main` 以最小 PR 迁移，避免旧 UI、旧接口、旧 `.ccg/tasks` 或过期文档回流。
