# 最终审查与验证记录

## 结论

- 当前运行态：`KEEP_CURRENT_STATE`。
- Critical / High：0。
- 仓库契约：`engines.node >=22.13 <23` 与 pnpm 11.2.2 的最低 Node 要求、CI Node 22 和预生产 Node 22.23.1 一致。
- 本次没有激活独立 release，没有部署业务代码或前端；线上仅变更 PM2 应用解释器。

## 模型审查

- 分析阶段 Antigravity 与 Claude 都拒绝“新 release 脚本 + 旧 cwd”的裂脑方案；该方案已废弃。
- Claude 终审：Critical 0，结论 `KEEP_CURRENT_STATE`。两项 Warning 为回滚顺序与 `pm2 save` 默认 `0644` 的 SOP 缺口，均已补入 `docs/device/production-deployment-runbook.md`。
- Antigravity 终审首次及按用户要求重试均因其账号/资格服务返回 `admin controls not applicable` / `WaitForReady timeout`，没有有效模型报告；未伪写为通过。

## TDD 与本地门禁

- RED：verifier 精确拒绝原 `engines.node >=20.19`。
- GREEN：改为 `>=22.13 <23` 后，Node 22 + pnpm 11.2.2 clean frozen install 和 dependency security gate 通过。
- 全 workspace typecheck、lint（0 error；Kiosk 4 条既有 Fast Refresh warning）、API build、三端带正式参数 production build、Terminal Agent build 通过。
- release provenance / genesis fixture 全通过。

## 独立 release 证据（未激活）

- release ID：`preprod-node22-a7cfb5d9-20260726t122504z`；source commit：`a7cfb5d931ca5766c1ed3e62850626406aa76377`。
- Node 22.23.1 + pnpm 11.2.2 fresh frozen install；`better-sqlite3` 以 Node 22 headers 源码编译成功。
- 两套 custom Prisma Client、`better-sqlite3`、SWC、msgpackr 原生加载通过；API 与三端生产构建通过。
- PostgreSQL 仅执行 `prisma migrate status`，结果 up-to-date；未 deploy/resolve/seed。
- manifest 前精确核对并移除 9 个仅用于 root workspace 聚合的 pnpm 链接：
  - `@ai-job-print/admin`
  - `@ai-job-print/api`
  - `@ai-job-print/kiosk`
  - `@ai-job-print/partner`
  - `@ai-job-print/refresh`
  - `@ai-job-print/shared`
  - `@ai-job-print/ui`
  - `@ai-job-print/worker`
  - `terminal-agent`
- 移除后 manifest create / verify 通过；候选仍未切流。

## PM2 切换与回滚证据

- 原 script `/srv/ai-job-print/services/api/dist/main.js`、cwd `/srv/ai-job-print/services/api`、完整 API provenance 和代码哈希均未改变。
- 首次切换在 Node 22 下健康启动，但 `pm2 save` 默认生成 `0644` dump，安全门禁触发并自动恢复 Node 20；恢复后 health 正常。
- 第二次切换在 save 后立即把 `/root/.pm2/dump.pm2` 收紧为 `0600`，最终：online、restart 0、unstable 0、Node 22.23.1、绝对 interpreter `/usr/local/bin/node`，真实进程 exe 为 `/opt/node-v22.23.1-linux-x64/bin/node`。
- PM2 daemon/systemd 继续由 Node 20 pin 驱动；dump 固化绝对 Node 22 interpreter。未额外执行 kill/resurrect 或 reboot，避免第二次无必要业务中断。
- root-only 回滚目录保留原 dump、unit/drop-in、DEPLOY_SOURCE 和脱敏进程摘要。
- 本机与公网 health 为 `ok/postgres`，Kiosk/Admin/Partner HTTPS 200；稳定复核仍为 restart 0、unstable 0。

## 无副作用边界

- 未运行 migration deploy/resolve/seed。
- 未修改数据库、Redis、COS、短信、账号、手机号或环境密钥。
- 未覆盖当前 `node_modules`，未改业务代码或前端产物，未启用 production F1 Genesis。
