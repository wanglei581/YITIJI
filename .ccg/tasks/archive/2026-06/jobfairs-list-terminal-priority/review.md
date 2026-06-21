# 招聘会列表页本校优先接线审查

## 变更范围

- `JobFairsPage` 从 Kiosk API client 引入 `getTerminalId`。
- 列表页请求招聘会前读取当前终端，并按 `terminalId ? { terminalId } : undefined` 透传给 `getJobFairs`。
- 新增静态验证脚本，钉住列表页不再回退为无参 `getJobFairs()`。
- 同步更新 `docs/progress/current-progress.md` 和 `docs/progress/next-tasks.md`。

## 验证结果

- `node apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs`：通过。
- `pnpm --filter @ai-job-print/kiosk typecheck`：通过。
- `pnpm --filter @ai-job-print/kiosk lint`：通过，保留既有 `KioskBusyContext.tsx` Fast Refresh warning。
- `pnpm --filter @ai-job-print/api verify:jobfair-campus-priority`：通过。

## 注意事项

- API 验证使用临时 SQLite 数据库运行。历史 SQLite migrations 与当前 `schema.prisma` 存在已知漂移，临时库运行前补齐了 `Organization.contactPhone` 和 `JobFair.sourceId` 两列；这不改变仓库代码，也不影响生产 PostgreSQL 基线。
- Claude + Antigravity 双模型审查均无 Critical。双方指出验证脚本精确字符串匹配略脆，已改为空白无关正则匹配。
- 本分支不改 UI、不改后端排序逻辑、不新增招聘会报名或投递闭环。
