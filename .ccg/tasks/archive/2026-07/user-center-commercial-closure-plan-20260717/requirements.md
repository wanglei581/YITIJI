# 用户中心商用级闭环审计与开发方案校准范围

## 真实闭环

把用户中心商用级闭环的审计、产品方案、五份实施计划和正式进度说明校准到最新 `origin/main` 事实，避免旧工作区中的历史状态覆盖已合入的 Wave 0、Wave 1-A、Wave 1-B Slice 1 和 Slice 2 方案结论。

## 允许范围

- 只读核验：`docs/reviews/user-center-commercial-closure-audit-2026-07-16.md`、`docs/product/user-center-commercial-closure-plan-2026-07.md`、五份 `docs/superpowers/plans/2026-07-16-user-center-wave*.md`、`docs/progress/current-progress.md`、`docs/progress/next-tasks.md` 与相关 Git 历史。
- 仅当发现事实确实未同步时，修改上述文档和必要的计划状态说明。
- 记录本次校准结论和最小文档验证。

## 禁止范围

- 不修改运行时代码、schema、migration、CI、生产配置、数据库、密钥、终端、支付或可见 UI。
- 不将旧根工作区中的未提交内容直接覆盖最新 `origin/main`。
- 不提交、推送、创建 PR、合并或部署，除非用户另行明确授权。

## 验收

- 每个计划中的状态与 `origin/main` 和 `current-progress.md` 的最新事实一致。
- 没有将已完成的 Wave 0 / Wave 1-A / Wave 1-B Slice 1 回写成“尚未开工”。
- 明确 Slice 2 是本地候选、未 push / PR / merge / 部署，且不能因 Antigravity 审查配额不足被误标为已合入。
- 文档链接有效，`git diff --check` 通过。
