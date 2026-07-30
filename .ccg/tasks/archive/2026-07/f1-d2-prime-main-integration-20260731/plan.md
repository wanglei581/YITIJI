# 实施计划

采用双模型一致推荐的方案 A：

1. 从 `origin/main@7b33447d` 建立独立 worktree 并跑纯主线基线门禁。
2. 先按精确哈希 `166fe9dc` 移植四个 D2 脚本并验证 blob 一致，再按 RED→GREEN 关闭集成审查发现的 user-systemd ambient 环境继承风险。
3. 不 cherry-pick 三个文档提交；在主线文本上增量协调 NO-GO/PASS 时间线、当前加固候选待新 retake、exit 澄清和 D3 未授权门禁。
4. 跑语法、D2 合同、API build/lint、旧 evidence 复核、差异与白名单门禁。
5. 完成子代理规格/质量审查和 Antigravity + Claude 双模型审查。
6. 归档 task 并只提交到本地分支；不 push、不建 PR、不部署。

正式逐步计划：`docs/superpowers/plans/2026-07-31-f1-d2-prime-main-integration.md`。
