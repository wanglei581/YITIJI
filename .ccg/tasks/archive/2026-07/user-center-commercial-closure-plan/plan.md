# 用户中心商用级闭环方案任务计划

## 本轮计划

1. 读取正式入口文档、现有用户中心源码与服务端数据关系。
2. 使用真实浏览器检查访客用户中心、设置、登录和资产门禁。
3. 运行用户中心相关静态/集成验证，区分代码失败与环境/schema 前置条件。
4. 由 Codex 做产品、触控和信息架构审计；由 Claude 独立做架构、安全、隐私和数据生命周期复核。
5. 输出审计报告和分波商用开发方案。
6. 对 Wave 0 与 Wave 1 计划做独立实现前复审，修正最新 main 事实、法务 gate、状态机、队列补偿、下载租约和弱网回执；前端模型不可用时保留失败证据并明确未完成项。
7. 从最新 `origin/main` 创建纯文档 worktree，只迁移本任务文件和对应进度事实，做链接、占位、Markdown 与 diff 验证；本轮不修改业务代码。
8. 未经明确授权不 push/merge；文档进入正式基线后再另起 Wave 0 运行时任务。

## 交付物

- `.ccg/tasks/user-center-commercial-closure-plan/review.md`
- `docs/reviews/user-center-commercial-closure-audit-2026-07-16.md`
- `docs/product/user-center-commercial-closure-plan-2026-07.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave0-wave1-program.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave0-truth-baseline.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave1-account-security.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave1-data-rights.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave1-ops-ui.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

## 推荐执行顺序

后续需用户批准后另起任务：

1. Wave 0：真实表达与验证基线。
2. Wave 1：账户安全与数据权利。
3. Wave 2：换绑与资产动作一致性。
4. Wave 3：打印售后与权益单点闭环（收费模式条件项）。
5. Wave 4：基于运营数据的体验增强。
6. Wave 5：预生产与 Windows 真机商用验收。

## 停止条件

- 未经用户批准，不进入运行时代码实施。
- 未经法务确认，不锁定账户注销冷静期、财务/审计保留期限或未成年人条款。
- 未完成支付、退款、权益和对账同版本验收，不开启收费模式。
