# 需求与边界

## 目标

1. 修正 `docs/progress/next-tasks.md` 对 Node 22 契约和 PM2 应用运行时的过时表述。
2. 保持“PM2 daemon Node 20 / 应用 interpreter Node 22 / 独立 release 未激活 / 业务代码未切换”四项事实。
3. 验证通过后推送 `codex/preprod-pnpm1122-upgrade-20260726` 并创建 PR。
4. PR 创建后把真实 PR 号回填到进度文档，归档本任务并再次推送。

## 禁止

- 不合并 PR、不部署、不修改业务代码、schema、migration、依赖或 lockfile。
- 不 force-push，不删除分支或 worktree。
