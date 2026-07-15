# 终端机队 F0 集成执行计划

1. 只读确认当前为 harness linked worktree、工作区无非 CCG 改动，`origin/main` 为最新已验证主线。
2. 以 Claude + Antigravity 并行分析三提交迁入顺序、主线漂移和 SSOT 冲突风险；空输出不计通过。
3. 在当前独立 worktree 从 `origin/main` 创建 `codex/device-fleet-f0-integration-20260715`。
4. 依次 cherry-pick `f04522c8`、`9b8434ad`、`872f71f4`；除两份进度 SSOT 外出现任何代码冲突即停止复核。
5. 对 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md` 手工合并：保留主线最新改密、首次手机号绑定、PR/CI 事实，同时加入 F0 本地集成候选事实；修正已合入事项的过时描述，不扩展其他历史条目。
6. 运行 API/Admin 两项 F0 verify、typecheck、lint、build、API `db:pg:sync:check`、`git diff --check`、主线祖先与禁区路径检查。
7. 先做内部规格复审，再做内部质量复审；发现问题只在既定文件范围修复并重跑。
8. 并行执行 Claude + Antigravity 最终审查；Critical/Warning 修复后重新双审。
9. 更新并归档 CCG 任务，提交本地集成结果；保留 worktree 和分支，停在 push/PR 前。
