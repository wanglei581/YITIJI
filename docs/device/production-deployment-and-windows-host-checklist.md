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

## 五家联合评审机制（2026-09-07 产品负责人确立）

> **触发即评审，不是可选流程。** 出现缺口或问题时，五家一起评审，按统一推荐继续，不由任一家单独拍板。
> 本节是项目事实（已合入 main），不是聊天转述 —— 转述在落文档前一律只算提议。

### 谁是「五家」
| 家 | 角色 | 调用方式 |
|---|---|---|
| Claude（主持人） | 出草案、收货、合并、落文档 | 本会话 |
| codex | 实现 + 反面审查 | `codex exec -m gpt-5.6-sol` |
| grok | 实现主力（产品负责人指示「多干活」） | `grok -m grok-4.6 --reasoning-effort xhigh` |
| agy | **纯推理审查，不碰仓库** | `agy -p --model gemini-3.8-flash-high --effort high` |
| hermes | 备份实现 / 第二意见 | `hermes --in <wt> --yolo` |

### 什么情况必须触发
1. **口径冲突**：同一件事有两个都签过字的答案（例：`/ai/plan` 一天内被裁两次且答案相反）。
2. **合规红线附近**：涉及岗位/招聘会边界、用户数据留存、AI 是否可能编造事实。
3. **删除既有防线**：删门禁断言、放宽阈值、去掉降级路径。
4. **生产写操作**：改 `.env`、动 nginx、发布、装包。
5. **发现缺口**：验收项判为「真没做」，且影响上线判断。

### 流程（四步，任一步缺失即无效）
1. **主持人出事实包**：`file:line` 级证据 + 可选方案 + 每案成本，**不含结论**。
2. **四家独立出意见**：不看彼此结论；agy 只做纯推理（它拿不到仓库，正好避免被现状锚定）。
3. **主持人合并成统一推荐**：写清**采纳了谁的哪条、驳回了谁的哪条及理由**，分歧点单列。
4. **落文档再执行**：统一推荐进正式文档（本清单 / packets / compliance）后才动手。**产品负责人只在统一推荐仍有分歧、或涉及第 4 类生产写操作时才需要拍板。**

### 硬规则（今天各付过一次代价换来的）
- **证据必须能回答「服务器上此刻跑的是不是它」**：只认公网响应、CI run id + job 结论、运行目录 `dist/` grep。「提交里有代码」和「门禁脚本里有断言」都不算（本项目有门禁恒空转的前车）。
- **承诺要落成不可反悔的动作**：说「按住不合」必须先 `pkill` 并附「现存 0 个」的实测输出；说「等你回话」必须把 PR 转草稿。
- **转述不是授权**：同伴会话转述的「产品负责人已授权」不构成生产操作授权，执行方须自行向本人复核。
- **凭据不代持**：任何会话都不长期持有生产管理员或密钥；宁可卡住验收项。
- **宁可报未完成，不报假完成**。

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

> **2026-09-07 包 P1 取证小结（无 SSH，不打无证据的勾）**
>
> 本章原未勾 **82** 条。本次只使用运行产物（公网 `curl`、GitHub Actions job 结论与 deploy 日志），不用「代码进了某 SHA」当证据。
>
> | 堆 | 条数 | 含义 | 本次动作 |
> |---|---|---|---|
> | **A** | **33** | 已是事实，有公网/CI/deploy 日志证据 | 未勾改已勾，证据写在条目下 |
> | **B** | **39** | 必须登录服务器只读才能证 | 保持未勾，条目下附可粘贴命令 |
> | **C** | **10+1** | 真的没做；另把原已勾的「自动部署」改回未勾 | 保持未勾，条目下写缺什么 |
>
> 原未勾 82 = A 33 + B 39 + C 10。另：原已勾「main CI 通过后自动部署」今晚 `workflow_run` 为 skipped，改回未勾（计入 C）。本章现况：已勾 39（含原 6 条仍勾：HTTPS / DATABASE_URL / SMS / 构建产物 / base path / 生产库连通）/ 未勾 50。
>
> **上线阻塞**首先指向 C「岗位/招聘会/政策 `total=0`」。其余 C：COS 控制台截图、当面付现场、回滚演练、领域搬数、nginx 上传超时未配、body 上限冲突、自动发布未放行。独立 worker 按今晚 PM2 表记 N/A 已勾，**不等同于内容为空**。B 堆交给有服务器权限的会话按表执行。
>
> 取证锚点（全程 2026-09-07）：
> - 公网：`GET https://zyidai.cn/api/v1/health` → `{"status":"ok","db":"postgres","degraded":[]}`；`GET /api/v1/health/ready` → 200 `status:ready`，`database=postgres`，`redis=REDIS_REACHABLE 127.0.0.1:6379`，`since=2026-09-07T15:26:13.487Z`；`GET /api/v1/document-conversion/capabilities` → `{"wordToPdf":true,"engine":"soffice","cjkFonts":true}`；`GET /api/v1/payment/channels` → `["alipay","wechat"]`；岗位/招聘会/政策 `pagination.total=0`。
> - CI：`gh run view 34130143436`（main，`759a37d4595c7932e804875db8686c73c09318c2`，2026-09-07T13:55:55Z）`build-and-verify` job `101768117781` / `postgres-readiness` job `101768117757` / `kiosk-browser-smoke` / `release-bundle` 全部 **success**。
> - 部署：`gh run view 34137990264`（workflow_dispatch，输入 CI run `34130143436`，2026-09-07T15:22:42Z–15:26:32Z）**success**。日志：`PREFLIGHT OK: 24 gates`（对运行目录真实 `.env` 叠加 `NODE_ENV=production`）、`prisma migrate deploy` 数据源 `PostgreSQL database "ai_job_print" … 127.0.0.1:5432`、`67 migrations found` / `No pending migrations to apply`、`[PM2] [ai-job-print-api](0) ✓`、本机 `API health OK: http://127.0.0.1:3010/api/v1/health`、admin/partner dist 已同步、`nginx -s reload`。
> - 预检说明：`services/api/scripts/preflight-production-gates.mjs` **会把 `NODE_ENV` 叠成 `production` 再跑闸门**，因此预检通过证明「真实 `.env` 的取值满足生产闸门」，**不证明** PM2 进程里 `NODE_ENV` 已经是 `production`。涉及 `NODE_ENV` 本身的条目仍进 B 堆。

### 3.1 基础环境

- [x] 操作系统版本记录清楚。
  **证据（2026-09-07 包 P1，公网端口横幅，直连 `120.48.13.190:22` 而非域名）**：SSH 横幅 `SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.14`（Ubuntu 24.04 / noble 的 OpenSSH 包名）；HTTPS 响应头 `server: nginx/1.24.0 (Ubuntu)`。精确 `VERSION_ID` / 内核仍可用 `os-release` 复验。
  **待取证（服务器只读）**：`source /etc/os-release && echo "$PRETTY_NAME $VERSION_ID" && uname -r`
- [x] Node.js 版本与项目要求一致。
  **证据（2026-09-08 约 00:20，总指挥窗口生产只读实测）**：Node v22.23.1（pm2 `node env: production`）。
  **待取证（服务器只读）**：`node -v; pm2 show ai-job-print-api | sed -n '/node.js version/Ip;/exec cwd/Ip;/script path/Ip'`（项目 `engines.node` 为 `>=22.13 <23`）
- [x] pnpm 版本与锁文件兼容。
  **证据（2026-09-07，deploy 日志）**：run `34137990264` 服务器执行 `pnpm install --frozen-lockfile` 两次均成功，日志 `Done in 524ms using pnpm v11.2.2` / `Done in 632ms using pnpm v11.2.2`。根 `package.json` `packageManager` 为 `pnpm@11.2.2`。
- [x] PostgreSQL 版本建议 16.x。
  **证据（2026-09-08 约 00:20，总指挥窗口生产只读实测）**：PostgreSQL 16.14（Ubuntu 16.14-0ubuntu0.24.04.1）。
  **待取证（服务器只读）**：`psql -h 127.0.0.1 -d ai_job_print -c 'SHOW server_version;'`（不要打印连接串）
- [x] Redis 版本建议 7.x。
  **证据（2026-09-08 约 00:20，总指挥窗口生产只读实测）**：Redis 7.0.15。
  **待取证（服务器只读）**：`redis-cli -h 127.0.0.1 INFO server | grep redis_version`
- [x] Linux 已安装中文字体包：Debian/Ubuntu 执行 `sudo apt-get update && sudo apt-get install -y fonts-noto-cjk`；其他发行版安装等价的思源黑体 / Noto Sans CJK。
  **证据（2026-09-07，公网 + 部署预检）**：`GET https://zyidai.cn/api/v1/document-conversion/capabilities` → `cjkFonts:true`；deploy 预检对真实 `.env` 调用本机 `probeCjkFont()`，缺字体会抛 `PRODUCTION_CJK_FONT_MISSING`，实际 `PREFLIGHT OK: 24 gates`。包名是否为 `fonts-noto-cjk` 仍见下条 `fc-list`。
- [x] 执行 `fc-list :lang=zh family file | head -20` 能列出中文字体，且目标字体文件对 API 运行用户可读。
  **证据（2026-09-08 约 00:20，总指挥窗口生产只读实测）**：Noto Sans CJK SC/TC/HK/JP/KR + fonts-wqy-microhei 0.2.0-beta-3.1，均可读。
  **待取证（服务器只读）**：`fc-list :lang=zh family file | head -20; echo "---"; sudo -u "$(pm2 jlist | python3 -c 'import json,sys; print(json.load(sys.stdin)[0].get("username",""))' 2>/dev/null || echo www-data)" fc-list :lang=zh family | head`
- [x] 服务器时区为 `Asia/Shanghai`。
  **证据（2026-09-08 约 00:20，总指挥窗口生产只读实测）**：timedatectl 显示 Asia/Shanghai (CST, +0800)。
  **待取证（服务器只读）**：`timedatectl | grep -E 'Time zone|Local time'`
  （旁证、不足以下勾：nginx 重载日志本地时间 `2026/09/07 23:26:30` 对应 GitHub UTC `15:26:30Z`，为 UTC+8，与 `Asia/Shanghai` 偏移一致，但未读到时区名。）
- [x] 磁盘空间、内存、CPU 满足预估访问量。
  **证据（2026-09-08 约 00:20，总指挥窗口生产只读实测）**：/dev/vda2 ext4 40G，已用 16G、剩 23G（41%）；内存 3.8Gi 总 / 1.0Gi 用；2 vCPU；load 0.00 0.02 0.02。
  **待取证（服务器只读）**：`df -hT; free -h; nproc; uptime`
  （旁证、不足以下勾：deploy 磁盘闸门 `DISK_AVAIL_MB=20570`，只证明备份盘当时有约 20GiB 空闲。）
- [x] 防火墙只开放必要端口：HTTP/HTTPS、必要管理端口；数据库/Redis 不对公网开放。
  **证据（2026-09-08 约 00:20，总指挥窗口生产只读实测）**：`ss -lntup` 实测：0.0.0.0 只有 80 / 443（nginx）与 22（sshd）；**PostgreSQL 5432 与 Redis 6379 均只绑 127.0.0.1，未对公网开放** —— 强于本条要求。
- [x] Word → PDF 采用服务端 LibreOffice 或内网 Gotenberg；不在 Windows 一体机安装转换引擎，Terminal Agent 仍只接收 PDF / 图片。（**2026-09-07 生产已开通**：engine=soffice）
- [x] LibreOffice 路线安装固定版本的 `libreoffice-core` / `libreoffice-writer`；Gotenberg 路线固定容器镜像 digest，服务端口只允许 API 内网访问，禁止公网暴露。（2026-09-07 已装 LibreOffice 路线）
- [x] 安装思源黑体/宋体或 Noto CJK 字体包，执行 `fc-cache -f -v` 后 `fc-list ':lang=zh' family | head` 有输出；没有中文字体时能力必须保持关闭。（2026-09-07 公网实测 `cjkFonts:true`，冒烟 PDF 内嵌 CJK 字体）
- [x] soffice 运行账户使用独立低权限 UID、只写系统临时目录，并由容器/network namespace/防火墙阻断出网；进程内不可达代理只是纵深防护，不得替代主机侧封锁。
  **2026-09-07 落地方式（必须照此，勿简化）**：`SOFFICE_PATH` 指向隔离包装脚本 `/usr/local/bin/soffice-sandboxed`，由它用 `systemd-run` 调真正的 soffice；API 代码零改动（适配器本就是 `spawn(SOFFICE_PATH, args)`）。参数：`User=soffice-runner`（system 用户、nologin、无家目录）、`PrivateNetwork=yes`、`ProtectSystem=strict`、`ProtectHome=yes`、`NoNewPrivileges=yes`、`RestrictSUIDSGID=yes`、`RestrictNamespaces=yes`、`MemoryMax=1G`、`TasksMax=64`、`RuntimeMaxSec=120`、`ReadWritePaths=/tmp,/var/tmp`。
  **本机现状决定了这层隔离不可省**：API 与 pm2 均以 root 运行、`ufw inactive`、`iptables OUTPUT ACCEPT`、无 docker / firejail。直接把 `SOFFICE_PATH` 指向 `/usr/bin/soffice` 属**不达标配置**，等于让 root 权限、可任意出网的解析器处理用户上传的 Word。
  **三个实测坑，改动前务必读**：① `PrivateTmp=yes` 不能用 —— 沙箱私有 /tmp 会让 API 写在共享 /tmp 的输入文件在沙箱内不存在，soffice 报 `source file could not be loaded`；改用共享 /tmp，靠 `ProtectSystem=strict` + `ReadWritePaths` 限制写范围。② API 以 root 跑时 `mkdtemp` 目录是 700 root，低权限用户读不到输入、写不出输出（`Io Access 0x507`）；包装脚本须在调用前把该次 `--outdir` 与输入文件放开到最小范围、结束后收回。③ 包装脚本内**不得用 `exec`** —— exec 替换进程后 EXIT trap 不触发、权限收不回，首版实测在 /tmp 留下 707 世界可写目录；须前台运行、记录退出码、恢复权限后再原样退出。
- [x] 域名解析、HTTPS 证书正常。（**2026-08-08 外部实测**：`https://zyidai.cn` 返回 `HTTP/2 200`，`server: nginx/1.24.0 (Ubuntu)`；证书 `subject=CN=zyidai.cn`，`issuer=Let's Encrypt`，`notAfter=2026-10-04`。）**证书自动续期仍未验证** —— 须在服务器确认 certbot/acme 定时任务存在且上次续期成功。

### 3.2 环境变量核对

> **手改服务器 `.env` 后的强制自检（2026-09-07 新增，来自一次真实风险）**：任何人手工改动生产 `.env` 的键之后，**收工前必须跑一次发布脚本步骤 3c 用的同一个闸门脚本做干跑**，看到 `PREFLIGHT OK` 才算完成：
>
> ```bash
> cd /root/YITIJI && node services/api/scripts/preflight-production-gates.mjs \
>   --env-file /srv/ai-job-print/services/api/.env \
>   --force-true PRINT_REQUIRE_PII_SCAN,PRINT_REQUIRE_PRINTER_ONLINE
> ```
>
> **为什么**：手改的键若触发生产启动闸门，故障会推迟到下次发布的 PM2 重启那一步才爆 —— 那是最糟的失败位置（新代码已落盘、旧进程已死）。干跑把它提前一整个发布周期暴露。
> **干跑结论的有效期**：只在「闸门代码与部署脚本自已部署 SHA 起零变更」时成立，用 `git diff --stat <已部署SHA> origin/main -- services/api/src/config/production-runtime-gates.ts scripts/deploy-api-release.sh` 为空来确认。
> **手改的键能否在发布中存活**：`rsync` 排除 `services/api/.env`，发布步骤 3b 逐行 awk 只改 `PRINT_REQUIRE_PII_SCAN`，其余键原样透传 —— 2026-09-07 核实。


以 `.env.example` 为清单逐项核对生产 `.env`：

- [x] `NODE_ENV=production`。
  **证据（2026-09-08 约 00:20，总指挥窗口生产只读实测）**：pm2 `describe` 显示 `node env: production`；`.env` 1 条 + `/root/.pm2/dump.pm2` 2 条。**注意 `pm2 env 0 | grep ^NODE_ENV=` 返回 0 行是输出格式差异，不是缺失** —— 总指挥窗口一度据此误判为缺口，已纠正。
  **待取证（服务器只读）**：`pm2 env 0 | grep -E '^NODE_ENV='`（不要把其余环境变量贴进聊天或工单）
- [x] `JWT_SECRET` 使用生产强随机值，长度不少于 16 字符；不得使用本地开发/CI 测试值。
  **证据（2026-09-07，deploy 预检）**：run `34137990264` 对运行目录真实 `.env` 跑 `assertProductionRuntimeGates`（`PRODUCTION_JWT_SECRET_INVALID` 要求存在、长度达标、且不是样值前缀），结果 `PREFLIGHT OK: 24 gates`。未读出密钥值。
- [ ] `NODE_ENV=production` 已由 PM2/部署环境显式注入；支付、数据库、CORS 和其他生产运行时门禁均依赖该值，不得遗漏或写为 development。
  **待取证（服务器只读）**：`pm2 show ai-job-print-api | sed -n '/env:/,$p' | grep -E 'NODE_ENV' ; grep -E '^NODE_ENV=' /proc/$(pgrep -n -f 'ai-job-print-api|dist/main.js' | head -1)/environ 2>/dev/null | tr '\0' '\n' | grep '^NODE_ENV='`
- [x] `DATABASE_URL` 指向 PostgreSQL，不再指向 SQLite 文件。（**2026-08-08 外部实测**：`GET /api/v1/health` 返回 `{"status":"ok","db":"postgres"}`。）
- [x] `FILE_STORAGE_DRIVER=cos`；生产不得回退本地磁盘存储。
  **证据（2026-09-07，deploy 预检）**：真实 `.env` 在强制 `NODE_ENV=production` 的闸门下通过 `PRODUCTION_FILE_STORAGE_DRIVER_NOT_COS`（必须为 `cos`），`PREFLIGHT OK: 24 gates`。未读出密钥。
- [ ] API 生产启动门禁已验证：`NODE_ENV=production` 下，JWT_SECRET 缺失/过短、`FILE_STORAGE_DRIVER` 非 `cos`、`DATABASE_URL=file:` SQLite 均会启动失败。（**2026-08-08 复核**：门禁实现存在于 `services/api/src/config/production-runtime-gates.ts`（`PRODUCTION_JWT_SECRET_INVALID`、`PRODUCTION_FILE_STORAGE_DRIVER_NOT_COS`）。但线上 API 正常启动**不构成**门禁已生效的证据 —— 若 `NODE_ENV` 非 production，门禁根本不会执行。须在服务器确认 `NODE_ENV` 实际取值后才能打勾。）
  **证据（2026-09-08 约 00:20，总指挥窗口生产只读实测）**：`find /srv /var/backups` 命中 5 个 `.sqlite*`，**全部在 `node_modules` 内**（`china-division` 行政区划数据、Prisma `query_compiler_small_bg.sqlite.wasm`）；排除 `node_modules` 后**应用目录零残留**。取证命令必须带 `-not -path "*/node_modules/*"`，否则永远误报。
  **待取证（服务器只读）**：先取进程 `NODE_ENV`（见上条）。若为 `production`，再对照 PM2 重启后 `GET /api/v1/health` 已 200（run `34137990264` 已有 `API health OK`）即可关闭本条。预检把 `NODE_ENV` **叠成** production，不能单独当本条证据。
- [x] `REDIS_URL` 正确。
  **证据（2026-09-07，公网 ready）**：`GET https://zyidai.cn/api/v1/health/ready` → `subsystem=redis status=ok code=REDIS_REACHABLE message="Redis 可达（127.0.0.1:6379）"`。预检同时要求生产 `.env` 含 `REDIS_URL`。
- [x] API 监听端口、前端 API base URL、CORS allowlist 正确。
  **证据（2026-09-07 包 P1，公网 + deploy）**：deploy 健康检查 `http://127.0.0.1:3010/api/v1/health`；公网 `https://zyidai.cn/api/v1/*` 经 nginx 反代返回 JSON。CORS 实打（`curl --resolve zyidai.cn:443:120.48.13.190 -H Origin:`）：`https://zyidai.cn` / `https://admin.zyidai.cn` / `https://partner.zyidai.cn` 的 OPTIONS 与 GET 均回 `access-control-allow-origin` 为该源；`Origin: https://evil.example` 的 OPTIONS/GET **都没有** `access-control-allow-origin`。
- [ ] COS bucket、region、secretId、secretKey、签名 TTL 正确。
  **待取证（服务器只读）**：在 API 运行目录执行（禁止打印 secret 值）：
  ```bash
  grep -E '^(FILE_STORAGE_DRIVER|COS_BUCKET|COS_REGION|COS_SECRET_ID|FILE_SIGNING_TTL|COS_SIGNED_URL_TTL)=' services/api/.env \
    | sed -E 's/(SECRET_ID|SECRET_KEY)=.*/\1=SET/'
  ```
- [ ] COS 生命周期人工验收已完成并截图存档：禁止配置 Bucket 全局过期规则，`tmp/` 以外前缀不得覆盖长期保存对象，`long_term` 文件的 `expiresAt = null` 只能由业务删除或用户主动删除处理。
  **未完成**：需要腾讯云 COS 控制台规则截图（规则名 / 前缀 / 过期天数 / 启用状态）。CI `verify:cos-lifecycle-policy` 只钉仓库策略文档，**不是**线上桶配置。谁能做：有 COS 控制台权限的运维，对照 `docs/device` 生命周期条款存档。
- [ ] OCR provider 与百度密钥正确。
  **待取证（服务器只读）**：`grep -E '^(OCR_PROVIDER|BAIDU_OCR_API_KEY|BAIDU_OCR_SECRET_KEY)=' services/api/.env | sed -E 's/(KEY|SECRET_KEY)=.*/\1=SET/'`
  （旁证：预检要求 `OCR_PROVIDER=baidu` 且两把密钥非空；**未做百度 live 调用**，故不下勾。）
- [ ] AI provider / LLM 功能级配置可读取。
  **待取证（服务器只读）**：`grep -E '^(AI_PROVIDER|AI_LLM_API_KEY|TRTC_LLM_API_KEY)=' services/api/.env | sed -E 's/(API_KEY)=.*/\1=SET/'`
  （旁证：预检要求 `AI_PROVIDER=llm` 且至少一把 LLM key 非空；未做模型 live 调用。）
- [ ] ASR/TTS provider 与腾讯密钥正确。
- [ ] `RESUME_PDF_FONT_PATH` / `RESUME_PDF_FONT_FAMILY` 已按需配置；默认系统候选可用时可留空。旧变量 `JOB_MATERIAL_PDF_FONT_PATH` / `_FAMILY` 仅作兼容回退，不再作为新部署主配置。
- [~] `NODE_ENV=production` 下字体探测失败会以 `PRODUCTION_CJK_FONT_MISSING` 拒绝启动；管理员登录后读取 `GET /api/v1/health/cjk-font`，确认 `data.ok=true`、`path` / `family` 与预期一致。
  **2026-09-07 现状：端点实测未取到**（该端点需 Bearer Token，发布 lane 与 Windows lane 均无管理员账号，且都拒绝索取或代持管理员口令 —— 这个边界要保持）。
  当前填入的是**按 `cjkFontCandidates()` 解析顺序在服务器只读推定的值，非端点实测**：`path=/usr/share/fonts/truetype/wqy/wqy-microhei.ttc`（来自 `RESUME_PDF_FONT_PATH`，文件存在且 `-rw-r--r--` 可读）、`family=WenQuanYiMicroHei`（来自 `RESUME_PDF_FONT_FAMILY`）、`ok` 预期 `true`（该项为候选列表第一顺位，Noto CJK 为未被选中的次顺位）。
  **旁证**：服务器转换冒烟产出的 PDF 中文字体确实内嵌成功，`ok=true` 有独立佐证；但 `path` / `family` 的字面值只有推定，**没有独立核对**。
  **待办**：由持管理员账号者读取端点实际返回并与上述三值逐字比对，不一致以端点为准，届时把本条改为 `[x]` 并写明取证人与时间。
- [x] SMS provider 在短信审核前不得误设为真实生产发送。（**2026-07-26**：预发已为 `tencent` 且真号 E2E 通过；见 §2.2。正式生产仍须保持密钥仅服务端、禁止 log 假发送冒充生产。）
- [x] ~~`PRINT_REQUIRE_PAID_BEFORE_CLAIM` 显式设为 true 或 false~~ **该开关已删除，无需配置**。先付后印现在写死在代码里：Agent 只领取「已关联订单 + `payStatus='paid'` + `taskStatus='pending'`」的任务，`claimableWhere` 与事务内 CAS 两层都要求，任何环境都关不掉。验收口径改为看 CI 静态门禁 `verify:print-rollout-config`（钉死该开关不得存在、不得放行无订单任务）与行为门禁 `verify:kiosk-cashier-ui`。若运行目录 `.env` 里还留着这个变量，删掉即可，它已不生效。
  **证据（2026-09-07 包 P1，CI job 结论，不是脚本行号）**：run `34130143436` job `build-and-verify`（`101768117781`）success，其中步骤 `Verify suites` / `Backend P0 contract gates` 均为 success。该 run 是当晚生产发布 `34137990264` 的目标 CI。不引用脚本行号当「跑过」的证据。
- [ ] 若启用微信或支付宝「扫付款码」：`PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED=true` 已写入仅服务端环境并随 API 重启生效；支付宝同时已配置 `ALIPAY_APP_ID`、应用私钥、支付宝公钥、正式网关和 `PAYMENT_NOTIFY_BASE_URL=https://zyidai.cn`（密钥不进仓库、不进前端）。
  **待取证（服务器只读）**：`grep -E '^(PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED|ALIPAY_APP_ID|PAYMENT_NOTIFY_BASE_URL|PAYMENT_PROVIDER)=' services/api/.env | sed -E 's/(KEY|SECRET|PRIVATE)=.*/\1=SET/'`
  （旁证：公网 `GET /api/v1/payment/channels` → `["alipay","wechat"]`，只证明渠道开关，不证明扫码枪收敛 env。）
- [ ] 支付宝当面付现场验收：屏上动态二维码和 HID 扫码枪付款码各完成一笔受控小额交易；`10003`/网络不确定时只允许服务端查单收敛，不允许用户立即重扫；核对 Order、PaymentAttempt、渠道流水、出纸与退款记录一致。
  **未完成**：需要一体机现场两笔受控小额交易与对账记录。谁能做：现场运维 + 有订单库只读权限的人。属支付闭环上线阻塞（若生产要开当面付）。
- [x] `PRINT_SCAN_CAPABILITY_MODE` 显式设为 managed 或 strict（生产缺省会拒启动；managed=未配置能力行放行既有闭环，strict=未配置行 fail-closed，Task 11）。
  **证据（2026-09-07，deploy 预检）**：`PRODUCTION_PRINT_SCAN_CAPABILITY_MODE_UNDECLARED` 要求真实 `.env` 为 `managed|strict`，`PREFLIGHT OK: 24 gates`。具体取值未回显。
- [x] `TERMINAL_LEGACY_REGISTER_ENABLED=false`；生产启动门禁必须拒绝缺省或 `true`，共享 `adminSecret` 不得再用于新设备注册。
  **证据（2026-09-07，deploy 预检）**：`PRODUCTION_TERMINAL_LEGACY_REGISTER_FORBIDDEN` 要求真实 `.env` 显式为 `false`，`PREFLIGHT OK: 24 gates`。
- [x] `TERMINAL_PLANNED_PROVISIONING_ENABLED` 显式设为 `true|false`：滚动升级第一阶段保持 `false`；确认所有 API 实例均为 reader-aware 新版本且旧 binary 已摘流量/退出后，第二阶段才切 `true`。
  **证据（2026-09-07，deploy 预检）**：`PRODUCTION_TERMINAL_PLANNED_PROVISIONING_UNDECLARED` 要求真实 `.env` 显式 `true|false`，`PREFLIGHT OK: 24 gates`。当前处于第几阶段（值是 `true` 还是 `false`）未回显，见下条。
- [ ] 开启 planned writer 前已保存所有 API 实例的构建版本/commit、进程清单和健康检查证据；开启后禁止回滚到不认识 `lifecycleStatus` 的旧 binary。确需回滚时先把 planned writer 切回 `false` 并停止新设备预创建。
  **待取证（服务器只读）**：`grep '^TERMINAL_PLANNED_PROVISIONING_ENABLED=' services/api/.env; cat DEPLOY_SOURCE.txt; pm2 jlist | python3 -c 'import json,sys; [print(p["name"], p["pm2_env"].get("status"), p["pm2_env"].get("unstable_restarts")) for p in json.load(sys.stdin)]'`
- [ ] 文件大小、签名 URL TTL、匿名/会员数据 TTL 与产品要求一致。
- [x] `CONVERSION_ENGINE=soffice|gotenberg|disabled` 已显式声明；生产启用 soffice 时 `SOFFICE_PATH` 为绝对路径，启用 Gotenberg 时 `GOTENBERG_URL` 仅指向内网地址。（2026-09-07 生产 `CONVERSION_ENGINE=soffice`，`SOFFICE_PATH=/usr/local/bin/soffice-sandboxed`，**不是** `/usr/bin/soffice`）
- [ ] `CONVERSION_MAX_CONCURRENCY` 已按机器容量设置（默认 2）；确认单次 60 秒超时、输出 15MB 上限不被外围代理放宽。
  **待取证（服务器只读）**：`grep -E '^(CONVERSION_MAX_CONCURRENCY|CONVERSION_TIMEOUT)=' services/api/.env; nginx -T 2>/dev/null | grep -E 'client_max_body_size|proxy_read_timeout'`
- [ ] API 启动日志中记录的转换探测结果与 `GET /api/v1/document-conversion/capabilities` 一致；探测失败、缺字体或 disabled 时 `wordToPdf=false` 且返回明确 `reason`。
  **待取证（服务器只读）**：`pm2 logs ai-job-print-api --lines 200 --nostream | grep -Ei 'conversion|soffice|cjk|wordToPdf'; curl -fsS http://127.0.0.1:3010/api/v1/document-conversion/capabilities`

### 3.3 构建与静态资源

在服务器或等价预生产环境执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
```

验收：

- [x] 安装不依赖本机私有路径。
  **证据（2026-09-07，deploy 日志）**：run `34137990264` 在生产机两次 `pnpm install --frozen-lockfile` 成功（`Already up to date` / `Done … pnpm v11.2.2`）。CI job `101768117781` / `101768117757` 同样 `pnpm install --frozen-lockfile` success。
- [x] 构建产物路径与 nginx/静态服务配置一致。
  **证据（2026-09-07 包 P1 公网复测）**：`https://zyidai.cn/` `HTTP/2 200`，`last-modified: Mon, 07 Sep 2026 15:26:30 GMT`（与 deploy nginx 重载同一秒），引用 `/assets/index-Do9twi7d.js`、`/assets/index-BVFud9v_.css`；该 hash 与 deploy `34137990264` 构建日志 `dist/assets/index-Do9twi7d.js` 一致。Admin `index-DbJNOmHO.js` / Partner `index-B0pSiPGw.js` 同样与构建日志一致。
- [x] 前端资源 base path 正确。
  **证据（同上）**：`/assets/*` 绝对路径可正常加载；`GET https://zyidai.cn/assets/index-Do9twi7d.js` 返回 `206` `content-type: application/javascript`。
- [x] 大文件上传入口不会被前端路由或 nginx 误拦截。
  **证据（2026-09-07，公网）**：`POST https://zyidai.cn/api/v1/files`（无鉴权 JSON）→ `HTTP/2 401` `content-type: application/json` `{"error":{"code":"AUTH_MISSING_TOKEN"}}`，不是 SPA HTML、不是 nginx 405/404。路由打到 API。单请求体上限见 3.7 `client_max_body_size`（B 堆）。

#### 3.3.1 持续部署流水线（2026-08-08 新增，据线上实测补充）

- [ ] main CI 通过后自动部署已生效。
  **未完成（2026-09-07 包 P1）**：CI run `34130143436` success 之后，自动 `workflow_run` 部署 `34130176570` / `34133158769` 均为 `conclusion=skipped`。当晚成功发布是手动 `workflow_dispatch` `34137990264`（输入该 CI run）。谁能做：有 GitHub Actions 权限的人打开 skipped run 看 if 条件（常见是 `DEPLOY_API_ENABLED` 未放行）。**不是内容阻塞**；手动补发路径已通。
- [x] API 已纳入受控发布（2026-08-08「只发 Kiosk、不部署 API」已过时）。
  **证据（2026-09-07，deploy 日志）**：run `34137990264` job 名 `Deploy to server (API + Kiosk + Admin + Partner)`，日志 `=== 受控发布 API（备份→迁移→构建→PM2→健康）===`，随后 `prisma migrate deploy`、`[PM2] [ai-job-print-api](0) ✓`、`API health OK: http://127.0.0.1:3010/api/v1/health`。公网 `/api/v1/health/ready` 的 `since=2026-09-07T15:26:13.487Z` 与 PM2 重启时刻对齐。目标 SHA 来自已通过的 CI run `34130143436` → `759a37d4595c7932e804875db8686c73c09318c2`。
- [ ] **部署脚本 `rm -rf ${DEPLOY_WEB_ROOT}/*` 为不可回滚操作**：须确认该路径专用于 kiosk 静态资源、不含其他站点或用户数据，并确认失败时的回滚手段（保留上一版本产物或 nginx 双目录切换）。
  **待取证（服务器只读）**：`echo "WEB_ROOT=$DEPLOY_WEB_ROOT"; ls -ld "$DEPLOY_WEB_ROOT"; ls "$DEPLOY_WEB_ROOT" | head; nginx -T 2>/dev/null | grep -n -A2 "root "`
- [ ] 部署失败时的告警与回滚演练已完成。
  **未完成**：有备份锚点（见 3.8），但没有「故意失败 → 告警触发 → 按 DEPLOY_SOURCE 回滚 → 健康恢复」的演练记录。谁能做：有 SSH 的发布负责人。非内容阻塞，属发布可靠性。

### 3.4 PostgreSQL 空库部署验收

按 [postgres-operations.md](./postgres-operations.md) 执行并留存日志：

- [x] 生产库已连通并可服务查询。（**2026-08-08 外部实测**：`/api/v1/jobs`、`/api/v1/job-fairs`、`/api/v1/policies` 均返回 200 且结构正确。）
- [ ] **生产库业务内容为空 —— 上线前阻塞（2026-08-08 实测新增）**：岗位 `pagination.total = 0`、招聘会 `pagination.total = 0`、政策 `data: []`。接口与页面可用，但终端上没有任何可展示内容，不具备对外服务条件。须先完成：① 至少一个真实岗位来源（合作机构 API/Webhook/Excel 任一轨）导入并经管理员审核 `approved` + `published`；② 至少一场真实招聘会；③ 政策条目。导入后须复测三个端点 `total > 0`。
  **未完成（2026-09-07 公网复测仍空，上线阻塞）**：`GET https://zyidai.cn/api/v1/jobs?page=1&pageSize=1` → `pagination.total=0`；`/job-fairs` → `total=0`；`/policies` → `total=0`。谁能做：合作机构导入 + 管理员审核发布，按 [content-onboarding-runbook.md](../product/content-onboarding-runbook.md)。
- [x] 全新空库 `migrate deploy` 通过。
  **证据（2026-09-07，CI）**：run `34130143436` job `postgres-readiness`（`101768117757`）success；`ci.yml` 步骤 `Migrate deploy on fresh PG` 执行 `pnpm db:pg:deploy`，服务为 `postgres:16` 空库 `DATABASE_URL=postgresql://ci:ci@localhost:5432/ai_job_print_ci`。这是 CI 空库门禁，不是「今天在生产空库上重放」。
- [ ] `verify:demo-seed-guard` 通过，且生产未执行任何 `db:seed*`。
  **待取证（服务器只读）**：`ls -lt services/api/prisma/*.ts | head; grep -R "DEMO_SEED_CONFIRM\|db:seed" /var/log /root/.bash_history 2>/dev/null | head; psql -h 127.0.0.1 -d ai_job_print -c "SELECT email, role FROM \"User\" LIMIT 20;"`
  （旁证：CI `verify:demo-seed-guard` 在 run `34130143436` `build-and-verify` 已 PASS；**生产是否跑过 seed 仍须库内账号抽样**。）
- [ ] 现有生产恢复确认沿用已存在且已轮换口令的管理员账号，未运行首个管理员 bootstrap。
  **待取证（服务器只读）**：`psql -h 127.0.0.1 -d ai_job_print -c "SELECT count(*) AS users FROM \"User\";" ; psql -h 127.0.0.1 -d ai_job_print -c "SELECT action, created_at FROM \"AuditLog\" WHERE action ILIKE '%bootstrap%' ORDER BY created_at DESC LIMIT 5;"`
- [ ] 若为真正全新空库：运行前只读确认 `User=0`，受控凭据目录归当前用户且 mode 0700，双人批准 10 分钟执行窗口；bootstrap 后仅生成 1 个 temporary admin 和 1 条必成功创建审计。
  **待取证（服务器只读）**：先 `SELECT count(*) FROM "User";`。若 `User>0`，本条对当前生产 **N/A**（不是全新空库），在工单注明 count 后可改口径；不要把 N/A 写成已演练。
- [ ] 首个管理员以 HTTPS 登录，初始密码只进入强制改密流程且未获得管理 JWT；改密后为 `owner_managed`、`tokenVersion` 已递增、改密审计存在，并已使用新密码重新登录。
  **待取证（服务器只读）**：`psql -h 127.0.0.1 -d ai_job_print -c "SELECT role, \"tokenVersion\", \"passwordStatus\" FROM \"User\" WHERE role IN ('admin','owner') LIMIT 10;"`（列名以实际 schema 为准）
- [ ] 0600 初始凭据文件已在改密验收后安全删除；CLI 结果不确定时已按 runbook 三态 reconciliation 核对，未直接重跑或删除凭据。
  **待取证（服务器只读）**：`sudo find /root /srv /var -name '*admin*cred*' -o -name '*bootstrap*' 2>/dev/null | head; sudo ls -l /root/*pass* 2>/dev/null | head`
- [ ] API 启动日志显示连接 PostgreSQL，不是 SQLite。
  **待取证（服务器只读）**：`pm2 logs ai-job-print-api --lines 100 --nostream | grep -Ei 'postgres|sqlite|datasource|Prisma'`
  （旁证：公网 health `db=postgres`、migrate 日志 `Datasource "db": PostgreSQL … 127.0.0.1:5432`；**启动日志原文仍须 grep**。）
- [x] PG schema 漂移校验通过。
  **证据（2026-09-07）**：① CI job `101768117757` 步骤 `PG schema drift check`（`pnpm db:pg:sync:check`）随 job success；② 生产 `prisma migrate deploy` 日志 `67 migrations found` / `No pending migrations to apply`（run `34137990264`）。
- [ ] 核心表外键与唯一约束生效。
  **待取证（服务器只读）**：`psql -h 127.0.0.1 -d ai_job_print -c "\d \"ExternalJob\"" ; psql -h 127.0.0.1 -d ai_job_print -c "SELECT conrelid::regclass, conname, contype FROM pg_constraint WHERE contype IN ('f','u','p') ORDER BY 1,3 LIMIT 40;"`
- [x] 数据库备份脚本可执行。
  **证据（2026-09-07，deploy 日志）**：run `34137990264` 步骤 `=== 2. PostgreSQL 全库备份 + 可读校验 ===` 在 15:25:27Z 开始、15:25:28Z 进入下一步（`pg_dump -Fc` + `pg_restore -l` TOC 可读校验），发布未因备份失败中止。随后 `备份共 7 组 … 将保留 3 组`。
- [ ] `pg_dump` 备份文件可恢复到临时库。
  **未完成**：deploy 的「可读校验」只做 `pg_restore -l` 列 TOC，**没有**恢复到临时库并跑查询。谁能做：有 PG 权限的人按 `postgres-operations.md` 建临时库 `pg_restore` 后 `SELECT count(*)`。属备份可靠性，不是内容阻塞。

### 3.5 历史数据迁移门禁（当前无通用全库搬数命令）

- [x] 确认生产仍以 PostgreSQL 为唯一运行库，未设计或执行 PG→SQLite 回退。
  **证据（2026-09-07）**：公网 health `db=postgres`；deploy migrate 数据源 `PostgreSQL database "ai_job_print" … 127.0.0.1:5432`；`DEPLOY_SOURCE` 写入 `api_database=postgresql`；生产闸门拒绝 `DATABASE_URL=file:`（预检 24 gates）。没有 PG→SQLite 回退发布路径。
- [ ] 未从 Git 历史恢复或执行已退役的 SQLite→PostgreSQL 全库搬数工具。
  **待取证（服务器只读）**：`ls -l /srv /var/backups 2>/dev/null | grep -iE 'sqlite|\.db$'; grep -R "sqlite-to-pg\|sqlite2pg" /root/.bash_history 2>/dev/null | head`
- [ ] 如确有外部旧库导入需求，已另立具名授权的领域迁移方案，不把它夹带进常规部署。
  **未完成**：仓库与本次取证未见具名授权的领域搬数方案。若确认「无外部旧库要导」，由产品负责人书面关闭本条；在此之前保持未勾。非当前内容阻塞。
- [ ] 领域迁移已在同等级访问控制的备份恢复库或批准脱敏 fixture 上完成只读 preflight、dry-run、逐类守恒对账和失败恢复演练。
  **未完成**：无演练记录。前提是上条「有外部旧库」。谁能做：数据负责人。非当前内容阻塞。
- [ ] 孤儿/重复/缺来源数据进入 blocker 或归档清单，未被猜测补值、静默丢弃或自动发布。
  **未完成**：无对账清单。当前公网三类内容 `total=0`，对账对象本身为空。内容导入（3.4 阻塞项）时必须顺带做本条。

**B1 扫描会话安全加固 migration 前置检查（如目标库已有真实 `ScanTask` 数据）**：迁移
`20260713160000_add_scan_task_active_session_unique`（同一 `terminalId` 同时只允许一条
`status IN ('waiting','matched')` 的活跃 `ScanTask`，partial unique index）会在存量数据违反
该约束时直接建索引失败、阻断整个 `migrate deploy`。`ScanTask` 功能自首期真实扫描上线起就已
可能产生数据（不是本次 migration 才新引入这张表），因此**任何**已经跑过一段时间、可能已有真
实扫描记录的环境（不限于本次是否是首次切换到 PostgreSQL）部署这条 migration 前必须先执行：

```sql
SELECT "terminalId", COUNT(*) FROM "ScanTask" WHERE status IN ('waiting','matched') GROUP BY "terminalId" HAVING COUNT(*) > 1;
```

- [x] 上述 SQL 结果为空（无重复活跃行）方可继续部署此 migration。
  **证据（2026-09-07，生产 migrate）**：run `34137990264` `67 migrations found` / `No pending migrations to apply`。该 unique index 若在有重复行时创建会让 `migrate deploy` 失败；它已经在已应用集合里，当前库不能再插入重复活跃行。
- [ ] 若非空：先人工核实每个终端的重复行——保留最新一条 `waiting`/`matched`，其余转
  `expired`（未匹配）或 `cancelled`（已匹配但未完成），再重跑预检确认清空。
  **待取证（服务器只读）**：仍建议跑一遍上面的 SQL 确认当前为 0 行。若为 0，本条 N/A。
- [ ] 该 migration 上线前，若目标终端的 `scan` 能力当前为 `available` 且确有 Agent 在跑，
  先临时把该终端 `scan` 能力置为非 `available`（Admin 能力开关）并停止对应 Terminal Agent
  的 scan-watcher，避免修复上线瞬间的行为切换影响正在进行的真实扫描；确认无进行中扫描后
  再部署，部署完成、验证通过后再恢复 `available`。
  **待取证（服务器只读）**：`psql -h 127.0.0.1 -d ai_job_print -c "SELECT \"terminalId\", key, status FROM \"TerminalCapability\" WHERE key='scan';"`（列名以 schema 为准）

### 3.6 核心 verify

以项目实际 package scripts 为准，至少覆盖：

```bash
pnpm --filter ./services/api verify:member-assets-c2d
pnpm --filter ./services/api verify:mock-interview
pnpm --filter ./services/api verify:job-fit
pnpm --filter ./services/api verify:resume-optimize
pnpm --filter ./services/api verify:resume-generate
pnpm --filter ./services/api verify:cjk-font
pnpm --filter ./services/api verify:production-runtime-gates
pnpm --filter ./services/api verify:ocr-baidu
pnpm --filter ./services/api verify:career-plan
pnpm --filter ./services/api verify:activity-logs
pnpm --filter ./services/api verify:document-conversion
```

验收：

- [x] verify 全部 PASS。
  **证据（2026-09-07 包 P1，CI job/step 结论，不引用 workflow 行号）**：run `34130143436` 四个 job 全部 success：`build-and-verify` `101768117781`（步骤 `Verify suites` / `Backend P0 contract gates` / `Backend P0 real HTTP contracts` / `PG schema drift check` success）、`postgres-readiness` `101768117757`（步骤 `Core verify suites on PG` / `Migrate deploy on fresh PG` success）、`kiosk-browser-smoke`、`release-bundle`。口径是 GitHub Actions 全量门禁绿，不是生产机复跑上表命令。
- [ ] 运行日志无简历原文、面试回答、转写文本、规划正文、API Key、access token。
  **待取证（服务器只读）**：`pm2 logs ai-job-print-api --lines 500 --nostream | grep -Ei 'sk-|api[_-]?key|Bearer eyJ|BEGIN PRIVATE|access_token' || echo 'no credential-like lines in last 500'`
  （旁证：CI `verify:pii-redaction` / `verify:error-observability` 在 run `34130143436` PASS，钉的是代码路径，不是生产日志。）
- [x] 验证脚本在 PostgreSQL 环境下执行，而不是误连 SQLite。
  **证据（2026-09-07，CI）**：job `postgres-readiness` `101768117757` success；`ci.yml` 该 job `DATABASE_URL: postgresql://ci:ci@localhost:5432/ai_job_print_ci`，服务镜像 `postgres:16`。SQLite job 是并行的 `build-and-verify`，不替代本条。
- [ ] `SOFFICE_PATH` 存在的部署机使用真实 `.doc` / `.docx` 样例执行转换，逐份打开 PDF 核对中文字体、表格、图片、分页、页数，并记录 LibreOffice 版本；本地 fake 引擎通过不等于真实转换通过。
  **待取证（服务器只读）**：清单已给出的探测命令（把 `API_PORT` 换成 `3010`）：
  ```bash
  test -x "$SOFFICE_PATH" && "$SOFFICE_PATH" --version
  fc-list ':lang=zh' family | head -20
  curl -fsS http://127.0.0.1:3010/api/v1/document-conversion/capabilities
  SOFFICE_PATH="$SOFFICE_PATH" pnpm --filter ./services/api verify:document-conversion
  ```
  然后用真实样例转 PDF 并人工打开。公网 `engine=soffice wordToPdf=true` **不等于**版式目视验收。

转换引擎部署探测命令（服务器执行，不含密钥）：

```bash
test -x "$SOFFICE_PATH" && "$SOFFICE_PATH" --version
fc-list ':lang=zh' family | head -20
curl -fsS http://127.0.0.1:${API_PORT:-3010}/api/v1/document-conversion/capabilities
SOFFICE_PATH="$SOFFICE_PATH" pnpm --filter ./services/api verify:document-conversion
```

### 3.7 nginx / 反代 / 上传限制

- [x] `/api/v1/*` 正确反代到 API 服务。
  **证据（2026-09-07，公网）**：`GET /api/v1/health`、`/health/ready`、`/document-conversion/capabilities`、`/payment/channels`、`/jobs` 均 `HTTP/2 200` + `server: nginx/1.24.0 (Ubuntu)` + JSON。deploy 本机探活 `http://127.0.0.1:3010/api/v1/health`。
- [x] Kiosk/Admin/Partner 静态资源路径正确。
  **证据（2026-09-07，公网 + deploy）**：`https://zyidai.cn/` HTML title「AI求职打印服务终端」、Vite `/assets/index-Do9twi7d.js`；`https://admin.zyidai.cn/` title「管理员后台 - AI求职打印服务终端」；`https://partner.zyidai.cn/` title「合作机构后台 - AI求职打印服务终端」。deploy 日志 `admin dist 已同步到 ***` / `partner dist 已同步到 ***`。同主机路径 `/admin` `/partner` 仍落到 Kiosk SPA（预期，正式入口是子域）。
- [x] `client_max_body_size` 支持简历 PDF、图片、扫描件上传。
  **证据（2026-09-07，发布 lane 服务器只读取证；主持人复核应用侧数字）**：三份站点配置（`ai-job-print` / `-sslip` / `-zyidai`）五处均为 `client_max_body_size 100m`。简历 / 打印文档 / 证件照 / 招聘会材料的 purpose 上限均 ≤30MB，100m 足够。
  **待取证（服务器只读）**：`nginx -T 2>/dev/null | grep -n client_max_body_size`
- [ ] API body limit 与 nginx limit 不冲突。
  ⚠️ **不一致，待产品负责人决定**（证据（2026-09-07，发布 lane 服务器只读取证；主持人复核应用侧数字）**：）：nginx `100m`，而应用侧 `RAW_UPLOAD_PROXY_MAX_BYTES = 200MB`（`services/api/src/files/file-validation.ts:134`），有效上限 = `min(purpose 上限, 200MB)`。
  **`PURPOSE_POLICY` 里只有三个 purpose 超过 100MB，且都是 500MB**：`partner_video`（合作机构宣传视频）、`screensaver_material`（待机宣传屏素材）、`admin_upload`（管理员上传）→ 这三类有效上限 200MB，**会在 nginx 100MB 处被 413 掐断，且用户看到 nginx 默认错误页而非应用提示**。其余上传全部 ≤30MB，不受影响。
  **三选一并写进文档，不选就是埋着**：① nginx 提到 ≥200m；② 这三个 purpose 降到 ≤100MB；③ 这三类改走 COS 直传（不经 nginx，500MB 视频本就不该整份穿 nginx 再进 API 进程内存）。**任一方案都要动生产或改代码，需产品负责人授权。**
  **待取证（服务器只读）**：`nginx -T 2>/dev/null | grep client_max_body_size; grep -E '^(JSON_BODY|NEST_BODY|FILE_MAX)' services/api/.env`
- [ ] 上传超时配置满足大文件与弱网场景。
  ❌ **未配置，判不满足，排上线前**（证据（2026-09-07，发布 lane 服务器只读取证；主持人复核应用侧数字）**：）：三份 nginx 配置里没有任何 `proxy_read_timeout` / `proxy_send_timeout` / `client_body_timeout`，走默认 **60 秒**。一体机现场是有线网，但**手机扫码上传走用户自己的移动网络**，弱网传几十 MB 扫描件 60 秒很容易不够。需动生产 nginx，需产品负责人授权。
  **待取证（服务器只读）**：`nginx -T 2>/dev/null | grep -E 'proxy_read_timeout|proxy_send_timeout|client_body_timeout'`
- [ ] WebSocket/SSE 如有使用，反代升级头正确。
  **待取证（服务器只读）**：`nginx -T 2>/dev/null | grep -n -E 'Upgrade|proxy_set_header Connection|proxy_http_version'`
  （旁证、不足以下勾：本包对 `https://zyidai.cn/api/v1/health` 发 `Upgrade: websocket` 仍拿到 JSON 200，不是 101；这只说明 health 不是 WS 端点，不能代替 nginx 配置全文。）
- [x] `/opc` 等其他项目路径不会与本项目路由冲突。
  **证据（2026-09-07，发布 lane 服务器只读取证；主持人复核应用侧数字）**：三份站点配置里无 `/opc`，也无任何非本项目 location。
  **待取证（服务器只读）**：`nginx -T 2>/dev/null | grep -n -E 'location |server_name |root '`
  （旁证：公网 `https://zyidai.cn/opc` 落到 Kiosk SPA HTML，像是前端 fallback，不是独立站点。是否另有 `/opc` 项目须看 nginx 配置。）

### 3.8 进程守护与日志

- [x] API 使用 PM2/systemd/等价方式守护，异常自动重启。
  **证据（2026-09-07，deploy 日志）**：`[PM2] Applying action restartProcessId on app [ai-job-print-api](ids: [ 0 ])` / `[PM2] [ai-job-print-api](0) ✓`，表中 `status=online` `↺=25`。随后本机与公网 health 200，`ready.since=2026-09-07T15:26:13.487Z`。未做故意杀进程的混沌演练。
- [x] Worker/队列进程独立守护。 —— **N/A（当前 PM2 没有独立 worker 进程）**
  **证据（2026-09-07 包 P1，deploy 日志，不是「仓库里 worker 是空壳」）**：run `34137990264` PM2 表只有 `ai-job-print-api`（id 0，`status=online`）和模块 `pm2-logrotate`（id 1）。公网 ready 的 `member-privacy-scheduler` 挂在 API 进程内（`EXPORT_SCHEDULER_REGISTERED`）。
  ⚠️ 进程内消费没有独立重启边界；任务量上去后若仍要独立 worker，需另立进程。**不是与「内容为空」同级的上线阻塞**。
- [x] 前端静态服务或 nginx 重启策略明确。
  **证据（2026-09-07，deploy 日志）**：`=== 重载 nginx ===` 后 `2026/09/07 23:26:30 [notice] … signal process started`，job 以 `✅ 部署完成` 收尾。
- [x] 日志路径固定，日志轮转已配置。
  **证据（2026-09-07，发布 lane 服务器只读取证；主持人复核应用侧数字）**：`/root/.pm2/logs/ai-job-print-api-{out,error}.log`；`pm2-logrotate` 配置 `max_size 50M` / `retain 7` / `rotateInterval 0 0 * * *`。
  **待取证（服务器只读）**：`pm2 conf pm2-logrotate; ls -l ~/.pm2/logs /var/log/nginx | head`
  （旁证：PM2 模块 `pm2-logrotate 3.0.0` `status=online`；**路径与保留份数未读出**。）
- [x] 日志级别生产可控，不输出敏感正文。
  **证据（2026-09-08 约 00:20，总指挥窗口生产只读实测）**：`pm2 logs --lines 500 | grep -cEi 'sk-|api[_-]?key|Bearer eyJ|BEGIN PRIVATE|access_token'` → **命中 0 行**。取证方式本身安全：只计数、不打印命中行。
  **未验，且取证方式本身有风险**：抽查日志内容可能读到敏感数据。**取证时只做模式匹配、不打印命中行**（统计命中数并报出条目，不回显内容）—— 验证动作自己不能制造它要防的风险。待有服务器只读权限者按此方式执行。
  **待取证（服务器只读）**：`grep -E '^(LOG_LEVEL|PINO_LEVEL)=' services/api/.env; pm2 logs ai-job-print-api --lines 80 --nostream`
- [x] 健康检查接口或探活脚本可用。
  **证据（2026-09-07，公网）**：`GET https://zyidai.cn/api/v1/health` → 200 `status=ok db=postgres degraded=[]`；`GET https://zyidai.cn/api/v1/health/ready` → 200 `status=ready`（database/redis/member-privacy-scheduler 均为 `ok`）。deploy 发布闸门使用 `curl -fsS http://127.0.0.1:3010/api/v1/health`。
- [x] 部署回滚脚本/流程明确。
  **证据（2026-09-07，deploy 日志）**：步骤 7 写 `DEPLOY_SOURCE.txt`，字段含 `rollback=restore $BACKUP_PREFIX.runtime then if migration rollback required restore $BACKUP_PREFIX.dump`、`backup=`、`runtime_backup=`、`ci_run=`、`source=origin/main@$TARGET_SHA`。步骤 2/3 已生成 dump + runtime 锚点，成功后保留 3 组。这是流程写清，**不是**失败演练（演练见 3.3.1 C 堆）。

---

## 四、线上浏览器业务验收

在生产或预生产域名上，用真实浏览器完成以下路径：

### 4.1 账号与资产

- [ ] 手机号登录/登出成功。 —— 生产待验；**本地 PASS**（登出后旧 token 立即 401，且以「登出前同一请求 200」为内建阳性对照）
- [ ] QR 扫码登录成功：Kiosk 通过 Terminal Agent 本地桥接创建二维码，手机打开二维码 URL 后只确认登录，一体机拿到会员态；手机端不接收 member token。
- [ ] QR 二维码 URL 的公网/局域网基址可被手机访问；如果 Kiosk 页面运行在 `localhost`，必须显式配置手机可访问的 `VITE_QR_LOGIN_PUBLIC_BASE_URL`。
- [ ] 空闲自动退出生效。 —— 生产待验；**已有 CI 覆盖**：`kiosk-privacy-timeout.spec.ts` 23 条用例，`ci.yml:1053-1054` 两条 job 在跑，本地复跑 `23 passed`。
- [ ] 忙碌态（上传/AI/打印中）不误触发退出。 —— 生产待验；**同上套件覆盖**（忙碌锁顺延 `VITE_KIOSK_PRIVACY_BUSY_DEFER_SEC`）。
- [ ] 「我的」资产区加载成功，无假数量。 —— 生产待验；**本地 PASS**（未登录 401 且响应里 0 个计数字段）
- [x] 未登录游客不展示跨会话资产。 —— **PASS，且强于本条要求**
  **证据（2026-09-07 23:38–23:40，发布 `759a37d45` 之后，发布 lane 取证）**：**每条路由开全新浏览器上下文**（无 cookie / localStorage / sessionStorage），走真实域名逐条访问「我的」六个资产页并抓全部 `/api/v1/` 调用 —— `/me/resumes`、`/me/documents`、`/me/print-orders`、`/me/ai-records`、`/me/favorites`、`/me/activity` **六页登录门均在，且各发出 0 条 `/api/v1/` 调用**；六页文案均写「仅本人可见」，与 §10 数据边界一致。
  **为什么按「0 条调用」记而不是「返回 401」**：401 是**服务端过滤**（请求发生过、被拒），仍存在「过滤条件某天被改错就漏数据」的风险面；0 条是**客户端 fail-closed**，该风险面不存在。这个 0 也是回归时最灵敏的指标 —— 哪天有人加「先拉一下再判断登录」的优化，0 就会变非 0。
  **复验方法（必照做）**：① **必须每条路由新开 context** —— 共用 context 时第一页登录门写进的本地状态会污染后续判断（发布 lane 曾因共用 page 被待机态污染，产出 74 条假结论）；② 域名侧需本机 DNS 劫持 + 浏览器 `--host-resolver-rules` 指向 `120.48.13.190`。

### 4.2 AI 简历与「我的」闭环

- [ ] 上传简历 → AI诊断 → 报告页 → 「我的」AI服务记录可见。 —— 生产待验；**本地 PASS**
- [ ] 简历优化 → 优化结果 → 导出 PDF → 我的文档可见。 —— **生产域名仍待验**；本地真实后端已 PASS
  **本地证据（2026-09-08，[会员闭环运行期证据](../reviews/member-closure-runtime-evidence-2026-09-08.md)）**：
  一次不间断的真人旅程留下完整审计链 `file.upload → parse_submitted → optimize_requested →
  resume.generate_exported → member.ai_record_delete → file.delete`，导出稿 `endUserId` 为本人会员。
  **最后两条 `actorRole=enduser` 是闭环的证明** —— 会员必须先在「我的文档」里看见文件才可能点删除，
  删除动作比截图更难伪造。这是 [#946](https://github.com/wanglei581/YITIJI/pull/946) 的反面证据：
  缺陷期该链路对登录会员 100% 失败（0 文件 0 审计）。
  **为什么仍不勾**：本地是 SQLite + 本地存储 + `AI_PROVIDER=mock`，与生产的 PostgreSQL + COS +
  真实 LLM 不同构；§4.2 要求的是生产或预生产域名上的真实浏览器验收，本地证据不能替代。
  **同轮附带发现**：走查脚本的 `recordStep` 吞掉每一步异常继续走（记录型设计），
  却被包在 `test()` 里当判定型门禁用 —— 缺验证码时整条会员用例 **8.4 秒跑完且 PASS、零覆盖**。
  已在阶段交界处插硬断言（缺码 → `test.skip()` 显示 skipped 而非 passed）。
  **记录型工具报绿只说明它走完了，不说明它验到了** —— 复验时别拿这类脚本的绿当证据。
- [ ] AI简历生成 → 预览/编辑 → PDF → 我的简历/我的文档可见。 —— 生产待验；**本地 PASS**（导出 201，我的文档 1→2）
- [ ] 岗位匹配参考 → AI服务记录可见。 —— **本地未实测**：job-fit provider 未配置，端点如实回 503。另注意它走 `job_ai` 而非 `resume_ai` 授权，是有意的颗粒度设计，复验时要分别授权，别把它当缺陷。
- [ ] 模拟面试 → 报告 → 「我的」模拟面试报告子区可见 → 可返回报告。
- [ ] 删除 AI记录后不残留幽灵记录。 —— 生产待验；**本地 PASS，两处同验**
  **只断言「列表里没有了」不够** —— 记录可能只是被列表查询过滤掉，直连 `GET /resume/records/:taskId` 仍读得到。
  本地同时验：列表少一条 **且** 直连读取 404。阳性对照：对未删除的记录做同样直连读取回 200，
  幽灵条件成立、断言会判 FAIL，**证明它分辨得了「删了」和「没删」**。生产复验建议照此两处同验。

### 4.3 打印/文件闭环

> **2026-09-08 本地取证**：本节 4 条已在本地真实后端跑出运行期证据（11 项断言全 PASS，
> 含阳性对照证明断言不恒真），明细见
> [会员闭环运行期证据](../reviews/member-closure-runtime-evidence-2026-09-08.md) 的 §4.3 附录，
> 脚本 `apps/kiosk/scripts/probe-file-closure-43.mjs`。
> **本地 PASS 不等于可勾** —— 本地是 SQLite + 本地存储 + `AI_PROVIDER=mock`，与生产的
> PostgreSQL + COS + 真实 LLM 不同构，本节要求的是生产或预生产域名上的真实浏览器验收。
> 其余 6 条本地证不了的原因已在附录里逐条列出（Word 转换需 soffice、打印链路需 Agent 与打印机）。


- [ ] 按 [用户文件与简历资产生产/试运营验收证据包](../acceptance/user-file-assets-trial-acceptance.md) 完成用户文件与简历资产证据包，留存命令日志、浏览器截图、COS 控制台截图、PostgreSQL 抽样和审计查询结果；不得以本地 SQLite/local storage verify 代替 PostgreSQL + COS + 会员账号真实验收。
- [ ] 上传文件 → 我的文档可见。 —— 生产待验；**本地 PASS**
- [ ] 文档预览使用短期签名 URL。 —— 生产待验；**本地 PASS**（`sig` 存在、TTL 1800s ≤ 上限）
- [ ] 文档下载成功。 —— 生产待验；**本地 PASS**（200 / 字节与原件一致 / `application/pdf`）
- [ ] 再打印进入打印链路。
- [ ] `.doc` / `.docx` 上传后仅在 capabilities `wordToPdf=true` 时允许「转 PDF / Word 预览 / Word 打印」；否则入口置灰并展示服务端返回的 reason。
- [ ] Word 转换后的界面固定展示「由转换引擎生成，复杂版式可能有偏差，请预览核对」，用户确认预览后才进入打印建单。
- [ ] Word 打印任务关联的是 `createdBy=document_conversion`、`assetCategory=derived`、`sourceFileId=原件` 的派生 PDF；Agent 下载 MIME 为 `application/pdf`，不直接下发 Word。
- [ ] 删除文档后对象存储与数据库状态一致，删除审计存在。 —— 生产待验；**本地 PASS**
  本地还多验一条清单没写、但更该验的：**删除前已经铸出去的签名链接，删除后必须失效**（实测 404）。
  只查「DB status 改成 deleted」的断言，对「字段改了但文件还能下」这种缺陷是瞎的。建议生产复验时照此加验。
- [ ] 打印任务进入打印订单，状态展示正确。

### 4.4 岗位/招聘会/政策

- [ ] 岗位列表/详情真实数据展示来源机构、同步时间、外部 ID。
- [ ] 岗位收藏进入我的收藏。 —— 生产待验；**本地 PASS**（收藏 / 取消收藏均实测）
- [ ] 去来源平台投递只记录打开入口行为，不记录第三方后续结果。 —— 生产待验；**本地 PASS，且已落成机械判据**
  两条判据（见 `apps/kiosk/scripts/probe-activity-favorites-44.mjs`）：
  ① `BrowseLog` / `ExternalJumpLog` 列名不得命中 `status|result|outcome|stage|applied|interview|offer|hired|progress`；
  ② `ActivityJumpAction` 取值必须全是 `external_*` 打开语义。当前四个取值全部是「打开了外部入口」——
  **`external_apply` 记的是「用户点开了来源平台的投递页」，不是「用户投递了」，这个区别就是许可证边界。**
  已做阳性对照：同一条规则打在 `FileObject`（有 `status`）与 `PrintTask`（有 `status,printOutcome`）上都会判 FAIL，
  证明它不是恒真断言。**合规类断言尤其需要阳性对照 —— 一条永远为真的合规断言，比没有断言更危险。**
- [ ] 岗位浏览与外部入口打开在「我的」浏览与跳转记录可见，可删除。 —— 生产待验；**本地 PASS**（写入 → 可见 → 删除 → 不再可见，四步实测）
- [ ] 招聘会详情真实数据可见。
- [ ] 招聘会收藏进入我的收藏。 —— 生产待验；**本地 PASS**（`fair-hr-1k-2026q2` 实测）
- [ ] 招聘会浏览与外部预约入口打开在「我的」浏览与跳转记录可见，可删除。 —— 生产待验；**本地 PASS**（`action=external_appointment`）
- [ ] 招聘会资料打印进入我的文档 + 打印订单。
- [ ] 政策收藏进入我的收藏。 —— **本地未实测**：`PolicyPost` 夹具 0 行。拿合成 id 也能让端点回 200 凑出 PASS，但那证明的是「通道能收任意字符串」，不是「政策收藏可用」，所以不记。
- [ ] 政策浏览与官方入口打开在「我的」浏览与跳转记录可见，可删除。
- [ ] 政策材料打印仅在真实材料源启用后验收；当前 info-only 卡片不得伪造我的文档或打印订单。

### 4.5 AI/外部服务

- [ ] LLM 真实调用成功，失败时有诚实错误提示。
- [ ] OCR 图片/扫描 PDF 成功，低置信度提示复核。
- [ ] ASR/TTS 在支持环境可用；失败时文字兜底可用。
- [ ] 外部服务失败不伪造成功、不写入假结果。 —— 生产待验；**本地 PASS，且做了双配置对照**
  脚本 `apps/kiosk/scripts/probe-ai-failure-honesty-45.mjs`。注入 provider 失败后：
  接口 501 诚实报错、`AiResumeResult` 与 AI 产出文件均**零新增**、`AiServiceLog` 记 `parseResume/failed`。
  **阳性对照**：换回可用 provider 后同样三条断言全部转红（201 / 结果行 +1 / 日志记 success）——
  **两种配置给出相反结论，才证明它们分辨得了真假**。只跑失败态的话，一条恒真断言也会全绿。

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

- [x] Kiosk 页面可从生产域名打开。
  **证据（2026-09-07 23:31，发布后，Windows lane 取证）**：`https://zyidai.cn/`（**非 IP**，真实域名 + HTTPS）；bundle `/assets/index-Do9twi7d.js`（本次发布新产物，域名侧已生效）；正文 615 字，首屏「今天想办什么 / 说出你的处境，顺序我来排」正常渲染；JS 运行错 0。
  **取证方法（必抄，否则下一个人按域名复验会打到黑洞并误判「线上挂了」）**：本机 DNS 把 `zyidai.cn` 劫持到 `198.18.x`，浏览器 `--host-resolver-rules` 指向 `120.48.13.190`。
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

#### 5.6.1 收款已开通后新增的承重项（2026-09-08）

背景：生产已开通真实收款（见 §进度 2026-09-07），而履约链路当时只有软件侧证据。
2026-09-08 用真实 HTTP 请求跑完软件侧 29 步（见
`docs/reviews/fulfilment-chain-software-evidence-2026-09-08.md`），未发现缺陷。
下面这几条是那轮走查暴露出的、**软件侧证不了、只能真机证**的部分，经四家 CLI 评审
删掉了三条伪需求后剩下的。每条都写明「软件侧已证到哪」，避免真机上重复验已证的部分。

- [ ] **出纸内容与用户上传的那一份一致**：Agent 用任务下发的签名 `fileUrl` 下载后，
      先比对任务里的 `fileMd5` 再送驱动；纸面内容与用户上传的原件一致（不是上一单的
      缓存、不是占位页）。
      *软件侧已证*：服务端下发的文件 sha256 与任务声明逐字节一致；篡改 `sig`、换
      `fileId`、去签名裸取一律 401。**真机要证的是 Agent 真的按摘要校验后才打。**
      *留证*：任务 ID、Agent 日志里算出的摘要、纸面照片。

- [ ] **缺纸 / 卡纸时不得假完成**：抽空纸盒或人为卡纸，让作业进入 Windows 打印队列
      但纸不出，确认任务**不得**置 `completed`、Kiosk 完成页**不得**提示取纸。
      加纸/清障恢复后，记录实际行为是补打、吞单还是重复打，三者都要写进结果。
      *为什么承重*：既有「打印失败 → failed」只覆盖驱动明确报错的真失败；**收了钱之后
      的假完成只能靠看纸**，这是唯一会让用户付了钱、页面说好了、手里没纸的路径。
      *留证*：任务 ID、任务终态、Windows 队列截图、纸盒前后状态、恢复后纸张实物张数。

- [ ] **断网后不重打**（与下一条分开做，不要合并勾）：Agent 出纸后、上报 `completed`
      前拔网线；恢复后确认**纸只出过一次**。
      *判据*：以**纸匣张数前后计数**为准，不以 `PrintTask` 数量为准 —— 后者软件侧已证
      恒为 1，真机再验一遍等于没验。
      *留证*：断网时刻、恢复时刻、纸匣计数前后值、该订单任务 ID。

- [ ] **Agent 进程重启后不重打**：Agent 出纸后、上报前杀进程并重启；确认它不重打本地
      队列里那一份。判据与留证同上一条（纸匣计数）。

- [ ] **签名 URL 过期后不得复用缓存**：把任务放置到签名过期后再让 Agent 下载，确认它
      重新 claim 取新签名。
      *判据*：从 Agent 日志或抓包取到它实际请求的 URL，该 URL 的 `sig` 与该任务**最新一次**
      claim 下发的一致，且与过期那次**不同**；不得出现直接读本地缓存文件出纸。

- [ ] **支付回调未达 / 延迟时 Agent 不得领未付任务**：让渠道回调延迟或丢失（可断开回调
      入口），确认订单停在未付、Agent claim 不到该任务、Kiosk 不放行。
      *为什么在真机清单里*：回调成功的正向链路属服务端与渠道联调，手机加接口即可证，
      不占真机时间；**这里只测回调没到时 Agent 会不会误领**。
      *留证*：订单 payStatus、claim 返回体、Agent 日志。

> 评审删掉的三条，记下来免得下次又被提出来：
> ① 「已 claim 后退款、验纸不出」—— 退款接口对 `ACTIVE_PRINT_TASK_STATES`
>   （`claimed` / `printing`）直接返回 `ORDER_TASK_IN_PROGRESS`，**这个场景按产品路径
>   根本搭不出来**；且作业一旦进 Windows Spooler 物理不可逆，出了纸也分不清是拦截失败
>   还是合理竞态。退款拦截在接口层已证（`ORDER_REFUNDED`）。
> ② 「真实支付回调驱动放行」的正向链路 —— 属服务端/渠道联调，不是真机独有场景。
>   （失败侧保留为上面一条。）
> ③ 「打印参数真作用到出纸」—— 与本节既有的份数 / 黑白 / 彩色 / 双面四项重复。

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
