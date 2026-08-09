# 商用就绪全栈审计与治理报告（2026-08-09）

> 审查根目录：`/Users/wanglei/AI求职打印服务终端-commercial-readiness-wave1`
> 初始审查基线：`codex/commercial-readiness-wave1-20260809@83588b8f`
> Wave 5 修复提交：`392c5de5`；最终本地候选：`codex/commercial-readiness-wave1-20260809@1cc66965`，已包含 `origin/main@9f82157b`，尚未推送；相对 main behind 0 / ahead 10，相对 upstream ahead 11 / behind 0
> Git 快照时间：2026-08-09；PR #570 checks 仍绑定旧远端 head `254c1394`，须以同一新 HEAD 重跑
> 审查方式：源码、路由、Prisma、workspace、CI、Git/worktree、独立小程序仓库只读核验；未连接或修改生产数据库、服务器、Windows 主机、对象存储或硬件
> 删除结果：**本轮没有删除代码、模型、迁移、目录或本地资产**

## 1. 执行摘要

### 1.1 最终结论

| 判定层级                         | 结论                   | 原因                                                                                                                                 |
| -------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 现有 monorepo 结构               | **可继续使用**         | `apps/`、`services/`、`packages/` 职责总体清晰；当前不需要物理迁移                                                                   |
| Kiosk / Admin / Partner 主体代码 | **代码候选有条件通过** | 既有三端验收覆盖较广，Wave 1–5 又关闭一批真实性、持久化与隐私缺陷；但本分支仍未合并、未部署                                          |
| API 主体能力                     | **有条件通过**         | 核心业务已有真实 Prisma/状态机；材料任务 query token 已在代码候选中 fail-closed，仍存在 8 个注册中的旧占位接口和若干无运行时访问模型 |
| Terminal Agent / 打印扫描        | **NO-GO**              | Windows 扫描 watcher 当前主动 fail-closed；打印参数、长驻恢复、真实奔图出纸/扫描仍缺现场证据                                         |
| 微信小程序                       | **NO-GO**              | monorepo 仅完成 M0.1–M0.3；外部跳转、隐私本人数据和 M0.4/M1 未闭环；独立仓库另有未推送高价值提交                                     |
| 生产内容与外部服务               | **NO-GO**              | 生产公开岗位/招聘会/政策当前真实空态；真实来源、支付、短信、TRTC、密钥、法务和生产对象存储仍有外部门禁                               |
| 整体商用发布                     | **NO-GO**              | 任一 P0 未关闭都不能宣称商用上线                                                                                                     |

本轮最重要的判断不是“项目没做完”，而是项目已经形成了相当多真实闭环，但仍混有四类不同状态，必须分开治理：

1. **已经修复但未进入生产**：Wave 1–5 的仓库完整性、入口/打印状态真实性、AI 落库 fail-closed、文件 metadata-first 删除、Agent durable dead-letter、本人待续任务、spooler 不确定结果 fail-closed、打印参数白名单、扫描删除本地审计、材料 token header-only、会话 history 清理、写库 verifier 隔离和高风险 CI 防回退等。
2. **明确没有开始或只到诚实空态**：小程序 M0.4/M1、Partner 迎新内容/统计、Admin 补贴标签与退款异常处置、Agent dead-letter 人工重放。
3. **接口已暴露但实现是假成功/空数组**：`/api/v1/kiosk/session|help|notifications|activities|screensaver-content` 共 8 个 handler。
4. **看似废弃但尚不能删**：旧 Kiosk API 模块、五组无运行时访问 Prisma 模型、空壳 worker、旧分支/worktree、独立小程序仓库。

### 1.2 本轮确认的最高风险断层

| 优先级           | 断层                                                                    | 当前事实                                                                                                         | 商用影响                                                       |
| ---------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| P0               | Windows 扫描被安全门禁主动关闭                                          | `apps/terminal-agent/src/agent/scan-input/verified-folder.ts:25-27` 在 Windows 返回 `reparse_point_unverifiable` | 真实扫描不能上线，但这是正确的 fail-closed，不应绕过           |
| P0               | 代码候选与远端/生产版本未对齐                                           | `1cc66965` 已含修复提交 `392c5de5` 和 `origin/main@9f82157b`，但尚未推送；Wave 1–5 明确“未部署”                  | 本地提交不能当作 PR、main 或线上事实                           |
| P0               | 生产公开内容为空                                                        | `docs/progress/current-progress.md` 记录 jobs/fairs/policies 公网为空态，真实来源待接入                          | 求职信息入口无法形成实际业务价值                               |
| P0               | Windows/奔图/支付/对象存储缺真实验收                                    | `docs/progress/next-tasks.md:5-9,41-43`                                                                          | 自动化不能证明真实出纸、扫描、扣款和删除                       |
| P0（扫描恢复前） | `_unclaimed` 删除账本已有代码候选，但还没有上报/归档和 Windows 现场证据 | 本地 SQLite 账本使用 per-install HMAC、删除失败可重试；`pendingReport` 尚无 API/ack                              | 本地追责能力增强，但不能替代集中对账、DB 故障处置和真机验证    |
| P1               | 8 个旧 Kiosk handler 返回空数据或 `{ok:true}`                           | 五个 controller 直接返回常量，service 全为空                                                                     | 对任何仍调用旧契约的客户端形成“成功但没发生”的假象             |
| P1               | 材料 query token 已拒绝，但边缘层历史日志仍需治理                       | GET/decision 遇 `accessToken` query 返回 400 `MATERIAL_TOKEN_QUERY_FORBIDDEN`，Kiosk 只发 header                 | CDN/Nginx/APM 可能在应用拒绝前已记录旧 URL；须脱敏、检索和轮换 |
| P0               | 新代码候选尚无同 SHA 远程 CI                                            | PR #570 旧 `254c1394` 的 build/PG 两红、browser/MSI 两绿；本地 `1cc66965` 尚未推送                               | 必须以同一新 HEAD 重跑四项，未全绿不得合入                     |
| P1（已修）       | Router history 曾保留 payment session token                             | RED 证明 Back 可恢复 token；Wave 5 统一 `KioskPrivacyGuard.clearSessionTo` 后 Back/Forward 均不能恢复            | 唯一 reportable Security Low 已关闭，仍待新 HEAD CI 复验       |
| P1               | 独立小程序存在 local-only 提交                                          | `/Users/wanglei/zhiyida-miniapp@ee0ca9b` 比 upstream ahead 1，47 文件、+2022/-423                                | 删除仓库或分支会直接丢失 kiosk 登录与动态打印价格候选          |

## 2. 审查范围与证据口径

### 2.1 已覆盖

- Kiosk、Admin、Partner、Miniapp 的入口、页面、数据适配和已知诚实空态。
- API 的模块注册、controller → service → Prisma/存储关键断层。
- Terminal Agent 的打印、扫描、重试、恢复和本地敏感文件留存边界。
- SQLite/PostgreSQL 双 schema、迁移、seed、fixture、本地数据库与生成物管理。
- 根 workspace、CI、部署工作流、verify 接线和 GitHub 开放 PR。
- 本地分支、远程分支、remote-tracking refs、worktree、脏资产和独立小程序仓库。
- 可删除、待下线、受保护、可重建四类资产。

### 2.2 没有冒充完成

- 未 SSH 生产服务器，报告中的 production commit 只采用仓库最后一次正式记录，不是本轮实时服务器 readback。
- 未读取生产表行数，故不能判定旧 Prisma model 可删除。
- 未运行真实微信开发者工具、Windows 服务、奔图驱动、SMB、支付、短信、TRTC、百度 OCR 或真实 COS DELETE。
- 未执行 `git fetch --prune`、`remote prune`、`gc`、checkout、分支删除、worktree remove 或任何生产写操作。

### 2.3 删除六项证据门禁

任何代码/页面/模型/目录只有同时证明以下六项才可删除：无路由引用、无 import 引用、无测试/verify 依赖、无当前文档声明、无 build/deploy/workspace 依赖、无生产或硬件链路使用。本报告凡未满足其中任一项，一律归入“待下线/需 census/不可删”，不使用“应该没用”的推断替代证据。

## 3. 前后端功能与接口总表

| 端/功能域                    | 当前实现                                                                                              | 后端/外部依赖                           | 状态                  | 主要断层或边界                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| Kiosk 首页/导航              | 定版入口、API 健康与设备状态 fail-closed                                                              | health、terminal config/capabilities    | 已做，未部署最新 Wave | Wave 1 最新 feature config 与打印状态真实性仍在 PR #570                                       |
| 会员登录/隐私清场            | 手机/扫码登录、路由级 idle/硬超时、本人资产隔离；Wave 5 统一清理 Router history                       | Redis、短信/微信登录、member auth       | 代码候选              | payment token 的 Back/Forward 恢复已修；真实短信、微信、27 寸 Kiosk 与 BFCache 现场仍待验     |
| 会话恢复                     | `/me/pending-tasks` 只返回本人真实可续任务，退出/切换/重绑导航到固定目的地                            | PrintTask/Order/member auth             | Wave 2/5 已修，未部署 | 仅恢复明确白名单路由；生产版本尚无该修复                                                      |
| AI 简历解析/诊断/优化/生成   | 真实 API、匿名 token、本人归属、导出/打印候选                                                         | AI provider、OCR、FileObject            | 主体已做              | Wave 2 才让 parse/optimize/generate 落库失败返回 503；真实模型/配额/密钥仍待生产验收          |
| 模拟面试/TRTC/AI 顾问        | 文字、报告、语音/数字人代码路径存在                                                                   | TRTC、LLM、网络                         | 代码候选              | 真实 TRTC/设备/弱网未验，不能按本地 mock 记商用                                               |
| 打印上传/预览/报价/支付/进度 | FileObject、报价、Order/PaymentAttempt/PrintTask、Agent claim/status；Wave 3 仅放行黑白/单面/1 页合一 | 支付渠道、对象存储、Windows Agent、奔图 | 代码候选              | 未验证参数已 fail-closed；真机出纸、驱动状态、断电恢复、真实支付/退款仍未验                   |
| 扫描                         | ScanTask + Agent watcher + Kiosk 轮询                                                                 | SMB/Windows/扫描仪/FileObject           | **生产不可用**        | Windows reparse point 无可信检查，watcher 当前主动禁用                                        |
| 文件删除/到期/隔离           | Wave 2 metadata-first tombstone/quarantine                                                            | Prisma + storage                        | 已修，未部署          | 真实 COS “远端成功但客户端超时”等不确定结果仍待故障注入                                       |
| 岗位/企业/招聘会/政策        | 三端已有真实查询、审核、来源与合规外跳                                                                | 有授权内容源                            | 代码已做              | 生产公开数据已治理为空；真实来源与有效期审核待数据负责人提供                                  |
| Kiosk 帮助                   | 本地静态 FAQ，明确为静态页                                                                            | 无                                      | 已做                  | 旧 `/kiosk/help` 空接口并非该页面数据源                                                       |
| Kiosk 通知                   | `/me/notifications` 真实会员通知；顶层路由复用该能力                                                  | MemberNotification/SystemBroadcast      | 已做                  | 旧 `/kiosk/notifications` 仍返回空/假成功                                                     |
| Kiosk 权益活动               | `/activities` + `/activities/:id` 真实 BenefitActivity                                                | BenefitActivity                         | 已做                  | 旧 `/kiosk/activities` 仍返回空/id 回显                                                       |
| Kiosk 屏保                   | `/terminals/:terminalId/screensaver` 真实配置/播放列表                                                | AdAsset/TerminalScreensaverConfig       | 已做                  | 旧 `/kiosk/screensaver-content` 仍返回空数组                                                  |
| Admin 运营后台               | 设备、订单、内容、计费、文件、机构、会员、审计等主体已接真                                            | 多域 API                                | 主体已做              | dead-letter 无处理 UI；补贴标签、退款异常处置明确未建（`admin/print-scan/index.tsx:761-763`） |
| Partner 数据源/内容          | API/Webhook/Excel/CSV、审核、统计主体已接真                                                           | JobSource/导入审核                      | 主体已做              | 原生 Finder→浏览器 `DataTransfer` 未现场验；智慧校园迎新内容/使用统计无模型/管线              |
| Miniapp M0.1–M0.3            | 四 Tab、登录、公开岗位/招聘会/政策/企业浏览                                                           | member/public API                       | 已合入主体            | `verify:static` 未接 CI；真实 AppID/开发者工具未验                                            |
| Miniapp 外部 CTA             | 页面显示合规提示                                                                                      | 外部小程序/webview/URL 白名单           | **未完成**            | job/fair/policy 详情仍只有 toast + TODO（见第 5.4 节）                                        |
| Miniapp 隐私/本人数据 M0.4   | 页面已注册                                                                                            | `/me/*`、数据请求状态机                 | **未完成**            | 本地 toggle、导出/注销 toast；尚未接后端                                                      |
| Miniapp M1/M2                | 独立仓库已有更多候选页与 kiosk 登录/打印价格提交；monorepo 有 M2 方案                                 | 跨端订单/到机码/支付                    | 候选/方案             | 不得从独立旧仓直接发布；必须选择性迁入唯一 `apps/miniapp`                                     |
| Worker                       | 只有 `package.json`，无 consumer/runtime                                                              | 规划中的 BullMQ                         | 占位                  | 当前任务在 API 内 BullMQ；短期不应为了目录完整强拆第二进程                                    |

## 4. 已修复但尚未形成生产事实

### 4.1 Wave 1

- 全仓 tracked 文件冲突标记检查与 workflow YAML 语法检查已进入主 CI 前置步骤（`.github/workflows/ci.yml:78-80`）。
- Kiosk 百宝箱/智慧校园入口改为读取真实 feature config；打印进度不再提前宣称“已领取/正在出纸”。
- 扫描输入增加路径、链接、稳定快照和 fd 身份复核；Windows 无法可靠验证 reparse point 时禁用 watcher。
- 生产要求精确 `PRINT_REQUIRE_PII_SCAN=true` 才允许启动。

### 4.2 Wave 2

- Agent 失败补报进入 durable dead-letter；打印前 `dispatching` 必须先落本地账本，重启后不自动重印不确定任务。
- `/me/pending-tasks` 改为真实本人 PrintTask 查询，不再返回固定空数组。
- AI parse/optimize/generate 均等待 `persistResult()`，落库失败返回 `503 AI_RESULT_PERSISTENCE_FAILED`。
- 文件用户删除、违规直传、过期清理统一先把 metadata 置为不可访问，再做对象删除；DB 失败不先删对象。

### 4.3 Wave 3A/3B

- Agent 打印监控不再把 monitor 不可用、从未匹配任务、WMI 持续 `unknown`、`printing/retained` 超时报告为 completed；统一以 `PRINT_JOB_UNCONFIRMED` fail-closed，本地先持久化 failed，重领只补报、不自动重印。显式 Complete/Completed/Printed 或“已经观察 active 后从 spooler 消失”才结束队列监控；后者只证明 spooler 生命周期结束，不证明纸张物理到手。
- WMI 状态解析让 Error/Jammed/UserIntervention/Deleting/Deleted/Cancelled/Canceled 及连续缺纸优先于 Retained/Complete，并以动态故障注入覆盖打印命令超时、未匹配、unknown、printing/retained、缺纸和取消。
- API/Kiosk 打印参数改为全环境 fail-closed：DTO 与 service 双门禁、公开报价与建单在计价/落库前只允许 `black_white + simplex + pagesPerSheet=1`；彩色、两种双面、2/4 页合一统一拒绝，内部绕过返回 `PRINT_PARAMETER_NOT_VERIFIED`。Kiosk Preview/Params 禁用未验证选项，Confirm 在报价前明确提示；旧会话不会被静默改价。
- PR #570 首轮 W6 远程红灯已在本地按真实鉴权契约修复：`/session-resume` 测试不再匿名直达或只等旧标题，而是通过可见手机号登录和合成登录响应建立只存在内存的 AuthContext，会话没有 localStorage/sessionStorage/cookie 持久化；随后断言 `GET /me/pending-tasks` 携带 Bearer 并展示真实结构待续卡片。补齐登录 shell 的 `/me/favorites` 安全空响应后，单项 1/1、`verify:fusion-w6` 104/104 与完整 W6 浏览器 104/104 通过。
- 这些修复的专项、API/Kiosk/shared/Agent typecheck、相关 lint/build、价格/支付/W2 与任务可靠性回归已在本地通过并已形成分支提交，但仍未合并 main/部署。Pantum 真实 `JobStatus` 字符串、极快任务、spooler 重启、超时后迟到任务、彩色/duplex/N-up 驱动参数和参数级 terminal capability 均必须由 Windows 真机关闭。

### 4.4 Wave 4A/4B/4C

- `_unclaimed` TTL 删除已新增本地 SQLite `scan_deletion_audit` 账本：每个安装生成独立 256-bit HMAC 密钥，账本只保存 keyed digest、原因码、时间、结果、次数、安全错误码和 `pendingReport`，不保存路径、文件名、内容、异常消息或密钥。删除失败保持文件并记 `delete_failed`，重启后复用同一事件重试；审计 DB 不可用或写入失败时，为隐私仍继续 TTL 删除并输出不含 PII 的安全事件标识。
- 材料任务正式客户端 census 只发现 Kiosk，且已使用 `x-material-task-token`。API 已删除 GET task / PII decision 的 query 声明和 fallback；任何 `accessToken` query 现在 400 `MATERIAL_TOKEN_QUERY_FORBIDDEN`，响应不回显 token。会员 Bearer 和 header token 行为不变。
- 主 CI 已接入本轮高风险本地回归：repository integrity；Agent scan input、扫描删除审计、task reliability、print monitor truth；API member pending tasks、AI persistence、file delete、print parameter、material token transport；Kiosk member session、print parameter。新增脚本只使用临时目录/SQLite、loopback 或注入 seam，可在 Linux Node 22 运行，不依赖生产、Windows、外部网络、密钥或真实硬件。
- 本地 RED→GREEN 与回归结果：扫描删除旧实现无 durable API/状态后新专项全过；materials query 旧实现未拒绝后新专项全过；新增 CI 目标命令逐条全过；主干合并后 repository integrity 报告 3,091 个 tracked 文件无冲突标记、5 份 workflow YAML 有效，显式 `ci.yml` YAML 检查、Prettier 和 `git diff --check` 通过。行为复验所在机器实际 pnpm runtime 为 Node 24，仓库要求的 Node 22 仍以远程 CI 为准。
- 有意不纳入 Linux 主 CI：live COS/OCR/LLM/支付、Windows service/installer/WMI/SMB/reparse point、真实 spooler/奔图出纸和微信开发者工具；这些依赖密钥、网络、操作系统或硬件，必须保留为部署/现场门禁，不能用 mock 绿灯替代。

### 4.5 Wave 5

- Kiosk `/session-resume` 曾把 `paymentSessionToken` 放进 Router history；Profile/MySettings 的手动退出、切换账号和重新绑定现统一调用 `KioskPrivacyGuard.clearSessionTo` 并导航到固定目的地。RED 复现 Back 可恢复 token，GREEN 证明 Back/Forward 均不能恢复。Node 22 机械重放同逻辑的 focused browser 1/1、full privacy 19/19 通过；当前工作树 focused 1/1、typecheck、build、static 通过。
- 会写行的四条 verifier 在 Prisma 初始化前统一要求显式 `VERIFICATION_DATABASE_TARGET=isolated`；production、远程 PostgreSQL、非测试数据库或无 marker 一律 fail-closed。payment-flow、verify-order、device-status 的旧打印断言同步为已验证的 `black_white + simplex + 1-up` 与 80 分。Agent 四套隔离 SQLite 全绿；父任务 Node 22 在本机建全新临时库时遇到 Prisma schema engine generic error，未进入断言，故远程 CI 复验仍是硬门禁。
- Codex Security diff discovery 已覆盖 52/52 changed files、提出 6 个候选；唯一 reportable Low 是上述 history token 残留，已经 RED→GREEN 修复。外置封存器因 `target.snapshotDigest` 缺失拒绝完成，不能把 discovery/validation 证据描述成 sealed final report。

### 4.6 仍需注意

PR #570 远端 head 仍为 `254c1394`，其旧四项 checks 已结束为 `build-and-verify` **FAILURE**、`postgres-readiness` **FAILURE**、`kiosk-browser-smoke` **SUCCESS**、`unsigned-msi-candidate` **SUCCESS**。两项红灯分别是设备状态静态合同与 `/me/print-orders` 旧彩色 200 分 fixture 漂移；修复提交 `392c5de5` 已改为真实设备合同和黑白 80 分。第二次合并主干后的最终本地候选为 `1cc66965`，已包含 `origin/main@9f82157b`，相对 main behind 0 / ahead 10、相对 upstream ahead 11 / behind 0，但尚未推送。合并后 Node 22 的 QR UI、deploy authorization、ours static/typecheck、Kiosk production build 与 production config 全绿；缺少必需 env 时 production verifier 的一次失败是预期 fail-closed，不是产品失败。合并已保留 main #572 后台招聘 P0 的正式 progress；其 PostgreSQL 16 结论仍由新 HEAD 的 `postgres-readiness` 权威验证。仍须让四项 checks 全部绑定同一新 HEAD 并全绿；任何本地专项结果都不能替代远程复验。

## 5. 已确认的接口断层与缺陷

### 5.1 注册中的旧 Kiosk 假成功接口（P1；发现真实流量时升 P0）

| 路由                                         | 直接返回      | 证据                                                             | 真实替代能力                                              |
| -------------------------------------------- | ------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `POST /api/v1/kiosk/session/heartbeat`       | `{ok:true}`   | `services/api/src/kiosk-session/kiosk-session.controller.ts:3-8` | Kiosk 当前由前端隐私根与会员会话处理，不调用此路由        |
| `POST /api/v1/kiosk/session/extend`          | `{ok:true}`   | 同文件 `:10-13`                                                  | 同上                                                      |
| `GET /api/v1/kiosk/help`                     | `{data:[]}`   | `help/help.controller.ts:3-8`                                    | `HelpCenterPage.tsx:2` 明确是静态信息页                   |
| `GET /api/v1/kiosk/notifications`            | 空列表/0 未读 | `notifications.controller.ts:3-8`                                | `/api/v1/me/notifications` + `MemberNotificationsService` |
| `PATCH /api/v1/kiosk/notifications/:id/read` | `{ok:true}`   | 同文件 `:10-13`                                                  | `/api/v1/me/notifications/:kind/:id/read`                 |
| `GET /api/v1/kiosk/activities`               | `{data:[]}`   | `activities.controller.ts:3-8`                                   | `/api/v1/activities` + BenefitActivity                    |
| `GET /api/v1/kiosk/activities/:id`           | 只回显 `{id}` | 同文件 `:10-13`                                                  | `/api/v1/activities/:id`                                  |
| `GET /api/v1/kiosk/screensaver-content`      | `{data:[]}`   | `screensaver.controller.ts:3-8`                                  | `/api/v1/terminals/:terminalId/screensaver`               |

五个 service 均为空类，controller 也未注入它们；但五个 module 仍被 `services/api/src/app.module.ts:50-55,131-136` 注册。因此它们不是“无路由死文件”，而是**生产可达的旧契约面**。当前 Kiosk 源码没有这些 URL 的调用命中，但删除前仍必须取得：

1. 生产 Nginx/API 访问日志按精确路径的 30 天零调用证明；
2. 现场旧 Kiosk bundle、Miniapp、Admin/Partner、Terminal Agent 和外部集成客户端清单；
3. API 文档/监控/告警/契约测试无依赖证明；
4. 决定是先返回带弃用期的 `410`/明确错误，还是直接移除注册；
5. 下线后运行时冒烟与回滚点。

### 5.2 旧 Prisma 模型无运行时访问，但禁止直接删除（P1 数据治理）

SQLite 与 PostgreSQL 双 schema 均存在：`HelpItem`、`KioskSession`、`UserNotification`、`KioskActivity`、`ScreensaverContent`。全仓 `services/api/src`/scripts/apps/packages 搜索没有对应 Prisma delegate 访问命中。与此同时，真实新链路分别使用 `MemberNotification`/`SystemBroadcast`、`BenefitActivity`、`AdAsset`/`TerminalScreensaverConfig`。

这只证明“当前源码没有访问”，不证明生产表为空、没有手工报表、没有外部 ETL、没有历史数据保留义务。删除模型或历史 migration 前至少要有：双库表名/行数/最近写入时间、外键、索引、备份可恢复性、生产 SQL/BI/运维脚本使用清单，以及数据负责人签字。历史 migration 不重写；若确认退役，只能新增 forward-only migration。

### 5.3 材料任务 query token 已在代码候选中移除（P1 部署与日志残余）

- 全仓客户端 census 只发现 Kiosk 正式调用 `/materials/tasks`；Kiosk 已明确只通过 `x-material-task-token` 发送，且不拼 URL。Miniapp、Admin、Partner、Terminal Agent 均无正式调用。
- API 的 GET task 与 PII 决策已删除 `@Query('accessToken')` 与 query fallback；URL 中出现 `accessToken` 会立即返回 400 `MATERIAL_TOKEN_QUERY_FORBIDDEN`，错误体不回显 token。字符串/数组 header 和会员 Bearer 仍按原契约工作。
- 专项 `verify:material-task-token-transport` 已覆盖 controller 正反例、官方客户端静态 URL 守卫和日志源扫描，并已进入 CI。

当前残余不再是应用继续兼容 query，而是部署与边缘日志治理：未登记旧客户端会发生显式兼容中断；CDN、负载均衡、Nginx、WAF、APM 可能在请求到达应用前已记录旧 URL。上线前须对认证相关 query 全量脱敏，检索历史 `/materials/tasks?...accessToken=`，清理日志并把出现过的真实 token 按泄漏处理；监控拒绝次数/客户端版本时禁止记录 token 值。

### 5.4 Miniapp 已注册页面存在真实断层（小程序发布前 P0）

- `pages/job-detail/job-detail.js:110-116`：记录“打开来源平台”后只显示 toast，未实际打开 `externalUrl`。
- `pages/fair-detail/fair-detail.js:102-107`：同样只有 toast，预约外跳未接线。
- `pages/policy-detail/policy-detail.js:61-71`：打印与官方原文跳转均为 TODO。
- `pages/privacy/privacy.js:7-50`：隐私开关只改本地状态，清理周期、数据导出、账号注销只显示“即将上线”。
- 这些页面均已在 `apps/miniapp/app.json:2-16` 注册，不能当作不可达草稿。

外部跳转属于合规主链：必须展示来源、白名单校验、只去来源平台、记录跳转但不记录投递/预约结果。隐私设置不能用本地 toggle 冒充服务端保存；在 M0.4 完成前应保持明确不可用或只读说明。

### 5.5 `_unclaimed` 高敏扫描件已有本地删除账本，集中对账与现场仍缺（扫描恢复前 P0）

- 未匹配、任务状态变化、重复投递或重试超时的扫描件会移动到 `_unclaimed`（`scan-watcher.ts:277-336`）。这一隔离策略能防跨用户误挂载，应保留。
- Wave 4A 已在 Agent SQLite 增加 `agent_metadata` 与 `scan_deletion_audit`；每安装随机 HMAC 密钥派生不可跨安装字典重算的 identifier/event，记录 intent、`deleted|delete_failed`、次数、时间、安全错误码和 `pendingReport`，不记明文路径/文件名/内容/异常消息。
- EACCES 等删除失败会保留文件和 durable 失败状态，下一轮或重启后重试并复用事件；DB/审计写失败时不会为了审计继续留存高敏文件，仍执行 TTL 删除并输出 `untracked`/安全错误码。
- 专项覆盖旧库增量升级、不同安装隔离、重启、失败重试、PII 不落库、审计不可用不阻塞删除，并已进入 CI。

残余缺口是 `pendingReport=1` 尚无 API/heartbeat ack、重试、保留/归档协议；断电发生在“文件已删、结果未更新”之间会留下 `pending_delete`，只能标为待核查，不能虚构成功；SQLite 整体不可用时仍会删除但无法留下 durable 证据。恢复 Windows 扫描前仍须真机验证 SMB/NTFS 文件锁、ACL/杀毒占用、Agent 重启、外部删除/改写和 reparse point，并把本地 DB 健康、备份与集中对账纳入运维门禁。

## 6. 废弃、重复、孤儿与删除判定

### 6.1 分类结果

| 对象                                                   | 分类                       | 本轮动作       | 证据与后续条件                                                                                                                           |
| ------------------------------------------------------ | -------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `services/worker/package.json`                         | 预留占位，非运行时         | 保留           | 被 workspace 包含；`AGENTS.md:58`、`docs/project-structure.md:15` 及正式方案仍声明；不满足“无文档/build 规划引用”                        |
| 五个空 service 类                                      | 待下线候选                 | 保留           | service 自身无逻辑，但所属 module/controller 已注册；应与旧路由作为一个退役任务处理，不做碎片式删除                                      |
| 五组旧 Prisma model                                    | 疑似历史孤儿               | 保留           | 无 delegate 命中，但无生产数据 census；禁止删 schema/历史 migration                                                                      |
| 旧 Kiosk 8 个 handler                                  | 已被新链路替代的公开契约面 | 保留并计划下线 | 当前前端无调用；仍需生产访问日志/客户端 census                                                                                           |
| `node_modules`、`dist`、generated Prisma、test-results | 可重建缓存/产物            | 本轮不删       | 当前审查 worktree 约 `node_modules 990M`、Kiosk dist `6.7M`、Agent dist `768K`、generated `6.9M`；仅在工作树无运行中任务且有锁文件时清理 |
| 42 张 Miniapp 原型截图                                 | 设计证据                   | 不可删         | Git 跟踪且有活跃设计 worktree 改动；属于用户设计资产，不是缓存                                                                           |
| 两份相同 hero PNG                                      | 有意重复交付               | 不删           | SHA-256 相同，但 runtime public asset 与自包含原型各有引用；删除任一会破坏消费者                                                         |
| 本地/生产数据库、dump、真实文件                        | 受保护数据                 | 不可删         | 当前分支无 tracked `.db/.sqlite/.dump`；`.gitignore` 已覆盖 dev DB/storage/runtime data；生产只能按授权 runbook 处理                     |

### 6.2 可重建不等于可立即删除

可重建目录的删除仍必须先确认：没有正在运行的 Vite/API/Agent/Playwright 进程、没有其他代理共享该 worktree、没有用于离线复验的唯一依赖缓存、目标路径精确且不跨 worktree。当前 worktree 有并行开发，故本轮不做物理缓存清理。

## 7. 未合并功能与本地资产判定

### 7.1 GitHub 开放 PR

| PR                                               | 相对 `origin/main`（behind/ahead） | 分类                     | 建议                                                                                                              |
| ------------------------------------------------ | ---------------------------------: | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| #570 `codex/commercial-readiness-wave1-20260809` |                             0 / 10 | **可迁入，当前首要候选** | 本地 `1cc66965` 已包含最新 main 但未推送；新 HEAD 四项 CI、复审与 Windows/COS 边界确认后再合并，不得直接部署      |
| #569 `feat/kiosk-home-v3-pilot`                  |                              5 / 1 | **需保留候选**           | 用户视觉验收后决定；不要与 7 月定版入口并行形成第二套首页                                                         |
| #566 `feat/pii-redaction-text-layer`             |                              6 / 1 | **可迁入但依赖审查**     | 与 #565 栈关系和生产开关/文件链路一起重放；不能只摘 UI 宣称“已遮挡”                                               |
| #565 `feat/kiosk-pii-redaction-contract`         |                              6 / 3 | **需保留基础候选**       | 在 #566 去留确定前保留锚点；证明祖先关系后再清理中间分支名                                                        |
| #548 `codex/print-first-order-evidence-20260807` |                             20 / 1 | **可选择性迁入**         | 只提取仍真实的硬件证据/文档提交，先对照当前 Agent/生产事实；不复活落后分支继续开发                                |
| #117 `feature/job-master`                        |                          1188 / 23 | **无法判断，默认冻结**   | 分叉过深；先做 23 个独有提交的需求覆盖矩阵。已被 main 覆盖的放弃，仍有独特价值的重做/选择性提取，禁止整分支 merge |

PR #568 已合入 `origin/main@78c8e71d`，不再是开放 PR；但其原 worktree 仍有 56 个未提交文件，这部分本地资产没有随 PR 合并而自动获得保护性迁移结论，仍禁止清理。

### 7.2 独立小程序仓库

`/Users/wanglei/zhiyida-miniapp` 当前状态已经从早先的 29 个 tracked 修改 + 4 个 untracked 入口，收敛为一个本地提交：

- branch：`feature/test-mode-pricing-2026-08-04`
- HEAD：`ee0ca9b`，upstream/真实远程 head：`4d17e5b`
- ahead/behind：`+1/-0`，工作区 clean
- local-only commit：`feat(miniapp): integrate kiosk login and runtime print pricing`
- 变更规模：47 files，+2022/-423；含 `pages/kiosk-login/**`、`scripts/build-preview.mjs`、打印动态价格与多页接线
- 文件面：独立仓库 300 个 tracked 文件、58 个页面 JS；monorepo `apps/miniapp` 77 个 tracked 文件、14 个页面 JS；相对路径比较为独立仓库特有 230、monorepo 特有 7、共有 70（其中 44 内容相同、26 内容不同）

判定：这是**需迁移候选资产**，不是可删旧副本。下一步从最新干净 `origin/main` 建独立迁移分支，按能力切片选择性迁入：先 API 契约/合规/真实状态，再页面，最后预览工具；逐片跑 monorepo `verify:static`、外部跳转、价格单一真源和微信开发者工具。完成覆盖矩阵、远程备份与用户明确废弃前，不删除独立仓库、分支或本地提交。

### 7.3 本地 worktree 受保护资产

最新快照共有 28 个 worktree，其中 6 个存在未提交资产；本审查 worktree 的 3 项均为本轮正式文档更新，不是未迁移产品代码：

| 路径/分支                                                                  | 状态数量 | 判定                                                   |
| -------------------------------------------------------------------------- | -------: | ------------------------------------------------------ |
| `/Users/wanglei/AI求职打印服务终端` / `wip/kiosk-design-snapshot-20260809` |       58 | 设计/后端组合资产；受保护且不可混合清理                |
| `.claude/worktrees/project-pages-features-audit-7bfeb0`                    |       54 | Miniapp 原型截图/CSS 设计资产，受保护                  |
| 临时 worktree `design/v3-entry-remodel`                                    |       20 | V3 入口重塑候选，须由设计 owner 判定与迁移             |
| `/Users/wanglei/AI求职打印服务终端-miniapp-native`                         |        6 | `apps/miniapp` 早期迁移候选，需与已合入 M0.1–M0.3 判重 |
| 本审查 worktree `codex/commercial-readiness-wave1-20260809`                |        3 | 仅三份正式 docs；完成本轮后交由父任务提交/合并         |
| `.claude/worktrees/restore-history-conversations-99016d`                   |        1 | 工具配置改动，归属不明，需 owner 判断                  |

这些 worktree 不能按“分支 tip 已被 main 覆盖”直接删：未提交内容本身就是候选资产。其余 22 个 clean worktree 也不能批量删除；仍须逐个验证 unique commits、开放 PR、祖先关系、路径所有者和最近使用时间。

## 8. Local ↔ Git/远程一致性精确快照

### 8.1 当前审查分支

| 项                    | 值                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------- |
| branch                | `codex/commercial-readiness-wave1-20260809`                                         |
| HEAD                  | `1cc66965`（包含 Wave 5 修复提交 `392c5de5`）                                       |
| upstream              | `origin/codex/commercial-readiness-wave1-20260809@254c1394`                         |
| upstream ahead/behind | ahead 11 / behind 0；当前合并候选尚未推送                                           |
| `origin/main`         | `9f82157bc30b68ac5a3385ce4d1955018cf47903`                                          |
| `origin/main...HEAD`  | behind 0 / ahead 10；已包含 `origin/main@9f82157b`                                  |
| local `main`          | `73fd04a1`，相对 `origin/main` behind 7 / ahead 0                                   |
| PR                    | Draft #570 远端 head `254c1394`；旧 checks 为 build/PG FAILURE、browser/MSI SUCCESS |

Wave 1–5 产品/回归代码已收成至本地 HEAD，且已包含最新 `origin/main`；第二次主干合并保留了 main #572 后台招聘 P0 的正式 progress，当前候选仍未推送。分支能力在推送、同 SHA CI、审查并合入 main 前不得视为主干或生产事实；#572 的 PostgreSQL 16 也仍由新 HEAD `postgres-readiness` 权威验证。

### 8.2 分支与 refs

| 指标                                | 数量 | 解释                                                                         |
| ----------------------------------- | ---: | ---------------------------------------------------------------------------- |
| local branches                      |  584 | 不能按 merged/no-merged 数量直接删除                                         |
| true remote heads (`git ls-remote`) |  322 | 真实 GitHub heads，不等同本地 tracking refs                                  |
| local `refs/remotes/origin/*`       |  329 | 含 322 个真实 heads、6 个 stale tracking-only refs 和 `origin/HEAD` 符号引用 |
| stale tracking-only                 |    6 | 只表示远程已无同名 head；未授权前不 prune                                    |
| worktrees                           |   28 | 不能直接 prune/remove                                                        |
| open PRs                            |    6 | 见第 7.1 节                                                                  |

“stale tracking-only”只表示远程已无同名 head；未授权前仍不执行 `git remote prune`。584 个本地分支也不能按 merged/no-merged 数量批量清理：有活跃 worktree、未提交资产、堆叠基础分支和 local-only commits。脏 worktree 中仍有大量未提交资产，正好证明 stale ref 或分支 tip 祖先关系不能作为删除授权。

### 8.3 可重建差异与真实功能差异

| 类型           | 示例                                                                                      | 处理                                                          |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 可重建         | `node_modules`、`dist`、Prisma generated、test-results、tsbuildinfo                       | 可在空闲 clean worktree 按锁文件重建；不进入功能迁移          |
| 真实功能差异   | local-only commit、tracked modified、untracked source/migration/verify、PR unique commits | 必须 code review、验证、迁入/放弃决策，不能用缓存清理方式处理 |
| 受保护设计资产 | 原型 HTML/CSS/截图、视觉审计                                                              | 保留直到用户验收与唯一真值决策，不把二进制截图当 cache        |
| 生产/数据资产  | migration、schema、dump、FileObject/storage、Agent 本地 DB                                | 只按数据 census、备份、审计与授权 runbook 处理                |

## 9. CI、verify 与部署审查

### 9.1 已有强项

- `build-and-verify` 使用 full history checkout、frozen lockfile、dependency/security/compliance、双 schema drift、四端 lint/typecheck/build 和大量串行 SQLite verify（`.github/workflows/ci.yml:20-391`）。
- `postgres-readiness` 在 fresh PostgreSQL 16 执行 generate、migrate、seed 和核心业务 verify（`:392-531`）。
- `kiosk-browser-smoke` 覆盖 fusion static contracts、coverage 和 W1–W6/privacy/warning 浏览器套件（`:533-615`）。
- repository integrity gate 在安装依赖前运行，只依赖 Node/Git/Ruby；当前五份 workflow YAML 均能语法解析，tracked 文件无冲突标记。
- 部署有显式授权变量、备份、同提交构建、migration 与 provenance 设计；生产 seed 默认 fail-closed。

### 9.2 本轮已补覆盖与剩余缺口

从最终 HEAD 静态提取所有 workspace `package.json` 得到 301 个 `verify:*`/`verify-*` 脚本，其中 76 个脚本名未直接出现在 `ci.yml`。这不等于 76 个都未覆盖或都应无条件进主 CI：聚合脚本可能间接调用；live provider、真实 COS/OCR、人工 acceptance 应保留为受控门禁。本轮已经把 AI/file/print/material token、Agent scan/reliability/monitor、Kiosk member/print 等高风险纯本地回归接入；仍需单独归类的代表项如下：

| 建议优先级 | 脚本                                                            | 原因                                                       |
| ---------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| P1         | Agent `verify:task-runner-wake`                                 | task reliability 已接；wake 脚本仍需确认是否被现有聚合覆盖 |
| P1         | Miniapp `verify:static`                                         | 当前 monorepo 小程序没有任何 CI 调用命中                   |
| P1         | Kiosk `verify:service-entry-readiness`                          | member session 已接；服务入口真实性脚本仍未直接命中        |
| P1/P2      | `verify:deploy-authorization-gate`、部分 Admin/Partner 静态门禁 | 先核对是否被聚合脚本间接覆盖，再决定直接接线               |

建议同时维护三类清单：`ci-required`、`manual-live`、`local-focused`，并记录 direct/aggregate 覆盖关系，避免“脚本存在但无人知道是否必须跑”。不要简单把 76 个全塞进单一 30 分钟 job；按 SQLite 串行、PG、浏览器、Agent、Miniapp 分 job/聚合脚本。

### 9.3 CI 仍不能证明的事项

- Ruby YAML parser 只证明语法，不证明 GitHub Actions 表达式/权限/Action schema 语义；可在后续增加 actionlint 类静态校验，但不应为此阻塞当前紧急修复。
- SQLite 和 fresh PG 不能替代带历史数据的 production migration、索引耗时和对象存储不确定结果。
- Linux runner 不能替代 Windows service、WMI/CIM、reparse point、SMB、驱动/spooler。
- Chromium headless 不能替代 1080×1920 真机触控、PDF 插件、微信开发者工具和原生文件拖放。

### 9.4 部署与运行版本

仓库最后一次明确记录的同提交生产发布是 `main@389f37ff`（`current-progress.md` 2026-08-07 条目）。2026-08-08 未授权 Deploy run 已被取消，记录称未进入 API/Nginx 替换，但服务器源码工作目录曾被 checkout/build；因此下一次发布前必须重新只读核对：服务器源码 HEAD/dirty、`DEPLOY_SOURCE`、PM2 commit/restart、四端 bundle、migration、备份空间和授权变量。不能从本报告推断 2026-08-09 线上仍精确等于 `389f37ff`。

### 9.5 最终商用验收矩阵

| 证据层级            | 已有事实                                                                                 | 放行前仍需                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 代码可证明          | Wave 1–5 专项、会话 token RED→GREEN、写库 verifier fail-closed、52/52 Security discovery | 保持同 SHA 回归；外置封存器缺 snapshotDigest，不得声称 sealed final report              |
| 远程 CI             | 旧 `254c1394` 为 build/PG 两红、browser/MSI 两绿；`1cc66965` 已含 `392c5de5` 与 #572     | 推送同一新 HEAD，在 Node 22/PostgreSQL 16 上重跑四项并全部通过                          |
| 生产服务            | 仓库已有部署/备份/migration/provenance 门禁                                              | 具名授权下核对 PostgreSQL、Redis、COS/OSS、支付、OCR/LLM/TRTC、PM2/Nginx 与同 SHA       |
| Windows/Pantum 真机 | Agent/打印/扫描具备代码和 Linux/SQLite 回归                                              | 两台 Windows、SMB/reparse/ACL/杀毒/重启、spooler、真实出纸；厂家确认彩色/双面/N-up 参数 |
| 法务/内容/密钥      | 合规红线与第三方来源入口已有代码约束                                                     | 法务文本、来源授权/有效期/下架、真实岗位/招聘会/政策、商户与云服务密钥轮换/最小权限     |

## 10. 目录、数据、fixture 与文档渐进优化

### 10.1 目录结构：不迁移，只补职责索引

1. 保持 `apps/`、`services/`、`packages/` 物理结构不变。
2. 更新 `docs/project-structure.md` 时补入已经存在的 `apps/miniapp` 与 `packages/refresh`；不是搬目录。
3. `services/worker` 明确标记“reserved, no runtime”，并列出启用独立进程的准入：稳定队列负载、部署/监控/伸缩需求、API 内 processor 迁移计划、双进程禁止重复消费门禁。
4. `services/api/src/files/files.service.ts` 已 1134 行，超过 800 行红线；下一次新增职责前按 upload/content/delete/retention 切内部 service，保持 module/API 路径不变，不做全仓重写。
5. 空旧 Kiosk 模块应做一次“契约退役”任务，而不是今天删 service、明天删 controller 的长期半状态。

### 10.2 数据与迁移

- 当前 SQLite migration 目录 78 个、PostgreSQL migration 目录 50 个；数量不同不代表 drift，继续以 `db:pg:sync:check` 与 fresh migration 为准。
- 两份 schema 约 2295/2300 行；在没有 schema generator 的当前结构下，任何模型变更必须同一提交修改双 schema、additive migration 和 drift verify。
- 不修改历史 migration，不把生产迁移目录压缩成“更干净”的 baseline；新环境速度问题另立 squash/baseline RFC。
- 生产 seed 与真实内容导入分离。`seed*.ts` 只用于可丢弃环境；岗位/招聘会/政策必须走来源授权、审核、有效期和下架流程。
- 为疑似孤儿表建立只读 census SQL 模板，输出表存在性、行数、最近时间、外键、索引和样例字段的聚合/脱敏摘要；报告确认后才讨论 forward-only drop。

### 10.3 fixture 与本地数据

- 当前 fixture 分散在 `apps/kiosk/tests/fixtures`、`tests/visual/fixtures`、页面 `__fixtures__`、API 大量 `scripts/verify-*` 内嵌 fake。短期不搬目录，先为每个 fixture 加用途、是否写 DB、是否需要 Redis/PG、清理责任、是否允许 PII 的元数据注释/索引。
- CI 中复制 `prisma/dev.db` 的旧模式已经造成过假失败；所有新 verifier 使用 `mktemp` + fresh schema/seed，禁止依赖开发库当前状态。
- 所有会写行的 verifier 必须显式声明 `VERIFICATION_DATABASE_TARGET=isolated`，并在创建 Prisma client 前拒绝 production、远程 PostgreSQL、非测试库和缺 marker；本地 Node 22 新临时库 schema engine generic error 尚未闭合，保留远程 CI 复验。
- 当前没有 tracked `.db/.sqlite/.dump`，保持这一点；真实验收样本只存脱敏摘要/hash/ID，不把用户简历或扫描件提交 Git。
- `services/api/data`、storage、Agent `data/*.db`、`.env*` 保持 ignored；需要生产取证时只记录受控路径、hash、时间和恢复说明，不复制敏感文件进仓库。

### 10.4 文档与大文件

- `current-progress.md` 1338 行/约 907 KB，`next-tasks.md` 765 行/约 296 KB。继续使用既有 `docs/progress/archive/`，按日期把已稳定且不再执行的历史条目归档，并在正式入口保留当前状态、关键锚点和链接；不要新建第二套 handoff 标准。
- 设计截图和 runtime 图片职责不同。两份 `kiosk-home-hero-job-fair.png` 虽 hash 相同，但一份服务 runtime、一份保证原型自包含，均有引用；除非先改消费者和验证离线原型，不删除。
- 新增大二进制前记录来源/版权/用途/消费者；可再生的批量 capture 优先外部归档，只保留审计所需关键图。

## 11. 分级整改路线

### P0：发布前必须完成

1. **冻结唯一发布候选**：推送已含 `392c5de5` 和 `origin/main@9f82157b` 的候选 `1cc66965`；PR #570 的四项 CI 必须全部绑定同一新 SHA、全绿并经人工审查后才合入 main，从合入后的同一 SHA 构建，不从共享脏 worktree 发布。
2. **生产只读对齐**：核对服务器源码、runtime、PM2、四端 bundle、migration、授权变量、备份/磁盘；确认后再申请具名发布窗口。
3. **Windows/奔图验收**：两台主机覆盖安装升级、service 强杀、断网/断电、spooler/打印机重启、重复领取、终态补报、真实出纸；确认彩色 mode/pages-per-sheet，未知项必须拒绝或隐藏。
4. **扫描恢复门禁**：实现可信 Win32/PowerShell reparse-point 检查，覆盖 symlink/junction/reparse/写入替换/长驻 watcher；验证 Wave 4A 本地删除账本在 Windows/SMB/ACL/杀毒占用/重启下的行为，并补集中上报/ack/归档后再开放扫描。
5. **生产文件/支付**：真实 COS/OSS DELETE 超时与不确定结果、签名 URL、生命周期、支付/退款/对账、跨账号隔离和审计。
6. **真实内容与合规**：接入经授权岗位/招聘会/政策来源，法务定稿，轮换已暴露/待轮换密钥；保持平台内不投递红线。
7. **小程序若纳入首发**：外部 CTA、M0.4 本人数据、真实 AppID、开发者工具与真机验收全部完成；否则从发布范围明确排除并保持不可用入口不误导。

### P1：首发前优先或首个补丁

1. 对 8 个旧 Kiosk 路由做访问日志/client census，设计弃用/410/移除方案。
2. 对五组疑似孤儿 Prisma 表做生产只读 census；不得先删 model。
3. 部署 materials header-only 契约；对边缘/历史日志做 `accessToken` query 脱敏与泄漏处置，监控拒绝事件但不记录 token。
4. 为 Agent durable dead-letter 增加管理员/CLI 列表、确认、受控重放和审计；重放仍做 owner/admin/终态幂等校验。
5. 本轮 AI persistence、file delete、Agent reliability/monitor、材料 token、打印参数和会员会话门禁已接入；继续完成 Miniapp static、Agent wake 与 service-entry 的 direct/aggregate 覆盖判定。
6. 完成 Partner 原生 DataTransfer、Miniapp 外部跳转和隐私/本人数据真实接线。

### P2：稳定性与维护性

1. 渐进拆分超 800 行 `FilesService` 和超长进度文档；不改公开接口/物理顶层目录。
2. 建 verify 分类索引与聚合脚本，减少近 300 个脚本“存在但覆盖归属不明”。
3. 为 GitHub Actions 增加语义静态检查；保留当前 Ruby 语法门禁。
4. 建 worktree/branch 周期性只读清单：owner、目的、base/tip、unique commits、dirty count、开放 PR、最后活动、迁移决定。只清理六项证据齐全且经授权的条目。
5. 为设计二进制建立来源/消费者/可再生性清单，控制仓库增长而不误删用户资产。

## 12. 最终 GO / NO-GO 清单

只有以下所有项为“是”才能给整体商用 GO：

- [ ] 唯一 main SHA 的 CI、PG、浏览器、Windows installer 全绿并经人工审查。
- [ ] 生产 `DEPLOY_SOURCE`、PM2、Kiosk/Admin/Partner bundle 与该 SHA 一致。
- [ ] PostgreSQL 备份可读、migration 无 pending、回滚锚点和容量合格。
- [ ] 真实 Windows Agent/奔图完成出纸、错误恢复、重启、重复任务与状态回流。
- [ ] 扫描 reparse-point 门禁、SMB、原始扫描留存/审计/删除现场通过。
- [ ] 对象存储签名、内容、删除、超时与生命周期现场通过。
- [ ] 真实支付/退款/对账、短信、TRTC/LLM/OCR 和密钥最小权限通过。
- [ ] 真实岗位/招聘会/政策来源、授权、有效期、审核和下架机制通过。
- [ ] 法务协议/隐私/AI 提示定稿，平台内招聘闭环红线扫描通过。
- [ ] 发布范围内的 Miniapp 功能没有 TODO toast 冒充动作；若不发布则入口明确关闭。
- [ ] 旧 Kiosk API、疑似孤儿表、独立小程序和旧 worktree 均已有保留/迁入/放弃责任人，不发生误删。
- [ ] 发布后同一 SHA 的 Kiosk、Admin、Partner、API、Agent 与关键业务探针通过。

**本报告结论：当前为 NO-GO。** 这不是否定现有工程，而是要求先把“已写代码”“已通过本地验证”“已合入 main”“已部署生产”“已过硬件/外部服务验收”五个层级逐一闭环，禁止相互替代。

## 13. 复核命令与结果摘要

| 命令/检查                                              | 结果                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `git status --porcelain=v2 --branch`                   | 仅三份正式 docs modified；无未提交产品代码                                |
| `git rev-list --left-right --count @{upstream}...HEAD` | upstream behind 0 / local ahead 11                                        |
| `git rev-list --left-right --count origin/main...HEAD` | local behind 0 / ahead 10；已包含 `origin/main@9f82157b`                  |
| `git worktree list --porcelain`                        | 28 个 worktree                                                            |
| `git for-each-ref refs/heads`                          | 584 个 local branches；未做批量删除                                       |
| `git ls-remote --heads origin`                         | 322 个真实 remote heads                                                   |
| remote tracking 与 ls-remote 差集                      | 329 tracking refs（含 `origin/HEAD`），6 个 stale tracking-only；未 prune |
| 独立 miniapp `git status`/`rev-list`                   | clean，local-only ahead 1，未推送                                         |
| worker route/import/docs/workspace 搜索                | tracked 占位且有正式文档引用；不删除                                      |
| 旧 Kiosk module/controller/import 搜索                 | 5 module 注册、8 handler 可达；不删除                                     |
| Prisma delegate 搜索                                   | 五组旧 model 0 个运行时访问命中；未做生产 census，不删除                  |
| tracked DB/dump 搜索                                   | 0；本地 dev DB/storage 由 ignore 管理                                     |
| tracked 大文件/hash/引用搜索                           | 两份 1.66 MB hero PNG hash 相同但消费者不同；不删除                       |
| Wave 4/5 Agent/API/Kiosk 目标 verifier                 | 本地目标回归通过；Node 22 fresh DB schema engine 边界保留                 |
| Security diff discovery / sealer                       | 52/52、6 candidates、唯一 Low 已修；缺 snapshotDigest，未 sealed          |
| PR #570 `gh pr view` / job logs                        | 旧 `254c1394`：build/PG FAILURE，browser/MSI SUCCESS；新 HEAD 未推送      |
| repository integrity / 显式 YAML / Prettier            | 3,091 tracked marker-free；5 workflow valid；`ci.yml` 通过                |
| `git diff --check` / 文档格式                          | 主干冲突解决后已通过；最终三文档小修再次复跑                              |
