## 20 条验收流程调查（基于 C = `origin/claude/codex-task-history-progress-0de1dc` @ 6f473f211）

**结论先说：**
- **缺得最多的是「模拟 Agent」**：C 上没有这个脚本，要自己写。打印、扫描、缺纸这几段都能用纯 HTTP 模拟，端点和鉴权方式见第 20 条。
- **只有简历解析/优化/生成有本地 mock**（`AI_PROVIDER=mock`）。第 7、8、9 条要真实大模型密钥，本地 stub 接不上，因为后台配置的模型地址必须是公网。
- 第 1、2、3、4、5、6（文本版简历）、10–15、17、20 条都能纯 HTTP 脚本走通，前提是先补齐下面「共同前置」。

所有证据都只从 C 读取，工作区文件没用，也没有改任何文件。缩写：`api/` = services/api/src/，`K/` = apps/kiosk/src/，`A/` = apps/admin/src/，`P/` = apps/partner/src/，`M/` = apps/miniapp/，`S` = services/api/prisma/schema.prisma，`E` = services/api/.env.example。仓库根是 `/Users/wanglei/AI求职打印服务终端/.claude/worktrees/eager-leakey-d78066`。

### 共同前置（下面各条默认已满足）

- **启动后端**
  - 命令：`pnpm --filter @ai-job-print/api dev`（services/api/package.json:20），端口 3010（E:176）。
  - 必需变量：`DATABASE_URL`（E:7）、`TERMINAL_ADMIN_SECRET`（启动时必读，api/terminals/terminals-agent.service.ts:174）。
  - **Redis 必须真起**：终端会话令牌存在 Redis（api/terminals/terminal-session.service.ts:13-14,46），短信验证码也在 Redis（api/member-auth/member-auth.service.ts:107,334）。启动命令见 E:119 的注释。
- **种子**：`db:seed`（package.json:23；只允许 NODE_ENV=development/test，prisma/seed-guard.ts:7）。
  - 会建：admin/admin；partner1/partner1 属 uniOrg，partner2 属 hrOrg；终端 `t_ksk_001`（KSK-001），agentToken=`seed-terminal-token-ksk-001`，绑定 uniOrg（seed.ts:65-139）。
  - **不会建**：价目 PriceConfig、法务文档、政策、官方渠道。
  - 价目必须另外写入：调用 `seedDevDefaultPriceConfig`（api/payment/price-config.seed.ts:84）。后台改价接口只能改已有行，没有行会返回 NOT_FOUND（api/payment/admin-billing.service.ts:120-121）；没价目时报价直接报 PRICE_CONFIG_UNAVAILABLE（api/payment/pricing.service.ts:92-94）。
  - 非生产环境下，临时密码的 admin 可以直接登录（api/auth/auth.service.ts:566-573）。
- **终端身份（脚本怎么拿）**
  1. 带 `Authorization: Bearer <agentToken>` 和 `X-Terminal-Id` 调 POST /terminals/boot-ticket（api/terminals/terminals.controller.ts:97）。
  2. 用返回的 bootTicket 调 POST /terminals/session-token（:106），有效期 30 分钟，续期走 :112。
  3. 之后一体机类请求带 `x-terminal-id` 和 `x-terminal-session-token`（api/terminals/terminal-identity.guard.ts:11-12）。
  4. 种子里的明文 agentToken 按旧格式放行（api/terminals/terminal-credential-security.service.ts:313）。
- **一体机浏览器在 vite dev 下**
  - 设 `VITE_API_MODE=http`，默认是 mock（apps/kiosk/.env.example:11；admin、partner 的 .env.example:11 同样默认 mock）。
  - 设 `VITE_TERMINAL_ID=t_ksk_001`（只在 DEV 生效，K/services/api/screensaver.ts:134）。
  - URL 带 `?boot_ticket=`（K/services/terminalAuth.ts:54）；否则前端会去本机 Agent 的 /local/terminal-boot-ticket 取票（:125）。
- **打印机在线**：一体机按「5 分钟内有心跳」判断在线，种子那条心跳早就过期。脚本要先 PUT /terminals/t_ksk_001/heartbeat，带 printerStatus=ok。`PRINT_REQUIRE_PRINTER_ONLINE` 开发环境默认关（api/terminals/printer-availability.ts:27）。
- **能力开关**
  - 默认模式 managed（api/terminals/terminal-capabilities.service.ts:47）。
  - `DEFAULT_DENY_CAPABILITY_KEYS` = color_print、duplex_print、signature_stamp（packages/shared/src/types/printScanCapability.ts:86-90）。要打彩色/双面，先调 PUT /admin/terminals/:id/capabilities/:key（api/terminals/admin-terminals.controller.ts:159）设成 available。
  - `PRINT_REQUIRE_PII_SCAN` 开发环境默认关（api/print-jobs/print-jobs.service.ts:237；E:415）。
- **本地可用的 mock/stub**

| 变量 | 默认值 | 出处 | 说明 |
|---|---|---|---|
| `AI_PROVIDER` | mock | E:262；api/ai/ai.service.ts:166 | 只覆盖简历解析/优化/生成 |
| `SMS_PROVIDER` | log | E:144；api/member-auth/sms/sms-sender.ts:104 | 验证码打日志；脚本直接读 Redis `member:sms:code:{hash}` |
| `FILE_STORAGE_DRIVER` / `FILE_STORAGE_DIR` | local | E:62 / E:56 | 本地目录存储 |
| `PAYMENT_PROVIDER` | sandbox | E:354 | 配合 POST /payment/sandbox/simulate（api/payment/payment.controller.ts:112；生产返回 404，api/payment/online-payment.service.ts:747） |
| `OCR_PROVIDER` | disabled | E:281 | 无 stub |
| `ASR_PROVIDER` | disabled | E:304 | 无 stub |
| `VITE_USE_TRTC_CALL` | false | apps/kiosk/.env.example:32 | 语音通话关闭 |

- **本地没有替身的**
  - 其余 AI 功能无密钥时报 AI_NOT_CONFIGURED：api/ai/resume/llm-career-plan.service.ts:253、llm-job-fit.service.ts:386、llm-self-assessment.service.ts:236、api/mock-interview/mock-interview-llm.service.ts:302、api/advisor/llm-advisor.service.ts:454。模型地址必须是公网（api/ai/llm/ai-config.controller.ts:92）。
  - 小程序微信登录要真实调用 jscode2session（api/member-auth/member-auth.service.ts:514-523）。脚本改用短信登录拿会员令牌，/me/* 两端共用这个令牌。

### 1 一体机匿名打印

| 项 | 结论 |
|---|---|
| 入口 | K /print/upload → /print/desk → /print/confirm → /print/progress → /print/done（K/routes/index.tsx:209,210,221,223,224）；手机页 /upload/phone（:86） |
| 上传端点 | POST /upload-sessions（api/upload-sessions/upload-sessions.controller.ts:42）→ 手机 POST /:id/files（:84）→ 一体机轮询 GET /:id（:75）→ POST /:id/confirm（:101） |
| 隐私检查 | POST /materials/tasks、POST /materials/tasks/:id/pii-findings/decisions（api/materials/materials.controller.ts:35,81） |
| 报价与建单 | GET /print/price-config（api/payment/payment.controller.ts:58）→ POST /orders/quote（api/payment/order-quote.controller.ts:16）→ POST /print/jobs（api/print-jobs/print-jobs.controller.ts:60）→ 轮询 GET /print/jobs/:taskId（:84） |
| 出纸 | Agent：POST /terminals/:id/tasks/claim → PATCH /print-tasks/:id/status（api/terminals/terminals.controller.ts:172,198） |
| 落库 | 上传会话只在 Redis；FileObject（S:1145）、DocumentProcessTask/PiiFinding（S:1260/1338）；PrintTask+Order 建单（api/print-jobs/print-jobs.service.ts:481,498）；0 元单自动 markPaid(free)（:527-528）；Agent 回写 PrintTaskStatusLog 和 Order.taskStatus（api/terminals/terminals-agent.service.ts:668-689） |
| 后台可见 | 后台 /print-scan、/orders（A/routes/index.tsx:56,55） |
| 0 元前提 | 价目 print_bw_page 的 unitCents=0 |
| U 盘 | 走本机 Agent 的 /local/usb/status、files、upload（K/services/files/usbImportApi.ts:111-123），要真 Agent 加 bridge token，**不能脚本** |
| 清场 | 只有前端 KioskPrivacyGuard；/kiosk/session/* 没有前端调用 |
| 脚本 | 手机上传路径全程可纯 HTTP |

### 2 会员打印

| 项 | 结论 |
|---|---|
| 短信登录 | POST /member/auth/sms-code → /member/auth/login（api/member-auth/member-auth.controller.ts:63,78），需带当前协议版本（GET /kiosk/legal/:type，api/legal/legal.controller.ts:9） |
| 扫码登录 | POST /member/auth/qr/create（:143，Agent Bearer + x-terminal-id）→ 手机 /member/qr-login 确认（:161）→ claim（:182）。一体机页面走本机 Agent /local/qr-login/create（K/services/auth/memberQrLoginApi.ts:90），脚本可直接调后端 |
| 打印 | POST /print/jobs 带会员 Bearer，订单写入 endUserId（api/print-jobs/print-jobs.controller.ts:74-79） |
| 两端可见 | GET /me/print-orders（api/member-print-orders/member-print-orders.controller.ts:37）：一体机 /me/print-orders（K/routes/index.tsx:163；K/services/api/memberPrintOrders.ts:71）；小程序 pages/orders（M/pages/orders/orders.js:263-264） |
| 落库 | EndUser（S:859）、MemberLegalConsent（S:1943）、PrintTask、Order |
| 脚本 | 能 |

### 3 小程序下单 → 取件码 → 一体机核销

| 项 | 结论 |
|---|---|
| 小程序下单 | POST /files/kiosk-upload（api/files/files.controller.ts:133）→ 隐私检查（M/pages/print-upload/print-upload.js:268,284）→ POST /orders/quote → POST /me/print-orders，带 Idempotency-Key（member-print-orders.controller.ts:47；M/utils/api.js:1461-1472），生成 Order（unpaid + 取件码） |
| 一体机核销 | /print/pickup-claim（K/routes/index.tsx:225）→ POST /print/jobs/claim-pickup（print-jobs.controller.ts:35） |
| 未付款 | 返回 paymentSessionToken（api/print-jobs/pickup-order.service.ts:188-209）→ POST /orders/:id/pay（payment.controller.ts:63）→ 沙箱 simulate（:112）→ pay-status（:83） |
| 出纸 | POST /print/jobs/:orderId/release（print-jobs.controller.ts:47）建 PrintTask（pickup-order.service.ts:258）→ Agent 领取 |
| 两端状态 | 小程序 order-detail 读 GET /me/print-orders/:id（:78）；一体机读 /me/print-orders |
| 注意 | 小程序不做在线支付（M/utils/package-order.js:29），在一体机现场付 |
| 脚本 | 能（用短信登录令牌代替 wx-login） |

### 4 取件码分享与作废换新码

| 项 | 结论 |
|---|---|
| 分享 | 纯前端分享图（M/pages/print-pickup/print-pickup.js:756-760），没有后端记录 |
| 换新码 | POST /me/print-orders/:orderId/reissue-pickup-code（member-print-orders.controller.ts:84），替换 pickupCodeHash（api/member-print-orders/pickup-code-reissue.service.ts:24-26） |
| 旧码失效 | claim-pickup 按哈希查单，旧码查不到（pickup-order.service.ts:87） |
| 脚本 | 能 |

### 5 扫描 → 去打印 / 存进我的文档

| 项 | 结论 |
|---|---|
| 入口 | K /scan（K/routes/index.tsx:243） |
| 端点 | POST /scan/sessions（api/scan-tasks/scan-tasks.controller.ts:41）→ Agent GET /terminals/:id/scan-tasks/current-lease（:125）→ POST /terminals/:id/scan-sessions/deliver 上传文件（:137，Agent Bearer）→ 一体机 GET /scan/sessions/:id（:70）→ POST /:id/ack（:97） |
| 去打印 | 转 /print/desk?step=check，走隐私检查；图片提取文字要 OCR（api/materials/materials.service.ts:179） |
| 存我的文档 | 登录状态下自动归属（K/pages/scan/ScanResultPage.tsx:285,535-541）→ GET /me/documents（api/member-assets/member-assets.controller.ts:74）；小程序 pages/documents |
| 落库 | ScanTask（S:173）、FileObject |
| 变量 | `SCAN_TERMINAL_QUIET_PERIOD_SECONDS`（E:425） |
| 脚本 | 能：用 Agent 令牌调 deliver 模拟扫描件。图片件的隐私检查要 `OCR_PROVIDER=baidu`；disabled 时具体表现未确认 |

### 6 AI 简历

| 项 | 结论 |
|---|---|
| 入口 | K /resume/source → /resume/parse → /resume/report → /resume/optimize（K/routes/index.tsx:230-235） |
| 端点 | POST /resume/parse（api/ai/ai.controller.ts:169）、GET /resume/records/:id（:255）、GET /resume/records/:id/optimize（:271）、PUT/GET draft（:326/343） |
| 导出与打印 | POST /resume/records/:id/export（api/ai/resume-report-export.controller.ts:53）或 /resume/generate/export（ai.controller.ts:540）→ /print/jobs |
| 落库 | AiResumeResult（S:1825）、AiServiceLog（S:1905）、FileObject |
| 两端可见 | GET /me/resumes、/me/documents、/me/ai-records（member-assets.controller.ts:54,74,83）；一体机 K/routes/index.tsx:162-166；小程序 pages/resumes、documents、ai-records |
| mock | `AI_PROVIDER=mock` 能走 DOCX/PDF 文本；图片或扫描件要 OCR；导出单价行会自动补（price-config.seed.ts ensureResumeExportPriceConfig） |
| 脚本 | 能 |

### 7 简历生成 / 岗位对照 / 职业规划 / 自我探索

| 项 | 结论 |
|---|---|
| 简历生成 | POST /resume/generate（ai.controller.ts:424），mock 可用 |
| 岗位对照 | K /resume/job-fit → POST /resume/job-fit（api/ai/job-fit.controller.ts:140），支持手填岗位要求；打印 :177 |
| 职业规划 | POST /resume/career-plan/:taskId、打印（api/ai/career-plan.controller.ts:54,71） |
| 自我探索 | POST /resume/self-assessment、打印（api/ai/self-assessment.controller.ts:72,120） |
| 落库 | 都写 AiResumeResult |
| 脚本 | 只有简历生成能；另外三项要真实大模型密钥（外部服务），本地 stub 接不上 |

### 8 模拟面试（文字 / 语音）

| 项 | 结论 |
|---|---|
| 入口 | K /interview（K/routes/index.tsx:334） |
| 端点 | POST /mock-interviews（api/mock-interview/mock-interview.controller.ts:121）→ /:id/start（:130）→ /:id/answer（:138）→ /:id/end（:239）→ GET /:id/report（:256）→ POST /:id/report/print（:263） |
| 语音 | POST /:id/transcribe（:157）要 `ASR_PROVIDER`；GET capabilities/voice（:232） |
| 记录 | GET /me/mock-interviews（:291）：一体机 /interview?stage=reports；小程序 pages/interview-result |
| 落库 | MockInterviewSession/Turn/Report（S:2333/2361/2380） |
| 脚本 | 要真实大模型；语音还要腾讯或百度 ASR |

### 9 小青对话与 AI 顾问

| 项 | 结论 |
|---|---|
| 小青对话 | K /assistant：POST /assistant/chat（ai.controller.ts:589）、/assistant/voice（:639） |
| 要点总结 | POST /assistant/sessions/:id/summary（:709，要登录），写 AdvisorSession 和 AdvisorArtifact（S:3132/3186） |
| /ai/plan | 从总结条跳过去（K/pages/assistant/AssistantSessionSummaryBar.tsx:42），GET /advisor/sessions/:id（api/advisor/advisor.controller.ts:108）→ POST artifacts/:aid/print（:180） |
| 按办事入口的顾问 | 后端有 POST /advisor/sessions、/skill、/slots、/run、/ask（:99-157），**没有任何前端调用**（K/services/api/advisor.ts 只有 :57 GET 和 :68 打印） |
| 脚本 | 要真实大模型 |

### 10 政策

| 项 | 结论 |
|---|---|
| 浏览 | K /renshi（K/routes/index.tsx:183）→ GET /policies（api/policies/policies.controller.ts:109） |
| 本机构政策 | `POLICY_SCOPE=org`（E:112）再带终端头，只显示终端所属机构的政策 |
| 条件核对 | GET/POST eligibility（:128/:140） |
| 收藏 | POST /me/favorites，targetType=policy（api/member-favorites/dto/add-favorite.dto.ts:5） |
| 材料清单打印 | **未实现**，前端按钮置灰（K/pages/renshi/EligibilityResults.tsx:8-19） |
| 落库 | PolicyPost（S:715）、Favorite（S:2019） |
| 前置 | 种子没有政策，要先按第 18 条发布 |
| 脚本 | 除打印外能 |

### 11 本机构官方渠道

| 项 | 结论 |
|---|---|
| 入口 | K /official-channels（K/routes/index.tsx:257） |
| 端点 | GET /terminals/:id/official-channels（api/official-channels/official-channels.controller.ts:73；K/services/api/officialChannels.ts:77） |
| 二维码 | 前端生成（K/pages/official-channels/OfficialChannelsPage.tsx:16,56） |
| 数据来源 | 后台先设已验证域名 PUT /admin/orgs/:id/verified-official-domains（:29）；机构再 POST /partner/official-channels（:47），网址限定在已验证域名内 |
| 落库 | OnlinePlatformDirectory（S:2828） |
| 脚本 | 能（种子终端已绑定机构） |

### 12 意见反馈与 AI 内容投诉

| 项 | 结论 |
|---|---|
| 一体机匿名 | POST /kiosk/feedback（api/member-feedback/kiosk-feedback.controller.ts:28），含 ai_content_complaint（dto/kiosk-feedback.dto.ts:28,47）；匿名用户**看不到答复**（没账号） |
| 会员 | POST /me/feedback（member-feedback.controller.ts:24），类别 ai_content（dto/member-feedback.dto.ts:4）；小程序从 ai.js:126 进入。一体机会员反馈页没有 ai_content 类别：全仓只有 K/services/api/kioskFeedback.ts 命中，属未确认 |
| 后台处理 | /member-feedback（A/routes/index.tsx:71）：GET /admin/feedback（:18）、POST /:id/replies（:46）、PATCH /:id/status（:55） |
| 用户看答复 | GET /me/feedback/:id（:32） |
| 落库 | FeedbackTicket/FeedbackReply（S:2670/2705）；答复是否同时发通知（MemberNotification）未确认 |
| 脚本 | 能 |

### 13 个人数据导出、删除、账号注销

| 项 | 结论 |
|---|---|
| 入口 | K /me/privacy-requests（K/routes/index.tsx:177）；小程序 pages/privacy |
| 导出 | POST /me/data-requests（api/member-privacy/member-privacy.controller.ts:102），需要短信二次验证（member-auth.controller.ts:114,131）和 BullMQ 队列（member-data-request.service.ts:71,294）→ 下载授权 :120 → GET /member/data-exports/:id/content（member-data-export.controller.ts:12）；变量 `MEMBER_EXPORT_PUBLIC_WEB_BASE_URL`（E:466） |
| 单项删除 | DELETE /files/:id（files.controller.ts:412）、/me/ai-records/:id（member-assets.controller.ts:98）、/me/resumes/:id（:146） |
| 账号注销 | requestType=delete 如实拒绝，返回 ACCOUNT_CLOSURE_NOT_AVAILABLE（member-data-request.service.ts:62-63） |
| 后台 | /privacy-requests（A/routes/index.tsx:84）→ GET /admin/member-privacy/data-requests（:37） |
| 落库 | UserDataRequest（S:1958） |
| 脚本 | 能 |

### 14 协议未发布时拦住登录

| 项 | 结论 |
|---|---|
| 开关 | `LEGAL_DOCS_REQUIRE_PUBLISHED=true`（api/member-auth/legal-docs-published-guard.ts:31-34；E:173），不设时只在生产拦 |
| 未发布 | 登录返回 403 LEGAL_DOCS_NOT_PUBLISHED（guard :47-48；member-auth.service.ts:193） |
| 发布 | 后台 /legal-docs（A/routes/index.tsx:83）：POST /admin/legal-doc-versions → PATCH /:id/activate（api/legal/admin-legal-docs.controller.ts:23,35），写 LegalDocVersion（S:2730） |
| 版本不一致 | 返回 LEGAL_VERSION_STALE（member-auth.service.ts:208） |
| 脚本 | 能 |

### 15 AI 暂停 / 维护

| 项 | 结论 |
|---|---|
| 开关 | 后台 /ai-services（A/routes/index.tsx:60）→ PUT /admin/ai-access（api/ai-access/admin-ai-access.controller.ts:17），存 Redis `system:ai-access:*`（ai-access.service.ts:12,62）；启动兜底读 `AI_PAUSED`、`MAINTENANCE_MODE`（E:108-109） |
| 暂停效果 | 所有非只读 AI 接口返回 503 AI_PAUSED（ai-access.service.ts:76） |
| 打印扫描照常 | 打印/扫描/上传只挂了维护开关（print-jobs.controller.ts:65、scan-tasks.controller.ts:44、upload-sessions.controller.ts:44），只有维护模式才会拦（:74）；隐私检查豁免（materials.controller.ts:37,83） |
| 前端提示 | K/services/api/userErrorMessage.ts:94-95；M/utils/user-error.js:57-58 |
| 脚本 | 能 |

### 16 断网提示（只说明前端检测）

- /error-offline（K/routes/index.tsx:149）同时看三样：GET /health（5 秒超时）加 navigator.onLine（K/pages/placeholders/ErrorOfflinePage.tsx:9,191）、printer-status（:121）、online/offline 事件（:237）。
- 首页也有同样检测：K/pages/home/hooks/useHomeDeviceStatus.ts:20,73,124-125。
- 纯前端，靠浏览器模拟断网验证。

### 17 管理员后台

| 功能 | 页面 → 端点 → 落库 |
|---|---|
| 终端管理 | /devices（A/routes/index.tsx:50）→ /admin/terminals 下的列表、新建、绑定码、换机构、能力、档案、生命周期、紧急吊销（admin-terminals.controller.ts:60-244） |
| 订单与退款 | /orders（:55）→ GET /admin/orders（api/admin-orders-readonly/admin-orders-readonly.controller.ts:79）→ POST /admin/orders/:id/refund（api/payment/admin-order-actions.controller.ts:65）→ Refund（S:623） |
| 告警 | /alerts（:73）→ GET /admin/alerts、POST /admin/alerts/disposition（api/admin-ops/admin-ops.controller.ts:48,59）→ AlertDisposition（S:381） |
| 法务、AI 开关 | 见第 14、15 条；AI 模型配置 /ai-config（:61） |
| 改价 | /billing（:57）→ PUT /admin/billing/price-config/:key（api/payment/admin-billing.controller.ts:33）；一体机报价实时读库（pricing.service.ts:92） |
| 紧急下架 | 公司、招聘会、政策源、机构等页面里的弹窗 → POST /admin/recruitment-emergency/takedown 和 circuit-break（api/recruitment-hosting/recruitment-emergency.controller.ts:54,61），范围含 policy 和 official_channel → RecruitmentEmergencyHold/CircuitBreak（S:2488/2504） |
| 脚本 | 全部能 |

### 18 机构后台

| 功能 | 结论 |
|---|---|
| 政策发布 | /policy（P/routes/index.tsx:35）：POST /partner/policies → PATCH review → PATCH release（policies.controller.ts:179,253,260），平台管理员不审核 |
| 官方渠道 | 在 /profile 页（:29）→ /partner/official-channels 的增删改（official-channels.controller.ts:40-66） |
| 终端数据 | /terminals（:36）只有空状态，**未实现**（P/routes/terminals/index.tsx:5-13） |
| 服务人次 | 大屏把 visitCount 标成不可用（api/console-screen/console-screen.assemble.ts:162）；一体机从不调 /kiosk/session/*（api/kiosk-session/kiosk-session.controller.ts:18-34） |
| 统计 | /stats → GET /partner/stats（api/orgs/partner-stats.controller.ts:45） |
| 导出 | **没有导出端点**，只有导入模板下载 |

### 19 数据大屏

| 项 | 结论 |
|---|---|
| 位置 | 后台 /screen 和 /screen/:tab（A/routes/index.tsx:48-49）；机构后台 /screen（P/routes/index.tsx:27-28） |
| 数据端点 | GET /admin/screen/snapshot、/admin/screen/terminals/:id（api/console-screen/console-screen.admin.controller.ts:20,26）；/admin/screen/usage（console-screen.usage.controller.ts:32）；机构版在 console-screen.partner.controller.ts:24,45 和 usage.controller.ts:49 |
| 统计来源 | 对 Order、PrintTask、ScanTask、AiServiceLog、TerminalHeartbeat、BrowseLog 等直接计数 |
| 对比注意 | 大屏有进程内缓存 15/60/300 秒（console-screen.cache.ts:14-18），要等过期再对比 |
| 首页不同源 | 后台首页（:47）用的是另一组端点：/admin/terminals、/admin/printers、/admin/alerts、/admin/print-tasks、/admin/ai/usage（ai.controller.ts:729） |

### 20 Agent：领任务、出纸、回写、缺纸告警

| 项 | 结论 |
|---|---|
| 鉴权 | `Authorization: Bearer <agentToken>` 加 `X-Terminal-Id`（apps/terminal-agent/src/agent/api-client.ts:6-7,51-52） |
| 拿凭证 | 种子令牌；或 POST /auth/terminal/register 带 adminSecret（terminals.controller.ts:59；terminals-agent.service.ts:244）；或后台绑定码 POST /admin/terminals/:id/bind-code（admin-terminals.controller.ts:104）→ POST /auth/terminal/exchange-bind-code（terminals.controller.ts:67） |
| 循环 | PUT /terminals/:id/heartbeat（:75）→ POST /terminals/:id/tasks/claim，maxTasks 1–3（:172；真 Agent 每 5 秒一次，task-runner.ts:853）→ 下载签名 fileUrl → PATCH /print-tasks/:id/status，printing/completed/failed（:198；dto/patch-task-status.dto.ts:5） |
| 缺纸 | 心跳 printerStatus=paper_empty 派生出 printer_issue 告警（api/admin-ops/derived-alerts.ts:36,213-225），后台 /alerts 可见 |
| 恢复 | 心跳改回 ok/ready/idle（api/terminals/printer-status.ts:6） |
| 脚本 | 全部可纯 HTTP；**仓库没有现成模拟 Agent**，要自己写 |

### 现有脚本：哪些用真后端走过

- **进程内启动真实 AppModule，连真库和真 Redis 发 HTTP**（可直接复用）：
  - verify-member-auth.ts（:121、:303 读 Redis 验证码）——第 2、14 条
  - verify-member-qr-login.ts（:59）——第 2 条
  - verify-upload-sessions-http.ts（:777）——第 1 条上传段
  - verify-ai-access.ts（:359）——第 15 条
  - verify-member-assets-c2d.ts（:81）——第 2、6 条的「我的」
  - 以上都在 services/api/scripts/。
- **需要外部已起好的后端**：
  - apps/kiosk/tests/interaction/ai-resume-journey.spec.ts 加 playwright.interaction.config.ts，要 5273 和 3010 都在跑、`AI_PROVIDER=mock`——第 6 条。
  - apps/miniapp/tools/cross-end-member-parity.mjs（`--base --token`）比对两端「我的」数据——第 2、3、6、8 条。
- **进程内 Nest，但依赖是替身（不算真后端）**：verify-admin-ops、verify-print-jobs、verify-pickup-terminal-http、verify-console-screen-*、verify-member/package-order-idempotency-http。
- **service 级直接调库**：verify-miniapp-cloud-print-m2（第 3 条）、verify-pickup-code-share（第 4 条）、verify-scan-tasks、verify-policies、verify-official-channels、verify-feedback-notifications、verify-legal-doc-version、verify-member-data-export、verify-admin-orders-refund、verify-admin-billing、verify-kiosk-session；verify-mock-interview 和 verify-career-plan 用的是替身大模型。
- **全是 mock**：一体机 visual 用例；admin/partner e2e（`VITE_API_MODE=mock`，apps/admin/playwright.config.ts:46）。
- **模拟 Agent**：没有。terminal-agent 里没有 mock 或空跑模式。
- **种子**：services/api/prisma/seed.ts，另有 seed-fairs.ts、seed-companies.ts、seed-venue-guide.ts；价目 seed 函数没有被 seed.ts 调用。
- **本地全栈启动**：只有 .claude/launch.json（api 3010、kiosk 5273、admin 5274、partner 5275），其中 kiosk 那条写死了主仓库路径；根目录 package.json:11 的 `dev` 只起三个前端；没有 docker-compose；Redis 要手动起。

### 这 20 条里在 C 上没实现、或只有前端/只有后端的

1. **第 9 条「按办事入口的 AI 顾问」只有后端**：/advisor 的创建、执行、提问接口在，没有任何前端调用。一体机 /ai/plan 只能从小青的总结进入。
2. **第 10 条政策材料清单打印没做**：前后端都没有，前端按钮是置灰的。
3. **第 18 条机构后台三项缺失**：
   - 终端数据页只有空状态；
   - 服务人次：后端写入接口和查询函数都在，但一体机从不写，大屏如实显示不可用；
   - 导出：没有。
4. **第 1 条清场只在前端**：服务端会话结束接口没接上。
5. **第 1 条 U 盘、第 5 条真扫描**：依赖真实 Agent 和硬件。
6. **第 7、8、9 条**：没有本地大模型替身；第 8 条语音还要真实 ASR。
7. **第 4 条分享**是纯前端（小程序分享图），没有后端部分。
8. **第 12 条**：匿名反馈的用户看不到答复（没账号），答复要走会员路径。
9. **第 13 条账号注销**按设计如实拒绝，符合要求。