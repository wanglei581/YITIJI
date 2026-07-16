# 用户中心计划状态校准

## 真实闭环

让用户中心的方案、总控计划与进度入口准确反映已进入 `origin/main` 的 Wave 0、授权撤回终态保护与 Wave 1-A 账户安全底座，避免后续从已过时的“尚未开工 / 待合入”状态继续实施。

## 允许修改

- `.ccg/tasks/user-center-plan-status-reconcile-20260716/**`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `docs/product/user-center-commercial-closure-plan-2026-07.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave0-wave1-program.md`

## 禁止修改

- `apps/**`、`services/**`、`packages/**`、`legacy-miaoda/**`
- 数据库迁移、生产配置、密钥、部署与 Windows Terminal Agent 链路
- Wave 1-B 数据权利执行器、Wave 1-C 运营 UI 的运行时代码或完成状态
- 历史详细实施计划的逐项复选框

## 已核验事实

- 用户中心方案文档：PR #259 已合入主线。
- Wave 0 真值基线：PR #261（`0c4cdd57`）已合入主线。
- 授权撤回终态保护：PR #263（`4f8084d1`）已合入主线。
- Wave 1-A 账户安全：PR #265 的核心提交 `2c58ef6e` 与最终验证归档已在 `origin/main@f69bf1b7`。
- Wave 1-B 数据权利、Wave 1-C Admin/Kiosk 隐私运营 UI、不可逆注销执行与生产部署仍未完成。

## 验证

- Markdown 相对链接与同仓引用存在。
- 没有残留“Wave 0 尚未开工”“先集成用户中心方案文档”或“PR #265 待 CI / 未合并”的当前状态表述。
- `git diff --check`、目标 Markdown 的 Prettier 检查和变更范围检查通过。
- Claude 与前端审查模型均尝试复审；任一无有效报告须如实记录，不能写为双模型通过。
