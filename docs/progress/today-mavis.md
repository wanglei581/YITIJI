# 2026-05-30 Mavis 今日动手清单

## 角色

P0 冲刺 W1 Day 1。负责 Mavis 独占目录内的标准 UI 增强与现有页面修补。

## 将编辑/新建的文件

- `apps/partner/src/routes/dashboard/index.tsx` — P1 Partner 工作台 D 方案：合规提示占位、8 个核心数据卡、趋势折线、今日待办、绑定终端状态、快捷操作、热门 TOP5。
- `docs/progress/today-mavis.md` — 当日意图与完成记录。

## 将新增/修改的共享类型契约(packages/shared)

无。

## 将安装的依赖

无。等待 Claude 完成依赖安装，今日图表用轻量 SVG / CSS 实现，不触碰 `pnpm-lock.yaml`。

## 阻塞 Claude 的事项

无。Mavis 今日只动 Partner 独占目录，不触碰 `packages/ui` / `packages/shared` / Prisma / API / Kiosk resume。

## 预计完成时间

EOD UTC+8。

## 完成清单(下班前更新)

- [x] Partner 工作台 D 方案完成：已在 `apps/partner/src/routes/dashboard/index.tsx` 实现合规提示占位、8 个核心数据卡、两组内联 SVG 趋势折线、今日待办 6 项、绑定终端状态、快捷操作 8 项、热门岗位/招聘会 TOP5，并保留优化最近同步记录。
- [x] 验证命令通过：`pnpm --filter @ai-job-print/partner typecheck` → 通过（`tsc --noEmit` 无错误）。
- [x] 验证命令通过：`pnpm --filter @ai-job-print/partner build` → 通过（`tsc -b && vite build`，Vite 构建成功；仅出现 Node `DEP0205` deprecation warning）。
- [x] 合规禁词检查：dashboard 页面未出现 `一键投递` / `立即投递` / `平台投递` / `企业收简历` / `候选人管理`。
- [x] 本任务仅修改允许文件：`apps/partner/src/routes/dashboard/index.tsx`、`docs/progress/today-mavis.md`。工作区中 `packages/ui` / `packages/shared` 相关变更为本任务开始前已有协作变更，本任务未编辑。
- [x] 提交分支 `feat/p0-w1-mavis-partner-dashboard`
