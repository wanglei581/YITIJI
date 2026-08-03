# PR #452 main 同步与冲突解决

## 目标

- 将 `origin/main@6c1adb02` 以普通 merge commit 合入 PR #452 分支。
- 两份进度文档保留 main 与本分支双方事实，不覆盖或重复制造结论。
- 复核自动合并后的 D2 cleanup 与 `MEASURE` step 合同可同时执行。
- 重新通过专项合同、语法、API lint/typecheck/build 与远端 CI。

## 允许

- 普通 merge `origin/main`，不 rebase、不 force-push。
- 仅人工解决 `docs/progress/current-progress.md`、`docs/progress/next-tasks.md` 冲突。
- 更新并归档本任务目录。
- 推送同一 PR 分支以触发 CI。

## 禁止

- 不合并 PR #452。
- 不启动 Colima、PM2、Nginx、systemd unit 或 API 进程。
- 不执行 full drill，不生成或改写 evidence。
- 不连接 production，不 SSH、不部署、不切流、不进入 D3-D6。

## 验收

- 合并结果无冲突标记，工作树只包含预期 merge/任务归档。
- D2 offline contract 同时输出 cleanup 与 measure-step PASS。
- Node 语法、API lint/typecheck/build、`git diff --check` 通过。
- Antigravity 与 Claude 分析、终审完成，无未处置 Critical/Warning。
- 推送后 PR #452 新一轮三项 CI 全绿。
