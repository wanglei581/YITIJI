# 生产部署与 Windows 本地主机换机验收清单

> 最后更新：2026-06-24（新增「附录二」对齐 2026-06-22 预生产 Gate 2–4 实际状态，纠正附录 §G 过期判断；正文 §二–§八 正式生产门禁口径不变）；2026-06-14（当前窗口切换为上线验收与小范围试运营准备；新增 §六 试运营验收）
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

- [ ] main 分支为待部署版本。
- [ ] Git 工作区无未确认业务改动。
- [ ] `.env`、`.env.local`、`.claude/settings.local.json`、日志、dist/build、临时简历文件未提交。
- [ ] 最近一次 CI 主 job 通过。
- [ ] `postgres-readiness` job 通过。
- [ ] 如本次包含数据库 schema/type 变更，确认 PostgreSQL schema 已同步并通过漂移校验。

### 2.2 密钥轮换与最小权限

上线前必须轮换或重新签发生产密钥，不使用聊天/本地开发中暴露过的密钥：

- [ ] 百度 OCR 应用密钥已在百度控制台重建/轮换。
- [ ] 腾讯云 COS CAM 子用户密钥已轮换，权限最小化到私有桶所需动作。
- [ ] 腾讯云 COS 生命周期已人工验收：禁止配置 Bucket 全局过期规则；任何规则不得覆盖 `users/`、会员简历、AI 成果物或 `long_term` 长期保存对象。
- [ ] 如启用 COS 生命周期兜底规则，仅允许作用于 `tmp/` 临时前缀；规则名称、作用前缀、过期天数和启用状态已截图存档。
- [ ] 腾讯 ASR/TTS/SMS/TRTC 相关 CAM 权限已按生产最小权限配置。
- [ ] LLM/DeepSeek 或其他模型 API Key 已使用生产专用 Key。
- [ ] 短信签名/模板审核通过后再启用真实短信。
- [ ] 所有密钥只写入服务器环境变量/配置中心，不写入前端、不写入仓库、不写入日志。

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
- [ ] 域名解析、HTTPS 证书、证书自动续期正常。

### 3.2 环境变量核对

以 `.env.example` 为清单逐项核对生产 `.env`：

- [ ] `NODE_ENV=production`。
- [ ] `JWT_SECRET` 使用生产强随机值，长度不少于 16 字符；不得使用本地开发/CI 测试值。
- [ ] `DATABASE_URL` 指向 PostgreSQL，不再指向 SQLite 文件。
- [ ] `FILE_STORAGE_DRIVER=cos`；生产不得回退本地磁盘存储。
- [ ] API 生产启动门禁已验证：`NODE_ENV=production` 下，JWT_SECRET 缺失/过短、`FILE_STORAGE_DRIVER` 非 `cos`、`DATABASE_URL=file:` SQLite 均会启动失败。
- [ ] `REDIS_URL` 正确。
- [ ] API 监听端口、前端 API base URL、CORS allowlist 正确。
- [ ] COS bucket、region、secretId、secretKey、签名 TTL 正确。
- [ ] COS 生命周期人工验收已完成并截图存档：禁止配置 Bucket 全局过期规则，`tmp/` 以外前缀不得覆盖长期保存对象，`long_term` 文件的 `expiresAt = null` 只能由业务删除或用户主动删除处理。
- [ ] OCR provider 与百度密钥正确。
- [ ] AI provider / LLM 功能级配置可读取。
- [ ] ASR/TTS provider 与腾讯密钥正确。
- [ ] SMS provider 在短信审核前不得误设为真实生产发送。
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
- [ ] 构建产物路径与 nginx/静态服务配置一致。
- [ ] 前端资源 base path 正确。
- [ ] 大文件上传入口不会被前端路由或 nginx 误拦截。

### 3.4 PostgreSQL 空库部署验收

按 [postgres-operations.md](./postgres-operations.md) 执行并留存日志：

- [ ] 全新空库 `migrate deploy` 通过。
- [ ] seed 通过。
- [ ] API 启动日志显示连接 PostgreSQL，不是 SQLite。
- [ ] PG schema 漂移校验通过。
- [ ] 核心表外键与唯一约束生效。
- [ ] 数据库备份脚本可执行。
- [ ] `pg_dump` 备份文件可恢复到临时库。

### 3.5 SQLite → PostgreSQL 迁移演练（如存在旧数据）

- [ ] 迁移前备份 SQLite 原库。
- [ ] 目标 PG 库为空库保护生效。
- [ ] `db:pg:migrate-data` 或当前正式迁移脚本执行通过。
- [ ] 行数对账通过。
- [ ] 孤儿数据/历史脏数据有告警，不静默丢弃。
- [ ] 抽样核查：用户、文件、AI结果、打印任务、收藏、招聘会/岗位数据均可查。

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

### 5.1 Windows 环境

- [ ] Windows 10/11 x64，版本记录清楚。
- [ ] 系统时区为 `Asia/Shanghai`。
- [ ] 自动登录/开机启动策略符合现场 kiosk 使用方式。
- [ ] Edge/Chrome 已安装并可进入全屏 Kiosk 模式。
- [ ] Windows 更新策略不会在营业时段强制重启。
- [ ] 本机防火墙允许 Agent 访问后端 API；Agent 本地端口只监听 `127.0.0.1`。

### 5.2 打印机驱动与配置

- [ ] 奔图 CM2800/CM2820 系列驱动已安装。
- [ ] Windows 打印机列表中真实驱动名已记录。
- [ ] Agent 配置使用 `printerName`，不得硬编码具体型号字符串。
- [ ] `printerName` 与 Windows 实际识别名一致。
- [ ] 打印机通过 USB 或有线网络连接稳定。
- [ ] 默认纸张为 A4，不假设 A3。
- [ ] 彩色、黑白、份数、双面参数在本机驱动下实测。

### 5.3 Terminal Agent 安装

- [ ] Agent 版本与服务器 API 版本匹配。
- [ ] Agent 配置包含 API base URL、terminalId/注册凭据、printerName、扫描目录、日志路径。
- [ ] Token/凭据使用 Windows DPAPI 或设计文档要求的方式加密保存。
- [ ] Agent Windows Service 安装成功。
- [ ] Service 可开机自启。
- [ ] 单实例保护有效，重复启动不会产生双 Agent。
- [ ] Agent 日志路径固定，日志不含用户文件正文/密钥。

### 5.4 终端注册与心跳

- [ ] Agent 可访问生产/预生产 API。
- [ ] 终端注册成功。
- [ ] 心跳持续上报。
- [ ] Admin 终端管理页显示在线。
- [ ] 打印机状态/WMI 状态可上报。
- [ ] 断网后状态变离线；恢复网络后自动重新在线。

### 5.5 本地 Kiosk 与 Agent 通信

- [ ] Kiosk 页面可从生产域名打开。
- [ ] Kiosk 全屏模式无浏览器系统弹窗阻断主流程。
- [ ] `http://127.0.0.1:9527` 或当前 Agent local API 仅本机可访问。
- [ ] localAuthToken/actionToken 校验有效。
- [ ] Token 过期、nonce 重放、action 不匹配时拒绝。
- [ ] 页面展示设备状态与 Agent 上报一致。

### 5.6 真机打印验收

至少执行以下测试并留存结果：

- [ ] 打印测试 PDF。
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
- PG seed（seed.ts + seed-fairs.ts）通过 ✅。
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

### 仍待完成（正式生产 P0 阻塞，正文 §八 复选框不勾）

- Gate 4 **浏览器截图**补齐（API 级已过，完整截图待补）。
- **百度 OCR Key 预生产 live**、**AI / TRTC / ASR / TTS 按启用范围 live**（本地已验，预生产 live 待补）。
- **正式域名 + 正式 HTTPS**（当前仅 30 天临时自签）。
- **腾讯短信审核**通过后**真实手机号 E2E**（预生产仍 `SMS_PROVIDER=tencent`，真实发送待审核）。
- **Windows 真机 / Terminal Agent / 奔图打印·扫描 / 断网恢复 / 真实出纸**（§五，需真机）。
- **法务**用户协议 / 隐私政策审定（§2.3，当前为试运营文本）。
- **小范围试运营**（§六）未开始。
