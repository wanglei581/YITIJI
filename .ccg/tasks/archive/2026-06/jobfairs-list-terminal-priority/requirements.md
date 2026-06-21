# 招聘会列表页本校优先接线

## 目标

- Kiosk `/job-fairs` 列表页读取当前终端 `terminalId`。
- 调用 `getJobFairs` 时透传 `terminalId`，复用后端已验证的本校优先排序能力。
- 增加最小静态验证，防止列表页再次回退为无参 `getJobFairs()`。

## 非目标

- 不新增页面入口。
- 不改招聘会 API 契约。
- 不改后端排序逻辑。
- 不改 `/campus` 页面行为。
- 不重排招聘会列表 UI。

## 允许修改文件

- `apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx`
- `apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/jobfairs-list-terminal-priority/**`

## 验证方式

- `node apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs`
- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `pnpm --filter @ai-job-print/api verify:jobfair-campus-priority`
