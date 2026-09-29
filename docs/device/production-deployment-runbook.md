# 生产服务器部署 Runbook（可复制粘贴执行版）

> 最后更新：2026-07-30（F1 activation 参数契约对齐，未生产执行）
> 性质：本文是「**怎么做**」的执行手册；「**验收什么 / 通过标准**」见
> [production-deployment-and-windows-host-checklist.md](./production-deployment-and-windows-host-checklist.md)。
> 两份配套使用：先按本 runbook 执行，再回到 checklist §三 / §四逐项打勾。
> 关联：[postgres-operations.md](./postgres-operations.md) | [windows-host-acceptance-runbook.md](./windows-host-acceptance-runbook.md)
>
> ⚠️ 本文所有密钥位置一律为占位符 / 生成命令，**不含任何真实密钥值**。真实值只写入服务器
> 环境，不提交仓库、不进日志、不回显到聊天。

---

## 0. 适用前提

- 资源由用户提供后才能执行：一台 Linux 或 Windows 服务器（含部署权限）、域名 + HTTPS 证书、
  生产 PostgreSQL 16.x 实例、生产 Redis 7.x 实例、腾讯云 COS 生产私有桶（已轮换密钥）。
- 本 runbook 以 **Linux + nginx + PM2** 为主线示例；Windows 服务器部署时命令等价替换
  （`pm2` 可改用 `nssm`/`node-windows` 守护，路径用 `path` 风格，secrets 生成用
  `[guid]::NewGuid()` 或 openssl for Windows）。
- 端口约定：**API 监听 3010**（以 `services/api/.env.example` 为权威；根 `.env.example`
  里的 3000 是历史值，以 3010 为准）。

---

## 1. 拉取与依赖

```bash
# 在服务器上
git clone <repo-url> ai-job-print && cd ai-job-print
git checkout main            # 部署版本必须是 main
git log -1 --oneline         # 记录部署 commit，写进 checklist §2.1

# Node >= 20，pnpm >= 9（package.json engines）
node -v && pnpm -v

pnpm install --frozen-lockfile
```

---

## 2. 生产环境变量

### 2.1 生成强随机密钥（一次性）

```bash
# 后端 4 个服务端密钥，分别独立生成，不要复用同一串：
openssl rand -hex 32   # → JWT_SECRET（≥64 hex 满足「生产 ≥64 字符」要求）
openssl rand -hex 32   # → TERMINAL_ADMIN_SECRET（64 hex）
openssl rand -hex 32   # → TERMINAL_ACTION_TOKEN_SECRET（64 hex）
openssl rand -hex 64   # → FILE_SIGNING_SECRET（HMAC 签名，≥32 字符）
openssl rand -hex 64   # → SECRET_ENCRYPTION_KEY（AES-256-GCM 凭证加密，≥32 字符）
```

### 2.2 后端 `services/api/.env`（生产）

> 权威字段清单见 `services/api/.env.example`。下面是把 dev 默认翻成生产值后的模板，
> **逐项核对 checklist §3.2**。空值处填真实值；标 `<openssl>` 的填 §2.1 生成的串。

```dotenv
NODE_ENV=production

# ── 数据库：必须指向 PostgreSQL，不能是 file: ──
DATABASE_URL="postgresql://USER:PASS@PGHOST:5432/ai_job_print"
# 迁移/部署命令专用（避免误连开发库），与 DATABASE_URL 同库即可
POSTGRES_URL="postgresql://USER:PASS@PGHOST:5432/ai_job_print"

# ── 安全密钥（§2.1 生成，每个独立）──
JWT_SECRET="<openssl rand -hex 32>"
TERMINAL_ADMIN_SECRET="<openssl rand -hex 32>"
TERMINAL_ACTION_TOKEN_SECRET="<openssl rand -hex 32>"
FILE_SIGNING_SECRET="<openssl rand -hex 64>"
SECRET_ENCRYPTION_KEY="<openssl rand -hex 64>"

# ── 对象存储：生产必须 cos（否则文件只落本机磁盘，是上线事故）──
FILE_STORAGE_DRIVER=cos
TENCENT_COS_SECRET_ID=        # 已轮换的 CAM 子用户密钥
TENCENT_COS_SECRET_KEY=
TENCENT_COS_BUCKET=<生产存储桶>
TENCENT_COS_REGION=ap-guangzhou
TENCENT_COS_SIGN_URL_EXPIRES_SECONDS=1800   # 合规上限，勿超

# COS 生命周期验收：
# 1. 禁止配置 Bucket 全局过期规则，不能用桶级 Expiration 覆盖会员文件。
# 2. long_term 长期保存文件在数据库中为 expiresAt = null，只能由用户主动删除或业务删除路径处理。
# 3. 如需 COS 侧兜底清理，只允许对 tmp/ 临时前缀配置生命周期规则，且不得覆盖长期保存对象。
# 4. 生产试运营前必须在腾讯云控制台人工验收并截图存档：规则名称、作用前缀、过期天数、启用状态。

# ── Redis：生产必配，禁止 inline 降级 ──
REDIS_URL="redis://:PASSWORD@REDISHOST:6379/0"

# ── 短信：生产必须 tencent 并填齐；审核/凭证/真号 E2E 通过前不得上线生产 ──
# 当前无“生产禁用会员短信登录但允许 API 启动”的开关；任一 TENCENT_SMS_* 缺失都会启动失败。
SMS_PROVIDER=tencent
TENCENT_SMS_SECRET_ID=
TENCENT_SMS_SECRET_KEY=
TENCENT_SMS_SDK_APP_ID=
TENCENT_SMS_SIGN_NAME=
TENCENT_SMS_TEMPLATE_ID=
TENCENT_SMS_REGION=ap-guangzhou

PORT=3010

# ── CORS：生产必配，前端 origin 逗号分隔，不带尾斜线 ──
CORS_ALLOWED_ORIGINS="https://kiosk.example.com,https://admin.example.com,https://partner.example.com"

# ── OCR：已接真百度，密钥已轮换 ──
OCR_PROVIDER=baidu
BAIDU_OCR_API_KEY=
BAIDU_OCR_SECRET_KEY=

# ── AI 诊断/优化/生成 provider ──
AI_PROVIDER=llm
AI_LLM_API_KEY=               # 生产专用 LLM Key（如 DeepSeek）
AI_RESUME_RESULT_TTL_HOURS=24

# ── 语音转写（可选；不启用则文字兜底）──
ASR_PROVIDER=disabled

# ── TRTC 语音数字人（代码冻结，凭证只改这里）──
# 详见 .env.example §TRTC；不启用语音可留空，文字助手走后台「AI模型配置」
```

> 提醒：`FILE_STORAGE_DRIVER` 不显式设 `cos` 会**静默回落 local**，文件只落本机磁盘——
> 上线前务必确认这一项。`AI_PROVIDER` / `OCR_PROVIDER` 填非法值会让 API 启动直接报错
> （不静默回退），这是预期保护。

思考模式与小青音色的在线核对用 `probe:llm-thinking-live`（在 `services/api` 目录执行；加 `--tts` 才核音色）。密钥与 API 进程同一处：文字模型先读后台 AI 槽位，再读上面这份 `.env`；音色密钥与 `TtsService` 相同。缺密钥或有一项被跳过时打印「未验证：…」，退出码非 0。只有显式加上 `--allow-skip` 才允许跳过，此时仍打印「未验证」，退出码为 0。输出里不会有密钥。这条探针不进 CI；CI 只跑离线自检 `verify:llm-thinking-live-gate`。发布清单里的同一说明见 `production-deployment-and-windows-host-checklist.md` 的 AI / ASR 两条。
### 2.2.1 运维可选配置

大厅或招聘会现场多人共用一个出口地址时，不带已验签终端的验证码请求会挤在同一个「每小时 20 条、每分钟 5 次」里。下面三个变量只放宽这一层，不配则行为和现在一样。只能写在环境变量里，后台没有开关。

| 变量 | 作用 |
| --- | --- |
| `SMS_TRUSTED_EGRESS_CIDRS` | 英文逗号分隔的地址段。IPv4 只允许 /24 到 /32，IPv6 只允许 /56 到 /128。 |
| `SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT` | 这些地址每小时最多几条。默认 100，最大 200。 |
| `SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT` | 这些地址每分钟最多几次。默认 15，最大 30。 |

地址段比上面更宽（例如 `10.0.0.0/8`、IPv6 `/48`）、格式不对，或上限不是允许范围内的整数，服务会拒绝启动。

同一手机号仍是 60 秒一次、每天 10 条；同一设备每小时仍是 20 条；全站每日短信额度也不跟着放宽。已经验签的一体机仍按每台每小时 30 条、每分钟 5 次计，不占用这里的地址额度。

某一段在一小时内的用量达到该小时上限的 80% 时，走现有运维告警推送一条（需要 `ALERT_WEBHOOK_URL`），同一段同一小时只推一次。

### 2.3 前端构建变量（三端）

三个前端 app 走同源相对路径最稳（由 nginx 反代到 API）：

```bash
# apps/kiosk/.env.local、apps/admin/.env.local、apps/partner/.env.local 各自：
VITE_API_MODE=http
VITE_API_BASE_URL=/api/v1
# kiosk 默认启用 AI 助手数字人。缺少 VITE_USE_TRTC_CALL=true 时，生产构建会直接失败，
# 避免 /assistant 未启用数字人通话入口后线上静默回落文字助手。
VITE_USE_TRTC_CALL=true
# 启用数字人时必须提供真实终端 ID，通话 session/stop 会作为 X-Terminal-Id 发给 API。
VITE_TERMINAL_ID="<注册后的 terminalId>"
# kiosk 可选：VITE_KIOSK_LOGOUT_IDLE_SEC=180
# 如本次部署明确只上线文字助手，必须显式设置：
# VITE_ALLOW_TEXT_ONLY_ASSISTANT=true
```

---

## 3. 构建

```bash
# 依赖安装只跑一次，避免多进程并发 pnpm install 导致 node_modules 锁竞争
pnpm install --frozen-lockfile

# 冷环境先生成 SQLite + PG 两套 Prisma client，生产门禁/typecheck 依赖生成产物
pnpm --filter @ai-job-print/api exec prisma generate
pnpm --filter @ai-job-print/api db:pg:generate

pnpm typecheck      # 6 包
pnpm lint           # 4 端
pnpm build          # 5 包（pnpm -r --if-present build）

# Kiosk 数字人生产构建后必须跑专项守卫。
# 它会检查 VITE_API_MODE、VITE_API_BASE_URL、VITE_USE_TRTC_CALL、
# VITE_TERMINAL_ID，以及 dist 内 AiAdvisorCall / TRTC chunk 是否存在。
VITE_API_MODE=http \
VITE_API_BASE_URL=/api/v1 \
VITE_USE_TRTC_CALL=true \
VITE_TERMINAL_ID="<注册后的 terminalId>" \
pnpm build:kiosk:production

# 如本次部署明确只上线文字助手，使用显式 text-only 守卫路径：
VITE_API_MODE=http \
VITE_API_BASE_URL=/api/v1 \
VITE_ALLOW_TEXT_ONLY_ASSISTANT=true \
pnpm build:kiosk:production
```

产物：
- 后端：`services/api/dist/main.js`（启动用 `node dist/main.js`）
- 前端：`apps/{kiosk,admin,partner}/dist/`（静态资源，交给 nginx）

---

## 4. PostgreSQL 部署（禁止 demo seed）

> 完整说明与回滚见 [postgres-operations.md](./postgres-operations.md)。命令优先用 `POSTGRES_URL`。

```bash
cd services/api

# 1) 构建会自动生成 SQLite + PG 两套 Prisma client；只执行 additive migration
POSTGRES_URL="postgresql://USER:PASS@PGHOST:5432/ai_job_print" pnpm db:pg:deploy

# 2) 漂移校验（CI 同款守门）
pnpm db:pg:sync:check

# 3) 验证 demo seed 保护契约（该 verify 不连接数据库）
pnpm verify:demo-seed-guard
```

生产和预生产均禁止执行 `db:seed*`。四个 seed 只服务可丢弃的本地开发/CI 数据库，会写入默认账号、演示终端和直接公开的岗位/招聘会/企业数据；其中企业 seed 会覆盖下架状态，场馆导览 seed 会先删除再重建配置。生产真实业务数据必须走现有 Admin / Partner 审核与发布闭环。

### 4.1 下架库里残留的演示企业（第一次发布时跑一次）

**什么时候跑**：第一次发布、迁移完成之后，且产品负责人已授权。背景：早期企业种子留在生产库里的 3 家企业，名称带「（演示）」、来源名是「市人社公共就业平台（演示）」，至今仍在公开的企业列表里；seed 保护只拦新写入，拦不住已经在库里的行。

**判据与行为**：只动 `name` 与 `sourceName` **都**含全角「（演示）」的企业；只把 `publishStatus` 改成 `unpublished`，不删行、不改其它字段；每行一条审计（`company.maintenance_unpublish`，actorRole `system-cli`，与状态改动同一事务）；已是 `unpublished` 的行跳过，重复执行无改动、无新审计。命令没有 HTTP 入口。

```bash
cd services/api
# DATABASE_URL 从受控生产环境读取，不把数据库口令写进命令历史

# 第一步：dry-run（默认，不改库）。核对「目标数据库」一行是生产 PostgreSQL 的主机与库名；
# 清单应只有那 3 家带「（演示）」的企业；末行是「将改 N 行 / 已下架 M 行」。
pnpm --filter @ai-job-print/api maintenance:unpublish-demo-companies

# 第二步：清单核对无误后，带确认词和事由（2–200 字，写进审计）执行。
UNPUBLISH_DEMO_COMPANIES_CONFIRM=UNPUBLISH_DEMO_COMPANIES \
UNPUBLISH_DEMO_COMPANIES_REASON='首次发布清理开发期演示企业（产品负责人授权）' \
pnpm --filter @ai-job-print/api maintenance:unpublish-demo-companies
```

确认词写错，或确认词对但事由缺失、不在 2–200 字：命令不连库，退出码 2。执行输出的「已下架」清单与第一步 dry-run 清单对不上（行数或 id 不同）时停下，先人工核对，不要重复执行。

执行后在仓库根目录跑只读巡检，`GET /api/v1/companies（企业 · 含演示数据检查）` 一行应为 PASS「无演示标记」，或 INFO「total=0」；仍是 WARN 就把它列出的名字报给产品负责人，不要自行扩大判据重跑：

```bash
node scripts/prod-readonly-probe.mjs
```

当前生产故障恢复沿用已存在且已轮换口令的管理员账号，**不得**运行首个管理员 bootstrap。只有迁移完成且只读查询确认 `User=0` 的真正全新 PostgreSQL 库，才可在双人复核后运行：

运行前确认生产主机 NTP 已同步；执行窗口以生产主机时间为准。凭据目录所在磁盘必须启用静态加密，且不得被未加密备份、日志采集或制品归档收集。

```bash
# 先建立仅当前 Linux 用户可访问的仓库外目录
install -d -m 700 <服务器上的初始化输出目录>

# NODE_ENV / DATABASE_URL 从受控生产环境读取，不把数据库口令写入命令历史
export FIRST_ADMIN_BOOTSTRAP_CONFIRM=CREATE_FIRST_PRODUCTION_ADMIN
export FIRST_ADMIN_BOOTSTRAP_AUTHORIZED_UNTIL='<未来10分钟内的RFC3339时间>'
export FIRST_ADMIN_USERNAME='<首个管理员账号>'
export FIRST_ADMIN_NAME='<管理员显示名>'
export FIRST_ADMIN_CREDENTIALS_OUT=<服务器上的首个管理员初始化输出文件>
pnpm --filter @ai-job-print/api bootstrap:first-admin
```

执行窗口和确认短语只用于防误操作，不是独立身份认证；真正授权来自受控 Linux 账户、生产数据库凭据和双人审批。命令只允许 `NODE_ENV=production + PostgreSQL`，在 `Serializable` 事务内要求 `User=0`，创建一个 `temporary` admin 和同事务必成功的 `auth.first_admin_bootstrap.created` 审计。初始密码由系统强随机生成，只写入 `O_EXCL + 0600` 文件，不进入 stdout、日志、环境变量或仓库。

首次使用必须通过 HTTPS 管理后台：正确初始密码只换取 10 分钟单次改密 ticket，不签发管理 JWT；设置符合商用规则的新密码后才变为 `owner_managed`，递增 `tokenVersion` 并写 `auth.first_admin_bootstrap.password_changed` 审计。随后先核对 `User=1`、两条审计齐全、新密码可登录且初始密码已失效，全部通过后才删除 0600 初始凭据文件。

若命令返回 `FIRST_ADMIN_BOOTSTRAP_RECONCILIATION_REQUIRED`，不得立即删除凭据文件或重跑。先做只读核对：

- `User=1` 且存在匹配的 `bootstrap.created`：数据库可能已提交，保留文件并继续首次改密。
- `User=0` 且无匹配审计：数据库未提交，人工删除该 0600 文件后重新申请执行窗口。
- 其他组合：状态不一致，保持 **NO-GO**，备份并人工审查；不得用 seed 或直接 SQL 补写。

### 备用管理员应急启用（主管理员账号登不上时）

**前提**：平时由主管理员在管理后台「内部账号」里建好备用管理员（`POST /admin/internal-accounts/backup-admin/*`，
要本人密码 + 备用手机号验证码；建出来是**停用**状态、随机临时密码谁都不知道、手机号已验证）。全系统最多一个。

**什么情况下执行**：主管理员账号登不上（手机丢失、人员离岗、密码与短信都走不通），且后台里已经没有能登录的
管理员可以去点「启用」。能登录后台时一律在后台启停，不用本命令。

**谁能执行**：同首个管理员 bootstrap —— 受控 Linux 账户 + 生产数据库凭据 + 产品负责人具名同意；
执行人与核对人各记一份记录。AI 与自动化流程不得执行本命令。

**两步执行**（NODE_ENV / DATABASE_URL / SECRET_ENCRYPTION_KEY 从受控生产环境读取；只认 PostgreSQL）：

```bash
# 第一步：只查看并签发确认码，不改任何账号。会打印将被启用的用户名与脱敏手机号。
export BACKUP_ADMIN_EMERGENCY_CONFIRM=ENABLE_BACKUP_ADMIN_IN_EMERGENCY
export BACKUP_ADMIN_EMERGENCY_REASON='<为什么要应急启用，2-200 字，会写进审计>'
pnpm --filter @ai-job-print/api backup-admin:emergency-enable

# 第二步：核对第一步打印的账号无误后，10 分钟内带确认码再运行一次
export BACKUP_ADMIN_EMERGENCY_CODE='<第一步打印的确认码>'
pnpm --filter @ai-job-print/api backup-admin:emergency-enable
```

确认码是用 `SECRET_ENCRYPTION_KEY` 派生的签名，绑定「账号 + 当前版本 + 过期时间」，不落库不落文件；
启用一次后自动作废，超过 10 分钟也作废（重新跑第一步即可）。命令只能启用 `isBackupAdmin=true`、停用中、
手机号已验证的那一个账号，不接受任何账号参数。第一步写审计 `user.emergency_enable_requested`，第二步在同一事务里
启用账号（`tokenVersion+1`）并写 `user.enable`，两条审计的 `actorRole` 都是 `system-cli`、payload 带事由。

**执行后必须做**：

1. 持有备用手机号的人打开管理后台登录页 →「找回密码」→ 短信验证码 → 设新密码（完成后密码状态变为 `owner_managed`）。
   开着管理员短信第二步（`ADMIN_LOGIN_SECOND_FACTOR=sms`）时也照常能登录：第二步的验证码发到同一个备用手机号。
2. 登录后先处理主账号（在「内部账号」里停用旧主账号或让本人找回），并在审计日志里核对两条 `system-cli` 记录。
3. 主账号恢复后，**第一件事**是用主账号登录，在「内部账号」里把备用管理员**先停用**，再做别的操作，
   让它回到「平时停用、应急才启用」的状态。原因：备用管理员启用后就是完整的管理员，也能停用主管理员；
   两个账号同时可用的时间越长，被人拿备用账号反手停掉主账号的窗口就越大。停用时 `tokenVersion+1`，
   备用账号已登录的会话下一次请求即 401。
   停用后在审计日志里按时间段（从第二步 `user.enable` 到本次停用）核对备用管理员做过的 `user.disable` / `user.enable`，
   如果它停用过主管理员或别的管理员而不在预期内，按安全事件处理并报产品负责人。
4. 把执行时间、执行人、核对人、事由回填到 `docs/progress/current-progress.md`（不写手机号与确认码）。

> 当前生产已经使用 PostgreSQL。旧 SQLite→PostgreSQL 全库搬数工具已在招聘内容域 P1 Wave 1A
> 退役并移除，禁止从 Git 历史恢复执行。若未来有外部旧库数据导入，必须另立具名授权的领域迁移
> 方案、只读 preflight、脱敏演练、逐模型守恒对账和失败恢复步骤；本 runbook 不提供通用搬数命令。

---

## 5. 核心 verify（在生产/预生产 PG 上跑）

> 必须在 PG 环境跑（设 `DATABASE_URL=postgresql://...`），确认不是误连 SQLite。
> 验收：全 PASS；日志无简历原文 / 面试回答 / 转写文本 / 规划正文 / API Key / token。

```bash
cd services/api
pnpm verify:member-assets-c2d
pnpm verify:mock-interview
pnpm verify:job-fit
pnpm verify:resume-optimize
pnpm verify:ocr-baidu
pnpm verify:career-plan
pnpm verify:activity-logs
pnpm verify:companies
```

---

## 6. 进程守护（API + Worker）

### 6.1 当前运行版本：不得回填

当前 production release 的 F1 发布来源仍为 **NO-GO**。本节不会授权为当前目录补写
manifest/hash/archive、替换 PM2、reload、重启或修改 ecosystem。当前直接 `dist/main.js` 的历史
守护形态不能被本文档追认成 provenance 通过。

### 6.2 未来受控 release：D3–D6 分层授权

本节是 future-only 模板，不是当前部署命令，也不授权 SSH、Genesis、切流、激活、PM2 或 Nginx
操作。受管发布必须逐层取得独立、限时、具名授权：D3 只读预检通过后才可申请 D4 零流量
Genesis；D4 证据复核通过后才可申请 D5 负载层切流；只有 managed 链已建立且 D5 完成后，才可在
D6 稳态发布中使用 `release:activate`。上一层通过不自动授权下一层，`release:activate` 不得用于
首次建链。D3 非秘密输入、状态和硬停止条件统一登记在
[`f1-d3-managed-topology-inputs.md`](./f1-d3-managed-topology-inputs.md)；职责分离、审批记录索引与具名
签批要求见
[`f1-d3-managed-topology-approval-package.md`](./f1-d3-managed-topology-approval-package.md)。后者只引用
前者的 B1–B9 状态，不建立第二套技术输入。

每层审批必须先确认部署账户可写、legacy 与 managed API 运行账户相互独立且只读，并固定以下非秘密标识：
`<MANAGED_HOST_ROLE_ID>`、`<MANAGED_PM2_HOME>`、`<MANAGED_PM2_DAEMON_ID>`、
`<MANAGED_PM2_NAME>`、`<MANAGED_LOG_ROOT>`、`<CANDIDATE_RELEASE_ROOT>`、`<ARTIFACT_ROOT>`、
`<MANAGED_CURRENT_LINK>`、`<DEPLOYMENT_CONTROL_ROOT>`、`<LAUNCHER_CWD>`、`<LAUNCHER_PATH>`、
`<RECORDED_LAUNCHER_SHA256>`、`<RUNTIME_ENV_CONTRACT_PATH>`、
`<RECORDED_RUNTIME_ENV_CONTRACT_SHA256>`，以及代码固定的
`http://127.0.0.1:3011/api/v1/health`。`<MANAGED_HOST_ROLE_ID>` 表示现有同一台 production host
上的 managed 角色，不表示新增云主机；legacy 固定 loopback `3010`，managed 固定 loopback `3011`，
两者必须同时存在且都不得对外网监听。managed 必须使用独立 Linux account、`PM2_HOME`、daemon、
应用名、dump、日志、current、artifact、control root、launcher 与 runtime contract；不得复用 legacy
控制面。release 根不得含 `.env`、日志、storage、uploads 或运行时缓存；这些目录必须位于 release 根外。

D5 确认前，批准的 Nginx 配置必须保持 `100% legacy / managed 0%`，并在 D3 固定该 legacy 配置的
SHA-256，作为尚未确认切流时唯一允许的恢复目标。D5 确认后不得把 legacy 当 fallback；后续 activation
失败只能回到再次验证通过的 managed previous。shared PostgreSQL/Redis/对象存储的副作用预算、连接
预算，以及同机 capacity/cgroup 方案都必须先在 B8 只读关闭，D1′/D2′ 不替代生产容量批准。

runtime-env contract 只列 PM2 编排命令允许继承的最小环境变量**名称与用途**，不得包含值；未经
批准的部署账户、CI、调试或管理凭据不得进入 PM2 ecosystem。该 contract 收窄的是激活器传给
PM2 命令的环境副本，不能表述为“整个 API 进程环境已被完全收窄”。`ecosystem` / `dump.pm2`、
launcher、artifact、control root 和 release 目录均须按已批准的部署账户可写、运行账户只读策略
配置，并另行提供 control root 的长期保留证明。

```bash
# 在尚未由 current 指向的 candidate release 根执行；SOURCE_ARCHIVE 必须来自已冻结的完整 commit。
pnpm --filter @ai-job-print/api release:manifest -- create \
  --release-root <CANDIDATE_RELEASE_ROOT> \
  --artifact-root <ARTIFACT_ROOT> \
  --release-id <SAFE_RELEASE_ID> \
  --git-commit <FULL_40_HEX_COMMIT> \
  --source-archive <ABSOLUTE_SOURCE_ARCHIVE.tar.gz> \
  --created-at <RFC3339_UTC> \
  --pnpm-version <PNPM_VERSION>

pnpm --filter @ai-job-print/api release:manifest -- verify \
  --release-root <CANDIDATE_RELEASE_ROOT> \
  --artifact-root <ARTIFACT_ROOT>
```

PM2 不直接启动 candidate 的 `main.js` 或 guard。D4 首次受控建链时，部署账户从已验证 candidate
复制 `dist/release-provenance/release-current-launcher.js` 到 release 根外的 `<LAUNCHER_PATH>`，
设置为运行账户不可写，并记录其 SHA-256。PM2 的固定配置必须满足：`cwd=<LAUNCHER_CWD>`、
`script=<LAUNCHER_PATH>`、`script args=--current-link <MANAGED_CURRENT_LINK> --artifact-root <ARTIFACT_ROOT> --launcher-sha256 <RECORDED_LAUNCHER_SHA256>`。
launcher 每次启动都解析 `current` 为真实目录，再调用该 release 内、manifest 覆盖的 guard；guard
验证后才 `exec` API main。不得把 `current` 软链接直接作为 guard 的 `--release-root`。

仅当 D4 managed 链已建立、D5 已完成且 candidate 与 previous 均验证成功后，才可在单独授权的
D6 窗口填写并运行下列**非可直接执行的占位模板**。它会原子切换 managed `current`、reload 指定的
managed PM2 进程、核验 launcher path/cwd/args、检查本机 PostgreSQL health；任何失败只会回切到
再次验证通过的 previous，否则返回 `NO-GO`。不得手工 `pm2 reload` 绕过该命令。

激活器以排他方式创建 `<MANAGED_CURRENT_LINK>.activation.lock`，同一时刻只允许一个 activation。发现已有
锁、锁令牌不匹配或锁无法清理时均为 `NO-GO`，不得并发执行或擅自删除残留锁；须先取得单独授权，
只读确认没有在途 activation 与 `current` / PM2 实际状态后，才可处置残留锁。

```bash
pnpm --filter @ai-job-print/api release:activate -- \
  --candidate-root <CANDIDATE_RELEASE_ROOT> \
  --current-link <MANAGED_CURRENT_LINK> \
  --artifact-root <ARTIFACT_ROOT> \
  --pm2-name <MANAGED_PM2_NAME> \
  --health-url http://127.0.0.1:3011/api/v1/health \
  --launcher-cwd <LAUNCHER_CWD> \
  --launcher-path <LAUNCHER_PATH> \
  --launcher-sha256 <RECORDED_LAUNCHER_SHA256> \
  --runtime-env-contract-path <RUNTIME_ENV_CONTRACT_PATH> \
  --runtime-env-contract-sha256 <RECORDED_RUNTIME_ENV_CONTRACT_SHA256>
```

两套 CLI 不可混用：D4 `release:genesis` 为 11 flag / 22 参数，使用
`--managed-current-link`、`--deployment-control-root` 与 `--runtime-env-contract`；D6
`release:activate` 为上面的 10 flag / 20 参数，使用 `--current-link` 与
`--runtime-env-contract-path`，且没有 control-root flag。任何交叉复制都会 fail-closed。PM2 配置中的
3 项 launcher script args 是 PM2 传给 launcher 的运行参数，不属于 activation CLI 的 10 个 flag，
不得合并计数。此处仅记录接口差异，不提供 D4/D5 可执行步骤。

Worker 若为独立进程，仍按其实际入口单独守护；它不得复用 API launcher。每次受控切换后再执行
`pm2 save`，并立即把已批准的 `<PM2_HOME>/dump.pm2` 收紧为 `0600` 后复核。PM2 默认可能在重写
dump 后恢复为 `0644`，因此权限修正是**每一次**
`pm2 save` 的固定后置步骤，不能只在首次部署执行。随后把 releaseId、commit、
manifest/tree/launcher SHA-256、PM2 launcher 路径、目标应用 `exec_interpreter` 与 health 结果写入
脱敏部署记录；不得输出 dump 全文或环境变量值。

---

## 7. nginx 反代 + 上传限制（样例）

```nginx
server {
    listen 443 ssl http2;
    server_name kiosk.example.com;
    ssl_certificate     /etc/nginx/certs/kiosk.crt;
    ssl_certificate_key /etc/nginx/certs/kiosk.key;

    # 简历 PDF / 扫描件 / 图片上传：放宽 body 上限（与 API body limit 不冲突）
    client_max_body_size 100m;

    # 前端静态资源（kiosk 示例；admin/partner 各自 server 块或子路径）
    root /srv/ai-job-print/apps/kiosk/dist;
    location / {
        try_files $uri $uri/ /index.html;   # SPA 回退
    }

    # API 反代
    location /api/v1/ {
        proxy_pass http://127.0.0.1:3010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # 大文件 / 弱网上传
        # 如使用 WebSocket/SSE：
        # proxy_http_version 1.1;
        # proxy_set_header Upgrade $http_upgrade;
        # proxy_set_header Connection "upgrade";
    }
}
```

验收（checklist §3.7）：`/api/v1/*` 正确反代；三端静态路径正确；`client_max_body_size`
足够；API body limit 与 nginx 不冲突；与同机其他项目路径（如 `/opc`）不冲突。

---

## 8. 健康检查（确认连的是 PostgreSQL）

```bash
curl -s https://api.example.com/api/v1/health
# 期望：真实 DB 往返成功，且返回 "db":"postgres"（不是 sqlite）
```

部署完成判据之一：`/api/v1/health` 返回 `db=postgres`。

---

## 9. 回滚

- **代码回滚**：保留上一版本构建产物 / git tag；`pm2 reload` 切回。
- **Node 运行时回滚顺序**：若目标应用的 PM2 dump 已将 `exec_interpreter` 固化为
  `/usr/local/bin/node`，禁止先删除或改写该链接。必须先在同一授权窗口内用 `/usr/bin/node`
  重建/重启同名应用，确认原 script/cwd、health 与真实 `/proc/<pid>/exe` 均正确，再执行
  `pm2 save`、`chmod 0600 /root/.pm2/dump.pm2`，并脱敏确认 dump 已不再引用
  `/usr/local/bin/node`；完成这些步骤后，才可回滚 `/usr/local/bin/node`、Corepack 或 `/opt` 工具链。
  任一步失败都停止工具链清理并保留当前可启动解释器，避免 reboot/resurrect 时找不到 Node。
- **数据库**：破坏性变更前先 `pg_dump -F c` 备份（见 postgres-operations.md §4）；
  PG→SQLite 退路见 postgres-operations.md §5（改 `DATABASE_URL=file:...` 重启，代码不改）。
- **对象存储**：COS 文件不随代码回滚丢失（独立于代码）。
- **nginx / 证书**：配置先备份再改。

---

## 10. 执行后回填

执行完本 runbook 后：
1. 回 [checklist](./production-deployment-and-windows-host-checklist.md) §三 / §四逐项打勾。
2. 发现的问题写入 `docs/progress/current-progress.md`（不另起临时 handoff 文件，遵 CLAUDE.md §7）。
3. 记录部署 commit、PG 版本、Node/pnpm 版本、域名/证书到期日。
