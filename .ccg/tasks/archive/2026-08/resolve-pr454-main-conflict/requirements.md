# PR #454 main 冲突收口要求

## 目标

将最新 `origin/main` 合入 `codex/f1-d2-prime-retake-20260801`，解决正式进度文档冲突，使 PR #454 恢复可合并并重新触发 CI。

## 允许修改

- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/resolve-pr454-main-conflict/**`

## 约束

- 保留 main 上所有较新的项目进度，不覆盖或删除其他任务记录。
- 保留 D2′ `main@5b251e5f` 唯一一次 fresh retake 的真实 NO-GO 记录与下一步 stale-PID 修复边界。
- 不改运行时代码、测试、配置或依赖。
- 不运行 D2′、不启动 Colima、不连接或部署生产、不进入 D3–D6。
- 本任务只更新 PR 分支并触发 CI，不合并 PR #454。

## 验证

- `git diff --check`
- 冲突标记扫描
- 确认仅预期文档与 CCG archive 变化
- Claude + Antigravity 冲突方案分析和最终差异审查
- 推送后读取 PR mergeable 与 CI 状态
