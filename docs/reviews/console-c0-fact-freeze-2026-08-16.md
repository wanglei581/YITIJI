# 双后台 C0 事实冻结（2026-08-16）

> 执行 `docs/reviews/2026-08-12-v6-commercial-product-audit.md` §6.3 第 1 项。
> **核实基准：`origin/main` @ `67145a855a6eaaab2b5823182d530f817eee806b`**（2026-08-16，`feat(orders): 小程序与一体机共用后台裁定 + M1 渠道字段落地 (#608)`）。
> 仓库当前有 22 个 worktree；本文所有「存在/缺失」结论一律用 `git show origin/main:<path>` / `git ls-tree -r origin/main <dir>` 取值，不以任何工作区检出为准。
> 本文只冻结事实，**不实现任何功能，不下「已完成」结论**；发现的问题只登记不修。

## 0. 前置声明

1. **C0 的源文档本身不在 `origin/main` 上。** `docs/reviews/2026-08-12-v6-commercial-product-audit.md` 只存在于 4 个 worktree 与本分支。**C0 落盘时应连同该审查一起并入 main**，否则事实冻结的上游依据在主干上不可复核。
2. **5303 原型与 `origin/main` 完全一致**（`git diff --stat origin/main -- docs/design/console-ai-os-2026-08/` 为空），下文统计既是工作区实测值也是 main 的值。

---

## 1. 页数口径裁决：实测 Admin 34 → 35，Partner 13，合计 48

### 1.1 Admin 实测

路由表共 **37 个叶子条目**，其中 **3 条是 `<Navigate>` 重定向、不是页面**：`/terminals` `/printers` `/peripherals` → `/devices?tab=*`。

> `apps/admin/src/routes/{terminals,printers,peripherals}/` 三个目录**仍有源码**，只是不再被路由直接挂载（作为 `/devices` 的 Tab 内容复用）。清点物理页面不能按目录数算。

**实测真实页面 = 37 − 3 = 34**，与 `mapping.html` 的 Admin 34 行一一对应。侧栏 `NAV_ITEMS` 实测 **32 项 / 5 组**（34 − `/login` − `/account-settings`），与 `scripts/shell.js:4` 注释「5 组 32 项」吻合。

`/online-platforms` **在 main 上不存在**（无 admin 路由、无 API 控制器，只有 3 个原型/设计稿文件）。

**Admin = 34（现状）+ 1（新增）= 35。**

### 1.2 Partner 实测

**13 条叶子路由，0 条重定向**：`/login` `/`(工作台) `/profile` `/jobs` `/companies` `/fairs` `/smart-campus` `/policy` `/terminals` `/stats` `/sources` `/sync-logs` `/account`。侧栏 12 项 / 4 组，与 `shell.js:5` 吻合。**Partner = 13，本轮不新增。**

### 1.3 「47」的两个含义必须分开 —— 这是口径混乱的根因

- **47-A（现状口径）**：34 + 13 = 47，是**加入 `/online-platforms` 之前**的真实页数。`mapping.html` 用的是这个，它自身没算错 —— 但把它写成了改造后的目标态，同时表格里**根本没有 `/online-platforms` 这一行**。
- **47-B（目标口径）**：48 − `/permissions` = 47。这是 `shell.js:54` 给 `/permissions` 打的「摘除」标记想要的结果，**但摘除 ≠ 退役**：`shell.js:7` 自己写明「摘除 = 从侧栏摘掉但保留页面」。侧栏摘掉不减少物理页面。

**裁定（与审计一致）：按 48 计算。** 若坚持 47-B，必须先完成四项：

| 项 | 位置（origin/main） | 现状 |
|---|---|---|
| 路由退役 | `apps/admin/src/routes/index.tsx:26`、`:73` | 实体路由仍在 |
| 旧 URL 兼容 | 同上 | **无任何重定向**，直接删会 404 |
| 侧栏与路径映射 | `AdminLayoutWrapper.tsx:70`、`:121` | 两处仍引用 |
| 测试清理 | `apps/admin/scripts/verify-honest-placeholders.mjs:20` | 该脚本把 `permissions/index.tsx` 钉为四个「诚实空壳」之一 |

> `verify-honest-placeholders.mjs` 同时钉住 `apps/partner/src/routes/{terminals,stats,account}/index.tsx`，并禁止「功能建设中」「敬请期待」。**任何填充这三页的工作（含 C1 的 `/stats`）都必须同步改这个脚本**，否则 CI 会挂。此处只登记。

### 1.4 小程序不改变页数

`docs/product/miniapp-console-sharing-2026-08.md`（在 main 上）裁定「共用一套……不需要新建任何管理页，三处缺口全部并进现有页」。2026-08-16 新增的两个原型 `admin/orders.html`、`admin/member-privacy.html` 对应的都是**已存在**的路由。

---

## 2. V6 页号 ↔ 真实 React 路由映射

### 2.1 三条必须先纠正的事实

1. **`mapping.html` 前台基线确实过时**：只出现 P02–P27 共 19 个页号，**P33–P46 一个都没有**。
2. **`pickup-claim` 现在确实存在于 main，早期结论作废**：
   - 页面 `apps/kiosk/src/routes/index.tsx:214` → `PrintPickupClaimPage`
   - 端点 `services/api/src/print-jobs/print-jobs.controller.ts:22` + `:32` `@Post('claim-pickup')`，限流 20/60s
   - 落地 commit `c61b7e06`（2026-08-12）
   - **仍须保持的边界**：`claim-pickup` 只授权 `Order.pickupStatus`，`PrintTask.claimed` 仍只允许 Terminal Agent 写入，两套状态机不得混用
3. **`docs/design/kiosk-ai-os-v3-2026-08/wiring-map.md` 已覆盖 P33–P46**。缺 P33–P46 的是 `console-ai-os-2026-08/mapping.html`，不是 wiring-map。C0 的正确做法是**把 wiring-map 的覆盖并进 mapping.html，而不是另起第三份表**。

### 2.2 完整映射表

状态：`existing` = 路由与主要端点都在 main 且语义对得上；`extend` = 路由在但端点半实现/口径不符/参数不足；`new` = 路由或端点在 main 不存在；`deferred` = 有意后置。

| V6 | 原型 | 真实 React 路由 | 状态 | 备注 |
|---|---|---|---|---|
| P01 | `01-home-v6.html` | `/` | extend | 设备/价格/活动静态；需站点配置 + 能力投影 |
| P02 | `02-standby.html` | `/screensaver` | extend | 后端为 `GET /admin/screensaver/terminals` + `kiosk/screensaver-content` |
| P03 | `03-identity-gate.html` | `/login`、`/member/qr-login` | extend | 短时单次 QR、限流、returnTo 白名单未闭环 |
| P04 | `04-system-states.html` | `/session-timeout`、`/error-offline`、`/legal/:doc` | extend | `kiosk/session` 控制器为空壳 |
| P05 | `05-phone-relay.html` | `/upload/phone` | extend | 390×844 独立验收；QR TTL 后端硬编码 600s |
| P06 | `06-print-workbench.html` | `/print/{upload,material-check,preview,params,confirm,cashier,progress,done}` | extend | quote/create/pay 均在；缺 quoteId/锁价/BenefitReservation |
| P07 | `07-scan-workbench.html` | `/scan/{start,settings,progress,result}` | extend | 格式/DPI/ADF/单双面超出现有 Agent 合同 |
| P08 | `08-file-tools.html` | `/print-scan/{convert,sign,feature/:key}` | extend | 转换只接图片 |
| P09 | `09-resume-workbench.html` | `/resume/{source,parse,report,optimize,export}` | extend | 版本不可变、真实 export artifact 未闭环 |
| P10 | `10-resume-interview.html` | `/resume/generate[/preview]` | extend | 一次生成提交/版本/导出未闭环 |
| P11 | `11-jobfit-compare.html` | `/resume/job-fit` | extend | 需真实 jobId + resumeVersion，最多三岗 |
| P12 | `12-material-factory.html` | `/resume/materials` | extend | tone/length/清单为样例 |
| P13 | `13-jobs-desk.html` | `/jobs` | extend | 分页/facets/收藏/canonical source 未齐 |
| P14 | `14-job-detail.html` | `/jobs/:id` | extend | 外链需服务端审核 + 离站确认 + 跳转日志 |
| P15 | `15-companies.html` | `/companies`、`/companies/:id` | extend | 审核发布链已通；前台指标键部分静态 |
| P16 | `16-offline-agencies.html` | `/offline-agencies[/:id]`、`/jobs/:id/offline` | extend | service 筛选破坏分页 |
| P17 | `17-fair-desk.html` | `/job-fairs[/:id]` + 子资源 | extend | 打印 bundle artifact 缺 |
| P18 | `18-campus.html` | `/campus`、`/campus/{welcome,freshman-insights}` | extend | 活动与计划为静态 |
| P19 | `19-smart-campus.html` | `/smart-campus` + 子路由（`SmartCampusGuard`） | deferred | 默认 `enabled=false`；服务端 fail-closed 待补 |
| P20 | `20-interview-pod.html` | `/interview/{setup,session,report,reports,tips}` | extend | FSM 与报告 artifact 未闭环 |
| P21 | `21-policy.html` | `/renshi` | extend | 政策/资格/清单/热线为样例 |
| P22 | `22-career-plan.html` | `/resume/career-plan` | extend | 缺 resumeTaskId 前置校验 |
| P23 | `23-me.html` | `/profile` + `/me/*` | extend | 退出/删除/清空仍只改本地 UI |
| P24 | `24-benefits.html` | `/activities[/:id]`、`/me/benefits` | **extend（高危）** | `POST /orders/:id/redeem` 的 `discountCents = order.amountCents`（整单免）；接真前必须先堵 |
| P25 | `25-advisor.html` | `/assistant` | extend | 发送/降级/pin 持久化/输出 artifact 缺 |
| P26 | `26-advisor-work.html` | `/ai/plan` | extend | skill/session、输入槽、继续回答缺 |
| P27 | `27-toolbox.html` | `/toolbox` | extend | 离站确认与 allowlist 前端未接 |
| P28 | `28-self-assessment.html` | `/resume/self-assessment/*` | extend | consent version / assessmentId / artifact 缺 |
| P29 | `29-id-photo.html` | `/print-scan/feature/id-photo` | deferred | 能力键有、任务模型无 |
| P30 | —（P11 升格别名） | `/resume/job-fit` | existing | **不是缺页**，不得新增第二文件/入口/模型 |
| P31 | `31-contract-review.html` | `/contract-review[/processing,/result]` | deferred | 受 `contractReviewEnabled` 开关控制，关时 `<Navigate to="/">` |
| P32 | `32-resume-hub.html` | `/resume-service` | extend | intent/need 只在 URL，门禁不消费 |
| P33 | `33-resume-templates.html` | `/resume/templates` | extend | 模板 API + templateId→artifact 缺 |
| P34 | `34-jobs-hub.html` | `/jobs-service` | extend | typed route context 与来源治理缺 |
| P35 | `35-online-platforms.html` | `/jobs/online-platforms` | **extend（数据面 new）** | 页面在，但 `PLATFORMS` 是 **4 条硬编码常量**。`OnlinePlatformDirectory` 在 `services/api/src` 下 **0 处引用** → 治理与投影端点全部 new |
| P36 | `36-fairs-hub.html` | `/fairs-service` | extend | 筛选只拼 URL；「免费」无报价证明 |
| P37 | `37-interview-hub.html` | `/interview-service` | extend | 缺目标时保留可聚焦 disabled + 原因 |
| P38 | `38-policy-hub.html` | `/policy-service` | extend | 资格字段不全；「官方」缺核验 |
| P39 | `39-print-hub.html` | `/print-scan` | extend | 手机上传须进 P06 `stage=s1&source=qr`；capability unknown 必须 fail-closed |
| P40 | `40-session-safety.html` | `/session-resume`、`/session-timeout`、`/me/privacy-requests` | extend | `kiosk/session` 为空壳 |
| P41 | `41-fulfillment-states.html` | `/print/{progress,done,pickup-claim}` | **existing（取件）+ extend（其余）** | **`/print/pickup-claim` 与端点均已在 main（c61b7e06），原型此处是错的**。但 `PrintTask` 只有 5 个 status，`queued/checking/checkfail/jam/timeout` 表达不出来 |
| P42 | `42-my-assets.html` | `/me/{documents,resumes,favorites}` | extend | 删除确认只关弹层 |
| P43 | `43-my-records.html` | `/me/{activity,notifications,feedback,ai-records}` | extend | 反馈/已读/删除只改 DOM |
| P44 | `44-job-detail-offline.html` | `/jobs/:id/offline` | extend | 重试/收藏/带走未接 |
| P45 | `45-fair-onsite.html` | `/job-fairs/:id/*`、`/job-fairs/checkin` | extend | 人数/次数/「免费」硬编码 |
| P46 | `46-campus-service.html` | `/smart-campus/service/:key` | deferred | 无能力守卫真值；「校方官方」无证据 |

### 2.3 mapping.html「关键接口」列必须整列重写

实测机械抽取 `services/api/src` 全部 78 个控制器的路由后，**至少 24 条路径与 main 不符，其中 5 条完全虚构**。摘要：

| mapping.html 写的 | main 真值 | 判定 |
|---|---|---|
| `GET /admin/ops/overview` | **不存在**，`/dashboard` 由 7 个 service 聚合 | ❌ 虚构 |
| `GET /admin/ops/alerts` | `GET /admin/alerts` | ❌ 路径错 |
| `/admin/jobs`、`/admin/fairs`、`/admin/policies` 的 review/publish | `/admin/{job,fair,policy}-sources/:id/{review,publish}` | ❌ 路径错 |
| `/admin/print-jobs`、`/admin/scan-tasks` | `/admin/print-tasks`、`/admin/print-scan/tasks[/:type/:taskId]` | ❌ 路径错 |
| `GET/PATCH /admin/billing/prices` | `GET /admin/billing/price-config`、**`PUT`** `/admin/billing/price-config/:serviceKey` | ❌ 路径+动词错 |
| `/admin/files` | `GET /files`、`DELETE /files/:id`、`GET /files/lifecycle-summary`、`PATCH /files/:id/retention`（**不在 `/admin` 前缀下**） | ❌ 前缀错 |
| `/admin/ai/capabilities` 组 | `/admin/ai-configs[/:featureKey][/test]` | ❌ 路径错 |
| `/admin/ai/cost/*` `/quality/*` `/health` `/incidents` `/compliance/*` | **全部不存在**，AI 只有 `GET /admin/ai/usage` 与 `/admin/ai/logs` | ❌ 虚构 |
| `/admin/member-feedback` | `/admin/feedback[/:id][/status][/replies]` | ❌ 路径错 |
| `/admin/member-notifications` | `/admin/notifications/broadcasts` | ❌ 路径错 |
| `GET /admin/audit` | `GET /admin/audit-logs` | ❌ 路径错 |
| `/admin/legal-docs` | `/admin/legal-doc-versions[/:id/activate]` | ❌ 路径错 |
| `/admin/privacy-requests` | **不存在独立端点**，与 `/member-privacy` 共用 `/admin/member-privacy/data-requests` 一族 | ❌ **两页共用一套端点，是第三处 IA 重复** |
| `/admin/sync/*` | `/admin/job-sync/sources/*` | ❌ 路径错 |
| `/admin/screensaver/*` | `/admin/screensaver/terminals`、`/admin/terminals/:id/screensaver-config`、`/admin/ad-assets`、`/admin/ad-playlists` | ❌ 路径错 |
| `POST /admin/member-benefits/grant` | `POST /admin/member-benefits` 等 | ❌ 路径错 |
| `POST /auth/password` | `POST /auth/password/change` | ❌ 路径错 |
| `/partner/org`、`/partner/qualifications` | `/partner/profile`；**`/partner/qualifications` 不存在** | ❌ 路径错 + 端点缺 |
| `POST /partner/jobs`（单条新建） | **不存在**，只有 `/partner/jobs/import`（companies/fairs 同理） | ❌ |
| `/partner/smart-campus` | `/partner/smart-campus/terminals[/:terminalId/config]` | ❌ 路径错 |
| `/partner/coverage/points`、`/partner/effect/*`、`/partner/accounts`、`/partner/audit-logs` | **全部不存在** → `/terminals`、`/account` 两页无任何端点 | ❌ 虚构 |

### 2.4 `GET /partner/stats` 的两处硬性不一致（C1 的直接前置）

端点在（`orgs/partner-stats.controller.ts:32`，`orgId` 取自 token）。前端 adapter 也在（`apps/partner/src/services/api/stats.ts`）。但两者对不上：

1. **timezone 参数会被拒**：adapter 请求 `?period=&timezone=Asia%2FShanghai`，而 `PartnerStatsQueryDto` **只有 `period`**；`main.ts:89-91` 全局 `ValidationPipe` 设了 `forbidNonWhitelisted: true` → 稳定 **400 `VALIDATION_FAILED`**。
2. **响应解包对不上**：adapter 取 `body.data`，控制器**直接返回裸对象**（无 `ApiResponse.ok()` 包封）→ `body.data` 恒为 `undefined`。
3. **且当前无人调用**：`apps/partner/src/routes/stats/index.tsx` 是 20 行 `EmptyState`，0 个消费者。所以这两个 bug 今天不暴露，**一接就同时炸两处**。

> C1「先修 Partner `/stats` 已有契约」的具体含义 = 修 DTO/请求参数、统一响应信封、接页面、同步改 `verify-honest-placeholders.mjs`。

---

## 3. 5303 原型 action manifest

### 3.1 实测总数与审计基线的差异（审计当时是对的）

| 项 | 审计（08-12） | 本次实测（08-16） | 差 | 原因 |
|---|---|---|---|---|
| `<button>` | 378 | **392** | +14 | 08-16 commit `c38d7a5f` 新增 `admin/orders.html`(5) 与 `admin/member-privacy.html`(9)。392 − 14 = **378 精确回归** |
| `<a>` | 77 | **79** | +2 | 同上两页各 1。79 − 2 = **77 精确回归** |
| Tab 按钮 | 40 | **42** | +2 | `member-privacy.html` 新增 1 组含 2 个。42 − 2 = **40 精确回归** |
| switch | 4 | **4** | 0 | 一致 |
| `href="#"` | 16 | **16** | 0 | 一致 |
| `javascript:void(0)`（静态） | 3 | **3** | 0 | 一致 |

**裁定：审计六个数字在其撰写日全部准确，不推翻；今日基线更新为 392/79/42/4/16/3。**

无统一脚本处理的按钮：392 − 42(Tab) − 4(switch) = **346**。

### 3.2 处理器归属

25 个页面文件中 **`addEventListener` 0 处、内联 `on*=` 0 处**；每页只有 `shell.js` + `initShell()` 两行。`shell.js` 只绑定三类：`#ss button`（4 个状态切换，运行时注入）、`.tabs / .drawer__tabs`（**11 组 / 42 个按钮**）、`.switch`（4 个）。

**因此 346 个按钮点击后完全无反应** —— 这是「无处理器按钮不能当成已完成能力」的量化依据。

`.switch` 4 个（`admin/ai-config.html` ×1、`partner/smart-campus.html` ×3）在生产里**必须是 `command`（写配置），不是 local toggle**。

### 3.3 六类归属汇总（静态 392 按钮）

| 类 | Admin | Partner | 合计 |
|---|---:|---:|---:|
| navigate | 8 | 8 | **16** |
| local | 59 | 45 | **104** |
| query | 38 | 35 | **73** |
| command | 87 | 101 | **188** |
| external | 3 | 2 | **5** |
| gate | 6 | 0 | **6** |
| **合计** | **201** | **191** | **392** |

79 个 `<a>`：**navigate 59 / external 1 / gate（不可上线的死链）19**。

> 口径：`navigate` = 去另一个存在且语义正确的路由；`local` = 只改可见本地状态；`query` = 只读服务端查询；`command` = 服务端写；`external` = 离站/终端预览；`gate` = 能力门禁（disabled 且需可解释原因）。

### 3.4 各页重点（摘要，完整逐控件表见 §3.5–3.6 的原始盘点）

**Admin 13 页 / 201 按钮 / 27 链接**

- `/`（dashboard）：9 按钮 8 链接。「停掉 v6 灰度」「紧急下架这一条」「改派邻近终端」均 **new**（无灰度模型、无改派端点）。含 1 个 `href="#"`（应为 `/orders`，纯属漏填）
- `/billing`：17 按钮。保存 ×9 对 `PUT /admin/billing/price-config/:serviceKey`；**「+ 新增价目项」new**（无新建端点）
- `/job-materials`：14 按钮，后端只有 `GET /admin/job-materials/summary` → **13 个写动作全部 new**；含 3 个 `href="#"`
- `/ai-services`：24 按钮，main 上 AI 只有 usage/logs 两个只读端点 → **除 Tab 外无一条写链路存在**。「全站 AI 熔断」「一键切备用供应商」属高危写，必须 reason + step-up/RBAC + CAS + 强审计
- `/ai-config`：36 按钮（local 19 / command 13 / query 2 / navigate 2）。**安全冻结：`PUT /admin/ai-config(s)` 当前可写任意 Base URL，服务端会携带模型密钥访问。「影子测试/一键切换」在 DTO 白名单 + 受控 egress 落地前不得接线**
- `/job-sources`：23 按钮。单条 review/publish existing；**批量类 6 个全部 new**（无批量端点、无「要求补充」状态）
- `/companies`：22 按钮。审核/发布/新增/解绑均 existing；批量 3 个 new。**`companies.html:40` 文案写「合作机构后台 · 企业资料管理」但链接指向 `partner/jobs.html`，目标错**
- `/benefit-activities`：11 按钮。**高危冻结：`POST /orders/:id/redeem` 的 `discountCents = order.amountCents`（整单免、不看品类/上限/色彩/场景）。「核销规则」Tab 落地前，Kiosk 用券 CTA 不得接真**
- `/alerts`：7 按钮。告警是实时派生、无持久实体、无事故状态机 → **原型已正确地没放确认/指派/静默类动作**
- `/audit`：4 按钮。自然语言查询 new（AI 只生成筛选条件、不读日志内容）
- `/member-privacy`：9 按钮。**个人数据权利判定必须人工，本页不得引入任何模型判定**；且与 `/privacy-requests` 共用同一族端点，两页职责需先裁决
- `/online-platforms`：20 按钮，**整页 new** —— `OnlinePlatformDirectory` 在 `services/api/src` 下 0 处引用

**Partner 12 页 / 191 按钮 / 25 链接**

- `/profile`：22 按钮，Tab 2/3/4 的全部写动作都是 new（资质端点只在 admin 侧，线上平台收录申请无任何端点）
- `/jobs`：37 按钮。**「新增岗位/手工新增」是 new**（`POST /partner/jobs` 不存在，只有 `/import`）；「提工单」依赖不存在的 Ticket 模型
- `/fairs`：27 按钮。**子资源写操作今天全部只有 Admin 端点**（`/admin/fairs/:id/{companies,zones,materials}`、`venue-guide`）
- `/smart-campus`：13 按钮，含 3 个 switch。**生产里必须先过 org-type capability 投影**
- `/sources`：23 按钮，**14 个 command 是 new**（Partner 侧只有 toggle 与 preflight，手动同步只有 Admin 的 trigger）。**凭证永不回显**；该页 545 行，扩展前先拆分
- `/stats`：10 按钮，契约破损见 §2.4。**曝光/跳转不得写成投递/预约**；漏斗归因缺不可变 `sourceOrgId`；聚合需 N≥5、无个人明细
- `/sync-logs`：8 按钮。**本页正确地没放「重试同步」**（`SyncLog` 只有汇总、未关联批次与失败行）—— 原型里少见的诚实处理
- `/terminals`：4 按钮，`GET /partner/coverage/points` 不存在；生产页今天是 15 行 `EmptyState`
- `/account`：12 按钮，`POST /partner/accounts` 与 `GET /partner/audit-logs` 均不存在。**三个 Tab 必须等 Ticket 状态机与子账号模型落地后才开放**

### 3.5 运行时注入控件（不计入 392/79，但生产必须覆盖）

| 注入源 | 数量 | 类 | 冻结备注 |
|---|---|---|---|
| `#ss` 状态切换 | 4 × 25 页 | local | **纯原型工具，生产必须整体删除**，不得留成「演示模式」 |
| 顶栏按钮 | 1 × 25 页 | Admin=navigate / Partner=command(`POST /auth/logout`) | — |
| 侧栏 `<a class="nav__item">` | Admin 33 / Partner 13 | navigate | — |
| **侧栏无 href 项 → `javascript:void(0)`** | **Admin 20 项 × 13 页 = 260 次渲染** | **gate/死链** | 见 §4.2 |
| 机构助手悬浮球 / 收起 | 各 1 × 12 Partner 页 | local | — |
| 助手快捷问句 / 发送 | 12 Partner 页 | query | 输入框无提交处理器 |
| 助手答案内嵌按钮 | 7 | command ×6、query ×1 | **全部无端点**（无 Ticket 模型） |

### 3.6 无障碍冻结（新登记）

`grep -ro 'aria-' admin partner | wc -l` = **0**。25 个原型页**没有任何 `aria-*` 属性**，Tab 组不是 `role="tablist"`，抽屉不是 `role="dialog"`，`.switch` 是没有 `aria-checked` 的 `<button>`，`disabled` 也没有可解释原因。这与审计 §5 直接冲突。**接线时必须补齐，不能照抄原型 DOM。**

---

## 4. 生产禁止项：19 个 enabled 死链必须消除

### 4.1 `href="#"` —— 16 个，全部 enabled、可点击、无 `aria-disabled`

| # | 位置 | 文案 | 应指向 |
|---|---|---|---|
| 1 | `admin/ai-config.html:440` | 回滚 | Prompt 版本回滚（端点不存在 → 应为可解释 disabled） |
| 2 | `admin/alerts.html:33` | 设备离线/缺纸降级态 | Kiosk P04 说明 |
| 3 | `admin/billing.html:28` | 权益活动 | `/benefit-activities`（同页另一链接已正确指向） |
| 4 | `admin/companies.html:39` | 「找企业」列表与详情 | Kiosk P15 说明 |
| 5 | `admin/dashboard.html:135` | 进入订单管理 → | **`/orders`（真实存在，纯属漏填）** |
| 6–8 | `admin/job-materials.html:28-29` | 「AI简历服务」「我的文档」「打印扫描」 | Kiosk P09/P32、P42、P39 说明 |
| 9 | `admin/job-sources.html:29` | 「岗位信息」列表与详情 | Kiosk P13/P14 说明 |
| 10 | `admin/job-sources.html:30` | 合作机构后台 · 岗位信息管理 | **跨后台链接，生产不得存在** |
| 11 | `admin/job-sources.html:30` | 数据接入通道 | `/sync-sources`（真实存在） |
| 12 | `admin/online-platforms.html:28` | 合作机构后台 · 机构资料 | **跨后台链接，生产不得存在** |
| 13 | `partner/companies.html:54` | 「找企业」列表与详情 | Kiosk P15 说明 |
| 14 | `partner/policy.html:24` | 「政策服务」页 | Kiosk P21 说明 |
| 15 | `partner/smart-campus.html:26` | 「智慧校园」页 | Kiosk P19 说明 |
| 16 | `partner/stats.html:124` | 查看完整排行 → | 完整排行视图（端点不存在） |

**处置口径（三选一，逐条裁决，不得统一「先留着」）：**
- 目标路由真实存在（#3 #5 #11）→ 填真实路由
- 目标是 Kiosk 前台说明（#2 #4 #6 #7 #8 #9 #13 #14 #15）→ **改为非交互文本**，不做跨端跳转
- 目标是跨后台或不存在的能力（#1 #10 #12 #16）→ 改为**可聚焦 disabled + 明文原因**，或整体移除

### 4.2 `javascript:void(0)` —— 3 个静态 + 1 个模板（运行时 260 次）

静态 3 个都在 `index.html:150/156/162`（权限管理、计费与对账、数据接入通道的占位卡）。

**真正的风险源是 `scripts/shell.js:91`**：`const href = it.href || 'javascript:void(0)'`。ADMIN_NAV 33 项中 **20 项没有 href**，因此**每打开一个 Admin 原型页就渲染 20 个 `javascript:void(0)`，13 个 Admin 页合计 260 次**。PARTNER_NAV 12 项全部有 href，Partner 侧为 0。

**生产禁止策略（写死）：**
1. `javascript:void(0)` 与 `href="#"` **一律不得出现在生产构建产物中**，加 CI 静态检查（可参照 `apps/admin/scripts/verify-honest-placeholders.mjs` 形态新增 `verify-no-dead-links.mjs`，本次不实现）
2. 侧栏项一律使用真实 `NavLink to=...`；能力未开放的项用**可聚焦 disabled + 明文原因**表达，不用死链
3. 前端隐藏只是体验层，**深链必须服务端 fail-closed**

### 4.3 另外四处必须一起消除的链接缺陷

| 位置 | 问题 |
|---|---|
| `admin/companies.html:40` | 文案「合作机构后台 · 企业资料管理」→ 链接 `../partner/jobs.html`（目标错 + 跨后台） |
| `partner/fairs.html:26` | 文案「四链数据关联总账」→ 链接 `../index.html`（真实文档是 `docs/reviews/four-chain-data-integrity-ledger-2026-08.md`） |
| `admin/orders.html` | 链接指向 `../../../product/miniapp-console-sharing-2026-08.md`（**生产不得把仓库文档路径暴露给后台用户**） |
| `partner/companies.html` | `../admin/companies.html`（机构后台链到管理员后台） |

---

## 5. 单列：常驻「机构助手」在真实只读查询与权限裁剪完成前不得进入生产

### 5.1 实测事实

- 由 `shell.js:171` 的 `if (!isAdmin) mountAssistant(...)` 挂载，**只在 12 个 Partner 页出现**
- 答案来源是 `shell.js:258` 起的 `ASSIST_ANSWERS` —— 一个**以问题原文为 key 的硬编码字典**，逻辑是 `ASSIST_ANSWERS[q] || ASSIST_ANSWERS.__fallback`。**没有任何网络请求、没有任何数据库访问、没有任何权限判定**
- 输入框与「发送」按钮**没有绑定任何处理器**，只有 `.asst__q` 快捷问句会触发

### 5.2 措辞与事实的冲突（逐条取证）

| 位置 | 原文措辞 | 实际 |
|---|---|---|
| `shell.js:260` | 「**帮你查了**这 6 条待确认的岗位」 | 硬编码字符串 |
| `shell.js:271` | 「这是**逐条查库的结果，不是推测**」 | 硬编码字符串 |
| `shell.js:408` | 「每一步都是**查库结果，不是推测**」 | 硬编码字符串 |
| `shell.js:233` | 「状态查询类为**系统实测数据**」 | 无任何数据源 |
| `shell.js:219` | 「我可以**帮你查本机构**的内容状态……」 | 无任何数据源 |
| `shell.js:220` | 「查不到的我会直说，不会猜」 | 命中字典即输出，未命中走 `__fallback` |
| 多处 | `<span class="ev ev--1">E1</span>` 证据徽标 | 静态 DOM，不由任何判定产生 |
| `shell.js:274/296/339/359/386/393` | 「08-10 16:22」「6,820 次」「连续 3 次 401」「30 天后到期」 | 全是写死的样例数字 |

### 5.3 冻结裁定

**在下列三件事全部完成前，机构助手不得进入生产，也不得在任何界面上声称查过数据：**

1. **真实只读查询**：每个「查」类回答必须来自真实服务端只读端点（本机构范围），刷新后可复现；命中不到必须返回真实的「查不到」
2. **权限裁剪**：`orgId` 只能取自 token（参照 `PartnerStatsController`），跨机构与他租户对象走统一不泄露策略；不得回答任何求职者个人信息或其他机构数据。**必须有跨租户与深链负向测试**
3. **工单 API**：助手答案内嵌的 6 个 command 按钮全部依赖 **Ticket 状态机**，而 main 上**没有任何 Ticket 模型**

**附带口径**：即便三项完成，「帮你查了」「逐条查库」「系统实测数据」这类措辞也只允许出现在**确实来自服务端只读查询的回答**上；操作指导类必须保留「AI 判断，仅供参考」标注。E1/E2/E3 证据徽标必须由服务端判定产生，不得作为静态装饰。

---

## 6. C0 冻结结论（只陈述事实，不宣告完成）

1. **页数**：实测 Admin 34（现状）/ 35（加 `/online-platforms`）、Partner 13、**合计 48**。`mapping.html` 的 47 是「加 online-platforms 之前的现状数」，不是目标态；47-B 需先完成 `/permissions` 的路由退役 + 旧 URL 兼容 + 4 处引用清理 + `verify-honest-placeholders.mjs` 更新。
2. **映射**：`mapping.html` 前台基线只到 P27，缺 P33–P46，「关键接口」列**至少 24 条与 main 不符（含 5 条完全虚构）**，必须整列按 §2.3 重写；`wiring-map.md` 已覆盖 P33–P46，应合并而非另起第三份表。
3. **pickup-claim 纠正**：`/print/pickup-claim` 与 `POST /print/jobs/claim-pickup` **已存在于 main（c61b7e06）**，原型/早期结论作废；但 `PrintTask.claimed` 仍只允许 Agent 写入。
4. **控件**：392 button / 79 link / 42 Tab / 4 switch / 10 disabled / **0 aria**；**346 个按钮无任何处理器**；六类归属 navigate 16 · local 104 · query 73 · command 188 · external 5 · gate 6。审计原有 378/77/40/4 已定位为 08-12 基线，两页新增后精确回归，**不推翻**。
5. **禁止项**：16 个 `href="#"` + 3 个静态 `javascript:void(0)`，加 `shell.js:91` 模板在 Admin 侧运行时产生的 **260 次 `javascript:void(0)`**，全部必须在生产中消除；另有 4 处跨后台/错目标链接一并移除。
6. **机构助手**：硬编码答案 + 「帮你查了 / 逐条查库 / 系统实测数据」措辞，在真实只读查询、权限裁剪、Ticket API 三者完成前**不得进入生产**。
7. 生产 Admin/Partner **继续使用桌面 InkPaper 设计语言，不套 Kiosk V6**；5303 原型是 mock，本地切换、静态数字、无处理器按钮不构成任何已完成能力。

---

## 7. 额外登记（不在原任务四项内，已登记未修）

1. `GET /partner/stats` 的 timezone 参数会被全局 `ValidationPipe`（`forbidNonWhitelisted: true`）拒成 400，且前端 adapter 的 `body.data` 解包与控制器裸对象返回不匹配（§2.4）
2. 25 个原型页 `aria-*` 属性数为 0（§3.6）
