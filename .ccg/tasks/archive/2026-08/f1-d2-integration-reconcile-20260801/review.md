# PR #449 双模型审计

## 共同结论

- 禁止整 PR 合并或 cherry-pick；`run.sh`、旧 STAGE 标记、旧 `assert→fail`、runbook 与旧 CCG 记录均已被 #450–#454 的主干架构替代。
- `procfs.mjs` 单独只改善 `/proc/<pid>/cgroup` 读取/解析的固定错误分类，不能解决回滚后继续使用旧 PID 的生命周期根因。
- PR #449 应关闭但保留远端分支，不删除取证来源。
- 当前执行合同 PR 不提取 stale-PID 修复；继续保持独立 TDD 闸门。

## 差异意见与综合处置

- Antigravity：`CLOSE_AS_SUPERSEDED`，未来在最新主干重新设计 procfs 与 PID 身份校验。
- Claude：关闭 #449，同时把 `procfs.mjs`、回滚前 cgroup 快照和对应 mutation 作为未来 stale-PID TDD 任务的精确设计输入。

综合：关闭 #449；不迁代码。未来 stale-PID/cleanup TDD 任务必须重新 RED→GREEN，成对评估 procfs 固定分类、回滚前快照和 PID 身份/生命周期不变量，适配当前 `diagnostics.mjs`，不得直接复制旧 PR。

## rebase 后最终审查

- Antigravity：`APPROVE`，Critical 0 / Warning 0。
- Claude：`APPROVE`，Critical 0 / Warning 0。
- 双方均确认 PR #454 事件 A/B、invocation 唯一性、stale-PID/cleanup 与三闸后才可 retake 的 SSOT 完整保留；当前分支没有修改 `drill.mjs`、`diagnostics.mjs`、evidence schema、package scripts，也没有夹带 PR #449 旧代码。

## 集成结果

- PR #454：MERGED，merge commit `e09e87a9`。
- PR #449：CLOSED，远端分支保留供只读取证。
- 当前候选：[PR #457](https://github.com/wanglei581/YITIJI/pull/457)，未合并、未部署。
