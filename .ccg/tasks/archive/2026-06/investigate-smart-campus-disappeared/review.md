# 智慧校园消失与生产数据库门禁收口报告

## 结论

- 当前分支已包含智慧校园主线基线，Kiosk/Admin/Partner 的智慧校园入口、路由、页面和后端 API 未被删除。
- 智慧校园“看不见”的主要原因是运行时配置/数据状态：`VITE_API_MODE`、`VITE_TERMINAL_ID`、终端归属、学校机构模块开关、`TerminalSmartCampusConfig`、招聘会审核发布状态、生产演示数据过滤。
- 本地并行跑 DB verify 出现的 Prisma/libSQL `P1008 SocketTimeout` 根因是多个脚本同时写同一个 SQLite `dev.db` 触发文件库写锁竞争；顺序复跑通过，不是业务链路失败。
- 已新增生产数据库门禁：`NODE_ENV=production` 且 `DATABASE_URL=file:` 时 API 启动期抛 `PRODUCTION_SQLITE_FORBIDDEN`，防止生产误用 SQLite。
- SQLite → PostgreSQL 迁移脚本的 SQLite 源库读取使用显式受控豁免，避免生产主机迁移旧数据时被门禁误伤。

## 改动范围

- `.github/workflows/ci.yml`：CI `Verify suites` 接入 `verify:production-db-guard`。
- `services/api/src/prisma/create-client.ts`：新增生产禁 SQLite 运行时门禁与迁移源库显式豁免参数。
- `services/api/scripts/migrate-sqlite-to-postgres.ts`：SQLite 源库读取使用受控豁免。
- `services/api/scripts/verify-production-db-guard.ts`：新增门禁验证脚本。
- `services/api/package.json`：新增 `verify:production-db-guard`。
- `services/api/.env.example`：补充生产禁 SQLite 说明。
- `docs/device/production-deployment-and-windows-host-checklist.md`：补充生产数据库门禁验收项。
- `docs/progress/current-progress.md`：记录本次 P0 数据库并发风险收口。

## 验证

- `pnpm --filter @ai-job-print/api verify:production-db-guard` PASS。
- `pnpm --filter @ai-job-print/api typecheck` PASS。
- `pnpm --filter @ai-job-print/api build` PASS。
- `git diff --check` PASS。
- 前置验证已通过：`verify:smart-campus-ui`、`verify:jobfair-ui`、`verify:partner-smart-campus`、`shared/api/kiosk/admin/partner typecheck`、`api/kiosk/admin/partner build`。

## 双模型审查

- Antigravity 最终复审：APPROVE，Critical/Warning/Info 均无。
- Claude 最终复审：APPROVE，无 Critical；提示上线时必须核验 `NODE_ENV=production` 精确配置，该项已在生产部署清单中体现。

## 剩余风险

- 生产禁 SQLite 只解决“误用本地文件库上线”的 P0 风险；成百上千人真实并发仍需 PostgreSQL、Redis、队列、API 实例、对象存储和外部 AI/OCR 服务的预生产压测。
- 智慧校园显示仍依赖真实终端绑定、学校机构模块开关和 Kiosk 环境变量配置；这些属于上线部署验收项，不是当前代码缺失。
