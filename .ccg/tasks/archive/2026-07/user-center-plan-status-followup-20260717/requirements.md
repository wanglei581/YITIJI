# 用户中心计划状态主线重放

## 闭环与范围

PR #269 基于 `origin/main@f69bf1b7`，而主线已合入 PR #270（`88e940cd`）。本任务只把用户中心进度、方案和总控计划重放到该最新事实，避免把 Wave 1-A 追加加固回退成“未合并”。

## 允许修改

- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `docs/product/user-center-commercial-closure-plan-2026-07.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave0-wave1-program.md`
- `.ccg/tasks/user-center-plan-status-followup-20260717/**`

## 禁止修改

- `apps/**`、`services/**`、`packages/**`、`legacy-miaoda/**`
- 数据库迁移、生产配置、密钥、部署、支付、打印或 Windows Terminal Agent
- Wave 1-B/Wave 1-C 的运行时代码、可见入口或完成状态
- 历史实施清单的逐项复选框

## 事实与验收

- PR #270（`88e940cd`）已合入主线，GitHub Actions `29552177099` 两个 job 均成功，未部署。
- Wave 1-B 是下一开发波次；不可逆注销继续等待法务分类留存矩阵、冷静期与执行开关。
- 验证 Markdown 链接、状态断言、JSON、`git diff --check` 与范围检查；复审结果如实记录。
