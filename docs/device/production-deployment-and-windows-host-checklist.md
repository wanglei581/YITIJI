# 生产部署与 Windows 本地主机换机验收清单

> **验收快照（2026-08-08 线上实测复核）**
>
> 本次以 GitHub Actions 记录 + `zyidai.cn` 线上实际响应为证据复核，纠正此前「未部署」的过时判断。
>
> **已确认在生产运行：**
> - ✅ **持续部署已自动化**：`CI` 通过后由 `.github/workflows/deploy.yml` 经 SSH 自动部署到 `zyidai.cn`；最近成功部署 run `31172765587`（2026-08-07T11:06:48Z）。
> - ✅ **main CI 3/3 PASS**：`build-and-verify` + `postgres-readiness` + `kiosk-browser-smoke`，最近 run `31172027515`（2026-08-07T10:55:39Z）成功。
> - ✅ **线上 API 在线**：`GET /api/v1/health` → `200 {"status":"ok","db":"postgres"}`；`/api/v1/jobs`、`/api/v1/job-fairs`、`/api/v1/policies` 均 200。
> - ✅ **生产数据库为 PostgreSQL**（health 端点 `db: postgres` 实测，非 SQLite）。
> - ✅ **HTTPS 正常**：nginx/1.24.0 (Ubuntu)，Let's Encrypt 证书 `CN=zyidai.cn`，有效期至 2026-10-04。
> - ✅ **前端为真实构建产物**：线上返回 Vite 构建的 SPA（`/assets/index-*.js`），非占位页。
> - ✅ 生产启动门禁代码在位：`services/api/src/config/production-runtime-gates.ts`（JWT_SECRET 长度、`FILE_STORAGE_DRIVER=cos`）。
>
> **实测发现的真实缺口（不是文档没打勾，是线上确实没有）：**
> - ❌ **生产库三类内容全为空**：岗位 `total:0`、招聘会 `total:0`、政策 `data:[]`。页面可访问但没有可展示内容，不具备对外服务条件。
> - ⚠️ **部署流水线只发 Kiosk 前端**：`deploy.yml` 仅 build 并同步 `apps/kiosk/dist` 到 nginx 根目录，API 不在该流水线内（线上 API 在跑，但发布路径未纳入自动化，须确认其部署与回滚方式）。
> - ⚠️ `NODE_ENV=production` 无法从外部证实（health 未暴露），须在服务器侧确认。
>
> ⚠️ 其余需生产服务器登录 / 一体机现场 / 法务审定的项目，本地与外部探测均无法验证（见各节标注）。
>
> ## ⚠️ 2026-08-17 增补：今日改动影响本清单的四条
>
> 以下四条来自 2026-08-16/17 合入 main 的改动与实测，**部署前必须知道**：
>
> **① `REDIS_URL` 现在是启动必需项。**
> 不设置会在 `redis.module.ts` **硬失败**；设置了但连不上才走降级启动。
> 部署脚本 / systemd unit / .env 里漏了这个变量，服务起不来。
>
> **② 健康检查语义变了(PR #638 / #658)。**
> - `GET /health` 仍返回 **200**，但 `data.status` 可能是 `degraded`，并列出每个降级子系统的 `code`/`message`/`since`
>   （刻意保持 200：Kiosk 的 `ErrorOfflinePage` 只看状态码，503 会让一体机误判自己离线并阻断打印链路）
> - 新增 `GET /health/ready`：任一子系统降级即 **503** —— **只看状态码的探针应该指向这个**
> - 监控告警若只看 `/health` 的 HTTP 码，会漏掉全部降级状态
>
> **③ Redis 不可达时的真实行为(实测，非推断)。**
> - 修复前：进程活着、端口不通、日志无任何错误行(远端 Redis 被防火墙丢包时 30 秒内零 error 事件)
> - 修复后：明确降级启动 + 一条可 grep 的 `BOOT_DEPENDENCY_DEGRADED subsystem=redis code=... target=... timeoutMs=...`
> - 管理端此前会**整体 500 @ 37.9 秒**(鉴权守卫依赖 Redis)，已改为回源数据库，`500@37.9s → 200@1.0s`
> - **`redis.module.ts` 旧注释「Redis 暂时不可达不会阻塞应用启动」当时只对一半代码路径成立**，已订正
>
> **④ 硬件验收有了独立清单：[bench-acceptance-2026-08-16.md](./bench-acceptance-2026-08-16.md)。**
> 四项(扫码器接口/读码方式、麦克风是否存在、彩色打印、尺寸精度)合成一场台架，一个下午。
> **其中三项当前是「不知道」而不是「有问题」** —— 不测就只能继续猜，而它们各自卡着一条产品链路：
> - 彩色 + 双面在**服务端被 DTO 硬拒**(`@IsIn(['black_white'])` / `@IsIn(['simplex'])`)，解闸要先过真机验收
> - 语音功能在生产构建里**强制开启**(`VITE_USE_TRTC_CALL=true`)，但设备清单里没有麦克风、真机录音验收未勾选、
>   所有通过的语音测试用的都是 `--use-fake-device-for-media-stream` 假设备
>
> **另**：内容侧(三个库全空)有独立手册 [content-onboarding-runbook.md](../product/content-onboarding-runbook.md)。
> 2026-08-17 线上复测确认 `jobs` / `job-fairs` / `policies` 三者 `total` 仍全为 **0**。

> **勾选口径**：本清单的 `- [x]` 只代表「有可复核证据」，证据须写在条目后。未打勾 ≠ 未实现，可能只是尚未回填证据；请勿直接用勾选比例当作完成度。



> 最后更新：2026-07-25（补 Terminal planned 预创建两阶段发布与旧 binary 禁回滚门禁）；2026-06-25（补 QR 扫码登录本地 Agent 桥接验收项：Kiosk HTTPS/本地 127.0.0.1 访问前提、手机可访问二维码公网/局域网基址、Terminal Agent local API Origin 白名单）；2026-06-24（新增「附录二」对齐 2026-06-22 预生产 Gate 2–4 实际状态，纠正附录 §G 过期判断；正文 §二–§八 正式生产门禁口径不变）；2026-06-14（当前窗口切换为上线验收与小范围试运营准备；新增 §六 试运营验收）
> 适用范围：生产服务器上线、预生产演练、Windows 一体机本地主机更换、Terminal Agent 重新安装  
> 关联文档：[postgres-operations.md](./postgres-operations.md) | [terminal-agent-windows.md](./terminal-agent-windows.md) | [windows-terminal-agent-design.md](./windows-terminal-agent-design.md) | [feature-scope.md](../product/feature-scope.md) | [compliance-boundary.md](../compliance/compliance-boundary.md)

---

## 一、上线判断口径

页面功能和「我的」数据闭环打通，只代表产品逻辑具备上线基础；不能直接等同于生产服务器和 Windows 一体机换机已经无风险。

必须区分三层验收：

| 层级 | 验收目标 | 通过后才能说明 |
|---|---|---|
| 产品闭环验收 | 首页入口、业务流程、「我的」资产归属、合规文案 | 用户操作路径可用 |
| 生产服务器验收 | PostgreSQL、Redis、API、前端、对象存储、OCR/LLM/ASR/TTS、nginx/HTTPS、进程守护 | 线上环境可稳定运行 |
| Windows 本地主机/一体机验收 | Terminal Agent、打印机驱动、扫描、U盘、Kiosk 全屏、网络、断网恢复 | 硬件现场可真实服务 |

未完成本清单前，不得宣称「上线服务器无问题」或「更换 Windows 本地主机无问题」。

---

## 二、生产上线前硬性前置

### 2.1 代码与分支

- [x] main 分支为待部署版本。（**2026-08-08 复核**：`deploy.yml` 以 `workflow_run` 监听 `CI` 且 `branches: [main]`，main 即部署源；最近部署 run `31172765587` 成功。）
- [ ] Git 工作区无未确认业务改动。（2026-08-08 本地工作区有未提交改动：`apps/kiosk/src/pages/home/HomePage.tsx`、`index.css`、3 个 verify 脚本，以及 4 个未跟踪的 `apps/kiosk/*.mjs` 与 3 个 `docs/design/` 新目录；部署前须确认或清理。）
- [ ] `.env`、`.env.local`、`.claude/settings.local.json`、日志、dist/build、临时简历文件未提交。
- [x] 最近一次 CI 主 job 通过。（**2026-08-08 复核**：run `31172027515`，2026-08-07T10:55:39Z，`CI` 全部 success。）
- [x] `postgres-readiness` job 通过。（**2026-08-08 复核**：同 run 内 job 定义于 `.github/workflows/ci.yml:385`，随 CI 一并 success。）
- [ ] 如本次包含数据库 schema/type 变更，确认 PostgreSQL schema 已同步并通过漂移校验。

### 2.2 密钥轮换与最小权限

上线前必须轮换或重新签发生产密钥，不使用聊天/本地开发中暴露过的密钥：

- [x] 百度 OCR 应用密钥已在百度控制台重建/轮换。（**2026-07-25 `SECRETS_ROTATION_EVIDENCE` 方案 C**：用户确认沿用 2026-06-13 控制台重建 + live 复验；今日未再轮换、未读密钥值。）
- [x] 腾讯云 COS CAM 子用户密钥已轮换，权限最小化到私有桶所需动作。（同上：沿用 2026-06-13 轮换 + live；今日未再轮换。最小权限以当时配置为准，若 CAM 策略有变须另验。）
- [ ] 腾讯云 COS 生命周期已人工验收：禁止配置 Bucket 全局过期规则；任何规则不得覆盖 `users/`、会员简历、AI 成果物或 `long_term` 长期保存对象。
- [ ] 如启用 COS 生命周期兜底规则，仅允许作用于 `tmp/` 临时前缀；规则名称、作用前缀、过期天数和启用状态已截图存档。
- [x] 腾讯 ASR/TTS/SMS/TRTC 相关 CAM 权限已按生产最小权限配置。（**2026-07-25 方案 C**：用户确认 SMS/TRTC 为当前生产密钥且预发 `.env` 已同步、今日无需再换；未读密钥值。）
- [ ] LLM/DeepSeek 或其他模型 API Key 已使用生产专用 Key。
- [x] 短信签名/模板审核通过后再启用真实短信。（**2026-07-26 真号 E2E**：预发 `SMS_PROVIDER=tencent`，签名/模板名称级 `青岛智磊信创` / `2661213`；`sms-code` 201 + Tencent 下发成功日志；用户回填验证码后会员登录 201，`183****1921`。完整手机号/验证码/JWT 不入库。）
- [x] 所有密钥只写入服务器环境变量/配置中心，不写入前端、不写入仓库、不写入日志。（**2026-07-25**：用户确认「密钥在 .env」；预发名称级复核 OCR/COS/SMS/TRTC 为 `SET`，值未读出。）
- [x] 生产/预生产环境的 seed 内部账号默认口令（`admin` / `partner1` / `partner2`，明文写在 `services/api/prisma/seed.ts`）已全部轮换为强密码或直接禁用账号；公网可达的后台登录页不得挂任何仓库内可见的默认口令（2026-07-12 发现风险；**2026-07-25**：bcrypt 确认后执行 `SEED_PASSWORD_ROTATE`——admin 本已非默认，partner1/partner2 已轮换强随机口令且 `tokenVersion++`；seed 默认登录 `partner1`→`401 AUTH_LOGIN_FAILED`；明文仅服务器 root `0600` 文件，取后 shred。**注意**：勿再对预发跑会重置口令的 `db:seed` upsert）。

### 2.3 合规前置

- [ ] 用户协议 / 隐私政策已经法务审定；当前试运营文本不得冒充正式法务版本。
- [ ] 用户协议 / 隐私政策已说明文件分级保存：高敏/匿名文件短期保存，会员原始简历默认 90 天，用户确认后可延长至 180 天；优化后或派生成果物可确认后长期保存；延长保存需确认保存条款版本。
- [ ] 岗位/招聘会按钮文案只使用：`查看岗位`、`去来源平台投递`、`扫码投递`、`查看招聘会`、`去来源平台预约`、`扫码预约`。
- [ ] 不存在平台内投递、收简历给企业、企业候选人筛选、面试邀约、Offer 管理、候选人推荐。
- [ ] 外部跳转只记录跳转行为，不记录投递/预约结果。
- [ ] AI 输出禁词扫描有效：不出现保过、通过率、Offer 概率、录用概率、精准命中、候选人推荐等违规表述。

---

## 三、生产服务器环境验收

### 3.1 基础环境

- [ ] 操作系统版本记录清楚。
- [ ] Node.js 版本与项目要求一致。
- [ ] pnpm 版本与锁文件兼容。
- [ ] PostgreSQL 版本建议 16.x。
- [ ] Redis 版本建议 7.x。
- [ ] 服务器时区为 `Asia/Shanghai`。
- [ ] 磁盘空间、内存、CPU 满足预估访问量。
- [ ] 防火墙只开放必要端口：HTTP/HTTPS、必要管理端口；数据库/Redis 不对公网开放。
- [x] 域名解析、HTTPS 证书正常。（**2026-08-08 外部实测**：`https://zyidai.cn` 返回 `HTTP/2 200`，`server: nginx/1.24.0 (Ubuntu)`；证书 `subject=CN=zyidai.cn`，`issuer=Let's Encrypt`，`notAfter=2026-10-04`。）**证书自动续期仍未验证** —— 须在服务器确认 certbot/acme 定时任务存在且上次续期成功。

### 3.2 环境变量核对

以 `.env.example` 为清单逐项核对生产 `.env`：

- [ ] `NODE_ENV=production`。
- [ ] `JWT_SECRET` 使用生产强随机值，长度不少于 16 字符；不得使用本地开发/CI 测试值。
- [ ] `NODE_ENV=production` 已由 PM2/部署环境显式注入；支付、数据库、CORS 和其他生产运行时门禁均依赖该值，不得遗漏或写为 development。
- [x] `DATABASE_URL` 指向 PostgreSQL，不再指向 SQLite 文件。（**2026-08-08 外部实测**：`GET /api/v1/health` 返回 `{"status":"ok","db":"postgres"}`。）
- [ ] `FILE_STORAGE_DRIVER=cos`；生产不得回退本地磁盘存储。（门禁代码在位，但外部无法读取实际取值，须服务器确认。）
- [ ] API 生产启动门禁已验证：`NODE_ENV=production` 下，JWT_SECRET 缺失/过短、`FILE_STORAGE_DRIVER` 非 `cos`、`DATABASE_URL=file:` SQLite 均会启动失败。（**2026-08-08 复核**：门禁实现存在于 `services/api/src/config/production-runtime-gates.ts`（`PRODUCTION_JWT_SECRET_INVALID`、`PRODUCTION_FILE_STORAGE_DRIVER_NOT_COS`）。但线上 API 正常启动**不构成**门禁已生效的证据 —— 若 `NODE_ENV` 非 production，门禁根本不会执行。须在服务器确认 `NODE_ENV` 实际取值后才能打勾。）
- [ ] `REDIS_URL` 正确。
- [ ] API 监听端口、前端 API base URL、CORS allowlist 正确。
- [ ] COS bucket、region、secretId、secretKey、签名 TTL 正确。
- [ ] COS 生命周期人工验收已完成并截图存档：禁止配置 Bucket 全局过期规则，`tmp/` 以外前缀不得覆盖长期保存对象，`long_term` 文件的 `expiresAt = null` 只能由业务删除或用户主动删除处理。
- [ ] OCR provider 与百度密钥正确。
- [ ] AI provider / LLM 功能级配置可读取。
- [ ] ASR/TTS provider 与腾讯密钥正确。
- [x] SMS provider 在短信审核前不得误设为真实生产发送。（**2026-07-26**：预发已为 `tencent` 且真号 E2E 通过；见 §2.2。正式生产仍须保持密钥仅服务端、禁止 log 假发送冒充生产。）
- [ ] `PRINT_REQUIRE_PAID_BEFORE_CLAIM` 显式设为 true 或 false（生产缺省会拒启动；启用真实支付通道时必须 true）。
- [ ] 若启用微信或支付宝「扫付款码」：`PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED=true` 已写入仅服务端环境并随 API 重启生效；支付宝同时已配置 `ALIPAY_APP_ID`、应用私钥、支付宝公钥、正式网关和 `PAYMENT_NOTIFY_BASE_URL=https://zyidai.cn`（密钥不进仓库、不进前端）。
- [ ] 支付宝当面付现场验收：屏上动态二维码和 HID 扫码枪付款码各完成一笔受控小额交易；`10003`/网络不确定时只允许服务端查单收敛，不允许用户立即重扫；核对 Order、PaymentAttempt、渠道流水、出纸与退款记录一致。
- [ ] `PRINT_SCAN_CAPABILITY_MODE` 显式设为 managed 或 strict（生产缺省会拒启动；managed=未配置能力行放行既有闭环，strict=未配置行 fail-closed，Task 11）。
- [ ] `TERMINAL_LEGACY_REGISTER_ENABLED=false`；生产启动门禁必须拒绝缺省或 `true`，共享 `adminSecret` 不得再用于新设备注册。
- [ ] `TERMINAL_PLANNED_PROVISIONING_ENABLED` 显式设为 `true|false`：滚动升级第一阶段保持 `false`；确认所有 API 实例均为 reader-aware 新版本且旧 binary 已摘流量/退出后，第二阶段才切 `true`。
- [ ] 开启 planned writer 前已保存所有 API 实例的构建版本/commit、进程清单和健康检查证据；开启后禁止回滚到不认识 `lifecycleStatus` 的旧 binary。确需回滚时先把 planned writer 切回 `false` 并停止新设备预创建。
- [ ] 文件大小、签名 URL TTL、匿名/会员数据 TTL 与产品要求一致。

### 3.3 构建与静态资源

在服务器或等价预生产环境执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
```

验收：

- [ ] 安装不依赖本机私有路径。
- [x] 构建产物路径与 nginx/静态服务配置一致。（**2026-08-08 外部实测**：线上返回 Vite 构建 SPA，引用 `/assets/index-DqleN77r.js`、`/assets/index-CjAHAsWH.css`，非占位页；`deploy.yml` 将 `apps/kiosk/dist/.` 同步至 `DEPLOY_WEB_ROOT`。）
- [x] 前端资源 base path 正确。（同上，`/assets/*` 绝对路径可正常加载，首页 200。）
- [ ] 大文件上传入口不会被前端路由或 nginx 误拦截。

#### 3.3.1 持续部署流水线（2026-08-08 新增，据线上实测补充）

- [x] main CI 通过后自动部署已生效。（`.github/workflows/deploy.yml`，`appleboy/ssh-action@v1.0.3`，`if: workflow_run.conclusion == 'success'`；最近成功 run `31172765587`。）
- [ ] **API 发布路径未纳入自动化**：`deploy.yml` 只执行 `pnpm --filter @ai-job-print/kiosk build` 并同步 kiosk 静态产物，**不部署 `services/api`**。线上 API 确在运行（health 200），须补记其部署方式、进程守护（PM2/systemd）、版本来源与回滚步骤，否则 API 变更不会随 CI 上线。
- [ ] **部署脚本 `rm -rf ${DEPLOY_WEB_ROOT}/*` 为不可回滚操作**：须确认该路径专用于 kiosk 静态资源、不含其他站点或用户数据，并确认失败时的回滚手段（保留上一版本产物或 nginx 双目录切换）。
- [ ] 部署失败时的告警与回滚演练已完成。

### 3.4 PostgreSQL 空库部署验收

按 [postgres-operations.md](./postgres-operations.md) 执行并留存日志：

- [x] 生产库已连通并可服务查询。（**2026-08-08 外部实测**：`/api/v1/jobs`、`/api/v1/job-fairs`、`/api/v1/policies` 均返回 200 且结构正确。）
- [ ] **生产库业务内容为空 —— 上线前阻塞（2026-08-08 实测新增）**：岗位 `pagination.total = 0`、招聘会 `pagination.total = 0`、政策 `data: []`。接口与页面可用，但终端上没有任何可展示内容，不具备对外服务条件。须先完成：① 至少一个真实岗位来源（合作机构 API/Webhook/Excel 任一轨）导入并经管理员审核 `approved` + `published`；② 至少一场真实招聘会；③ 政策条目。导入后须复测三个端点 `total > 0`。
- [ ] 全新空库 `migrate deploy` 通过。
- [ ] `verify:demo-seed-guard` 通过，且生产未执行任何 `db:seed*`。
- [ ] 现有生产恢复确认沿用已存在且已轮换口令的管理员账号，未运行首个管理员 bootstrap。
- [ ] 若为真正全新空库：运行前只读确认 `User=0`，受控凭据目录归当前用户且 mode 0700，双人批准 10 分钟执行窗口；bootstrap 后仅生成 1 个 temporary admin 和 1 条必成功创建审计。
- [ ] 首个管理员以 HTTPS 登录，初始密码只进入强制改密流程且未获得管理 JWT；改密后为 `owner_managed`、`tokenVersion` 已递增、改密审计存在，并已使用新密码重新登录。
- [ ] 0600 初始凭据文件已在改密验收后安全删除；CLI 结果不确定时已按 runbook 三态 reconciliation 核对，未直接重跑或删除凭据。
- [ ] API 启动日志显示连接 PostgreSQL，不是 SQLite。
- [ ] PG schema 漂移校验通过。
- [ ] 核心表外键与唯一约束生效。
- [ ] 数据库备份脚本可执行。
- [ ] `pg_dump` 备份文件可恢复到临时库。

### 3.5 历史数据迁移门禁（当前无通用全库搬数命令）

- [ ] 确认生产仍以 PostgreSQL 为唯一运行库，未设计或执行 PG→SQLite 回退。
- [ ] 未从 Git 历史恢复或执行已退役的 SQLite→PostgreSQL 全库搬数工具。
- [ ] 如确有外部旧库导入需求，已另立具名授权的领域迁移方案，不把它夹带进常规部署。
- [ ] 领域迁移已在同等级访问控制的备份恢复库或批准脱敏 fixture 上完成只读 preflight、dry-run、逐类守恒对账和失败恢复演练。
- [ ] 孤儿/重复/缺来源数据进入 blocker 或归档清单，未被猜测补值、静默丢弃或自动发布。

**B1 扫描会话安全加固 migration 前置检查（如目标库已有真实 `ScanTask` 数据）**：迁移
`20260713160000_add_scan_task_active_session_unique`（同一 `terminalId` 同时只允许一条
`status IN ('waiting','matched')` 的活跃 `ScanTask`，partial unique index）会在存量数据违反
该约束时直接建索引失败、阻断整个 `migrate deploy`。`ScanTask` 功能自首期真实扫描上线起就已
可能产生数据（不是本次 migration 才新引入这张表），因此**任何**已经跑过一段时间、可能已有真
实扫描记录的环境（不限于本次是否是首次切换到 PostgreSQL）部署这条 migration 前必须先执行：

```sql
SELECT "terminalId", COUNT(*) FROM "ScanTask" WHERE status IN ('waiting','matched') GROUP BY "terminalId" HAVING COUNT(*) > 1;
```

- [ ] 上述 SQL 结果为空（无重复活跃行）方可继续部署此 migration。
- [ ] 若非空：先人工核实每个终端的重复行——保留最新一条 `waiting`/`matched`，其余转
  `expired`（未匹配）或 `cancelled`（已匹配但未完成），再重跑预检确认清空。
- [ ] 该 migration 上线前，若目标终端的 `scan` 能力当前为 `available` 且确有 Agent 在跑，
  先临时把该终端 `scan` 能力置为非 `available`（Admin 能力开关）并停止对应 Terminal Agent
  的 scan-watcher，避免修复上线瞬间的行为切换影响正在进行的真实扫描；确认无进行中扫描后
  再部署，部署完成、验证通过后再恢复 `available`。

### 3.6 核心 verify

以项目实际 package scripts 为准，至少覆盖：

```bash
pnpm --filter ./services/api verify:member-assets-c2d
pnpm --filter ./services/api verify:mock-interview
pnpm --filter ./services/api verify:job-fit
pnpm --filter ./services/api verify:resume-optimize
pnpm --filter ./services/api verify:ocr-baidu
pnpm --filter ./services/api verify:career-plan
pnpm --filter ./services/api verify:activity-logs
```

验收：

- [ ] verify 全部 PASS。
- [ ] 运行日志无简历原文、面试回答、转写文本、规划正文、API Key、access token。
- [ ] 验证脚本在 PostgreSQL 环境下执行，而不是误连 SQLite。

### 3.7 nginx / 反代 / 上传限制

- [ ] `/api/v1/*` 正确反代到 API 服务。
- [ ] Kiosk/Admin/Partner 静态资源路径正确。
- [ ] `client_max_body_size` 支持简历 PDF、图片、扫描件上传。
- [ ] API body limit 与 nginx limit 不冲突。
- [ ] 上传超时配置满足大文件与弱网场景。
- [ ] WebSocket/SSE 如有使用，反代升级头正确。
- [ ] `/opc` 等其他项目路径不会与本项目路由冲突。

### 3.8 进程守护与日志

- [ ] API 使用 PM2/systemd/等价方式守护，异常自动重启。
- [ ] Worker/队列进程独立守护。
- [ ] 前端静态服务或 nginx 重启策略明确。
- [ ] 日志路径固定，日志轮转已配置。
- [ ] 日志级别生产可控，不输出敏感正文。
- [ ] 健康检查接口或探活脚本可用。
- [ ] 部署回滚脚本/流程明确。

---

## 四、线上浏览器业务验收

在生产或预生产域名上，用真实浏览器完成以下路径：

### 4.1 账号与资产

- [ ] 手机号登录/登出成功。
- [ ] QR 扫码登录成功：Kiosk 通过 Terminal Agent 本地桥接创建二维码，手机打开二维码 URL 后只确认登录，一体机拿到会员态；手机端不接收 member token。
- [ ] QR 二维码 URL 的公网/局域网基址可被手机访问；如果 Kiosk 页面运行在 `localhost`，必须显式配置手机可访问的 `VITE_QR_LOGIN_PUBLIC_BASE_URL`。
- [ ] 空闲自动退出生效。
- [ ] 忙碌态（上传/AI/打印中）不误触发退出。
- [ ] 「我的」资产区加载成功，无假数量。
- [ ] 未登录游客不展示跨会话资产。

### 4.2 AI 简历与「我的」闭环

- [ ] 上传简历 → AI诊断 → 报告页 → 「我的」AI服务记录可见。
- [ ] 简历优化 → 优化结果 → 导出 PDF → 我的文档可见。
- [ ] AI简历生成 → 预览/编辑 → PDF → 我的简历/我的文档可见。
- [ ] 岗位匹配参考 → AI服务记录可见。
- [ ] 模拟面试 → 报告 → 「我的」模拟面试报告子区可见 → 可返回报告。
- [ ] 删除 AI记录后不残留幽灵记录。

### 4.3 打印/文件闭环

- [ ] 按 [用户文件与简历资产生产/试运营验收证据包](../acceptance/user-file-assets-trial-acceptance.md) 完成用户文件与简历资产证据包，留存命令日志、浏览器截图、COS 控制台截图、PostgreSQL 抽样和审计查询结果；不得以本地 SQLite/local storage verify 代替 PostgreSQL + COS + 会员账号真实验收。
- [ ] 上传文件 → 我的文档可见。
- [ ] 文档预览使用短期签名 URL。
- [ ] 文档下载成功。
- [ ] 再打印进入打印链路。
- [ ] 删除文档后对象存储与数据库状态一致，删除审计存在。
- [ ] 打印任务进入打印订单，状态展示正确。

### 4.4 岗位/招聘会/政策

- [ ] 岗位列表/详情真实数据展示来源机构、同步时间、外部 ID。
- [ ] 岗位收藏进入我的收藏。
- [ ] 去来源平台投递只记录打开入口行为，不记录第三方后续结果。
- [ ] 岗位浏览与外部入口打开在「我的」浏览与跳转记录可见，可删除。
- [ ] 招聘会详情真实数据可见。
- [ ] 招聘会收藏进入我的收藏。
- [ ] 招聘会浏览与外部预约入口打开在「我的」浏览与跳转记录可见，可删除。
- [ ] 招聘会资料打印进入我的文档 + 打印订单。
- [ ] 政策收藏进入我的收藏。
- [ ] 政策浏览与官方入口打开在「我的」浏览与跳转记录可见，可删除。
- [ ] 政策材料打印仅在真实材料源启用后验收；当前 info-only 卡片不得伪造我的文档或打印订单。

### 4.5 AI/外部服务

- [ ] LLM 真实调用成功，失败时有诚实错误提示。
- [ ] OCR 图片/扫描 PDF 成功，低置信度提示复核。
- [ ] ASR/TTS 在支持环境可用；失败时文字兜底可用。
- [ ] 外部服务失败不伪造成功、不写入假结果。

---

## 五、Windows 本地主机换机验收

换 Windows 主机时，必须按本节重新验收。不要因为旧机器通过就默认新机器通过。

预发终端 `t_ksk_001` 的**远程 Phase R / 现场 Phase F** 执行清单与回执模板：`docs/device/windows-field-recheck-phase-f-runbook.md`（远程旁证不能替代本节勾选）。

### 5.1 Windows 环境

- [ ] Windows 10/11 x64，版本记录清楚。
- [ ] 系统时区为 `Asia/Shanghai`。
- [ ] 自动登录/开机启动策略符合现场 kiosk 使用方式。
- [ ] Edge/Chrome 已安装并可进入全屏 Kiosk 模式。
- [ ] Windows 更新策略不会在营业时段强制重启。
- [x] 本机防火墙允许 Agent 访问后端 API；Agent 本地端口只监听 `127.0.0.1`。（2026-07-25 Phase F：`127.0.0.1:9527`；Agent 可达预发 API 旁证）

### 5.2 打印机驱动与配置

- [x] 奔图 CM2800/CM2820 系列驱动已安装。（2026-07-25 Phase F：队列名存在）
- [x] Windows 打印机列表中真实驱动名已记录。（`Pantum CM2800ADN Series`）
- [x] Agent 配置使用 `printerName`，不得硬编码具体型号字符串。（对照 `agent-config.json`）
- [x] `printerName` 与 Windows 实际识别名一致。（2026-07-25 Phase F）
- [ ] 打印机通过 USB 或有线网络连接稳定。
- [ ] 默认纸张为 A4，不假设 A3。
- [ ] 彩色、黑白、份数、双面参数在本机驱动下实测。

### 5.3 Terminal Agent 安装

- [ ] Agent 版本与服务器 API 版本匹配。
- [ ] Agent 配置包含 API base URL、terminalId/注册凭据、printerName、扫描目录、日志路径。
- [ ] Token/凭据使用 Windows DPAPI 或设计文档要求的方式加密保存。（现场现为仓库目录配置，正式安装口径仍开）
- [x] Agent Windows Service 安装成功。（2026-07-25：`AIJobPrintAgent` Running）
- [x] Service 可开机自启。（StartType=Automatic）
- [ ] 单实例保护有效，重复启动不会产生双 Agent。
- [ ] Agent 日志路径固定，日志不含用户文件正文/密钥。

### 5.4 终端注册与心跳

- [x] Agent 可访问生产/预生产 API。（2026-07-25：预发心跳 / printer ready）
- [ ] Admin 在既有「设备管理」页预创建唯一 `terminalCode`，设备状态为「待安装」，此时未签发日常设备凭证且不能认证。
- [ ] Admin 生成一次性绑定码，安装程序使用绑定码激活；首次凭证 generation=1，设备进入 `commissioning`，绑定码不可重复使用；首次成功认证心跳后自动进入 `active`。
- [ ] 终端激活成功；生产安装包、命令行、镜像和日志均不携带共享 `adminSecret` 或可复用明文 Token。
- [x] 心跳持续上报。（远程 Phase R + 现场在线）
- [x] Admin 终端管理页显示在线。（同日浏览器只读旁证）
- [x] 打印机状态/WMI 状态可上报。（`printerStatus=ready`）
- [x] 断网后状态变离线；恢复网络后自动重新在线。（2026-07-25 F5：WLAN 75s，恢复无需重启 Agent）

### 5.5 本地 Kiosk 与 Agent 通信

- [ ] Kiosk 页面可从生产域名打开。
- [x] Kiosk 全屏模式无浏览器系统弹窗阻断主流程。（2026-07-25 F6：1080×1920；未覆盖 Assigned Access）
- [x] `http://127.0.0.1:9527` 或当前 Agent local API 仅本机可访问。（2026-07-25 F3）
- [ ] `GET /local/terminal-identity` 在允许 Origin 下只返回 `terminalId` / `terminalCode`，错误 Origin 返回 403；不得返回 Agent token、API URL、打印机名或本地路径。
- [ ] 不设置 `VITE_TERMINAL_ID` 的同一份 production Kiosk 在 `KSK-001` / `KSK-002` 分别显示本机 `terminalCode`；Agent 未启动时显示“设备未绑定”且终端动作 fail-closed，不得伪装为“01号机”。
- [ ] 浏览器早于 Agent 启动以及 Agent 服务重启后，Kiosk 无需人工刷新即可恢复本机身份；重新绑定为另一终端后不得继续使用旧 `terminalId`。
- [ ] QR 登录本地桥接端口与 Kiosk 构建变量一致：Agent `localApiPort` / `localApiAllowedOrigins` 与 Kiosk `VITE_TERMINAL_AGENT_LOCAL_URL`、实际 Kiosk Origin 完全匹配。
- [ ] 如 Kiosk 使用 HTTPS 页面，已实测浏览器不会因 mixed content / Private Network Access 阻断 `http://127.0.0.1:<localApiPort>`；若被阻断，扫码登录不得宣称可用，需改为受信本地桥接方案或现场允许的本地访问策略。
- [ ] U 盘导入本地桥接令牌一致：Agent `agent-config.json` 的 `localApiBridgeToken` 与 Kiosk 构建变量 `VITE_TERMINAL_AGENT_BRIDGE_TOKEN` 完全一致（安装时一起生成/下发，不走网络协商）；未配置时 `/local/usb/*` 全部路由 fail-closed 403，Kiosk `usb` tab 应保持禁用并显示"本机未配置"，不得强行放行。
- [ ] `/local/usb/*` 令牌校验有效：错误/缺失令牌返回 403（`LOCAL_USB_BRIDGE_TOKEN_INVALID`），Origin 不在白名单返回 403（`LOCAL_USB_ORIGIN_FORBIDDEN`）。
- [ ] U 盘 `safeId` 一次性消费有效：同一 `safeId` 二次调用 `/local/usb/upload` 返回 410（`LOCAL_USB_FILE_EXPIRED`），刷新文件列表后旧 `safeId` 全部失效。
- [ ] 真实插入 U 盘后 `detectRemovableDrive()` 能正确识别盘符与卷标（win32 CIM/PowerShell 路径，未在开发环境验证过，属本清单新增待验收项）。
- [ ] 页面展示设备状态与 Agent 上报一致。
- [ ] 分别向 `KSK-001` / `KSK-002` 下发带唯一标识的任务，仅目标 Agent 可领取；交叉观察窗口内另一台不得领取，结果保留两端任务 ID 与 Agent 日志。

### 5.6 真机打印验收

至少执行以下测试并留存结果：

- [x] 打印测试 PDF。（**2026-07-25 F4**：`ptask_kiosk_2a75352b81631efb` 等旁证；**补做** `ptask_kiosk_e0fe379299af7c50` 简历打印扫码上传 → completed；用户确认「有出纸」。**2026-07-26 再确认** `ptask_kiosk_f9587c2439e1855a` completed，用户回「是」）
- [ ] 打印测试图片。
- [ ] 打印简历 PDF。
- [ ] 份数控制。
- [ ] 黑白打印。
- [ ] 彩色打印（硬件支持；本地驱动参数必须真机验证）。
- [ ] 自动双面打印（硬件支持；本地驱动参数必须真机验证）。
- [ ] 打印失败时任务状态回传 failed，Kiosk/我的打印订单可见。
- [ ] 打印完成时任务状态 completed，打印订单可见。
- [ ] 断网中产生任务不会伪造成功；恢复后按设计重试/重新 claim。

### 5.7 扫描 / U盘 / 外设

当前若扫描/U盘仍未真实接入「我的」，不得在页面宣称已闭环。

- [ ] TWAIN/WIA 扫描驱动可用，或 SMB/FTP 扫描目录可用。
- [ ] ADF 扫描测试通过。
- [ ] 扫描结果生成 PDF/图片。
- [ ] 扫描文件上传到后端/COS。
- [ ] 扫描文件进入我的文档。
- [ ] 扫描失败有明确提示，不伪造文件。
- [ ] U盘插入识别。
- [ ] U盘文件列表显示。
- [ ] U盘导入/打印路径可用。
- [ ] 扫码器如接入，扫码输入不会污染其他页面输入框。

证件类专项（Task 11 验收清单项，敏感文件按短 TTL 清理，不长期留存）：

- [ ] 身份证复印：证件放置 → 扫描 → A4 排版 → 真实出纸全链路可用（口径对齐首期计划 Task 8 的复印/证件复印标准，仅生成文件不出纸不算通过）；复印产物不落长期存储，完成后按敏感文件策略清理并有删除日志。
- [ ] 证件照隔离验收（能力未上线；本项通过只代表未上线能力已被正确隔离，**不代表证件照功能验收通过**）：Kiosk 卡片不可进入正式流程，且终端能力开关（Admin「打印扫描运维 → 设备能力」）中 `id_photo` 不为「可用」。证件照功能本身（上传 → 规格排版 → 用户确认 → 打印 → 敏感照片清理）的验收须在能力按计划 Task 8 实现后另行执行，或经正式范围决策明确移出本期。

### 5.8 文件流真机补验（#518 合入后必跑）

文件流代码已合入主干（#518 / `f5fe7b5b`），以下为自动化无法替代的现场门禁；每项须留存文件 ID / 订单任务 ID / Agent 日志与脱敏截图，不得只凭 iframe HTTP 200 或本地 verifier 宣称通过。

- [ ] **Kiosk 页内 PDF/图片真实可见内容**：实际 Edge/Chrome Kiosk 模式下，本机上传、手机扫码上传、U 盘导入、扫描结果、`我的文档`、优化简历/自评 PDF 均在页内弹层显示真实文件内容（肉眼或截图确认文字/图像，不只验证 URL 加载）；浏览器不能直接显示的 Word/TXT/Markdown 显示诚实状态。
- [ ] **U 盘简历导入闭环**：真实 U 盘插拔/空盘/隐藏文件，PDF/JPG/PNG 各一份与 10MB 边界；确认走 `resume_upload` purpose、会员 token 经标准 `Authorization` 绑定本人、匿名走任务级授权、列表按 10MB 过滤、`safeId` 一次性消费、重复点击锁与退出清场。
- [ ] **`我的文档` 隐私根**：预览/打印/删除/保存期限按钮全部可用；查看文档不打开 Kiosk 外部新窗口（`window.open` 为零），使用短期签名 URL，过期/清理后诚实置灰。
- [ ] **Admin 文件审计预览**：Admin 查看用户文件使用短期签名 URL 且留审计日志，跨账号/过期访问被拒，不落本地下载目录。
- [ ] **Partner Excel 原生拖放**：真实浏览器以操作系统原生拖放（非文件选择器）导入 `.xlsx`/`.csv`，覆盖错误扩展名、空表、列映射、有效/无效行预览与确认；确认数据默认待审核，不形成企业收简历闭环。

---

## 六、小范围试运营验收

生产环境、真实服务、Windows 真机与法务合规通过后，先进入小范围试运营，不直接扩大部署。

### 6.1 试运营范围

- [ ] 只启用 1 台终端。
- [ ] 只连接 1 台奔图打印机。
- [ ] 只邀请少量真实用户。
- [ ] 只开放已通过生产/真机验收的能力；扫描、语音、政策材料打印等未验收能力不得宣称可用。
- [ ] 现场人员知道回退方案：停止使用终端、切换人工服务、保留日志。

### 6.2 试运营必跑路径

- [ ] 手机号登录与登出。
- [ ] QR 扫码登录：手机扫码确认后，一体机进入同一会员态；本机桥接不可用时页面能回退到手机号登录。
- [ ] 上传简历 → OCR/文本提取 → AI 诊断。
- [ ] AI 简历生成或优化 → 生成 PDF → 我的文档。
- [ ] 用户文件与简历资产证据包已执行：覆盖上传原始文件、上传优化后或修改后文件、90 天 / 180 天 / 长期保存、重登查看、删除三态一致、过期清理、`long_term` 防误删和 AuditLog 审计；不得以本地 SQLite/local storage verify 代替 PostgreSQL + COS + 会员账号真实验收。
- [ ] 真实打印出纸 → 打印订单状态 completed。
- [ ] 打印失败场景 → 打印订单状态 failed，不伪造成功。
- [ ] 岗位 / 招聘会 / 政策浏览与收藏。
- [ ] 去来源平台投递 / 预约 / 官方入口打开，只记录外部跳转行为。
- [ ] 断网恢复后 Agent 与页面状态一致。

### 6.3 问题记录要求

每个问题至少记录：

- [ ] 发生时间。
- [ ] 终端编号 / Agent 日志路径。
- [ ] 用户操作路径。
- [ ] 相关任务 ID、文件 ID、打印任务 ID 或请求 ID。
- [ ] 前端截图或错误提示。
- [ ] API / Agent / nginx / Windows 事件日志位置。
- [ ] 是否可复现。
- [ ] 处理结论：阻塞修复、体验修正、配置问题、硬件问题、外部服务问题。

试运营期间只修复阻塞上线、真实服务、真机、配置、合规和必要体验问题；不借试运营新增业务功能。

---

## 七、上线后的观察与回滚

### 7.1 首日观察

- [ ] API 错误率。
- [ ] 登录成功率。
- [ ] 文件上传失败率。
- [ ] AI 调用失败率与成本。
- [ ] OCR 失败率。
- [ ] 打印任务 pending/failed 堆积。
- [ ] Agent 在线率。
- [ ] PostgreSQL 连接数、慢查询、磁盘增长。
- [ ] Redis 内存与队列积压。

### 7.2 回滚准备

- [ ] 上一版本构建产物可恢复。
- [ ] 数据库迁移有回滚/恢复方案；破坏性变更前有备份。
- [ ] 对象存储文件不会因代码回滚丢失。
- [ ] Agent 版本可回退。
- [ ] nginx 配置有备份。
- [ ] 域名/证书配置可恢复。
- [ ] 实际回滚/恢复演练：在预生产或候选环境执行一次真实回滚（部署上一版本产物 + 数据库恢复演练）并记录耗时与步骤，仅有材料准备不算通过。

---

## 八、通过标准

只有同时满足以下条件，才能进入正式上线或更换 Windows 主机交付：

- [ ] 生产服务器环境验收通过。
- [ ] PostgreSQL 空库部署/迁移/备份恢复通过。
- [ ] 核心 verify 通过。
- [ ] 线上浏览器业务验收通过。
- [ ] Windows 本地主机硬件验收通过。
- [ ] 密钥轮换与合规检查完成。
- [ ] 1 台终端 + 1 台打印机小范围试运营问题已记录并完成阻塞项处理。
- [ ] 发现的问题已记录到 `docs/progress/current-progress.md` 或对应正式文档，不使用临时 handoff。

结论口径：

```text
可以准备上线 ≠ 已经生产就绪。
生产就绪必须以本清单逐项验收通过为准。
```

---

## 附录：上线前 P0 验收执行记录（2026-06-13，Claude，本地/预生产可执行部分）

> 口径：以下只记录**本地可执行**的验收结果；凡需要生产服务器 / 云控制台 / Windows 真机的项，如实标记「未验证/阻塞」，不冒充完成。

### A. §2.1 代码与分支 —— 已通过

- main = `80eabcc`（含 74ef526 / 5f0ce63 / 80eabcc），工作区干净，与 origin 同步。
- 最近 CI：`build-and-verify` ✅ + `postgres-readiness` ✅（run 27427254853）。
- `git ls-files | grep -iE '\.env'` 仅 5 个 `.env.example`；`git log --all -- '**/.env'` 为空（.env 从未入库）；.gitignore 覆盖 .env/.env.local/*.log/dist。

### B. §2.2 密钥轮换 —— OCR / COS 已解除（2026-06-13 新 Key live 复验）；ASR/TTS/SMS/LLM 上线时按生产 Key

| 密钥 | 暴露情况 | 状态 |
|---|---|---|
| 百度 OCR（旧 AppID 7841387） | 曾在聊天明文暴露 | ✅ **已解除（2026-06-13）**：用户在百度控制台重建应用，新 Key 配入 `services/api/.env`；`verify:ocr-baidu-live` 真实联网通过，`accurate_basic` 识别与扫描件 `pdf_ocr` 全链路通过，置信度 high。旧 Key 作废以用户控制台操作为准 |
| 腾讯云 COS CAM | 配置时曾在终端回显 | ✅ **已解除（2026-06-13）**：用户轮换 CAM 子用户密钥，新 Key 配入 `.env`；`verify:cos:live` 真实桶 `yitiji-prod-private-1257025684` put→head→get→预签名URL直连→delete 全过，跑完清理无残留。建议确认权限已最小化到该私有桶所需 action |
| 腾讯云 ASR/TTS/TRTC | 未发现聊天暴露记录 | 上线时按最小权限签发生产专用 Key；TRTC 凭证只改 `services/api/.env`（代码冻结） |
| 腾讯 SMS | — | **阻塞：短信签名/模板审核未过**；审核通过前生产不得设 `SMS_PROVIDER=log` 以外的假发送，服务端已有启动期校验（prod 强制 tencent，禁止 log） |
| LLM（DeepSeek 等） | 未发现聊天暴露记录 | 上线使用生产专用 Key；真实联调证据：2026-06-12 2E/2D 真实 DeepSeek 浏览器验收通过 |

### C. §3.4/§3.6 PostgreSQL 底座 —— 本地预演通过

- 空库 `migrate deploy`：4 个迁移（0_init + activity_logs + company_profiles…）全部应用 ✅；`db:pg:sync:check` 漂移校验通过 ✅。
- 历史本地 PG 预演曾运行 seed.ts + seed-fairs.ts 并通过 ✅；该结果仅证明当时测试数据可写，**不是当前生产步骤**。现行生产禁止 `db:seed*`。
- PG 上核心 verify：`verify:companies` 11 PASS、`verify:activity-logs` 12 PASS、`verify:member-assets-c2d` 9 PASS ✅。
- **备份恢复演练 ✅**：`pg_dump -F c`（118KB）→ `pg_restore` 到临时库 → 行数核对 Job=13/JobFair=3/Organization=2 一致。
- `GET /api/v1/health` 已实现（2026-06-13 新增）：真实 DB 往返探活 + 返回 `db: sqlite|postgres`，部署时以此确认生产连接 PostgreSQL。

### D. §3.6 核心 verify（SQLite 全量）—— 已通过

typecheck（6 包）/ lint（4 端，0 error）/ build（5 包）全绿；verify:activity-logs 12、verify:companies 11、verify:member-assets-c2d 9、verify:career-plan 11、verify:mock-interview 17、verify:job-fit 11、verify:resume-optimize、verify:ocr-baidu 12 全 PASS（日志 /tmp/prelaunch-verify.log，2026-06-13）。

### E. §2.3 合规前置 —— 代码侧通过 / 法务阻塞

- 全仓禁词扫描（19 词 × 5 目录）：**B 类（真实 UI/逻辑违规）为零**；约 28 处 A 类为禁词过滤防线/合规注释，约 11 处 C 类为子串误中或合规免责语境。
- 2026-06-13 P0 修复：Kiosk `/qingdao` 删除写死的「重点企业岗位数」（142/98/37/54/76，来源归属与 sourceUrl 均虚构）与「园区企业数/在招岗位数」假统计，改为真实 `/companies` 企业展示入口 + 园区客观介绍。
- **阻塞：用户协议/隐私政策法务审定未完成**（当前为试运营文本）。

### F. 安全基线（10 项审计，2026-06-13）—— 通过

.env 隔离 / 无硬编码密钥 / CORS 生产白名单（CORS_ALLOWED_ORIGINS）/ ValidationPipe whitelist+forbidNonWhitelisted / helmet / 全局限流 60/min / 异常过滤器不泄露栈 / 签名 URL TTL 夹紧 ≤30min + 敏感文件小时级清理 + 删除审计 / webhook HMAC+5min 窗+nonce 防重放（timingSafeEqual）/ /me/* 全员 EndUserAuthGuard + endUserId 过滤 / 日志只记元数据、启动日志无密钥。低优建议（非阻塞）：express.json/urlencoded 显式 body limit；如未来新增管理员强删会员端点须带审计。

### G. §三服务器 / §四线上浏览器 / §五 Windows 真机 —— 2026-06-13 状态：未验证（阻塞）

> ⚠️ 本节是 2026-06-13 无服务器权限时的记录。2026-06-22 起预生产已部署并推进到 Gate 4 API 级，**最新真实状态见下方「附录二」**，不要再据本节断言「服务器全部未验证」。

- 生产服务器：无服务器/域名/云账号权限 → 全部未验证。需要用户提供：服务器（含 root/部署权限）、域名+证书、生产 PostgreSQL/Redis 实例或安装授权、COS 生产桶。
- 线上浏览器闭环：无生产域名 → 未验证。本地等价证据：35 项链路中除「线上域名」环境差异外，全部在本地真实后端浏览器验收通过（见 current-progress 各阶段记录）。
- Windows 真机/Terminal Agent/奔图打印机：无 Windows 真机 → 未验证。Phase 8 封板时已有跨机 E2E 通过记录，但换机/生产 API 对接必须按 §五重新逐项验收。

---

## 附录二：2026-06-24 预生产部署与验收状态对齐

> 口径：本节对齐 `docs/progress/current-progress.md`（2026-06-22 记录）的真实预生产状态，纠正附录 §G「服务器全部未验证」的过期判断。**预生产阶段性验收 ≠ 正式生产就绪**；正文 §二–§八 复选框仍以正式生产 / 真机 / 法务验收为准，本节不改变正文门禁。预生产服务器侧操作由 codex 在主机执行，主工作区 / Claude 不直接 SSH。

### 已达成（预生产，2026-06-21 ~ 2026-06-22）

- 预生产已部署：百度云 `/srv/ai-job-print`，PM2 `ai-job-print-api` online，公网 health 三端返回 `db=postgres`；部署候选已刷新至 `76c06ca8`（AI 导出产物复验候选）。
- Gate 2（候选部署）PASSED：初始候选包 sha256 校验、API/Kiosk/Admin production build、迁移前 PostgreSQL 备份、仅应用预期 additive migration、API dist hash 匹配；后续部署候选已刷新至 `76c06ca8`。
- Gate 3（自动命令门禁）PASSED：预生产运行时包通过 `verify:production-runtime-gates` / `verify:production-db-guard` / `verify:file-retention` / `verify:file-lifecycle-summary` / `verify:member-assets-c2d` / `verify:audit-logs` / `verify:resume-generate`；本地整仓通过 `verify:cos-lifecycle-policy`。
- 预生产 COS 隔离桶切换 PASSED：腾讯云新建隔离预生产 bucket + 预生产专用 CAM 子用户（`strict_nonprod=true`、`prod_label=false`、`ap-guangzhou`）；G3-06 `verify:cos:live` put/head/get/预签名下载/delete 通过，删除后对象不存在。
- Gate 4（账号 / API 级）PASSED WITH NOTES：受控 MEMBER_A / MEMBER_B / 临时 Admin 经真实 HTTP API + PostgreSQL + Redis + COS 完成会员登录、原始文件上传、默认 90 天、设置 180 天、原始件长期保存拒绝、签名 URL、跨账号 403、删除三态、过期清理、Admin 生命周期汇总；真实 AI 导出产物自动标记 `assetCategory=optimized` + `sourceFileId` 已补 COS/DB 脱敏证据。临时将 `SMS_PROVIDER=log` 执行后已回滚 `tencent`。
- 临时 HTTPS：30 天自签 + hosts 映射（`kiosk/admin/partner.preprod.local`）可返回 HTTP/2 200 与 `db=postgres` health。
- Gate 4（浏览器会员路径）PARTIAL PASSED WITH NOTES：2026-06-26 使用真实短信登录路径补齐会员页、合成 PDF 上传窗口和 `/me/documents` 会员文件与保存期限截图；证据保存到仓库外 `/Users/wanglei/gate4-evidence/gate4-browser-20260625231841`，坏的全屏截图 / Playwright 中间文件已删除，预生产中可见的 `gate4-synthetic-resume.pdf` 测试记录已清理。该项只覆盖会员浏览器路径，不等于完整 Gate 4、正式生产或试运营完成。

### 2026-07-12 增补：候选刷新至 material-check 落地版 + Gate 3 复跑通过

- 预生产已刷新部署 `fba6b414`（AI 文件体检真实化 + 上传魔数校验 + U盘导入 + 支付 W-C 全链落地提交，`DEPLOY_SOURCE.txt` 2026-07-12T07:22:51Z）；三端公网 health 均 `db=postgres`。
- Gate 3 在预生产 PG + 隔离 COS 桶上复跑 9/9 通过（`production-runtime-gates` / `production-db-guard` / `file-retention` / `file-lifecycle-summary` / `member-assets-c2d` / `audit-logs` / `resume-generate` + 新增门禁 `materials-processing` / `cos:files` 57 项含魔数正反断言）；日志 `/srv/gate3-rerun-fba6b414-20260712164355.log`，抽查无密钥/token 泄漏。
- 指定法务/留存文案防回退检查通过：`verify:legal-retention-copy` ALL PASS（覆盖范围为该脚本指定的法务/合规文案文件及固定防回退条件，非全仓文案审查）；另 16 禁词 × 5 源码目录精筛零真实违规。法务送审必须使用含「第三方 OCR / AI 服务」诚实披露口径的当前 main 文本，不得使用旧「不转发第三方」文案。
- 新增 P0 发现：seed 默认口令风险（见 §2.2 新增项），处置方式为服务器侧轮换脚本由用户亲手执行，密码不经聊天/仓库。

### 仍待完成（正式生产 P0 阻塞，正文 §八 复选框不勾）

- Gate 4 **剩余浏览器证据**补齐（Admin 生命周期、签名 URL / 等待窗口、必要时 COS 控制台或 DB 脱敏摘要；API 级和会员路径已过，完整截图待补）。
- **百度 OCR Key 预生产 live**、**AI / TRTC / ASR / TTS 按启用范围 live**（本地已验，预生产 live 待补）。
- **正式域名 + 正式 HTTPS**（当前仅 30 天临时自签）。
- ~~**腾讯短信审核**通过后**真实手机号 E2E**~~ → **2026-07-26 已完成**（见 §2.2）。
- **Windows 真机 / Terminal Agent / 奔图打印·扫描 / 断网恢复 / 真实出纸**（§五；Phase F 含 F4 出纸已过；扫描/U盘整机与彩色/双面参数等仍可另开）。
- **法务**用户协议 / 隐私政策审定（§2.3，当前为试运营文本）。
- **小范围试运营**（§六）未开始。
