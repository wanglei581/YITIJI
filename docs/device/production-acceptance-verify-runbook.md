# 生产验收 Verify Runbook（WP4 PostgreSQL + WP5 核心 verify）

> 2026-07-02。配套计划 [WP4/WP5](../superpowers/plans/2026-07-02-launch-blockers-resolution-plan.md)。
> 详细验收口径以 [production-deployment-and-windows-host-checklist.md](./production-deployment-and-windows-host-checklist.md) §3.4–§3.8 和 [postgres-operations.md](./postgres-operations.md) 为准；本文件只做**执行顺序 + 命令串 + 前置依赖**，不另造口径。
> 前提：在**生产服务器**执行；**必须先完成 WP1 密钥轮换**（否则联网类 verify 会因密钥失败）；所有 verify 必须跑在 **PostgreSQL** 环境（不是误连 SQLite）。

---

## 执行顺序总览
WP1 密钥就绪 → A. PG 空库部署 → B. 环境/连接自检 → C. 核心 verify → D. 生产门禁 verify → E. 联网真实服务 verify → 回写。

---

## A. PostgreSQL 空库部署（对应 checklist §3.4 / §3.5）
按 [postgres-operations.md](./postgres-operations.md) 执行，关键命令：
```bash
# 生产 .env 已配 DATABASE_URL=postgres://...（不是 sqlite）
pnpm --filter @ai-job-print/api db:pg:deploy      # 空库 migrate deploy
# 如有 SQLite 旧数据 → 走 §3.5 迁移演练，先备份、空库保护、行数对账
```
验收：`migrate deploy` 通过、PG schema 无漂移、外键/唯一约束生效、`pg_dump` 备份可恢复到临时库；`verify:demo-seed-guard` 通过且生产未执行任何 `db:seed*`。现有生产恢复沿用已存在的管理员账号；全新生产空库在受审的首个管理员 bootstrap 补齐前保持 **NO-GO**。

## B. 环境与连接自检
```bash
pnpm --filter @ai-job-print/api verify:production-db-guard   # 确认连的是 PG、生产库守门
curl -fsS http://127.0.0.1:<apiPort>/health                  # 健康端点，期望 db=postgres
```
验收：`verify:production-db-guard` 通过；`/health` 返回 `db=postgres`；API 启动日志显示连接 PostgreSQL。

## C. 核心 verify（对应 checklist §3.6，至少覆盖）
```bash
pnpm --filter @ai-job-print/api verify:member-assets-c2d
pnpm --filter @ai-job-print/api verify:mock-interview
pnpm --filter @ai-job-print/api verify:job-fit
pnpm --filter @ai-job-print/api verify:resume-optimize
pnpm --filter @ai-job-print/api verify:career-plan
pnpm --filter @ai-job-print/api verify:activity-logs
# 或聚合：
pnpm --filter @ai-job-print/api verify:member-login-data-closure
```
验收：全部 PASS；**日志无简历原文/面试回答/转写文本/规划正文/API Key/access token**；确认跑在 PG。

## D. 生产运行门禁
```bash
pnpm --filter @ai-job-print/api verify:production-runtime-gates
```
验收：生产必需环境变量齐全、fail-closed 门禁通过（此项也是 WP1 轮换后的总校验）。

## E. 联网真实服务 verify（依赖 WP1 新密钥）
```bash
pnpm --filter @ai-job-print/api verify:cos:live          # COS 新密钥
pnpm --filter @ai-job-print/api verify:cos:files
pnpm --filter @ai-job-print/api verify:ocr-baidu-live    # 百度 OCR 新密钥
pnpm --filter @ai-job-print/api verify:production-real-services
pnpm --filter @ai-job-print/api verify:toolbox-preprod-acceptance   # 百宝箱预生产
```
验收：联网 verify 全 PASS；失败即回到 WP1 查对应密钥。

## CI 对齐
确认 GitHub Actions 主 CI + `postgres-readiness` job 双绿（`.github/workflows/ci.yml`）。

## Done（WP4+WP5）
A–E 全通过 + `/health` = PG + 日志无敏感正文 + CI 双绿 → 回写 [current-progress.md](../progress/current-progress.md)，列已通过脚本，不贴任何密钥/正文。

---

## 一键只读巡检（发布后 / 上线彩排复验）

在**开发机**对公网复验，不登录服务器、不读密钥、不写任何数据。本机 DNS 把 `*.sslip.io` 劫持到 `198.18.1.0`，脚本按 IP 建连并用 `servername` / `Host` 指定域名（等价 `curl --resolve <域名>:443:<IP>`），见 [production-server-cleanup-2026-09-06.md](./production-server-cleanup-2026-09-06.md) §八「复验探针注意」。

```bash
node scripts/prod-readonly-probe.mjs
node scripts/prod-readonly-probe.mjs --host <生产服务器 IP> --domains zyidai.cn,admin.zyidai.cn,partner.zyidai.cn
node scripts/prod-readonly-probe.mjs --expect-sha <本次发布 SHA 前缀>
node scripts/prod-readonly-probe.mjs --json
# 发布后核对：必须在演示企业用 #1115 下架之后跑。下架前公开列表里还有演示企业，退出码会非 0。
node scripts/prod-readonly-probe.mjs --strict
```

`--expect-sha` 只打印在报告头，请人工与服务器 `DEPLOY_SOURCE.txt` 核对。`--scheme http` / `--port` 仅供本地桩，CI 门禁 `pnpm verify:prod-readonly-probe` 不连生产。

有 FAIL 退出码 1，WARN / INFO 仍为 0。不带 `--strict` 时，公开列表 `total=0` 是 INFO（内容录入是负责人的事），不是 FAIL。岗位、招聘会、政策、线下机构取第一页（`pageSize=50`），用户看得见的名称、标题、来源名、机构名里出现全角「（演示）」则 WARN 并列出前 3 个名字，没有则 PASS 并注明「无演示标记」；企业列表仍用宽匹配（演示|示例|测试数据|demo|sample），不收窄。线下机构若返回空数组，按 0 条记 INFO。

发布后核对加上 `--strict`（演示企业已用 #1115 下架之后）：岗位、招聘会、企业三条数非 0 即 FAIL，这三项为 0 且无演示标记则为 PASS；上面五个公开列表里任一处出现演示标记也从 WARN 改为 FAIL，退出码非 0。政策与线下机构的条数本身不要求为 0。

| 项 | 判定 |
|---|---|
| `GET /api/v1/health` | 200 且 `data.status=ok`、`data.db=postgres`、`degraded=[]`；否则 FAIL，打印原文前 200 字 |
| `GET /api/v1/health/ready` | 200 |
| 三域名 `GET /` | 200，抽出 `assets/index-*.js` hash；同一 hash 出现在两个域名上 WARN（打到了默认 vhost） |
| `GET /api/v1/jobs?pageSize=50`、`/job-fairs`、`/policies`、`/kiosk/offline-agencies` | 取 `pagination.total`、`total` 或数组长度；不带 `--strict` 时 0 为 INFO。名称类字段含全角「（演示）」不带 `--strict` 为 WARN，否则 PASS（无演示标记）。`--strict` 下岗位、招聘会条数非 0 为 FAIL，为 0 且无标记为 PASS；四个列表的演示标记一律 FAIL |
| `GET /api/v1/companies?pageSize=50` | 不带 `--strict` 时条数规则同上；演示标记用宽匹配（演示\|示例\|测试数据\|demo\|sample），命中 WARN。`--strict` 下条数非 0 或命中宽正则都 FAIL |
| `GET /api/v1/kiosk/legal/privacy_policy`、`/terms_of_service`、`/ai_disclaimer` | 200 且 `data` 非空。`ai_disclaimer` 未激活时接口仍是 200、`data` 为 null，按 data 为空 FAIL |
| `GET /api/v1/kiosk/legal/unknown_type` | **400**（#835） |
| `POST /api/v1/terminals/session-token` 空体 | **400**（存在，非 404；#833） |
| `GET /api/v1/admin/alerts?limit=5` 无鉴权 | **401**（#841 端点存在且受保护） |
