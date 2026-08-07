# 生产 API/Kiosk/DB 错位清单与受控发布方案

> 日期：2026-08-07
> 状态：**已按授权发布到 `main@e78f3668` 并完成线上只读验收**（Deploy run `31153754633`，2026-08-07）；发布前状态为方案 / PR 候选
> 依据：仓库只读 + 生产只读取证（root@120.48.13.190，2026-08-07）
> Claude Code 两次只读审查（含 `--bare`）均长时间无输出后终止，**未记为 Claude 审批**；本文件结论由 Codex 依据仓库规则与线上只读证据给出。

> 更新（2026-08-07）：用户授权后已以 `main@e78f3668` 执行受控发布，`DEPLOY_SOURCE`/PM2 `COMMIT` 均更新为该提交，`prisma migrate deploy` 无 pending、schema 同步通过，公网首页/健康 200、wx-login 400、contract-review 404、线下机构 200；备份与运行目录回滚锚点见 `DEPLOY_SOURCE`。本节及第 5 节步骤已由该发布实际执行验证。

## 1. 结论

生产目前处于“源码 / Kiosk / API / DB / 发布溯源”五者不一致状态，现有 Actions 部署只发布 Kiosk，会继续放大错位。必须改为**同一目标提交的受控整体发布**：备份 → additive 迁移 → API 构建/同步 → PM2 重启 → 健康检查 → 写 `DEPLOY_SOURCE` → Kiosk/nginx。发布须以仓库变量 `DEPLOY_API_ENABLED=true` 作为授权闸门，并另行确认发布窗口。

## 2. 只读证据表

| 维度 | 实测值 | 结论 |
|---|---|---|
| `origin/main` | `64e0dcba` | 当前目标基线 |
| `/root/YITIJI` HEAD | `616fd967` | 源码已接近 main，工作区干净 |
| `/srv/ai-job-print/DEPLOY_SOURCE.txt` | `source=origin/main@50896ed1`、`deployed_at=20260805T1758+0800` | 未随 Actions Kiosk 部署更新，溯源失真 |
| PM2 `ai-job-print-api` | `COMMIT=942c695a`、`STAMP=20260727T165244+0800`、script=`/srv/ai-job-print/services/api/dist/main.js`（mtime 2026-08-06 16:40） | 运行中 API 落后于源码 |
| 生产 PostgreSQL `_prisma_migrations` | 已应用 `20260730100000_add_terminal_network_diagnostics`、`20260801090000_add_contract_review_task`、`20260801130000_add_contract_review_confirmation_checkpoint`、`20260802100000_add_wx_open_id_to_end_user` | DB 超前于运行 API；其中 network diagnostics 名称出现**两条记录**，待核实 |
| `942c695a..64e0dcba` 迁移差异 | 正好新增上述 4 个迁移文件 | API 升级必须先执行 additive `db:pg:deploy` |
| `.github/workflows/deploy.yml` | 只构建/复制 Kiosk、reload nginx | 不构建/重启 API、不写 `DEPLOY_SOURCE` |
| 线上探测 | `https://zyidai.cn/` 200；`/api/v1/health` 200 且 `db=postgres` | 服务存活，但不等价于前后端一致 |
| 生产布局 | `/srv/ai-job-print` 是完整运行副本（非 git 仓库）；`.env` 与 `storage` 仅存在运行目录；`/root/YITIJI` 为 git 源码目录（无 `.env`） | API 发布必须在运行目录内保留 `.env`/`storage` |

## 3. 风险分级

- **高**：Kiosk/API 契约漂移。新前端可能调用旧 API 不存在的端点/字段（wx-login、contract review、network diagnostics、岗位匹配 JD 拆解等），表现为 404、字段缺失或入口 fail-closed。
- **高**：发布溯源失真。`DEPLOY_SOURCE` 陈旧，回滚与审计不可靠。
- **中**：DB 超前于运行 API。迁移已应用但运行代码不认识新模型/字段，功能与数据语义不一致。
- **低（当前）**：health 与首页 200、PM2/Nginx 在线，未观察到数据损坏。

## 4. 目标状态

API、Admin、Partner、Kiosk、DB 与 `DEPLOY_SOURCE` 均来自同一 `TARGET_COMMIT`；发布后 `pm2 env COMMIT == TARGET_SHA`、`DEPLOY_SOURCE.source == origin/main@<TARGET_SHA>`。

## 5. 受控发布步骤（由 deploy.yml + `.github/scripts/deploy-api-release.sh` 执行）

1. 前置：CI 三项全绿；仓库变量 `DEPLOY_API_ENABLED=true`（授权闸门）；可选 secrets `DEPLOY_API_DIR` / `DEPLOY_PM2_NAME`（默认 `/srv/ai-job-print`、`ai-job-print-api`）。
2. 源码同步到 `TARGET_SHA`（已有有界 fetch / ff-only）。
3. `pnpm install --frozen-lockfile`。
4. 构建 Kiosk。
5. 若 `DEPLOY_API_ENABLED=true`，脚本执行：
   a. 校验 `/root/YITIJI` HEAD == `TARGET_SHA`；
   b. 从运行目录 `.env` 读取 `DATABASE_URL`（不打印）；
   c. `pg_dump -Fc` + `pg_restore -l` 可读校验；
   d. `cp -a` 备份运行目录（回滚锚点）；
   e. API `db:pg:generate` + build；
   f. `rsync` 同步运行目录（排除 `.git/.claude/.ccg/node_modules/.env* /services/api/storage`）；
   g. `pnpm install --frozen-lockfile` + `db:pg:deploy`（additive）；
   h. 写 `DEPLOY_SOURCE`（含 source/ci_run/backup/runtime_backup/rollback）；
   i. `COMMIT=$TARGET_SHA pm2 restart --update-env` + 健康探测（默认 `http://127.0.0.1:3010/api/v1/health`）。
6. 未启用时 fail-closed 预检：运行 `DEPLOY_SOURCE.source` 必须等于 `TARGET_SHA`，否则禁止继续发布 Kiosk。
7. 复制 Kiosk dist 到 web root + `nginx` reload。

## 6. 回滚

- API：恢复 `$BACKUP_ROOT/pre-<sha>-<ts>.runtime` 到 `/srv/ai-job-print`（保留 `.env`/`storage`），再 `pm2 restart`。
- DB：仅 additive 迁移，通常无需回滚；确需回滚时用同一备份 dump 恢复（须另行授权）。
- 失败即退出并保留现场，不自动回滚迁移。

## 7. 授权边界

- 本 PR 只改工作流/脚本/文档，不执行生产操作。
- 合并后默认 `DEPLOY_API_ENABLED` 未设置 → 部署 fail-closed；API 不一致时连 Kiosk 也不会继续发布。
- 用户设置仓库变量 `DEPLOY_API_ENABLED=true` 并在明确窗口内触发 main CI/部署 = 生产发布授权。
- 发布前仍需确认：目标提交、发布窗口、磁盘余量（当前根盘约 80% 使用率）、可选 secrets。

## 8. 待办

- 核实 `_prisma_migrations` 中 `20260730100000_add_terminal_network_diagnostics` 重复记录。
- 选择目标提交并授权发布窗口。
- 发布后验收：`DEPLOY_SOURCE`、`pm2 env COMMIT`、health、首页 bundle，以及 wx-login / contract-review / network diagnostics 探针。
