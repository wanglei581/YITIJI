# 本地合并审计

- 范围：仅将 `codex/home-fusion-youth-stash-reconcile-20260731` 快进合入本地 `main`，并同步正式进度记录。
- 合并方式：`git merge --ff-only`，`main` 从 `f4a3be4e` 前进到 `9d6ace20`，未产生 merge commit。
- 允许修改：`docs/progress/current-progress.md` 与本任务归档记录。
- 禁止修改：首页运行时代码、路由、业务流程、生产配置、远端分支和生产环境。
- 外部动作：未 push、未部署、未连接 production。
- 验证：合并前与合并后均运行 `pnpm --filter @ai-job-print/kiosk verify:home-prototype-v1`；归档提交前运行 `git diff --check`。
