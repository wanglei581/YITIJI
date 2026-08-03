# 预生产完整 API 发布终审

## 结论

- PR #394 已 squash 合入 `main@1812ba54`；main push CI run `30195031110` 三项全绿。
- 预生产完整 API 候选已发布，Antigravity 与 Claude 均结论 `KEEP DEPLOYED`。
- 部署级 Critical/High：0。
- 服务器独有 PostgreSQL migration 缺于 Git main 是既有履历漂移，不是本轮引入，也不能通过回滚本轮解决；作为独立 P1 治理任务处理。

## 候选与发布证据

- 隔离候选完成冻结安装、双 Prisma client generate、API build、手机号转移专项 verifier。
- 发布前后 `services/api/dist` 均为 1959 文件，逐文件 SHA-256 完全一致。
- 最终 artifact SHA-256：`a4d1fb745db3f173f4834672922a679e94f0a929d91c36bf59d13a7436e40e25`。
- manifest SHA-256：`910abcdbb9abf748a2baa55109cc70347839589964261ef98abfe556018f2058`。
- 代码回滚点：`/srv/ai-job-print-api-backups/full-api-1812ba54-20260726T165517+0800`。
- 私有数据库备份：`/srv/db-backups/pre-full-api-1812ba54-20260726T165517+0800.dump`，1,942,341 bytes，`pg_restore -l` 通过。
- PM2 restart `24→25`，PID `2423235`，online；60 秒稳定检查和独立 postflight 通过。
- 本机/公网 health 为 `ok/postgres`，Admin/Kiosk/Partner 200，前端 bundle 不变，新增 fatal 日志模式 0。
- `.env`、两级 `node_modules`、运行时 `storage`、Prisma、Redis、COS、短信与业务数据未修改；未调用认证/短信/手机号转移写接口。

## Fail-before-cutover 记录

1. 首包携带 macOS xattr，在 Linux 解包生成 AppleDouble，dist manifest 由 1959 变为 4023；门禁停止且无 cutover。最终使用 `COPYFILE_DISABLE=1` 与 `--no-xattrs` 重打包，远端 dry-check 为 AppleDouble 0、dist 1959、manifest 匹配。
2. `dotenv` 默认 stdout 提示污染连接串，以及 `PGDATABASE` URI 假设不成立，导致两次 `pg_dump` 在切换前失败；均为 `NO_CUTOVER_PERFORMED`。最终改为 `quiet:true`、显式 PostgreSQL URI 断言、真实 `SELECT 1` 和 `pg_dump --dbname=<URI>`，连接值未输出。
3. 三次失败 staging、预检产物和零字节 dump 均移入 `/srv` 私有失败证据目录，未进入应用 serving 路径。

## 回滚 runbook

正常代码回滚不恢复数据库：本次未执行 migration/seed，运行字节发布前后相同。

1. 将当前 `services/api/dist`、`src`、`scripts` 移入新的失败目录，不直接删除。
2. 从回滚点恢复原 `dist`、`src`、`scripts`；恢复 `.env.example`、`.gitignore`、`package.json`、两份 Prisma config、`tsconfig.json` 与 `DEPLOY_SOURCE.txt`。
3. Prisma、`.env`、`node_modules` 和运行时 `storage` 全程不动。
4. `pm2 reload ai-job-print-api` 后在 20 秒内等待本机 health 恢复，并确认 `status=ok`、`db=postgres`。
5. 重新生成完整 dist manifest，与回滚点 `dist.manifest` 比对；同时复验 PM2 online、公网 health 和三端 200。任一不通过即停止并告警，不把回滚写成成功。
6. 数据库 dump 只用于经单独事故决策后的恢复；不得因普通代码回滚覆盖预生产数据库。真实 scratch restore 冒烟需要另行授权。

## 后续治理

- `20260722090000_pg_foundation_batch_tables`：服务器文件 SHA 与 `_prisma_migrations.checksum` 均为 `40ea7898186f19cc875a41071597bc7110e55a476dd2442620b0fb8a4fc80944`，记录已 finished 且未回滚。后续应按原字节回补 Git main，并在隔离 PostgreSQL 验证状态；禁止生产 `migrate reset`。
- 数据库备份仅做 TOC 可读校验，真实 scratch restore 冒烟作为另行授权任务。

## 文档 diff 复审说明

- Claude 对暂存文档与任务归档给出 `APPROVE`：未发现密钥、主机、连接串或明文手机号泄露；事实、回滚和另行授权边界一致。
- Antigravity 文档 diff 复审连续两次因其自身登录/资格状态未返回有效报告；不将空报告写成通过。部署方案与部署结果本身此前均已取得 Antigravity 和 Claude 的有效终审，结论均为 `KEEP DEPLOYED`。
