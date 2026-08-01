# 集成协调要求

## 目标

在不触碰生产、不执行 D2′ full drill 的前提下，先合入前序事件审计真值，再处理旧 F1 D2 PR 的重叠关系，最后把执行合同候选安全同步到最新 `main` 并创建 PR。

## 允许

- 合并已全绿且 CLEAN 的 PR #454。
- 只读审计 PR #449；证据充分时关闭为被后续主干替代，或明确提取独有价值。
- 在当前隔离分支 rebase 最新 `origin/main`，只协调本任务原有 11 个文件及本任务 CCG 记录。
- 重跑纯离线 contract、lint、typecheck、build 与双模型审查；通过后 push 并创建 PR。

## 禁止

- 不修改主工作区的两份 dirty 进度文档。
- 不启动 Colima，不运行 `drill:d2-same-host`，不生成 nonce/evidence。
- 不连接 production，不部署，不进入 D3–D6。
- 不顺手清理其他 worktree、branch、stale tracking ref 或开放 PR。
