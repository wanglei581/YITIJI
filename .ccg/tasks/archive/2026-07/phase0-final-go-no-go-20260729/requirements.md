# Phase 0 最终 GO/NO-GO 验收要求

## 目标

以 `origin/main@e7d0866e` 为唯一代码基线，对照正式产品范围、合规边界和生产验收清单，签发可复验的 GO / CONDITIONAL GO / NO-GO 结论。

## 功能归位声明

- 业务闭环：正式上线准入与阻塞项收口。
- 前端：只读核验 `apps/kiosk`、`apps/admin`、`apps/partner`，不修改生产页面。
- 后端：只读核验 `services/api`、`services/worker`，不修改接口、数据库或迁移。
- 终端：只读核验 `apps/terminal-agent` 与既有真机证据，不操作 Windows 或硬件。
- 共享类型 / UI：只读核验，不修改。
- 文档：允许新增最终审计报告与执行计划，并同步 `current-progress.md`、`next-tasks.md`。

## 允许修改

- `.ccg/tasks/phase0-final-go-no-go-20260729/**`
- `docs/superpowers/plans/2026-07-29-phase0-final-go-no-go.md`
- `docs/reviews/phase0-final-go-no-go-2026-07-29.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

## 禁止修改

- `apps/**`
- `services/**`
- `packages/**`
- 数据库、生产环境、密钥、Windows Terminal Agent 和打印扫描设备

## 判定原则

1. “代码已实现”“CI 通过”“预发验证”“当前生产版本验证”“Windows 真机验证”五类证据必须分开。
2. 正式验收清单中任一硬性 P0 未关闭，不能签发正式生产 GO。
3. 不把 P1 体验优化、后台信息架构收敛或二期能力误判为上线阻塞。
4. 不把历史真机或历史 live 结果冒充当前主干部署版本的完整验收。
5. 不新增功能，不借审计扩大产品范围。

## 验证范围

- 最新主干 GitHub CI 与发布来源证据。
- 本地依赖安全、类型、构建、核心 verify 与静态真实性门禁。
- Kiosk 1080×1920 / 移动端已有浏览器回归证据。
- Admin / Partner 生产 HTTP 模式与防 mock 门禁。
- PostgreSQL、生产配置、外部真实服务、法务与密钥状态。
- Windows Agent、打印、扫描、U 盘、支付、断网恢复、试运营证据。
