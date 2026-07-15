# F0 终端机队只读总览需求

## 目标

在既有 Admin `/devices` 页面内新增「设备总览」标签，面向 5–50 台 Windows 终端展示只读健康、Agent 版本、机构/位置摘要、屏保/智慧校园/百宝箱受限配置摘要和原页面深链。

## 允许范围

- `services/api/src/device-fleet/`：新增管理员只读白名单投影。
- `apps/admin/src/routes/devices/` 与现有 Admin API 适配器：新增同页标签与只读展示。
- `services/api/scripts/`、`apps/admin/scripts/`、两端 `package.json` 与 `.github/workflows/ci.yml`：新增专项回归门禁。
- `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`：同步真实状态。

## 禁止范围

- 不新增或修改 Prisma schema / migration。
- 不修改 `apps/terminal-agent`、`apps/kiosk`、打印任务、支付、生产配置或凭据。
- 不新增 POST / PUT / PATCH / DELETE，不写审计或数据库，不触发真实换机。
- 不返回或显示 MAC、IP、绑定码、令牌、设备指纹、文件、打印任务、扫描任务或用户数据。
- 不新增 Admin 一级路由、Kiosk、首页或「我的」入口。
- F1/F2 继续 `CLOSED_MODE`；候选机、切换、发布、回滚不出现在 F0 契约中。

## 冲突规则

- 配置记录可能以 `Terminal.terminalCode` 或 `Terminal.id` 作为既有兼容引用。
- 两种引用同时存在、跨终端命名空间碰撞或配置无法归属时，必须返回脱敏冲突摘要；禁止按优先级静默选择或合并。
- F0 只展示 `terminalCode`，不得把内部 `Terminal.id` 返回前端；原终端页深链使用既有 `search=<terminalCode>`。

## 验收

- 后端专项 verify 先失败后通过，覆盖健康枚举、受限配置计数、三类引用冲突、孤儿配置计数、敏感键递归排除和纯 GET/admin 守卫。
- Admin 专项 verify 先失败后通过，覆盖同页标签、HTTP/mock 双出口、30 秒安全刷新、无写操作、无敏感字段、原页面深链和可访问性文字状态。
- API/Admin typecheck、lint、build、`db:pg:sync:check`、专项 verify、`git diff --check` 通过。
- 不执行生产、Windows、打印、真实换机或 live 后端写入。
