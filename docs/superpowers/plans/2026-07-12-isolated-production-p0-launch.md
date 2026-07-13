# Isolated Production P0 Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不复用当前预发布 COS bucket、数据库或密钥的前提下，完成独立生产环境的部署、验收和单终端试运营准入。

**Architecture:** 以最新 `origin/main` 的冻结提交构建一次不可变发布包；生产 PostgreSQL、Redis、COS、域名与密钥均为独立资源。每个写操作前均有只读预检、备份、明确停止条件和脱敏证据；浏览器、Windows 真机和商业化支付分别独立验收，互不替代。

**Tech Stack:** pnpm monorepo、NestJS/Prisma PostgreSQL、Redis、腾讯 COS、nginx/Let's Encrypt、PM2、Windows Terminal Agent、Pantum CM2800ADN Series。

---

## 范围与不变量

- 现有 `yitiji-preprod-*` COS bucket、候选 PostgreSQL、预发布主机和测试数据不得提升、复制或改名为生产资源。
- 生产值只由账号所有者写入云控制台、密钥管理系统或生产服务器的受限环境文件；本计划、Git、聊天和日志均不保存值。
- 每个线上写操作（资源创建、DNS、迁移、seed、部署、PM2 reload、浏览器写路径、打印、扫描、支付）均须在执行前取得该步骤的用户授权。
- 支付渠道默认保持 `disabled`。真实微信/支付宝只在商户资料、回调域名和一分钱验收齐备后，按单独的商业化变更窗口开启。
- 正式记录仅写入 `docs/progress/current-progress.md` 和 `docs/progress/next-tasks.md`；原始日志、截图、备份、密钥和用户文件留在受控证据/备份位置，不进仓库。
- 操作员只在受控 shell 中注入 `PRODUCTION_DOMAIN`、`POSTGRES_URL`、`RESTORE_TEST_POSTGRES_URL` 和 `PROD_BACKUP_PATH`；变量值不得出现在 shell history、截图、命令输出或本计划。

### Task 1: 冻结生产目标、授权边界与停止条件

**Files:**

- Read: `docs/device/production-deployment-and-windows-host-checklist.md`
- Read: `docs/device/production-deployment-runbook.md`
- Read: `docs/device/postgres-operations.md`
- Read: `docs/compliance/compliance-boundary.md`
- Modify after proof only: `docs/progress/current-progress.md`
- Modify after proof only: `docs/progress/next-tasks.md`

- [ ] **Step 1: 由账号所有者在受控渠道确认生产资源清单**

清单必须包含独立的生产主机、PostgreSQL、Redis、COS bucket、DNS 域名、证书责任人、云防火墙责任人、Windows 终端编号和紧急联系人。清单保存在账号所有者的受控运维系统，不写入 Git。

- [ ] **Step 2: 确认数据策略并记录授权**

默认策略为新生产库为空库：仅部署 schema 和经审核的非用户业务基础数据；不导入预发布用户、文件、订单、审计或打印任务。若确有数据迁移需求，必须另出经用户批准的数据来源、字段映射、行数对账和个人数据合规计划；未批准时不得运行 `db:pg:migrate-data`。

- [ ] **Step 3: 写明停止条件**

任一项出现即停止，不进行后续写操作：目标 bucket 名含 `preprod`、数据库或 Redis 可公网访问、证书域名不匹配、法务文本未签署、seed 默认内部账号仍可登录、备份不可恢复、CI 非绿、Windows Agent 离线或打印机不 ready。

- [ ] **Step 4: 记录该门结论**

只在全部资源身份和授权已确认后，在正式进度文档记录“生产目标已冻结”和日期；不得记录域名以外的连接信息、账号、密钥或证书序列号。

### Task 2: 创建并只读核对独立云资源与网络边界

**Files:**

- Read: `docs/device/production-deployment-and-windows-host-checklist.md`
- Read: `docs/device/secret-rotation-runbook.md`
- Read: `services/api/.env.example`
- Evidence outside Git: 云控制台截图、资源标签、网络规则导出

- [ ] **Step 1: 由云账号所有者创建独立生产资源**

创建带 `production` 标签且不含 `preprod` 名称的 COS 私有 bucket、PostgreSQL 16.x、Redis 7.x、应用主机/部署目录和异机备份位置。所有生产资源必须与当前候选 bucket、数据库和 Redis 逻辑隔离。

- [ ] **Step 2: 配置最小网络暴露面**

云防火墙只开放 HTTP/HTTPS 和经固定来源限制的管理端口；PostgreSQL 与 Redis 仅允许应用主机私网访问。操作员保存规则截图，并以外部网络探测证明数据库和 Redis 没有公网监听。

- [ ] **Step 3: 配置独立私有 COS 与生命周期**

CAM 仅授予应用所需的 bucket 动作。生命周期规则只能命中 `tmp/`；不得设置 bucket 全局过期规则，不得覆盖 `users/`、会员简历、AI 成果物或 `long_term/`。保存规则名称、前缀、天数和启用状态的截图。

- [ ] **Step 4: 配置 DNS、nginx 和证书**

使 Kiosk、Admin、Partner 与 `/api/v1/*` 都通过生产域名 HTTPS 提供服务。验收命令为：

```bash
curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}\n' "https://${PRODUCTION_DOMAIN}/"
curl --fail --silent --show-error "https://${PRODUCTION_DOMAIN}/api/v1/health"
```

证书应由自动续期服务管理；在服务器只读确认实际 timer/cron 已启用。不得用自签、hosts 映射或预发布证书替代生产证据。

- [ ] **Step 5: 提交外部资源门证据**

证据包只包含资源标签、网络规则、COS 生命周期、域名/证书状态和脱敏健康输出。未通过本门时不得写生产 `.env`、迁移或部署应用。

### Task 3: 轮换密钥、移除 seed 默认账号风险并完成法务准入

**Files:**

- Read: `docs/device/secret-rotation-runbook.md`
- Read: `docs/device/payment-production-env-checklist.md`
- Read: `services/api/prisma/seed.ts`
- Modify after proof only: `docs/progress/current-progress.md`

- [ ] **Step 1: 在生产密钥管理系统重新签发生产专用凭据**

轮换 OCR、COS CAM、LLM、ASR/TTS/TRTC、SMS、JWT、文件签名和支付会话密钥。生产 `.env` 只填变量名对应的新值；PEM 通过权限为 `600` 的受限路径引用。不得在终端回显、聊天粘贴或提交任何值。

- [ ] **Step 2: 执行 seed 内部账号安全处置**

仓库当前没有可执行的默认账号轮换脚本，因此不得假设某个 Git 路径可运行。账号所有者先在生产服务器受控控制台准备一次性轮换或禁用命令，并在不含密码/连接串的前提下展示命令结构供批准；获得该步骤授权后才执行。随后用受控登录尝试确认仓库默认口令被拒绝；输出仅记录账号标识和成功/失败，不记录密码。

- [ ] **Step 3: 完成法务与合规签署**

取得正式用户协议和隐私政策的法务批准版本，确认 90/180 天与长期成果物留存口径、第三方 OCR/AI 披露、外部投递只记录跳转、无招聘闭环和 AI 禁词扫描边界。未取得签署证据时仅可停留在技术候选环境。

- [ ] **Step 4: 完成生产环境变量脱敏预检**

在生产服务器仅检查变量是否存在和枚举值是否正确：`NODE_ENV=production`、PostgreSQL `DATABASE_URL`、`REDIS_URL`、`FILE_STORAGE_DRIVER=cos`、`TENCENT_COS_*`、OCR/LLM/ASR/SMS 配置、`CORS_ALLOWED_ORIGINS`、`PRINT_REQUIRE_PAID_BEFORE_CLAIM`、`PRINT_SCAN_CAPABILITY_MODE`。缺项或非生产配置必须在启动前修正，禁止以 local storage、SQLite 或 sandbox 回退。

### Task 4: 冻结、构建并审查待部署发布包

**Files:**

- Read: `.github/workflows/ci.yml`
- Read: `services/api/scripts/verify-production-runtime-gates.ts`
- Read: `services/api/scripts/deploy-data-safety-gate.ts`
- Read: `docs/device/production-deployment-runbook.md`
- Evidence outside Git: commit、归档 sha256、构建清单

- [ ] **Step 1: 从干净 `origin/main` 冻结目标提交**

执行：

```bash
git fetch origin
git switch --detach origin/main
git status --short
git rev-parse HEAD
```

预期：工作树无输出；记录的目标提交与最近 `build-and-verify`、`postgres-readiness` 成功 run 的 head SHA 一致。任何未提交改动、CI pending/failed 或目标 SHA 不一致均停止。

- [ ] **Step 2: 在隔离构建环境生成不可变发布包**

执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @ai-job-print/api db:pg:sync:check
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:deploy-data-safety-gate
```

预期：所有命令退出码为 0；归档记录目标提交、归档 sha256、API `dist/main.js` sha256、构建时间和上一发布标识，绝不记录密钥或连接串。

- [ ] **Step 3: 对发布候选做双模型只读审查**

Claude 与前端模型均审查 `origin/main` 到冻结提交的差异、双 Prisma migration、环境门禁和 Kiosk 生产构建。任一 Critical/High 未关闭时不得进入部署窗口。

### Task 5: 生产 PostgreSQL、Redis 与数据安全门

**Files:**

- Read: `docs/device/postgres-operations.md`
- Read: `docs/device/postgres-load-hardening-runbook.md`
- Read: `services/api/prisma/postgres/schema.prisma`
- Read: `services/api/scripts/verify-production-db-guard.ts`
- Read: `services/api/scripts/verify-db-load-indexes.ts`
- Evidence outside Git: custom-format backup、restore 日志、迁移日志、脱敏行数摘要

- [ ] **Step 1: 在空生产库生成 client 并部署迁移**

仅在 Task 1 已确认“空库、无迁移数据”时，在生产服务器的受控 shell 执行：

```bash
pnpm --filter @ai-job-print/api db:pg:generate
pnpm --filter @ai-job-print/api db:pg:deploy
pnpm --filter @ai-job-print/api db:pg:sync:check
```

预期：所有 PostgreSQL migration 成功且 schema 无漂移。若有任何 pending/failed migration 或目标库非预期空库，停止并保留日志，不运行 `db:pg:migrate-data`。

- [ ] **Step 2: 执行备份恢复演练**

在生产 PostgreSQL 可访问但不承载用户流量时，创建 custom-format 备份并恢复到独立临时数据库：

```bash
pg_dump --format=custom --file="$PROD_BACKUP_PATH" "$POSTGRES_URL"
pg_restore --list "$PROD_BACKUP_PATH"
pg_restore --dbname="$RESTORE_TEST_POSTGRES_URL" "$PROD_BACKUP_PATH"
```

预期：备份非空、目录可读、恢复退出码为 0；临时恢复库在核对后删除。`POSTGRES_URL` 只从受控环境注入，不能写入命令历史、证据或 Git。

- [ ] **Step 3: 验证 Redis、索引和生产数据库门禁**

执行：

```bash
pnpm --filter @ai-job-print/api verify:production-db-guard
pnpm --filter @ai-job-print/api verify:db-load-indexes
```

预期：两个 verify 全 PASS，且 Redis 仅可从应用主机访问。高负载索引、PgBouncer、参数调优和压测按 `postgres-load-hardening-runbook.md` 另行授权执行，不与空库上线混在同一窗口。

### Task 6: 受控部署、启动门禁与回滚点

**Files:**

- Read: `docs/device/production-deployment-runbook.md`
- Read: `docs/device/production-acceptance-verify-runbook.md`
- Read: `services/api/src/config/production-runtime-gates.ts`
- Modify after proof only: `docs/progress/current-progress.md`

- [ ] **Step 1: 进入部署窗口前做只读预检**

核对目标提交、发布包 sha256、上一发布目录、磁盘预算、生产 `.env` 权限、PM2 当前 `pm_cwd`/`pm_exec_path`、nginx 配置和数据库备份。任一检查失败时取消窗口，不替换目录、不 reload PM2。

- [ ] **Step 2: 使用既有 release/软链流程切换发布包**

按 `production-deployment-runbook.md` 的 release 目录流程部署冻结包；先保持上一 release 可回退，再执行 PM2 reload。`DEPLOY_SOURCE.txt` 仅记录提交、包 hash、构建 hash、时间和 previous release，不记录秘密。

- [ ] **Step 3: 运行启动与数据安全门**

执行：

```bash
pnpm --filter @ai-job-print/api deploy:data-safety-gate -- before
pnpm --filter @ai-job-print/api verify:production-runtime-gates
curl --fail --silent --show-error http://127.0.0.1:3010/api/v1/health
pnpm --filter @ai-job-print/api deploy:data-safety-gate -- after
```

预期：health 报告 `db=postgres`；运行时门禁和数据安全门通过；PM2 实际指向新 release 的 `services/api/dist/main.js`。任一失败时按 runbook 回到上一 release；不得用“进程 online”替代这些证据。

### Task 7: 生产浏览器、文件资产和 Windows 现场验收

**Files:**

- Read: `docs/acceptance/user-file-assets-trial-acceptance.md`
- Read: `docs/acceptance/print-scan-field-execution-runbook.md`
- Read: `docs/device/production-deployment-and-windows-host-checklist.md`
- Evidence outside Git: 脱敏浏览器截图、Windows Event Log、Agent 日志索引、COS/PG 审计查询

- [ ] **Step 1: 用受控真实会员完成浏览器资产证据包**

覆盖手机号/QR 登录、上传、90/180 天留存、长期成果物确认、重登查看、删除、过期清理、`long_term` 防误删、审计日志，以及岗位/招聘会/政策的来源跳转记录。任何测试文件、会员、订单和产物按精确 ID 清理；不得用 SQLite/local storage 或预发布结果替代生产证据。

- [ ] **Step 2: 在 Windows 一体机完成硬件全链路**

确认 Agent 服务自启、DPAPI 凭据、打印机 `printerName`、本地桥接 Origin/令牌、在线/离线恢复、A4/黑白/彩色/份数/双面、打印失败回传、扫描 SMB/ADF、U 盘一次性 `safeId` 和敏感文件清理。打印/扫描实际执行前必须取得单独现场授权；不允许以心跳或 Windows Event Log 替代所有纸面与扫描验收。

- [ ] **Step 3: 保持支付与收费边界**

基础上线期间 `PAYMENT_PROVIDER` 保持 `disabled`，不进行真实扣款。若运营需要收费，另开支付窗口：先由商户完成微信/支付宝资料和 HTTPS 回调域名，再按 `payment-production-env-checklist.md` 配置，并在一分钱 live 冒烟、退款和对账验收后才开放真实支付。

### Task 8: 单终端试运营与上线判定

**Files:**

- Read: `docs/device/production-deployment-and-windows-host-checklist.md`
- Modify after proof only: `docs/progress/current-progress.md`
- Modify after proof only: `docs/progress/next-tasks.md`
- Evidence outside Git: 首日监控与问题记录

- [ ] **Step 1: 只开放 1 台终端和 1 台打印机**

仅启用通过 Task 7 的能力；未验收扫描、语音、U 盘或支付能力保持不可用或诚实提示。现场人员必须掌握停止终端、切换人工服务和日志保留流程。

- [ ] **Step 2: 观察首日指标并处理阻塞项**

观察 API 错误率、登录成功率、上传/OCR/AI 失败率、打印 pending/failed 堆积、Agent 在线率、PostgreSQL 连接/慢查询/磁盘和 Redis 内存/队列。任何数据安全、支付、打印伪成功、敏感文件泄露、招聘合规或设备阻塞问题均停止扩大范围。

- [ ] **Step 3: 形成正式上线结论**

只有 Task 1–8 的证据完整、阻塞项关闭且回滚路径可用时，才在进度文档写“生产就绪”。否则只记录已通过门与下一阻塞项，不得把预发布、CI 或单项真机结果表述为整体生产完成。

## 执行前复核

- 本计划没有创建第二套架构：它只编排现有 `production-deployment-and-windows-host-checklist.md`、PostgreSQL 运维手册、支付环境清单和现场验收 runbook。
- 本计划不包含应用代码改动；运行时变更、数据库迁移、密钥、DNS、云资源和 Windows 操作均在明确授权后由对应责任人执行。
- 本计划的唯一生产资源假设是“独立于预发布”；任何目标仍指向 `preprod` bucket/数据库/密钥时必须回到 Task 1 停止。
