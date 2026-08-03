# S0-A 用户可见真实性收口

## 功能归位声明

- 真实闭环：招聘会统计 unsupported 状态、智慧校园开通口径、校园 AI 模拟面试路由。
- 前端：仅修改既有 Kiosk 页面和既有 verify，不新增入口、路由或页面。
- 后端：仅收紧既有招聘会统计服务返回值，不新增表、事件系统或接口。
- 共享类型：仅把没有真实来源的统计字段表达为可空/unsupported。
- 终端、共享 UI、数据库、生产配置、硬件：均不涉及。
- 文档：完成后只更新正式进度文档和任务审查记录。

## 允许修改

- `services/api/src/jobs/jobs-kiosk.service.ts`
- `services/api/src/jobs/jobs-shared.ts`（2026-07-28 阻塞复核后批准：只允许同步 `FairStatsDto` 可空契约）
- `packages/shared/src/types/fairDto.ts`
- `services/api/scripts/` 中一个最小招聘会统计契约 verify（确有必要时）
- `services/api/package.json`（仅为注册上述 verify）
- `apps/kiosk/src/pages/job-fairs/FairStatsPage.tsx`
- `apps/kiosk/src/pages/job-fairs/components/FairDataScreen.tsx`
- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/src/pages/smart-campus/SmartCampusHomePage.tsx`
- `apps/kiosk/scripts/verify-smart-campus-ui.mjs`
- `apps/kiosk/src/pages/campus/components/CampusTabs.tsx`
- `apps/kiosk/tests/visual/fusion-w4.spec.ts`（仅补真实点击路由回归）
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/phase0-s0a-truthfulness-20260728/**`

## 禁止事项

- 不新增数据库表、迁移、事件系统、依赖、入口、路由或后台。
- 不修改 `apps/kiosk` 首页，不实现新 AI OS、小程序或统一任务中心。
- 不借本次范围扩展改造 API 的 CommonJS/ESM、tsconfig、workspace 依赖或共享包出口。
- 不操作生产、密钥、真实用户数据、支付、Windows 终端或打印扫描硬件。
- 不用固定 `0`、动画、假实时或“已开通”包装没有真实来源的数据。

## TDD 与验收

1. 每个子任务先增加断言并执行得到预期失败（RED）。
2. 最小实现后执行同一断言通过（GREEN）。
3. 运行 Kiosk/API 相关 verify、typecheck、lint、build。
4. Claude、Cursor、Antigravity 分层交叉审查；Codex 独立复跑并决定是否合并。

## 停止条件与回滚

- 若需要新数据模型、事件采集或重做 API，停止扩展，只隐藏或明确 unsupported。
- 回滚按 A1/A2/A3 独立提交执行；若回滚会恢复虚假口径，则临时关闭相应入口。
