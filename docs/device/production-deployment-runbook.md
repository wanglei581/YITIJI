# 生产服务器部署 Runbook（可复制粘贴执行版）

> 最后更新：2026-06-13（Claude，上线前 P0 准备物，未真机执行）
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
TENCENT_COS_BUCKET=yitiji-prod-private-1257025684
TENCENT_COS_REGION=ap-guangzhou
TENCENT_COS_SIGN_URL_EXPIRES_SECONDS=1800   # 合规上限，勿超

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

### 2.3 前端构建变量（三端）

三个前端 app 走同源相对路径最稳（由 nginx 反代到 API）：

```bash
# apps/kiosk/.env.local、apps/admin/.env.local、apps/partner/.env.local 各自：
VITE_API_MODE=http
VITE_API_BASE_URL=/api/v1
# kiosk 可选：VITE_TERMINAL_ID=<注册后的 terminalId>、VITE_KIOSK_LOGOUT_IDLE_SEC=180
```

---

## 3. 构建

```bash
pnpm typecheck      # 6 包
pnpm lint           # 4 端
pnpm build          # 5 包（pnpm -r --if-present build）
```

产物：
- 后端：`services/api/dist/main.js`（启动用 `node dist/main.js`）
- 前端：`apps/{kiosk,admin,partner}/dist/`（静态资源，交给 nginx）

---

## 4. PostgreSQL 空库部署 + seed

> 完整说明与回滚见 [postgres-operations.md](./postgres-operations.md)。命令优先用 `POSTGRES_URL`。

```bash
cd services/api

# 1) 构建会自动生成 SQLite + PG 两套 Prisma client；部署迁移到空库
POSTGRES_URL="postgresql://USER:PASS@PGHOST:5432/ai_job_print" pnpm db:pg:deploy

# 2) 漂移校验（CI 同款守门）
pnpm db:pg:sync:check

# 3) seed（按需，空库初始化基础数据）
pnpm db:seed
pnpm db:seed:fairs
pnpm db:seed:companies
pnpm db:seed:venue-guide
```

> 若迁移旧 SQLite 数据：按 postgres-operations.md §3 用 `db:pg:migrate-data`，
> 必须确认输出「迁移完成并对账通过」并记录孤儿行告警，不静默丢数据。

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

```bash
cd services/api
# API
pm2 start dist/main.js --name api --time
# 若 worker 为独立进程，按其实际入口单独守护（与 API 分开）
pm2 save
pm2 startup    # 生成开机自启脚本，按提示执行

pm2 logs api --lines 50    # 看启动日志：应出现连接 PostgreSQL，不是 SQLite
```

验收：异常自动重启、开机自启、日志路径固定 + 轮转、日志级别不输出敏感正文。

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
