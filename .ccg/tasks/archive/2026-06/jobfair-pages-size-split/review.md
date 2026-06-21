# 招聘会页面大文件拆分审查记录

## 结论

- Claude：无 Critical；发现 1 个 Warning，尺寸守卫未接入 package scripts / CI 链路。
- Antigravity：无 Critical、无 Warning，结论 APPROVE；Info 提醒 `JobFairDetailTabs` 继续保留详情页专用 `MapBlock`。
- 处置：已新增 `verify:jobfair-size`，并将 `verify:jobfair-ui` 改为先执行 `verify-jobfair-page-size.mjs` 再执行原 UI 防回退脚本。CI 现有 `verify:jobfair-ui` 调用因此自动覆盖尺寸守卫。

## 验证

- `pnpm --filter @ai-job-print/kiosk verify:jobfair-size`：通过。
- `pnpm --filter @ai-job-print/kiosk verify:jobfair-ui`：通过，含尺寸守卫。
- `pnpm --filter @ai-job-print/kiosk typecheck`：通过。
- `pnpm --filter @ai-job-print/kiosk lint`：通过，只有既有 `KioskBusyContext.tsx` Fast Refresh warning。
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`：通过。

## 保留风险

- `CampusTabs.tsx` 和 `JobFairDetailTabs.tsx` 仍超过 500 行，但本次目标是主入口页面先降到 500 行以内；后续如继续扩展对应 Tab，应另起分支继续拆分。
- `JobFairDetailTabs` 保留详情页专用 `MapBlock`，这是为了保持原有 `min-h-[15rem]` 视觉行为，不与共享 `MapBlock` 合并。
