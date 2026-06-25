# 剩余分支 / worktree 候选定级（2026-06-25）

> 本报告只记录当前 `main` 基线之后仍需处理的分支与 worktree。2026-06-25 后续已完成 QR 登录安全重做、#91/#92 合入与旧 `codex/qr-ticket-login` 清理；本报告同步为清理后的剩余候选视图。

## 复核基线

- 主线：`main == origin/main`（具体 tip 以 `git rev-parse HEAD` / `git rev-parse origin/main` 为准）
- 当前开放 PR：0
- 本地分支：3 个（`main`、`feature/interview-setup-redesign`、`backup/interview-b65d6e48`）
- worktree：1 个（主仓）
- 远程候选 head：`origin/feature/sprint1-order-model`、`origin/feature/sprint1-partner-dashboard`
- 已删除旧候选：`origin/fix/expert-audit-stage-a`
- 已关闭候选：`codex/qr-ticket-login` 已由 #91 安全实现取代并清理；`codex/qr-login-local-agent-bridge` 与 `docs/qr-login-cleanup-progress` 过渡分支已清理。

## 定级结论

| 对象 | 当前状态 | 定级 | 下一步 |
| --- | --- | --- | --- |
| `feature/interview-setup-redesign` | 本地无 worktree；相对 `main` 落后 135、领先 31，包含面试页重设计、旧 CCG 归档、smart-campus / fair / scan / 生产门禁等历史混合改动。 | 高风险候选，不能整分支合并 | 只允许从干净 `main` 另起分支，按产品决定选择性提取面试 UI 思路；不得复活整条旧分叉。 |
| `backup/interview-b65d6e48` | 本地无 worktree；相对 `main` 落后 146、领先 12；含 `keep/b65d6e48` tag，主要是面试重设计早期备份和 fair verify residue 防回退。 | 备份保护 | 等 `feature/interview-setup-redesign` 决策完成后再判断是否删除；当前保留。 |
| `origin/feature/sprint1-order-model` | 远程候选 1 commit：订单模型、订单计费、Prisma migration、`verify-order`。 | 高价值功能候选 | 需做数据库 / API / 打印任务影响深审；如采纳，从干净 `main` 最小迁移订单模型基础，不直接合并旧远程。 |
| `origin/feature/sprint1-partner-dashboard` | 远程候选 5 commits：包含订单模型、Admin orders / alerts、Partner profile / dashboard。 | 高价值但更大范围候选 | 依赖订单模型决策；建议拆成订单基础、Admin 运营、Partner dashboard 三段迁移，禁止整分支一次性合并。 |

## 禁止事项

- 不把 `feature/interview-setup-redesign` 或 `backup/interview-b65d6e48` 直接 rebase / merge 到 `main`。
- 不直接合并 `origin/feature/sprint1-order-model` 或 `origin/feature/sprint1-partner-dashboard`。
- 不用 `git remote prune` / `git gc` 做“顺手清理”。
- 不把 `.ccg/tasks/` 草稿或归档重新带回正式 Git 跟踪。

## 推荐执行顺序

1. `origin/feature/sprint1-order-model`：深审订单模型与打印任务计费影响，若采纳则从干净 `main` 新建最小迁移分支。
2. `origin/feature/sprint1-partner-dashboard`：在订单模型落定后拆分审查 Admin / Partner dashboard。
3. `feature/interview-setup-redesign` + `backup/interview-b65d6e48`：做面试页产品取舍；若当前 `main` 方向已满足需求，则保留证据后清理旧候选。

清理后的目标状态：主线只保留 `main` 和明确仍在执行的功能分支；所有已放弃旧分叉都有审查证据；所有采纳能力均从干净 `main` 以最小 PR 迁移，避免旧 UI、旧接口、旧 `.ccg/tasks` 或过期文档回流。
