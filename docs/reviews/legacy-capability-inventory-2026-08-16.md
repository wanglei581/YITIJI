# 生产能力清单 —— 整体迁 V6 会丢掉什么（2026-08-16）

> **这是能力清单，不是页面清单。** 每条记的是「用户能办成什么事」，不是「有哪个页面」。
> **核实基准：`origin/main` @ `1829a343d`**（2026-08-16，`feat(kiosk): 全站 AI 前端原语 (#618)`）。
> 全部「存在 / 缺失」结论一律用 `git show origin/main:<path>` / `git ls-tree -r origin/main <dir>` 取值。
> 本仓有 22 个 worktree，且已确认多条设计文档的「生产落点」陈旧，属系统性问题，因此**不以任何工作区检出为准**。
> 本文只盘点，**不实现任何功能，不改任何代码 / 原型 / `docs/progress/`**。

> ## ⛔ 已订正：H-1 初稿有一处事实错误
>
> 初稿把 H-1（小程序到机码核销）判为 **P0「生产上找不到任何输入口、正在静默断链」**。
> **该判断是错的** —— 生产上入口存在且可达（`/print/pickup-claim`，打印扫描页第一张卡）。
> 独立复核批次已逐条取证，协调者复验确认。**H-1 已降级为 P1，订正说明见 §三 H-1 顶部。**
>
> 失误性质：把「V6 原型没画」推成了「生产没有」。**原型不是生产**，这正是本文 §1.2 自己立的边界。
> 读本文的其它条目时请留意同类风险 —— §二 2.2 表格中的「V6 里为什么找不到」一列描述的是
> **原型现状**，不构成对生产是否具备该能力的判断；生产侧结论以 §一能力全集为准。

---

## 0. 这份清单要回答的问题

用户要把一体机前台整体换成 V6，并明确「V6 是 V6，当前项目是当前项目，不要把旧页面的东西搬进 V6 页面」。
方向没有问题，但有一个结构性风险：**V6 原型的能力集冻结在某个时间点，它不知道后来上线了什么。**

这不是推测，有实证：

| 项 | 取值 | 证据 |
|---|---|---|
| V6 原型最后一次**能力性**改动 | **2026-08-11** | `git log origin/main -- docs/design/kiosk-ai-os-v3-2026-08/`：`ee4bc267f`(08-11) 之后只有 `5cb74bc6c` / `2a4085a1f` / `4a8bd76cf`(均 08-16)，三者分别是运行时切片落库、字号下限、类型闸门，**未新增任何能力** |
| 小程序云打印「到机核销」上线 | **2026-08-12 起** | `c61b7e06f` `feat(print): wire miniapp order-only pickup flow`，其后 `3a926c97b`(08-13) / `33a8141e9`(08-14) / `39b9e3bbe`(08-14) / `215f81b2d`(08-16) 持续收口 |

**2026-08-12 之后落地的能力，V6 结构上不可能画到。** 这正是本清单的价值区间。

生产代码里已经有人手写下过这条警告：

```
apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx:55-58
// POST /print/jobs/claim-pickup。V6 原型 39-print-hub.html 尚未画出该入口
// （原型冻结于该能力上线之前），但它是真实已交付能力，合并 V6 时不得删除。
```

**全库只有这一处这样的护栏**（`grep "V6 原型|原型冻结|原型尚未"` 命中 1 个文件）。本文其余 §三 列出的缺口，今天没有任何东西拦着它们在改版时消失。

---

## 1. 口径与方法

### 1.1 「真实可用的能力」判定标准（三条必须同时满足）

1. **用户能到达** —— 有站内真实入口，不是只能手打 URL 的孤儿路由
2. **后端真的支持** —— 端点存在于 `origin/main:services/api/src`，不是前端自己编的
3. **不是占位 / 假成功** —— 不是「敬请期待」空壳页，不是没发请求就显示「已保存 / 已完成」

三条中缺任意一条的，一律进 **§四 看起来有但其实没有**，迁移时可以直接丢，不用心疼。

另设一个中间态：**条件性能力（conditional）** —— 三条都满足，但被终端配置 / 构建开关 / 外部凭证锁着，默认部署下用户到不了。这类**不能当"没有"删掉**，因为一旦运营侧打开，V6 里必须有它的位置。

### 1.2 边界

- 一条能力可能横跨多个页面；一个页面可能承载多条能力，也可能承载零条。**按能力切分，不按页面切分。**
- 描述能力时只写**用户能办成什么事**。**不写**旧页面的布局、组件、文案、按钮位置 —— 本文是给「在 V6 原型里重新设计」用的输入，不是给「把旧页面搬过去」用的。
- 合规红线（CLAUDE.md §2 / §10）：岗位与招聘会只做**第三方 / 官方来源信息入口**。「平台内投递」「平台收简历」不是能力，本文不会出现这类条目；跳转类能力一律按「跳转到来源平台 + 留下跳转记录」表述。
  > 阴性结果（可复核）：全库精确扫描 `一键投递` / `立即投递` / `企业收简历` / `候选人管理` **0 命中**；`平台投递` 的命中经负向后顾断言确认全部是白名单短语「去来源平台投递」的子串。**本次盘点未发现任何越界能力。**

### 1.3 影响面

V6（`docs/design/kiosk-ai-os-v3-2026-08/README.md:8`）自己写明范围是「27 寸 1080×1920 竖屏一体机前台」，且「本目录不改 `apps/kiosk/` 生产代码……不实现 Admin / Partner 配置项」。因此：

| 端 | 是否在「整体迁 V6」的影响面内 |
|---|---|
| `apps/kiosk`（173 个页面文件 / 105 条路由） | **是** —— 本清单主体 |
| `apps/admin`、`apps/partner` | 否 —— 走 `docs/design/console-ai-os-2026-08/` 桌面 InkPaper 语言，不套 Kiosk V6 |
| `apps/miniapp`（196 个文件） | 否 —— 但它是**到机码的签发方**，一体机侧核销入口一旦丢失，小程序这条链会断在最后一步，故必须覆盖其在一体机上的落点 |
| `services/api`（79 个控制器） | 否（不改）—— 作为「后端真的支持」的判据来源 |
| `apps/terminal-agent` | 否 —— 但 U 盘导入与扫码登录经它的本地网桥，属能力前提 |

### 1.4 已有配套调研（直接复用，本文不重做）

| 文档 | 在 main 上? | 本文如何使用 |
|---|---|---|
| `docs/reviews/ai-capability-wiring-matrix-2026-08-16.md` | 是 | AI 域后端真值的基础事实（已复核通过） |
| `docs/reviews/console-c0-fact-freeze-2026-08-16.md` §2.2 | 是 | P01–P46 ↔ 真实路由映射表，§二 的底表 |
| `docs/reviews/kiosk-control-integrity-audit-2026-08-16.md` | 是 | §四 的主要来源（705 个 onClick 审计） |
| `docs/reviews/v6-missing-pages-plan-2026-08-16.md` | **否**（只在 `4bed3d431`） | **方向相反**：那份从 V6 视角找缺口（补页），本文从生产能力视角找丢失（保能力）。重叠项已在 §三 逐条标注 |

### 1.5 V6 交付集

`pages.json` 声明 46 页（`01-home-v6` … `46-campus-service`，无 P30 文件，P11 即 P30）；`01-home.html` / `01-home-v4` / `01-home-v5` 标 `retired`，**不进交付集**。本文所有「V6 有 / 没有」的判定只对这 46 页取值。

---

## 一、能力全集

> **状态机字段取值**均取自 `services/api/prisma/schema.prisma`（应用层校验，非 Prisma enum）。
> **登录列**三档：`匿名` = 完全不需登录；`需登录`；`匿名+` = 匿名可用且登录后有额外能力。

### 1. 打印与出纸（PR）

| # | 用户能办成什么事 | 入口 → 路由 | 后端端点 | 关键状态机 | 登录 |
|---|---|---|---|---|---|
| **PR-1** | 把手上的电子文件在这台机器上打成纸，当场扫码付钱，看着它出纸 | 首页「打印扫描」大卡 → `/print-scan`；或三个快捷直达 → `/print/upload?tab=file\|qr\|usb`。链路 `/print/upload → material-check → preview → confirm → cashier → progress → done` | `POST /files/kiosk-upload`、`POST /materials/tasks`×4、`GET /materials/tasks/:id`、`POST /orders/quote`、`GET /print/price-config`、`POST /print/jobs`、`GET /payment/channels`、`POST /orders/:id/pay`、`POST /orders/:id/code-pay`、`GET /orders/:id/pay-status`、`POST /orders/:id/pay/reconcile`、`GET /print/jobs/:taskId` | `Order.payStatus` `unpaid\|paying\|paid\|refunding\|partial_refunded\|refunded\|closed\|failed`；`PrintTask.status` `pending\|claimed\|printing\|completed\|failed\|cancelled`；`Order.channel='kiosk'` | 匿名+ |
| **PR-2** | 打印前让机器把身份证号一类的敏感字段找出来，逐条决定遮不遮，遮完再打 | `/print/material-check`（PR-1 链路内，无跳过按钮） | `POST /materials/tasks`(`inspection`/`normalize_a4`/`pii_scan`/`pii_redact`)、`POST /materials/tasks/:id/pii-findings/decisions` | `DocumentProcessTask.kind` 五值 / `.status` `pending\|processing\|completed\|failed\|cancelled` | 匿名 |
| **PR-3** | 金额为 0 的单子不进收银台，直接出纸 | `/print/confirm` 报价返回 0 时自动分支 | 同 PR-1 的 quote + `POST /print/jobs` | `Order.paymentSource='free'`，服务端置 `paid` 并签发 `pickupCode` | 匿名 |
| **PR-4** | 付款成功后拿到一串取件凭证码，出纸口出问题时凭它找工作人员核验或补打 | `/print/done`；`/me/print-orders` 单条详情 | `GET /orders/:id/pay-status`（服务端 `pickupCodeVisibleFor` 判定可见性）、`GET /me/print-orders` | `Order.pickupCode`（10 位，字符集 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`，`order-status.service.ts:14-22`） | 匿名+ |
| **PR-5** | **拿小程序给的 10 位到机码（或扫它的二维码），在机器上核销这笔云打印订单，付款后出纸** | `/print-scan` **首张卡片**「扫码或输入取件码」 → `/print/pickup-claim` →（已付）`/print/progress` /（未付）`/print/cashier` | `POST /print/jobs/claim-pickup`（Throttle 20/min，带 `x-terminal-id`）、`POST /print/jobs/:orderId/release`、`GET /orders/:id/pay-status` | `Order.pickupStatus` `none\|pending\|claimed\|used\|expired\|cancelled`；`pickupCodeHash`(唯一) / `pickupCodeEnc` / `pickupCodeExpiresAt`；`Order.channel='miniapp_cloud'`；释放前 `printTaskId` 恒 null | 匿名（但要求终端已配 `terminalId`） |
| **PR-6** | 用自己手机把文件传到这台机器上（机器出码、手机上传、机器上确认） | `/print/upload?tab=qr`；`/print-scan/convert`、`/print-scan/sign` 侧栏。手机侧 `/upload/phone`（**豁免终端超时**） | `POST /upload-sessions`、`POST /upload-sessions/:id/files`、`GET /upload-sessions/:id`、`POST /upload-sessions/:id/confirm`、`DELETE /upload-sessions/:id` | `UploadSession.status` `pending\|uploaded\|confirmed\|cancelled\|expired`；`mode` `member\|temporary` | 匿名+ |
| **PR-7** | 插 U 盘挑一份文件打印（**条件性**：需构建期注入 Agent 网桥令牌） | `/print/upload?tab=usb` | **不经 `services/api`**：Terminal Agent 本地网桥 `GET /local/usb/status`、`GET /local/usb/files`、`POST /local/usb/upload` | 文件入链后与 PR-1 一致 | 匿名 |
| **PR-8** | 查自己历次打印订单、金额、支付状态与取件码 | `/print-scan` 快捷「打印订单」；「我的」；`/print/done`；首页「继续上次」 → `/me/print-orders` | `GET /me/print-orders` | `PrintTask.status` 六态；`payStatus` 缺失时显示「暂无支付信息」，不推断 | 需登录 |
| **PR-9** | 就打印 / 扫描出的问题提一张带任务号的工单 | `/print/done`、`/me/print-orders`、`/print-scan` → `/me/feedback?category=print&relatedPrintTaskId=` | `POST /me/feedback` 等（见 ME-9） | `FeedbackTicket.relatedPrintTaskId` | 需登录 |

> **PR-4 与 PR-5 是两套不同的码，不能合并。** 两者都是 10 位、同一字符集，但语义相反：PR-4 的码在**付款之后**签发，用途是**人工核验 / 补打**，机器上没有自助核销面；PR-5 的码在**下单之后、付款之前**由小程序签发，用途是**在机器上自助核销并触发付款出纸**。

### 2. 扫描（SC）

| # | 用户能办成什么事 | 入口 → 路由 | 后端端点 | 关键状态机 | 登录 |
|---|---|---|---|---|---|
| **SC-1** | 把纸质材料（简历 / 证件 / 普通文档）扫成 PDF | 首页「纸质扫描」；`/print-scan`「材料扫描」；`/print/upload` 内「扫描原件」；「我的」→ `/scan/start → settings → progress → result` | `GET /terminals/:terminalId/capabilities`（**硬门禁**，`unknown` 也不放行）、`POST /scan/sessions`、`GET /scan/sessions/:id`、`DELETE /scan/sessions/:id`；Agent 侧 `POST /terminals/:terminalId/scan-sessions/deliver` | `ScanTask.status` `waiting→matched→completed`，旁支 `expired\|cancelled\|failed`；`FileObject.purpose` 由 scanType 决定 `resume_scan\|id_scan\|print_doc` | 匿名+ |
| **SC-2** | 刚扫好的 PDF 直接拿去打印 | `/scan/result`「直接打印」→ **直跳 `/print/confirm`** | 复用 PR-1 的 quote → jobs → 支付 → 轮询 | 预置 `copies:1, duplex:single, color:bw` | 匿名 |

### 3. 文件加工（FT）

| # | 用户能办成什么事 | 入口 → 路由 | 后端端点 | 关键状态机 | 登录 |
|---|---|---|---|---|---|
| **FT-1** | 把多张照片合并成一份 PDF 再打印 | 首页「文件加工」；`/print-scan`「格式转换」→ `/print-scan/convert` → `/print/confirm` | `POST /files/kiosk-upload`×N、`POST /print/convert/images-to-pdf`（带 `Idempotency-Key`） | 结果 `FileObject.purpose='print_doc'`、`assetCategory='derived'`；上限 20 张 / 单张 10MB | 匿名+ |
| **FT-2** | 在 PDF 上叠加签名或印章图片再打印（版式合成，非 CA 电子签） | `/print-scan`「签名盖章」；「我的文档」条目动作 → `/print-scan/sign` → `/print/confirm` | `POST /files/kiosk-upload`（文档 `print_doc` / 印章 `signature_image`）、`POST /print/sign/inspect`、`POST /print/sign/compose` | 授权勾选与后端 `AUTHORIZATION_NOTICE_VERSION` 绑定；印章 mime 白名单 | 匿名+ |
| **FT-3** | 管理本人文档：预览、再打印、送去签章、改保存期限、删除 | `/print-scan` 快捷；「我的」；`/scan/result`（登录态） → `/me/documents` | `GET /me/documents`、`GET /files/:id/preview-url`、`PATCH /files/:id/retention`、`DELETE /files/:id` | `FileObject.status` `uploading\|active\|quarantined\|deleted`；`retentionPolicy` `months_3\|months_6\|long_term\|system_short`（`system_short` 不可选）；6 个月 / 长期需 `consentVersion` | 需登录 |

### 4. AI 简历（RS）

| # | 用户能办成什么事 | 入口 → 路由 | 后端端点 | 关键状态机 / 产出物去向 | 登录 |
|---|---|---|---|---|---|
| **RS-1** | 传一份简历，当场拿到六维评分诊断报告 | 首页「诊断优化」→ `/resume/source?intent=diagnose` → `/resume/parse` → `/resume/report` | `POST /resume/parse`、`GET /resume/records/:taskId` | `AiResumeResult.kind='parse'`、`status` `pending\|processing\|completed\|failed`；匿名铸 `accessTokenHash` + `expiresAt`。→ 进「我的简历」「AI服务记录」 | 匿名+ |
| **RS-2** | 拿到防编造的优化版简历，导出 PDF/Word/TXT/MD 并当场打印 | `/resume/report`、`/resume/career-plan`、`/resume/job-fit`、`/me/resumes` → `/resume/optimize` → `/print/confirm` | `GET /resume/records/:taskId/optimize`、`POST /resume/records/:taskId/layout-adjust`、`POST /resume/generate/export` | `kind='optimize'`（与 parse 共用 taskId，`@@unique([taskId,kind])`）。→ `FileObject{purpose:'resume_upload', assetCategory:'optimized'}`，登录用户进「我的文档」 | 匿名+ |
| **RS-3** | 挑一个版式模板并调整排版后再导出 | `/resume/optimize` 页内 | `GET /job-materials/templates`、`POST .../layout-adjust`、`POST /resume/generate/export`（带 `templateId`+`layout`） | 非法 `templateId` 400 `AI_RESUME_TEMPLATE_UNSUPPORTED`；**可选简历模板目前只有 1 个** | 匿名 |
| **RS-4** | 没有电子简历时，引导式填写 → AI 生成 → 导出 → 打印 | 首页「访谈式生成」；`/resume/source` 页内 → `/resume/generate` → `/generate/preview` → `/print/confirm` | `POST /resume/generate`、`GET /resume/generate/:taskId`、`POST /resume/generate/export` | `kind='generate'`；跳过的字段进 `missingHints` 不补 | 匿名 |
| **RS-5** | 用语音口述来填简历字段（**条件性**：默认关闭） | `/resume/generate` 表单内 7 处 | `POST /resume/voice/transcribe` | 转写文本先给用户确认 / 编辑再回填；`ASR_PROVIDER` 未配凭证时 `enabled=false`，返回 `ASR_NOT_CONFIGURED`，**不伪造文本** | 匿名 |
| **RS-6** | 把简历和一个目标岗位对齐，拿到匹配等级 + 差距清单，并打印 | 首页「岗位匹配」；`/resume/report`、`/resume/career-plan`、`/jobs-service`、`/me/resumes` → `/resume/job-fit` → `/print/confirm` | `POST /resume/job-fit`、`GET /:taskId`、`POST /resume/job-fit/consent`、`GET\|DELETE /consent/:taskId`、`POST /:taskId/print` | `kind='job_fit'`；匿名授权三列 `jobAiConsentVersion/GrantedAt/RevokedAt` 挂在 parse 行、随 TTL 清 | 匿名+（需页内显式授权） |
| **RS-7** | 基于简历拿到职业方向建议并打印 | 首页「职业规划」；`/resume-service`、`/interview-service` → `/resume/career-plan` → `/print/confirm` | `POST\|GET /resume/career-plan/:taskId`、`POST /:taskId/print` | `kind='career_plan'`；生成时读取 `job_fit` 与 `self_assessment` 作上下文 | 匿名 |
| **RS-8** | 做一次 25 题自我探索，拿 5 维倾向解读与 PDF，可随时撤回并物理删除 | `/resume-service`、`/interview-service`、`/resume/report`、`/resume/career-plan`、`/assistant` → `/resume/self-assessment/intro → questions → result` | `POST /resume/self-assessment`、`GET /:taskId`、`POST /:taskId/print`、`DELETE /:taskId` | `kind='self_assessment'`；打分是纯函数不依赖 LLM，LLM 挂时如实显示「维度解读未生成」。产出 `FileObject{purpose:'self_assessment_report'}` | 匿名+ |
| **RS-9** | **把自我探索结果附在简历后面一起打出来（服务端合并成一份新文件）** | `/print/confirm` 勾选「附加自我探索」 | `POST /resume/self-assessment/:taskId/append` | 全站**唯一**的跨能力产物合并链 | 匿名 |
| **RS-10** | 生成求职信 / 感谢信 / 作品集封面 / 招聘会材料清单 PDF 并打印 | 首页「材料工厂」；`/resume-service` → `/resume/materials` → `/print/confirm` | `GET /job-materials/templates`、`POST /job-materials/generate` | 6 个 published 模板（**代码常量非 DB**）；产出 `FileObject{purpose:'cover_letter'}` → 进「我的文档」 | 需登录 |
| **RS-11** | 浏览简历版式参考 | `/resume-service`、「我的」 → `/resume/templates` | `GET /job-materials/templates` | 只能看，不产出文件；唯一 CTA 回 `/resume/source` | 匿名 |
| **RS-12** | 看自己的简历档案，并从中回到报告 / 优化 / 匹配 | 「我的」 → `/me/resumes` | `GET /me/resumes`（只返回 `parse\|generate`） | 后端有 `DELETE /me/resumes/:id`，**kiosk 未接** | 需登录 |
| **RS-13** | 看并删除自己历次 AI 调用记录（含岗位 AI 会话） | 「我的」 → `/me/ai-records` | `GET\|DELETE /me/ai-records/:id`、`GET\|DELETE /me/job-ai-sessions/:id` | 返回 6 类 kind；删 `parse` 会级联删同 taskId 全部派生结果 | 需登录 |

### 5. 面试与助手（IV / AS）

| # | 用户能办成什么事 | 入口 → 路由 | 后端端点 | 关键状态机 | 登录 |
|---|---|---|---|---|---|
| **IV-1** | 做一场 AI 模拟面试（文字），拿结构化报告并打印 | 首页「面试」→ `/interview-service` → `/interview/setup → session → report` → `/print/confirm` | `POST /mock-interviews`、`POST /:id/start`、`/answer`、`/end`、`GET /:id/report`、`POST /:id/report/print` | `MockInterviewSession.status` `configured\|in_progress\|completed\|aborted`；`interviewerType` 5 值；`difficulty` `easy\|standard\|pressure`；`durationMin` `3\|5\|8`；`MockInterviewTurn.qType` 8 值 | 匿名（可选传 `resumeFileId`） |
| **IV-2** | 语音作答 + 面试官语音提问（**条件性**：默认关闭，三级降级） | `/interview/session` 自动探测 | `GET /mock-interviews/capabilities/voice`、`POST /:id/transcribe`、`POST /:id/turns/:idx/audio` | 转写后进 review 态让用户改文本再提交，带 `inputMode='voice'`、`transcriptEdited`；ASR/TTS 缺凭证时静默降级文字 | 匿名 |
| **IV-3** | 查看并删除自己的往期面试报告 | `/interview-service` → `/interview/reports` | `GET /me/mock-interviews`、`DELETE /me/mock-interviews/:id` | 未登录给登录引导，不显示假列表 | 需登录 |
| **IV-4** | 看面试技巧参考 | `/interview-service` → `/interview/tips` | **无**（纯静态内容） | — | 匿名 |
| **AS-1** | 和 AI 助手小青文字对话，并被引导到站内真实页面 | 首页助手入口 / 各服务中心 → `/assistant` | `POST /assistant/chat` | 回复里的跳转动作按白名单前缀过滤，只允许站内真实路由 | 匿名 |
| **AS-2** | 和数字人顾问语音通话（**条件性**：`VITE_USE_TRTC_CALL` 默认 false，关闭时整块 UI 不渲染且 SDK 被剔除） | `/assistant` 页内 | `POST /trtc/session`、`POST /trtc/session/stop` | 后端真签 `userSig`；`X-Terminal-Id` 必填、start 限流 5/min、taskId 归属落 Redis | 匿名 |
| **AS-3** | 上传合同 / Offer 拿风险提示报告（**条件性**：`VITE_ENABLE_CONTRACT_REVIEW` 默认 false，关闭时入口不渲染、路由重定向首页） | `/resume-service` → `/contract-review{,/processing,/result}` | `POST /contract-reviews`、`GET /consent-scope`、`GET /:id`、`POST /:id/confirm`、`POST /:id/report`、`DELETE` | `ContractReviewTask.status` 11 态；缺 Redis 或 API key 时 fail-closed 不进模型；报告打印另有第二道开关 | 匿名 |

### 6. 岗位 / 企业 / 线下机构（JB）

| # | 用户能办成什么事 | 入口 → 路由 | 后端端点 | 关键状态机 | 登录 |
|---|---|---|---|---|---|
| **JB-1** | 按关键词 / 城市 / 分类 / 来源机构筛选并浏览第三方来源岗位 | 首页「岗位信息」→ `/jobs-service` → `/jobs` | `GET /jobs` | `Job.reviewStatus='approved'` + `publishStatus='published'` 硬过滤；排序 `syncTime desc`；`category` `fulltime\|intern\|campus\|parttime`；`@@unique([sourceOrgId, externalId])` | 匿名 |
| **JB-2** | 看单个岗位详情（含来源机构、外部编号、同步时间），并留下浏览记录 | `/jobs` 卡片、`/companies/:id` → `/jobs/:id` | `GET /jobs/:id`、`POST /activity/browse` | `BrowseLog` 仅在服务端反查「已审核+已发布」后才落库 | 匿名+（记录需登录） |
| **JB-3** | 扫码或打开来源平台去投递，并在本人账号下留一条跳转记录 | `/jobs/:id` 底部 | `POST /activity/external-jump` | `ExternalJumpLog.action='external_apply'`；`targetTitle/sourceName/sourceUrl/externalId` **服务端补齐，前端伪造不了**；`expiresAt` TTL 默认 30 天 | 匿名+（记录需登录） |
| **JB-4** | 收藏岗位 / 招聘会 / 政策（匿名存本机，登录存账号） | `/jobs`、`/jobs/:id`、`/job-fairs`、`/renshi` | `GET\|POST /me/favorites`、`DELETE /me/favorites/:targetType/:targetId` | `targetType` 白名单只有 `job\|job_fair\|policy`；`@@unique([endUserId, targetType, targetId])` | 匿名+ |
| **JB-5** | 让 AI 按简历收敛岗位列表 / 解读某个岗位 / 算单岗匹配 | `/jobs`、`/jobs/:id` | `POST /jobs/ai/recommendations`、`POST /jobs/:id/ai/explain`、`POST /jobs/:id/ai/match` | 需 `UserAiConsent.scope='job_ai'`；`JobAiRecommendation.fitLevel` `reference_high\|medium\|low`；mock 模式硬拒 `JOB_AI_MOCK_DISABLED` | **需登录 + 需授权 + 需已诊断简历** |
| **JB-6** | 扫码前往 4 家外部招聘平台首页 | `/jobs-service` → `/jobs/online-platforms` | **无**（4 条前端硬编码常量；不落 `ExternalJumpLog`） | `OnlinePlatformDirectory` 表 + 完整状态机存在，但 Kiosk 侧 0 端点，只有 admin 只读 API | 匿名 |
| **JB-7** | 按行政区划 / 企业类型 / 行业筛选企业，看到跟随筛选的真实统计 | `/jobs-service`「找企业」、`/jobs` 页内 → `/companies` | `GET /companies`（真游标分页）、`GET /companies/stats` | `CompanyProfile` 双 published；`companyCount/openJobCount/todayNewJobCount/fairCompanyCount` 全是真实 Prisma 聚合 | 匿名 |
| **JB-8** | 看企业详情（指标逐项受后台开关控制），翻它的在招岗位，扫码去来源平台 | `/companies` → `/companies/:id` | `GET /companies/:id`、`GET /companies/:id/jobs`、`POST /activity/browse`、`POST /activity/external-jump` | `showOpenJobCount/showCity/showEmployeeScale/showBoothNo`（后者默认 false）；**开关关或数据空则整条不显示，不补零** | 匿名+ |
| **JB-9** | 搜索并翻页浏览已审核发布的线下人力资源机构门店 | `/jobs-service`、`/jobs` 筛选条 → `/offline-agencies` | `GET /kiosk/offline-agencies`（**真服务端分页**） | `OfflineAgency` `reviewStatus='approved'` + `publishStatus='published'` + `status='active'` 三重过滤 | 匿名 |
| **JB-10** | 看机构详情与其在招岗位，进单个线下岗位看到店办理指引 | `/offline-agencies` → `/offline-agencies/:id` → `/jobs/:id/offline` | `GET /kiosk/offline-agencies/:id`、`GET /kiosk/offline-jobs/:id` | `OfflineJob.status='active'`；服务端刻意不宣称门店实时营业状态 | 匿名（**不落任何记录**） |

### 7. 招聘会（FR）

| # | 用户能办成什么事 | 入口 → 路由 | 后端端点 | 关键状态机 | 登录 |
|---|---|---|---|---|---|
| **FR-1** | 按状态 / 地区 / 日期筛选招聘会场次；终端绑定学校时优先看到本校场次 | 首页「招聘会」→ `/fairs-service` → `/job-fairs`；首页页脚「最近一场」 | `GET /job-fairs?terminalId=` | 双 published；`theme` `general\|campus\|campus_corp\|industry`；`resolveCampusPreferredOrgId` 要求 `Organization.type='school_employment_center'` | 匿名 |
| **FR-2** | 扫码去来源平台预约招聘会 | `/job-fairs` 卡片、`/job-fairs/:id` | `POST /activity/external-jump` | `action='external_appointment'`；`JobFair.sourceUrl` 必填 | 匿名+ |
| **FR-3** | **扫码去来源平台完成现场签到（本系统不记录签到结果）** | `/fairs-service`「扫码签到」→ `/job-fairs/checkin` | `GET /job-fairs` + `POST /activity/external-jump` | `action='external_checkin_open'`；`JobFair.checkinUrl` 为空时服务端**拒绝记录** | 匿名+ |
| **FR-4** | 看招聘会详情（参展企业 / 展区 / 统计 / 场馆导览四个 Tab） | `/job-fairs` → `/job-fairs/:id` | `GET /job-fairs/:id`、`/companies`、`/zones`、`/stats`、`/venue-guide`、`POST /activity/browse` | 未配置导览时返回 `data:null` → 前端空态 | 匿名+ |
| **FR-5** | 浏览 / 搜索参展企业名录并按展区筛选，看企业详情、扫码去来源平台投递 | `/job-fairs/:id` → `/companies` → `/companies/:companyId` | `GET /job-fairs/:id/companies[/:companyId]`、`POST /activity/external-jump` | `action='external_apply'`，`targetType='fair_company'`，`externalId` 存父级 fairId 以支持回跳 | 匿名+ |
| **FR-6** | 把某家参展企业的资料 / 岗位清单打成纸 | `/job-fairs/:id/companies/:companyId` | `POST /job-fairs/:id/companies/:companyId/print-url?variant=profile\|positions` → `/print/preview` | 服务端 pdfkit 实时渲染 → 标准 `FileObject`（TTL 1h）→ HMAC 签名 URL；最多 60 个岗位 | 匿名 |
| **FR-7** | 把招聘会活动资料（日程 / 展位图 / 名录）打成纸 | `/job-fairs/:id` →「活动资料」→ `/job-fairs/:id/materials` | `GET /job-fairs/:id/materials`、`POST /:materialId/print-url`、`GET /job-fairs/materials/:materialId/content`（HMAC） | `FairMaterial.publishStatus='published'` + `allowPrint`；桥接表 `FairMaterialPrintBridge.status` `creating\|ready\|failed` + 租约 + sha256 校验 | 匿名 |
| **FR-8** | **用本人简历生成一份招聘会参会准备单并打印** | `/job-fairs/:id` →「AI参会准备单」→ `/job-fairs/:id/visit-plan` → `/print/confirm` | `POST\|GET /job-fairs/:fairId/visit-plan/:taskId`、`POST /:taskId/print` | `kind='fair_visit_plan'`；身份取登录 `endUserId` 或 `x-resume-access-token`；失败时诚实显示 `failReason` | 匿名（需先有已诊断简历） |
| **FR-9** | 看招聘会现场规模（参展企业数 / 岗位数 / 计划招聘人数 / 行业分布） | `/job-fairs/:id` →「现场数据」→ `/job-fairs/:id/stats` | `GET /job-fairs/:id/stats` | `isMockData` 恒 false；`dataSourceLabel='主办方录入数据 · 非实时'`；**只有 4 个字段是真的**，签到 / 浏览 / 扫码 / 打印计数恒 null 走诚实空态 | 匿名 |
| **FR-10** | 看展区分布（场馆导览图） | `/job-fairs/:id` →「展位导览」→ `/job-fairs/:id/map` | `GET /job-fairs/:id/map` | `FairZone.category != 'innovation'`；**`booths` 恒 `[]`**，展位交互路径永不触发 | 匿名 |
| **FR-11** | 在一场校园主题招聘会内浏览参展企业、导览图并扫码预约 | `/fairs-service`「校园招聘会」→ `/campus` | 同 FR-4/FR-5 各端点 | 选场是**前端启发式打分**，只渲染得分最高的一场 | 匿名+ |

### 8. 政策（PL）

| # | 用户能办成什么事 | 入口 → 路由 | 后端端点 | 关键状态机 | 登录 |
|---|---|---|---|---|---|
| **PL-1** | 按人群身份筛选并阅读政策指引（条件 / 材料 / 办理路径），扫码打开来源链接 | 首页「政策服务」→ `/policy-service` → `/renshi?tab=policy`；「我的」；帮助中心 | `GET /policies`、`POST /activity/browse`、`POST /activity/external-jump`(`external_open`) | `PolicyPost` 双 published；`kind` `policy_guide\|notice`；`audience` `graduate\|flexible\|migrant\|startup\|hardship`；`sourceOrgId` 必填 | 匿名+ |
| **PL-2** | 阅读政策公告 | `/renshi?tab=notice` | `GET /policies`（前端按 kind 过滤） | `kind='notice'`、`publishedDate` | 匿名 |

### 9. 校园 / 智慧校园 / 百宝箱（CP）

| # | 用户能办成什么事 | 入口 → 路由 | 后端端点 | 关键状态机 | 登录 |
|---|---|---|---|---|---|
| **CP-1** | （**条件性**）看迎新指引 / 校园自助服务办理说明 / 后台上架的校园应用磁贴 | 首页「智慧校园」→ `/smart-campus[/welcome\|/service/:key]` | `GET /terminals/:terminalId/config`；启动外链时 `POST /terminals/:terminalId/toolbox-events` | `TerminalSmartCampusConfig.enabled` **默认 false**；`SmartCampusModules{welcome,bigdata,luggage,panorama}` 默认全 false，`bigdata` 被服务端强制冻结；**四层 fail-closed 门禁** | 匿名 |
| **CP-2** | （**条件性**）打开运营方审核上架的扩展服务（站内路由 / 外部 H5 离场确认 / 扫码取用） | 首页「百宝箱」→ `/toolbox` | `GET /terminals/:terminalId/config`、`POST /terminals/:terminalId/toolbox-events` | `TerminalToolboxConfig.enabled` 默认 true，但前端另加 `config.items.some(isLaunchableKioskAppItem)`；`launchMode` `internal_route\|external_url\|qr_code\|mini_program_qr` | 匿名 |

### 10. 我的 / 账号 / 权益 / 隐私（ME）

| # | 用户能办成什么事 | 入口 → 路由 | 后端端点 | 关键状态机 | 登录 |
|---|---|---|---|---|---|
| **ME-1** | 用手机号 + 短信验证码登录本机（未注册号验证后自动建号） | 任意页「我的」→ `/profile`；任何 `/me/*` 的登录引导 → `/login` | `POST /member/auth/sms-code`、`POST /member/auth/login`、`GET /kiosk/legal/:type`（取协议版本号一起提交） | `MemberLegalConsent.termsVersion/privacyVersion/...DocVersionId/source='sms_login'`；后端 `assertConsentMatches` 校验版本；token 只进内存，刷新即回游客态 | — |
| **ME-2** | **用自己手机扫一体机二维码，在手机上验证后让一体机登录（手机号不在公共屏幕上输入）** | `/login`「扫码登录」Tab；手机侧 `/member/qr-login?ticketId=` | 一体机侧经 Terminal Agent 代理 `POST /local/qr-login/create`、`/claim`（claimToken 不落浏览器）+ 直连 `GET /member/auth/qr/:ticketId/status`；手机侧 `POST /member/auth/qr/:ticketId/confirm` | 票据 `status` `pending\|confirmed`（Redis）；`MemberLegalConsent.source='qr_login'` | — |
| **ME-3** | 退出登录 / 切换账号，把本机会话清干净不串号 | `/me/settings`；`/profile` 头部 | `POST /member/auth/logout` | `clearKioskSensitiveSession()` + logout + 写 privacy boundary + 截断前进栈 + 硬重载 | 需登录 |
| **ME-4** | **换绑手机号（旧号验证 + 新号验证，换绑后旧会话全部踢下线）** | `/me/settings` | `POST /member/auth/step-up/sms-code`(`phone_rebind`) → `POST /member/auth/step-up/verify` → `POST /member/auth/sms-code` → `POST /member/phone/rebind` | step-up challenge/grant 为 Redis 态；返回 `sessionsRevoked` | 需登录 |
| **ME-5** | **撤回岗位 AI 授权（撤回后再用岗位 AI 必须重新确认）** | `/me/settings`「隐私与 AI 授权管理」 | `GET /me/ai-consents/status`、`POST /me/ai-consents/job_ai/revoke` | `UserAiConsent.scope/grantedAt/revokedAt/consentVersion`；后端 `requireActiveConsent` 是**硬门禁**，未授权直接 403 `USER_AI_CONSENT_REQUIRED` | 需登录 |
| **ME-6** | **提交一份正式的数据权利请求（撤回授权）并看到请求记录与处理状态** | `/me/settings` → `/me/privacy-requests` | `GET\|POST /me/data-requests` | `UserDataRequest.requestType/status/handledAt/auditRef/idempotencyKey/executionStep/...`；同一事务里撤回 + 建 `completed` 行 + 写 AuditLog | 需登录 |
| **ME-7** | 浏览正式权益活动并领取一份权益到自己账户 | 「我的」→ 权益活动；`/me/benefits` → `/activities[/:id]` | `GET /activities`、`GET /activities/:id`、`POST /activities/:id/claim` | `BenefitActivity.status` `draft\|published\|ended` + `stockRemaining` CAS 扣减；`BenefitClaim @@unique([activityId,endUserId])`；产出 `BenefitGrant.benefitType` `coupon\|free_quota\|package_entitlement\|subsidy_eligibility_hint`、`status` `active\|used_up\|expired\|revoked` | 浏览匿名 / 领取需登录 |
| **ME-8** | 看自己已有权益的类型、余量与有效期；在打印确认页看到本单可用 / 不可用权益以及为什么现在不能抵扣 | 「我的」→ `/me/benefits`；`/print/confirm` | `GET /me/benefits` | 六态判定，每条对应服务端一个真实拒绝分支；**核销 CTA 恒 `aria-disabled` 且不绑任何端点**（刻意，防资损） | 需登录 |
| **ME-9** | 提交本人服务反馈、追加回复、关闭工单 | 「我的」→ 意见反馈；`/print/done`(3 处)；`/me/print-orders`；`/print-scan` → `/me/feedback` | `GET\|POST /me/feedback`、`GET /:id`、`POST /:id/replies`、`PATCH /:id/close` | `FeedbackTicket.submitterType` `member\|anonymous_kiosk`；`category` `device\|print\|file_process\|general`；`status` `pending\|processing\|replied\|closed`；`FeedbackReply.senderType` `user\|admin\|system` | 需登录 |
| **ME-10** | 看本人消息（个人通知 + 系统公告合流），标已读 / 全部已读 / 删除 | 「我的」→ 消息通知；`/profile` 铃铛 → `/me/notifications` | `GET /me/notifications`、`PATCH /read-all`、`PATCH /:kind/:id/read`、`DELETE /:kind/:id` | `MemberNotification.category` `system\|print\|ai\|feedback`、`relatedType` 三值；`SystemBroadcast` + `BroadcastReadState`；API 层 `kind` `personal\|broadcast` | 需登录 |
| **ME-11** | 看本人浏览记录与外部跳转记录 | 「我的」→ 招聘会与活动；`/jobs-service`、`/fairs-service`、`/policy-service` 入口卡 → `/me/activity` | `GET /me/browse-logs`、`GET /me/external-jump-logs` | 匿名上报返回 `{recorded:false, reason:'LOGIN_REQUIRED'}`，**不落影子记录**；`expiresAt` TTL 物理清理 | 需登录 |
| **ME-12** | 看已脱敏手机号、公共终端会话说明与全站文件留存口径，直达用户协议 / 隐私政策全文 | 「我的」→ `/me/settings`；`/legal/:doc` | `GET /kiosk/legal/:type` | `LegalDocVersion` | 部分需登录 |

### 11. 系统 / 会话 / 设备（SY）

| # | 用户能办成什么事 | 入口 → 路由 | 后端端点 | 关键状态机 | 登录 |
|---|---|---|---|---|---|
| **SY-1** | 无人操作时机器进待机宣传屏，任意触碰唤醒且不残留上一位用户痕迹 | idle 触发 → `/session-timeout` → `/screensaver` | `GET /terminals/:terminalId/screensaver` | `TerminalScreensaverConfig` + `AdPlaylist/AdPlaylistItem/AdAsset`；素材按 sha256 预缓存，断网走缓存；**忙碌态豁免真实**（引用计数锁，打印 / 扫描 / AI / 上传中不触发） | 匿名 |
| **SY-2** | 会话超时前收到倒计时预警，可点「继续使用」保住当前页面 | 自动 → `/session-timeout` | **无**（纯前端 `KioskPrivacyGuard` + `useIdleLogout`） | 硬隐私截止（默认 300s）**不受 busy 豁免**，与 idle 分层 | 匿名 |
| **SY-3** | 在任意页顶栏看到本机打印机与网络的真实状态 | 所有 `KioskRoot` 路由共享顶栏；`/print/preview` 用它做打印门控 | `GET /terminals/:terminalId/printer-status`（公开只读） | `isOnline`（后端算的 5 分钟心跳窗）+ `printerStatus` `ready\|low_paper\|paper_empty\|error\|offline`；**default 分支返回「状态未知」而非在线**；耗材 `tonerKnown=false` 恒假，绝不谎报 | 匿名 |
| **SY-4** | 登录后在首页看到「继续上次」并跳回未完成的打印任务或待优化简历 | 首页 `ContinuePanel` | `GET /me/print-orders`、`GET /me/resumes` | 无进行中任务时整块不渲染 | 需登录 |
| **SY-5** | 在帮助中心查 13 条常见问题并跳到对应功能 | 「我的」；`/print/done`(3 处)；`/scan/start`；`/error-offline` → `/help` | **无**（硬编码 FAQ 常量 + 8 分类过滤） | — | 匿名 |
| **SY-6** | 全站看到 AI 结论的证据分级与免责标注（E1 你的材料 / E2 来源信息 / E3 AI 判断 · 仅供参考），AI 生成的打印件带 AIGC 标识 | 全站共享原语 `apps/kiosk/src/ai/` | 由各 AI 端点的 `providerLabel` 派生 | `EvidenceLevel` `E1\|E2\|E3`；`FORBIDDEN_E3_CLAIM_PATTERNS` 禁百分比 / 录用概率；徽章字号下限 13px | 匿名 |

**合计：真实可用能力 63 条**（含 6 条条件性：PR-7、RS-5、IV-2、AS-2、AS-3、CP-1/CP-2）。

---

## 二、能力 × V6 对照

> 底表用 `console-c0-fact-freeze-2026-08-16.md` §2.2 的 P01–P46 ↔ 路由映射，再逐条到 V6 的 46 个交付页里核实**该动作是否真的画了**。
> 路由被 V6 覆盖 ≠ 能力被覆盖 —— 这是本节和 c0 那张表的区别。

### 2.1 已覆盖（迁移时直接在 V6 页上重新设计即可）

| 能力 | V6 归宿 |
|---|---|
| PR-1 上传→报价→支付→出纸 | **P39**（域首屏）+ **P06** s1–s7 |
| PR-2 体检与隐私遮挡 | **P06**（`字体内嵌` / `涂黑` 均在稿内） |
| PR-3 0 元单直通 | **P06**（`免费单` 在稿内） |
| PR-4 付款后取件凭证码 | **P06 s7** |
| PR-6 手机接力上传 | **P05** + **P06** `?stage=s1&source=qr` |
| PR-7 U 盘导入 | **P06**（`src="usb"` 源卡）+ **P08** |
| PR-8 我的打印订单 | **P42** `?stage=orders` |
| PR-9 打印异常反馈提交 | **P39** `ovl-fb` 浮层 |
| SC-1 扫描成 PDF | **P07** |
| SC-2 扫描件直接打印 | **P07 → P06** |
| FT-1 图片转 PDF | **P08** |
| FT-2 签名盖章 | **P08** |
| FT-3 我的文档（含留存期） | **P42** `?stage=docs` |
| RS-1 上传→诊断报告 | **P09** s1–s3 |
| RS-2 优化→导出→打印 | **P09** s4/s5 + **P09B** |
| RS-3 模板与排版 | **P33** + **P09** |
| RS-4 访谈式生成 | **P10** |
| RS-5 语音口述填写 | **P10**（`口述`） |
| RS-6 岗位匹配 | **P11 / P30** |
| RS-7 职业规划 | **P22** |
| RS-8 自我探索 | **P28** |
| RS-10 求职材料工厂 | **P12** |
| RS-11 简历素材库 | **P33** |
| RS-12 我的简历 | **P42** `?stage=resume` |
| RS-13 AI 服务记录 | **P43** `?stage=ai` |
| IV-1 文字模拟面试 | **P20** |
| IV-2 语音面试 | **P20**（`语音作答`） |
| AS-1 助手文字对话 | **P25** + **P26** |
| AS-3 合同风险提示 | **P31** |
| JB-1/JB-2/JB-3 岗位列表 / 详情 / 跳转 | **P13** + **P14** + **P34** |
| JB-4 收藏 | **P43** `?stage=fav` |
| JB-5 岗位 AI 三件套 | **P14**（`AI 匹配 / AI 解读`） |
| JB-6 线上招聘平台 | **P35** |
| JB-7/JB-8 找企业 | **P15** |
| JB-9/JB-10 线下机构与线下岗位 | **P16** + **P44** |
| FR-1/FR-2 招聘会列表与预约 | **P17** + **P36** |
| FR-4 招聘会详情 | **P17** |
| FR-5 参展企业名录与详情 | **P45** `?stage=booth` |
| FR-6/FR-7 资料与企业资料打印 | **P45** `?stage=materials` + **P36** |
| FR-9 现场数据 | **P45** `?stage=stats` |
| FR-10 展位导览 | **P45** `?stage=map` |
| FR-11 校园招聘专区 | **P18** |
| PL-1/PL-2 政策与公告 | **P21** + **P38** |
| CP-1 智慧校园 | **P19** + **P46** |
| CP-2 百宝箱 | **P27** |
| ME-1 短信登录 | **P03** |
| ME-2 手机扫码登录 | **P03** `?stage=sq` |
| ME-3 退出登录 | **P23** `ovl-end` |
| ME-7/ME-8 权益活动与我的权益 | **P24** + **P06 s4**（只读权益卡） |
| ME-9 反馈工单（提交 / 列表） | **P39** `ovl-fb` + **P43** 反馈列表段 |
| ME-10 消息通知 | **P43** `?stage=notice` |
| ME-11 浏览 / 跳转记录 | **P43** `?stage=trace` |
| ME-12 协议全文与留存口径 | **P23** `ovl-set` + **P04** |
| SY-1 待机屏 | **P02** |
| SY-2 会话超时与继续使用 | **P04** + **P40** |
| SY-3 设备状态顶栏 | **P01**（`设备状态` / `本机状态`） |
| SY-5 帮助 | **P39 等 37 页的 `help.js` 全站浮层**（形态不同，见 §三 H-9） |
| SY-6 AI 证据分级与免责 | **全站机制**（`interface-handoff.md §3`，生产已落 `apps/kiosk/src/ai/`） |

### 2.2 无处安放（**本次盘点的核心产出**，逐条处置见 §三）

| ID | 能力 | V6 里为什么找不到 |
|---|---|---|
| **H-1** | **PR-5 小程序到机码核销** | V6 46 页 `到机码` **0 命中**、`小程序` 仅 P27 一处、`云打印` 0 命中。P39 的卡片全部指向 P06 / P07 / P08 / P29 / P25 / P42，**没有任何码核销入口**；全站只有两个码输入框（P40:335 与 P41:704），**都是 `maxlength="4" inputmode="numeric"` 的 4 位数字** —— P40 那个是「手机号后四位」复验，P41 那个语义是「出纸口有一份没人取，凭码认领」，和「核销订单→付款→出纸」完全不是一回事 |
| **H-2** | **FR-8 AI 参会准备单** | `参会准备` / `准备单` 只出现在 **retired 的 `01-home.html` / `01-home-v4.html`**，46 页交付集内 0 命中；`逛展计划` 0 命中。P45 只有 booth/map/materials/stats 四个阶段 |
| **H-3** | **ME-4 换绑手机号** | `换绑` 在 46 页仅 P41 一处且语义无关；`换号` / `更换手机` 0 命中。P23 `ovl-set` 只展示登录方式和文件留存口径 |
| **H-4** | **ME-5 撤回岗位 AI 授权** | `AI 授权` / `授权管理` 0 命中。P11 有 job-fit 的一次性授权卡，但没有「事后到设置里撤回」的位置 |
| **H-5** | **ME-6 数据权利请求与记录** | `数据导出` / `个人信息副本` / `隐私请求` / `数据副本` / `更正` 全部 0 命中。P23 只有一个 `ovl-del`「删除已存的简历文件」浮层，那是删文件，不是数据主体权利请求 |
| **H-6** | **RS-9 自我探索附印到简历** | `附加自我` / `附在简历` 0 命中。P28 与 P06 之间没有这条合并链 |
| **H-7** | **FR-3 招聘会扫码签到落点** | P17 有「入场签到」按钮，但**没有对应页 / 阶段**（与 `v6-missing-pages-plan` G-04 同一处；本文从能力侧确认它是**已上线能力**而非待建） |
| **H-8** | **IV-3 往期面试报告 / IV-4 面试技巧** | P37 页内把这两页写成「还没建」，而 main 上 `/interview/reports`、`/interview/tips` 都是真实页面（与 `v6-missing-pages-plan` G-03 同一处） |
| **H-9** | **SY-5 帮助中心（独立页形态）** | V6 是 `help.js` 全站浮层，生产是 228 行独立页 + 5 处入口 + 8 分类过滤。**能力在，形态不同**（与 G-06 同一处），归类为「形态需裁决」而非「会丢」 |
| **H-10** | **AS-2 数字人语音通话** | `语音通话` / `数字人` 0 命中。P25 只画了文字顾问。该能力**默认关闭**，但一旦开启 V6 无处放 |
| **H-11** | **SY-4 首页「继续上次」** | `继续上次` 在交付集内仅 P09 一处（简历内部续做）；P04 有「接着上次做」但那是系统态图谱页。**首页级的跨域续做面板 V6 没画** |
| **H-12** | **RS-8 自我探索历史页形态** | 生产是独立路由 `/resume/self-assessment/history`，V6 是 P28 的 s4 阶段（与 G-11 同一处）。~~该页在生产上是永久空态~~ **⛔ 已订正：该页非空态，渲染单次回看 + 合规披露卡，且有两处站内入口。见 §三 H-12 顶部** |

### 2.3 V6 有但生产没有（反向缺口，简单标注；与 #619 互补）

| V6 页 | V6 画了什么 | 生产现状 |
|---|---|---|
| **P29** 证件照工作台 | 拍摄 / 换底 / 排版 / 打印全流程 | `/print-scan/feature/id-photo` 是**诚实占位说明页**，零 API，卡片标 `available:false`「待开发」 |
| **P35** 线上招聘平台 | 平台目录治理（收录状态 / 链接体检 / 排序） | 前端 4 条硬编码常量；`OnlinePlatformDirectory` 表与状态机在，但 **Kiosk 侧 0 端点**，只有 admin 只读 API |
| **P06 s4 / P24** 权益核销抵扣 | 「权益内 0 元 / 抵扣 X 元」结算 | 前端刻意不接 `POST /orders/:id/redeem`（服务端 `discountCents = order.amountCents` = 整单免，未落面值 / 品类 / 上限规则，接上即资损） |
| **P41** 退款分支（部分退 / 原路退 / 对账） | 六个退款态 | 后端 `payStatus` 有 `refunding/partial_refunded/refunded`，但**部分退款动作本波未接**；Kiosk 无任何退款发起面 |
| **P45** 展位交互（点选展位 / 已入驻·已预留·空闲图例） | 可交互平面图 | 后端 `getFairMap` 的 `booths` 恒 `[]`，`FairCompanyBooth` 模型闲置 → 交互分支永不触发 |
| **P45** 现场服务统计（签到进度 / 浏览 / 扫码 / 打印计数） | 五类计数 | 后端恒 `null`（签到结果合规上本就不能记），前端走诚实空态 |
| **P39** 匿名异常反馈浮层 | 免登录选类型即可提交 | 后端 `POST /kiosk/feedback` **已于 2026-08-16 上线且实现完整**，但 kiosk 前端 0 引用，异常反馈仍跳登录墙的 `/me/feedback`。**这是 V6 领先于生产前端的一处** |
| **P06 / P39** 打印满意度三档 | — | `FeedbackTicket.satisfaction` 字段在，无前端写入方 |

---

## 三、无处安放的能力 —— 逐条处置建议

### H-1 · 小程序到机码核销（PR-5）—— **P1，迁移前必须在 V6 里新设计**

> ## ⛔ 订正（2026-08-16，本条初稿的「丢掉的后果」是错的）
>
> 初稿写的「用户拿着码走到机器前，**在整机上找不到任何输入口**」——**这句是错的，生产上有这个入口。**
> 独立复核批次逐条对 `origin/main` 取证，协调者亦已复验：
>
> ```
> 首页「打印扫描」大卡   homeV6Domains.ts:48   'print-hub' → /print-scan
>   └─ 打印扫描页第一张卡  print-scan/PrintScanHomePage.tsx
>        key:'pickup-claim' 「扫码或输入取件码」 available:true → /print/pickup-claim
>             └─ routes/index.tsx:228  <PrintPickupClaimPage />
>                  └─ POST /print/jobs/claim-pickup
> ```
>
> 该入口刻意**不登记进 `CARD_CAPABILITY_KEY`**，因此不受本机打印/扫描能力探测门禁影响，恒为 `available:true`。
> 页面是 HID 键盘楔式，读满 10 位自动核销；小程序二维码编码的正是裸 10 位码，两端字符集
> 完全一致 `[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}`，扫码枪扫进去直接过。
>
> 修复提交 `33a8141e9`（2026-08-14）标题即 *"fix: make miniapp pickup claim reachable"*，**早于本清单成稿两天**。
> `PrintScanHomePage.tsx` 的源码注释本身就写着这件事：
>
> > `// V6 原型 39-print-hub.html 尚未画出该入口（原型冻结于该能力上线之前），`
> > `// 但它是真实已交付能力，合并 V6 时不得删除。`
>
> **失误性质**：本清单的任务是「盘点生产能力 × 对照 V6」，但这一条把「V6 原型没画」直接推成了
> 「生产没有」。**原型不是生产** —— 这正是本文 §1.2 自己立的边界，H-1 却越了线。
> 同日同目录的 `a3-print-fulfillment-gap-spec-2026-08-16.md:231` 也写着「状态 7 主链路**已完整**」，本条与之矛盾而未察觉。
>
> **降级为 P1，不是撤销。** 下面「建议在 V6 里新设计」的结论**仍然成立**，只是理由变了：
> 不是「现在断了要抢修」，而是「**迁移时若照 V6 原样搬会造成能力倒退**」。生产此刻工作正常。

**为什么 V6 原型没有**：**纯冻结时点问题。** V6 能力冻结在 `ee4bc267f`（2026-08-11），该能力首次落地是 `c61b7e06f`（2026-08-12），差一天。不是产品有意不要 —— 恰恰相反，`67145a855`（08-16）还在为它补「小程序与一体机共用后台裁定 + M1 渠道字段」。

**迁移时不做设计的后果**：V6 原型 P39 的卡片全部指向 P06 / P07 / P08 / P29 / P25 / P42，没有码核销入口。照 V6 整体迁移而不补这一页，等于**把一个生产上已经能用的能力删掉**。

**额外的埋雷（比"倒退"更危险）**：如果改版时有人看到 V6 P41 的「取件码」就顺手接线，会把 10 位字母数字码接到一个 `maxlength="4"` + `inputmode="numeric"` 的输入框上 —— **结构上无法输入生产的码**，还会连带把 P41「出纸口无人认领」的语义（认领别人落下的纸）和 PR-5 的语义（核销自己的订单并付款）混成一个。两者背后是两张不同的状态机：P41 那一支不写 `Order.pickupStatus`，PR-5 必须写。**这条埋雷不受订正影响，仍然成立。**

**建议：在 V6 原型里新设计。** 具体位置有现成的落点，不需要发明新概念：
1. **P39 打印域首屏**加一张入口卡（生产上它就是第一张卡），文案口径按合规白名单，不叫「取件」以免和 PR-4 混淆；
2. 新增一个**核销阶段**（可挂在 P39 或 P06 之前），支持扫码枪一次性输入与手动输入两条路，字符集 32 个无歧义字符、10 位；
3. 核销成功后**汇入 P06 s5 收银台**（V6 已有完整的主扫 / 被扫 / 对账 / 失效重出码六态），付款成功再进 s6 出纸。P06 s5 现成可用，这条不需要新画。
4. 在原型里把 PR-4（付款后的核验凭证码，找工作人员）与 PR-5（下单后的到机码，自助核销）**明确区分标注**，否则下一轮还会混。

### H-2 · AI 参会准备单（FR-8）—— **P1，建议在 V6 里新设计**

**为什么 V6 没有**：**能力被 retired 页面带走了。** `参会准备` / `准备单` 这两个词只存在于 `01-home.html` 和 `01-home-v4.html` —— 两个已标 `retired`、不进交付集的历史首页。也就是说 V6 早期是知道这个能力的，统一到 v6 首页时它随旧首页一起被摘掉，而 P17 / P36 / P45 都没有接住。

**丢掉的后果**：用户失去「用自己的简历生成一份这场招聘会该去哪几家、准备什么」的产出，且该产出可打印、进 AI 服务记录（`kind='fair_visit_plan'`）。这是招聘会域**唯一**把简历链和招聘会链接起来的能力。

**建议：在 V6 原型里新设计。** P17「招聘会作战台」已经有 AI 分诊（「这三场你该去哪一场」）和示意路线，语义上是同一族；把参会准备单作为 P17 的一个阶段或 P45 的第五个阶段，比新起一页更符合 V6 自己的组织方式。

### H-3 / H-4 / H-5 · 账号与数据权利三件套（ME-4 / ME-5 / ME-6）—— **P1，必须在 V6 里新设计**

**为什么 V6 没有**：**产品口径滞后，不是有意不要。** 生产源码里的注释自己就落后于实现 —— `MySettingsPage.tsx:4-5` 写着「明确不做：……换绑」，而同文件 84–198 行实现了完整四步换绑；`routes/index.tsx:177` 也写着「不做换绑/注销」。V6 是照着「账号设置是个轻量浮层」的旧口径画的（P23 `ovl-set` 只有登录方式 + 文件留存说明）。

**丢掉的后果**：
- **ME-4**：用户换手机号后无法把账号迁过去，历史简历 / 订单 / 权益全部失联。这在一体机场景（用户往往几个月才来一次）是硬伤。
- **ME-5**：`job_ai` 授权是**服务端硬门禁**（`requireActiveConsent` 直接 403）。给得出去、收不回来 —— 这是个人信息保护上的实质缺陷，不只是体验问题。
- **ME-6**：数据主体权利请求的**记录与状态**没有呈现面。目前后端已经在为每次撤回写 `UserDataRequest` 行 + AuditLog，前端不展示等于用户无从证明自己行使过权利。

**建议：在 V6 原型里新设计一个「账号与隐私」页**（不是浮层）。理由：三条能力都有多步流程（换绑是四步、撤回要二次确认、请求要列表 + 状态），浮层放不下；且它们共享同一个「本人身份 + 二次验证」的前提，合成一页比拆三处更省。这与 `v6-missing-pages-plan` 的 G-05「补 P23b」结论一致，**本文额外补的是：G-05 只提到「原型只画删除、没画数据导出」，实际还漏了换绑与授权撤回两条已上线能力。**

> 注意一处生产侧的口径瑕疵（登记不修）：撤回 `job_ai` 有两个入口，`/me/settings` 直调 `POST /me/ai-consents/job_ai/revoke`（**不留 `UserDataRequest` 行**），`/me/privacy-requests` 走 `POST /me/data-requests`（留行 + 审计）。用户在请求列表里看不到从设置页撤回的那次。重新设计时应收成一条路径。

### H-6 · 自我探索附印到简历（RS-9）—— **P2，建议在 V6 里新设计**

**为什么 V6 没有**：这是全站唯一的跨能力产物合并（P28 的产物合进 P06 的打印件），横跨两页，属于「两边都以为对方画了」的典型缝隙。

**丢掉的后果**：自我探索报告只能单独打印或看页内预览，无法和简历装订成一份。产品价值上这是「一份完整求职材料」的组成部分，丢了不影响主链但削弱交付物完整度。

**建议：在 V6 原型里新设计** —— 作为 P06 s4（核价与确认）的一个附加项，不新增页。

### H-7 · 招聘会扫码签到落点（FR-3）—— **P1，在 V6 里新设计（一个阶段即可）**

**为什么 V6 没有**：P17 在 2026-08-09 补过「入场签到（线上 /job-fairs/checkin）」的按钮，但只补了按钮没补落点。

**丢掉的后果**：`/job-fairs/checkin` 是一个**真功能页**（拉真实场次、按 `checkinUrl` 过滤、渲染真二维码、落 `external_checkin_open` 跳转记录），同时也是「本系统不记录签到结果」的合规声明页。丢了它，签到入口无处安放，且那句合规声明也一起没了 —— 后者比前者更要紧。

**建议：在 V6 原型里新设计一个签到阶段**（挂 P17 或 P45）。合规文案必须一起画进去：本系统只提供**打开来源平台签到入口**，不记录签到结果。

### H-8 · 往期面试报告 / 面试技巧（IV-3 / IV-4）—— **P1，改口径 + 补页**

**为什么 V6 没有**：**V6 的事实陈述过时了。** P37 页内写这两页「还没建」，而 main 上 `/interview/reports`（真读 `GET /me/mock-interviews`、可删）和 `/interview/tips`（静态技巧页）都已存在。

**丢掉的后果**：用户失去「回看历次面试报告」的入口 —— 而报告是可打印的产出物，回看的价值高于练习本身。

**建议：在 V6 原型里补两页 + 撤销 P37 的「还没建」标注。** 与 `v6-missing-pages-plan` G-03 同一处，此处只补充能力侧证据。

### H-9 · 帮助中心形态（SY-5）—— **P2，形态需裁决，不算会丢**

**为什么 V6 不同**：V6 用 `help.js` 全站浮层（37 页挂载），生产是独立页 + 5 处入口。**能力两边都有，是形态之争。**

**建议：确认可以下线独立页，改用 V6 的全站浮层。** 理由：一体机场景下「在当前页就地看帮助」优于「跳走再跳回来」；且生产的 `/help` 是硬编码 FAQ，本来就不可运营，改形态不损失任何数据能力。**但必须保留 5 个现有入口点位**（`/print/done`×3、`/scan/start`、`/error-offline`），这些是真实的求助时刻。

### H-10 · 数字人语音通话（AS-2）—— **P2，先不新设计，但要在原型里留位并标明**

**为什么 V6 没有**：该能力由 `VITE_USE_TRTC_CALL` 控制，**默认 false 且关闭时整块 UI 不渲染、SDK 被 Rollup 剔除**。V6 只画了默认态。

**丢掉的后果**：当前为 0（默认部署下用户到不了）。但后端 `POST /trtc/session` 是真实完整的（签 userSig、限流、Redis 归属校验），一旦运营开启而 V6 没位置，会临时挤进 P25 造成返工。

**建议：在 P25 里留一个明确标注为「构建开关控制」的位置**，不做完整设计。**不建议下线** —— 这是已投入的真实能力，只是没开。

### H-11 · 首页「继续上次」（SY-4）—— **P2，建议在 V6 里新设计**

**为什么 V6 没有**：V6 P04 有「接着上次做」，但那是系统态图谱页；P01 首页有「待办理」但不是跨域续做面板。生产的 `ContinuePanel` 是 2026 年 6 月后逐步加上的首页能力，V6 首页定版时（v6 基线 2026-08-08）没有把它收进来。

**丢掉的后果**：登录用户失去「上次那单打印到哪了 / 上次诊断的简历可以继续优化」的首屏提示。一体机用户会话短、跨次访问多，这个面板承担的是「重新找回上下文」。

**建议：在 P01 首页新设计一个续做区**（登录态才渲染，无进行中任务时整块不渲染）。

> 顺带登记：生产还有一个 `/session-resume` 页，是 `GET /me/pending-tasks` 在 kiosk 的**唯一消费者**，功能真实（能恢复到 `/print/cashier` 续付），但**站内无入口**（见 §四）。`ContinuePanel` 并没有取代它 —— ContinuePanel 走的是另外两个端点。重新设计续做区时应把 `/me/pending-tasks` 的「支付续做」一起收进去，否则这条能力会永久失联。

### H-12 · 自我探索历史（RS-8 的历史形态）—— **P1，必须在 V6 里承接，不得下线**

> ## ⛔ 订正（2026-08-16 第二轮）：本条初稿的「没有后果 / 确认可以下线」是错的
>
> 初稿写「该页必然为空、可以下线，并顺手消除那两个入口承诺」。**若照做会删掉一个能用的页面，以及页面上一段合规披露。**
>
> **事实（独立审查批次取证，协调者已复核）：**
>
> 1. **初稿引用的 `setHistory` 在 `origin/main` 上根本不存在。** `git grep setHistory origin/main` 源码 0 命中。该代码活在**落后分支**上（`origin/chore/type-floor-ratchet-gate`、`origin/claude/ai-s0-backend-hardening`、`origin/chore/wire-s0-s1-verifies-into-ci` 的同文件 462/468 行）。`origin/main` 的 465-469 行是「AI 任务四态（S1-1）」的注释块。
> 2. **该页不是空态。** `SelfAssessmentFlow.tsx:744-798` 的 `SelfAssessmentHistoryPage` 读 `loadSession()` 并渲染记录编号 / 同意时间 / 维度 / 保留至 + 「回看这次结果」跳转，外加一张**恒渲染**的合规披露卡：答案原文从未入库、过期解读到期自动清理、撤回的那次已物理删除、**企业与合作机构与管理后台都看不到，也不参与岗位排序**。源码注释写明「服务端没有『按人列出历次』的端点……**所以本页不编列表**」—— 这是主动取舍，不是缺陷。
> 3. **它不是孤儿路由。** 两处站内入口：`SelfAssessmentFlow.tsx:647`、`InterviewServiceHubPage.tsx:98`。主入口是结果页，从那里进来 `session.taskId` **必然有值** —— 恰恰是必然非空的路径。（本条初稿自己也承认这两个入口存在，与 §4.1「站内无任何入口」的分类定义直接打架而未察觉。）
>
> **溯源**：重写提交 `5518e6264`（2026-08-16，PR #622「P28 自我探索接线」）删掉了 `setHistory` 并重写该页。陈旧结论留在两份 main 上的文档里，其中一份正是本文 §1.4 自称「§四主要来源」的 `kiosk-control-integrity-audit-2026-08-16.md:131`（另一处 `kiosk-delivery-matrix-2026-08.md:58`）。
>
> **后果比 H-1 重**：H-1 是虚报缺口，不动手就没事；本条的处置是「确认可以下线」，**照做会真的删掉能力 + 一段合规披露** —— 正是本文在 H-7 里论证「那句合规声明比入口更要紧」的同一类东西。
>
> **改判：P1，迁移时必须在 V6 里承接该页的两件事** —— ①凭 taskId 回看单次结果；②那张合规披露卡。**不得按初稿"顺手消除入口承诺"。**

**为什么 V6 不同**：生产是独立路由 `/resume/self-assessment/history`，V6 是 P28 的 s4 阶段。

**真正的差异**：不是"生产这页是空的"，而是**V6 的 s4 阶段是否承载了生产这页的两项内容**（单次回看 + 合规披露）。迁移前需逐项比对；缺哪项补哪项。

### 处置汇总

| 处置 | 条数 | 编号 |
|---|---|---|
| **在 V6 原型里新设计** | 8 | H-1(P1，已从 P0 订正)、H-2、H-3/H-4/H-5(合一页)、H-6、H-7、H-8、H-11 |
| **留位并标明，不做完整设计** | 1 | H-10 |
| **确认可以下线** | **1** | H-9（改用 V6 浮层形态）。~~H-12~~ **已订正为 P1「必须承接」，见 §三 H-12** |

---

## 四、看起来有但其实没有

> ~~这一节的东西**迁移时可以直接丢**。~~ 分四类。
>
> ## ⛔ 订正（2026-08-16 第二轮）：本节的「可以直接丢」定性过强，且 4.1/4.3 各有实证错误
>
> 独立审查批次逐条复核后发现三件事，**在动手删任何东西之前必须先读**：
>
> **① 4.1 的 11 条孤儿路由被 CI 冻结清单锁着。** `verify:fusion-w6`（在 `ci.yml`，`verify-fusion-w6.mjs:236-266`）硬断言路由表**恰好 104 条** + 与冻结清单 `tests/visual/route-manifest.ts` `deepEqual` + wave 归属合计 104。**§4.1 的 11 条全部在这份清单里。** 删任意一条，三条断言同时红；另有 `verify:fusion-w3`（`/resume/export`）、`verify:fusion-w4`（`/campus/welcome`）在 CI，视觉夹具 `fusion-w6-route-cases.ts:99,123,124` 还实际渲染 `/campus/welcome`、`/ai/plan`、`/session-resume`。
> **「它们不是能力」这个判断 10/11 成立，但「直接丢、不用心疼」低估了工作量** —— 每删一条是 router + 冻结清单 + verify 脚本 + 视觉夹具的联动改动。
>
> **② 4.1 里 `/resume/self-assessment/history` 判错**（非孤儿、非空态），详见 §三 H-12 顶部的订正。
>
> **③ 4.3「死代码」里至少 4 项是 CI 门禁的活依赖**，详见 4.3 小节顶部的订正。
>
> **本节的判据必须加强为三条同时满足才可判「可删」：**
> 1. 无 ES import 消费者；
> 2. **无任何 verify / 门禁脚本按路径 `readFileSync` 读它**（本节漏的正是这条）；
> 3. **无在制分支上的活跃调用方** —— 「无后端端点」≠「可删」：另一会话实测中，`utils/api.js` 的 `getCommunityFeeds` / `getDailyReport` 后端确实不存在，但 `community.js:45` 与 `daily-report.js:24` 仍在调用，删掉直接打断在制工作。**它们不是死代码，是在制品的前半段。**

### 4.1 孤儿路由（能渲染，功能可能是真的，但站内无任何入口）

| 路由 | 功能真假 | 判定 |
|---|---|---|
| `/ai/plan` | **整页伪造** | 不 import 任何 `services/api`，`DEFAULT_PLAN` 写死用户的「目标」和「尚需准备的材料」，页头还写「小青已理解你的目标」。全站无任何调用方带 state 导航到此页 ⇒ **100% 的渲染都是这段假内容**。**丢** |
| `/resume/export` | 恒空壳 | 96 行，无 props / 无 taskId / 不读路由参数，固定渲染「暂无真实输出物」，两个按钮**硬编码 `disabled`**。真实导出在 RS-2 / RS-4 内部完成。**丢** |
| `/print/params` | 功能已内联到别处 | 462 行，参数 UI（份数 / 颜色 / 双面 / 方向 / 缩放）已全部在 `/print/preview` 内。**丢**。连带必须改掉 `PRINT_STEPS` 里那个**永不出现的「参数」步**（进度条 3→5 跳号） |
| `/session-resume` | **功能真实** | `GET /me/pending-tasks` 在 kiosk 的唯一消费者，能恢复到 `/print/cashier` 续付。**页丢、能力保**（并入 H-11 的首页续做区） |
| `/notifications` | 别名壳 | 6 行，只是 `<MyNotificationsPage loginFrom="/notifications" />`。真路由是 `/me/notifications`。**丢** |
| `/me/activity/:id` | 真读但低效 | 列表点击经 `detailRoute()` 直达 `/jobs/:id` 等真实内容，**跳过详情页**；该页实现是「翻遍全部分页找单条」。**丢** |
| `/error-offline` | 功能真实但无人路由到 | 离线态实际由 `ServiceReadinessStrip` 在 5 个服务中心页内联呈现 + 顶栏「网络异常」标。**丢**（但保留 5 处内联呈现） |
| `/campus/welcome` | 空壳 | 页面自己写「智慧校园迎新服务位于独立专区」。已被 `/smart-campus/welcome` 取代。**丢** |
| `/campus/freshman-insights` | 空壳 | 同上。**丢** |
| `/smart-campus/freshman-insights` | 永久「暂未开放」 | `SmartCampusHomePage` 刻意不列出该入口（「校园大数据本期严格冻结」），且 `bigdata` 模块被服务端强制冻结为 false。**丢** |
| `/resume/self-assessment/history` | ~~必然空态~~ **⛔ 判错** | **非孤儿路由**（两处站内入口）、**非空态**（渲染单次回看 + 合规披露卡）。**不得丢**，见 §三 H-12 顶部订正 |

> **故意保留、不是缺陷的 4 条旧入口别名**（`<Navigate>` 重定向，代码注释已说明）：`/print/scan-convert`、`/print/scan-sign`、`/print/scan-feature`、`/resume/upload`。迁移时按需保留或一次性清掉，不属于能力。
> **不是孤儿的两条**：`/member/qr-login` 与 `/upload/phone` 都由**后端下发路径**（`member-qr-login.service.ts` / `upload-sessions.controller.ts` 的 `new URL('/upload/phone', origin)`），是手机侧扫码落点，不是站内导航目标。**必须保留。**

### 4.2 假成功 / 假承诺（用户会被骗，必须一并消除）

| 位置 | 问题 |
|---|---|
| `ScanResultPage.tsx:156` | 未登录时按钮写「**登录后管理文件**」+「登录后可在『我的文档』管理」。**双重假承诺**：① 扫描会话创建时就固化 `endUserId`，匿名 ⇒ `FileObject.endUserId=null`，而全库**不存在匿名→会员的文件认领机制**，登录后也永远进不了「我的文档」；② `LoginPage` 用裸路径 `navigate(returnTo)` 回跳，router state 丢失 ⇒ 登录回来看到的是「扫描未完成 / 扫描失败」。用户点一个承诺留存的按钮，换来一个失败屏 + 文件永久丢失 |
| `ConvertImagesPage.tsx:276` | 「转换规则」卡里无条件断言「PDF 已保存到『我的文档』」，而**同一屏** `:179-181` 的提示条已按登录态正确分流。一屏两句自相矛盾 |
| `PhoneUploadPage.tsx:132` | 硬编码「上传目标：**就业服务大厅 · 01号机**」。该页全部输入只有 URL fragment 里的 `sessionId`/`token`/`purpose`。**每一台机器、每一个场馆都这么显示** |
| `PrintDonePage.tsx:146,264,309` | `pages` 为 null 时 `null*copies=0` 且 `0 != null` 为真 ⇒ 显示「**共 0 面已全部打印**」、摘要行渲染成「 页 × N 份」。必现路径：扫描 → 结果页「直接打印」（`pages` 恒 null） |
| `/ai/plan` 整页 | 见 4.1。当前不可达故影响为 0，**若被接上入口即为 §9 红线违规** |
| `ProfilePage.tsx:36-59,77-82,93-111,143,155-165` | 「本次会话记录」整块是**死分支** —— 三个 state 只从 `location.state` 初始化，而全站没有任何页面用这些 state 导航到 `/profile`（生产方 `ResumeOptimizePage` 早已因「提示已保存但刷新即丢」被移除）。死分支里还埋着「查看记录」按钮实际跳上传页、`printFile` 不带 `fileUrl` 三屏后才失败两个隐患 |
| `PrintUploadPage.tsx:110-113` | `?tab=usb` 不检查 `usbConfigured` ⇒ 未配置网桥的机器上仍渲染「请插入 U 盘 / 连接后自动读取」的引导，而轮询 effect 直接 return。**用户插了 U 盘永远不会有反应** |
| `JobMaterialLibraryPage.tsx:184` | 眉头写「AI 求职材料 · **真实生成**」，而 `POST /job-materials/generate` 是**纯模板渲染，全链路无 LLM** |
| `AssistantPage.tsx:408-435` | 服务端已如实返回 `aiGenerated` / `providerLabel`（`ai.service.ts:778`，类型注释明写「缺失或 false 都不得呈现为 AI 回答」），前端**零引用**。若误配 `AI_PROVIDER=mock`（该 env 默认就是 `'mock'`），`MockAiProvider` 的预置话术会以完全相同的气泡呈现。**本域唯一的活体伪造风险路径** |
| `PolicyServiceHubPage.tsx:90` | 「补贴指引」指向 `/renshi?tab=subsidy`，而 `VALID_TABS` 无 `subsidy` ⇒ 静默回落 policy tab。点「补贴指引」和点「就业政策」落到同一屏 |
| `OfflineAgenciesPage.tsx:117-118` | 「区域：全部区域」是不可点的死 chip；后端支持 `district/orgType/service` 但前端不传 |

> **重要阴性结果**（避免下一轮重复排查）：收藏、权益领取、简历「已生成/已导出」、职业规划、收银台、打印进度、招聘会「已签到」（那是**参展企业**的后端状态，不是用户本人签到）—— 全部核查为**正确**的「真实请求成功后才显示成功」，不是假成功。

### 4.3 死代码（在仓库里但零 ES import）

> ## ⛔ 订正（2026-08-16 第二轮）：小节原标题「迁移时直接删」是错的，**至少 4 项删不得**
>
> 独立审查批次实证：下列四项虽无 ES import 消费者，但**被 CI 里的 verify 脚本按路径 `readFileSync` 读取**。
> 这些 `read()` 是**顶层调用**，文件一旦不存在直接 `ENOENT` 崩，门禁全红。
>
> | 项 | 谁在读它 | 是否在 `ci.yml` |
> |---|---|---|
> | `pages/home/serviceGroups.ts` | 7 个 verify 脚本 | **是**（`verify:jobfair-ui`、`verify:job-material-library-ui`、`verify:jobfair-commercial-closure`、`verify:renshi-policy-ui`；另 2 个只在 package.json） |
> | `hooks/useHomeDeviceStatus.ts` | `verify-prod-build-config.mjs:113` B7 检查 | **是** |
> | `auth/components/MemberLoginDialog.tsx` | `verify-member-login-dialog.mjs:240` + 约 6 条断言 | **是** |
> | `deleteMyBrowseLog` / `deleteMyJumpLog` | `verify-profile-activity-inkpaper.mjs:73-74` | **是** |
>
> 最后一项尤其说明问题:该门禁的断言文案本身就是「activity API **仍保留**浏览记录删除能力（本页不新增入口）」——
> **门禁要求它们存在,这是刻意保留的记录,不是遗留垃圾。** 同理 `docs/progress/current-progress.md:215` 对
> `MemberLoginDialog` 有明确决定:「旧弹窗组件**暂不做跨任务删除**,仅从首页生产入口解除挂载」。
>
> **同目录矛盾未察觉**:本文 §1.4 列为「§四主要来源」的 `kiosk-control-integrity-audit-2026-08-16.md:500`
> 已白纸黑字写着「已知**至少 3 个 verify 脚本仍在断言** `pages/home/serviceGroups.ts`」。本节整段信任了该文档的结论，却漏读了它的这句警告。
>
> **判「可删」必须三条同时满足**：①无 ES import 消费者；②**无任何脚本按路径 `readFileSync` 读它**；③**无在制分支上的活跃调用方**。
>
> **下列各项经复核判定成立、确可删**：`App.tsx`（只剩 `export {}`）、3 个 `placeholders/PrintScan*.tsx`、`placeholders/OfflineAgenciesPage.tsx` 与 `OfflineJobDetailPage.tsx`、`getMyRedemptions`、`mergeLocalToAccount` / `localPendingCount`。

- ⚠️ **删不得** `apps/kiosk/src/pages/home/serviceGroups.ts` —— 它定义了一整套首页瓦片（含「简历打印」「找企业」「校园招聘会」「扫码签到」「面试技巧」「面试报告」等），**零 ES import**，首页实际渲染的是 `homeV6Domains.ts`。**任何按 `serviceGroups.ts` 推断首页入口的分析都会得出错误结论** —— 但它是 4 条 CI 门禁的路径依赖，**不能删**，只能连门禁一起改。
- ⚠️ **删不得** `apps/kiosk/src/pages/home/hooks/useHomeDeviceStatus.ts` —— 与顶栏 `useTerminalDeviceStatus` 同功能的第二份实现，零 ES 消费者，且它映射的 `paperLevel` 字段后端根本不返回；但 `verify-prod-build-config.mjs` 的 B7 检查读它。
- ⚠️ **删不得** `apps/kiosk/src/pages/auth/components/MemberLoginDialog.tsx` —— 零 ES 引用，但 `verify-member-login-dialog.mjs` 读它并断言，且进度文档有「暂不做跨任务删除」的明确决定。
- `apps/kiosk/src/App.tsx` —— 文件本体已声明不再被 `main.tsx` 引用，内容只剩 `export {}`
- `apps/kiosk/src/pages/placeholders/{PrintScanConvertPage,PrintScanFeaturePage,PrintScanSignPage,OfflineAgenciesPage,OfflineJobDetailPage}.tsx` —— 路由已全部改指真实页，这 5 个占位组件零引用
- `FavoritesProvider.mergeLocalToAccount` + `localPendingCount` —— Provider 注释说「由用户在『我的收藏』显式触发」，但 `MyFavoritesPage` 根本不 import `useFavorites`。**匿名期收藏无法合并到账号**
- 前端已定义、后端端点真实、但零调用的函数：`getMyRedemptions`（**可删**）、⚠️ `deleteMyBrowseLog` / `deleteMyJumpLog`（**删不得** —— `verify-profile-activity-inkpaper.mjs:73-74` 断言其存在，文案即「仍保留删除能力」）

### 4.4 后端建好但前台没接（**不是"假"，是断链 —— 迁移时不要当成已有能力**）

| 端点 / 字段 | 状态 |
|---|---|
| `POST /kiosk/feedback` | **实现完整**（匿名、分类白名单、`dedupKey` 幂等、三层限流、不收 PII、不落 IP），2026-08-16 上线，**kiosk 前端 0 引用**。异常反馈仍跳登录墙的 `/me/feedback`。V6 P39 的 `ovl-fb` 浮层反倒是照这个设计画的 |
| `FeedbackTicket.satisfaction`（good/fair/bad） | 字段与聚合意图都在，**无前端写入方** |
| `POST /me/print-orders`、`GET /me/print-orders/cloud`、`GET /:orderId`、`POST /:orderId/cancel` | 小程序云打印建单 / 列表 / 详情 / 取消，**kiosk 一个都没调**（kiosk 只调列表） |
| `GET /me/pending-tasks` | 只有孤儿路由 `/session-resume` 消费 |
| `DELETE /me/browse-logs/:id`、`DELETE /me/external-jump-logs/:id` | 用户无法删自己的浏览 / 跳转记录，只能等 TTL |
| `DELETE /me/resumes/:id` | 简历不可删（文档和 AI 记录可删） |
| `POST /orders/:id/redeem` + `GET /me/benefits/redemptions` + `RedemptionRecord` | 核销链后端就绪，**前端刻意不接**（服务端 `discountCents = order.amountCents` 整单免，接上即资损，理由写在 `benefits.ts:8-22`）。⇒ 领了权益之后用户**只能看，什么也干不了** |
| `GET /job-fairs/:id/detail` | 详情页改用 5 个并发请求，0 处调用 |
| `GET /companies/filters` | 已 `@deprecated`，改用 shared 行政区划字典 |
| `GET /terminals/:terminalId/smart-campus` | kiosk 统一走 `/terminals/:id/config`，无前台调用方 |
| `HelpItem` 表 + `isPublished`/`sortOrder` | 读它的 `/kiosk/help` 是空壳，`/help` 页硬编码 |
| `/files/upload-intent`、`/files/:id/complete`、`/files/:id/raw` | kiosk 未使用 |

### 4.5 后端空壳端点（**已注册上线、无 Guard、返回硬编码值 —— 接上就是假成功**）

| 端点 | 返回 | 真身在哪 |
|---|---|---|
| `GET /kiosk/help` | `{ data: [] }` | 前端静态 FAQ |
| `GET /kiosk/activities`、`GET /kiosk/activities/:id` | `{ data: [] }` / `{ id }` | `/activities` |
| `GET /kiosk/notifications` | `{ data: [], unreadCount: 0 }` | `/me/notifications` |
| `PATCH /kiosk/notifications/:id/read` | **`{ ok: true }`** ← 假成功陷阱 | 同上 |
| `POST /kiosk/session/heartbeat`、`/extend` | **`{ ok: true }`** ← 假成功陷阱 | 前端 `KioskPrivacyGuard` + `useIdleLogout` |
| `GET /kiosk/screensaver-content` | `{ data: [] }` | `GET /terminals/:id/screensaver` |

注册处 `services/api/src/app.module.ts:133-138`。**这 6 组都不是 `ApiResponse` 信封格式**，与全站契约不一致，是早期占位。**改版时若按名字接上其中任何一个，会得到静默空列表或永远成功的假象。**

---

## 五、未验证 / 判不准的

1. **全部结论都是静态核实**：本次未启动应用、未跑浏览器、未接真机与 Terminal Agent。所有「用户能到达」的判定基于路由表 + 导航调用点的静态可达性分析，未做运行时点击验证。
2. **动态路由目标**：`navigate(变量)` 形式的跳转（约 25 处）与模板串路由（127 处）未逐个求值，可能存在少量误判可达性。
3. **PR-7 U 盘导入**未做 Windows 真机验收 —— 源码头注释自己写明「未完成 Windows 真机验收前不得据代码已合入宣称『U 盘导入已完成』」。本文按「代码闭环但未验收」记录，**不宣称已交付**。
4. **PR-1 的线上支付通道**：`GET /payment/channels` 未配置 `PAYMENT_PROVIDER` 时返回空注册表，前端显示「线上支付未开通」。本文未验证生产环境实际配置，因此**无法断言扫码付在生产上已开通**。
5. **CP-1 / CP-2 的实际开启状态**：智慧校园与百宝箱都由 Admin 侧终端配置驱动，本文只验证了门禁机制与默认值（fail-closed），未查任何生产终端的实际配置。
6. **V6 关键词扫描的局限**：§二 的「V6 有没有」判定基于对 46 个交付页 HTML 的关键词与 `data-at` 阶段扫描。**同义表述可能漏判** —— 若某条被判「无处安放」的能力实际以别的措辞画在某页里，应以原型实际内容为准。H-1（到机码）已用四组独立关键词 + 全站输入框枚举交叉验证，可信度最高；H-6、H-11 只用了两组词，置信度相对低。
7. **`docs/reviews/v6-missing-pages-plan-2026-08-16.md` 不在 `origin/main` 上**（只在 `4bed3d431`）。本文引用它的 G-01~G-11 编号作交叉参照，但**该文档的上游依据在主干上不可复核**，与本文的重叠结论应以本文的 main 取证为准。
