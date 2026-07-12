# 青序 LightFlow 三端全页面 UX 治理

## 目标

- 将用户已确认的视觉体系正式命名为「青序 LightFlow」。
- 保留工程内部 `service-desk` 命名，避免品牌命名引发无业务价值的代码重命名。
- 从最新 `origin/main` 重新盘点 Kiosk、Admin、Partner 的正式路由与页面承载文件。
- 把全页面迁移拆成可以独立验证、独立回滚的 UI-0 至 UI-4 分波计划。

## 本任务允许修改

- `docs/superpowers/specs/2026-07-11-service-desk-commercial-ux-migration-design.md`
- `docs/superpowers/plans/2026-07-11-service-desk-ui0-ui1-first-batch.md`
- 新增的青序全页面迁移总计划与页面盘点文档
- 旧视觉文档的状态说明
- 两份进度 SSOT，仅在事实已验证后更新
- 本 CCG 任务记录

## 本任务禁止

- 不修改 `apps/`、`services/`、`packages/` 运行时代码。
- 不执行页面换装、路由改造、API、权限、支付、打印、扫描或 AI 逻辑变更。
- 不吸收主工作区或其他 worktree 的未提交改动。
- 不把 4188 原型状态冒充正式页面已经迁移。
- 不一次性生成无法独立验证和回滚的全仓重写计划。

## 验收

- 所有页面以最新路由表和真实源文件为依据，不凭旧文档猜测。
- 品牌名、工程命名、证据等级和实施授权边界不互相冲突。
- 每个迁移波次具有明确页面域、文件预算、验证命令、浏览器视口和停止条件。
- 本任务只交付规范与计划，不宣称正式页面已经重构。
