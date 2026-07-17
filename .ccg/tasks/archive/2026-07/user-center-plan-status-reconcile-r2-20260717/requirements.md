# 用户中心计划状态二次校准：需求与范围

## 真实闭环 / 上线阻塞

PR #269 无法合并，是因为 `origin/main` 已由 PR #272 前进，并更新了相同的用户中心进度文档。需要在最新干净主线上将仍然停留在“运行时代码尚未开工”的产品方案和总控计划校准为实际已合并的 Wave 0 / Wave 1-A 状态，避免错误地把后续数据权利能力写成已完成。

## 允许修改

- `docs/product/user-center-commercial-closure-plan-2026-07.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave0-wave1-program.md`
- `docs/progress/current-progress.md`
- `.ccg/tasks/archive/2026-07/user-center-plan-status-reconcile-r2-20260717/**`

## 禁止修改 / 不涉及

- 不改应用、API、worker、数据库 schema、迁移、测试、依赖、CI、生产配置或密钥。
- 不改 `docs/progress/next-tasks.md`：PR #272 已把 Wave 1-A 合入事实、Wave 1-B 下一步和不可逆注销门禁写为最新真值。
- 不新增用户中心入口、页面、数据模型、服务或外部依赖。
- 不执行部署、真实短信、真实数据导出或账户注销。

## 真值与验收

- PR #270 已于 2026-07-17 合入 `main@88e940cd`；GitHub Actions `29552177099` 的两项 CI 成功。
- PR #272 已于 2026-07-17 合入 `main@f1c6d4ad`，只校准 `current-progress.md` 和 `next-tasks.md` 的合并状态。
- Wave 1-B、Wave 1-C、真实导出和不可逆注销执行仍未开始；注销仍受法务分类留存矩阵、冷静期和执行开关 fail-closed 门禁约束。
- 运行 Markdown 链接、状态断言、JSON、`git diff --check` 和范围检查；本任务为纯文档，不跑运行时代码测试。
