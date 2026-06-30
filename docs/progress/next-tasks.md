# 下一步任务

> 最后更新：2026-06-30
> 入口用途：当前任务池与执行顺序。历史任务长记录文本已归档到 `docs/progress/archive/2026-06-20-next-tasks-pre-normalization.md`；归档时行尾空格按仓库 whitespace 检查规范化。

## P0：项目规范化治理

- [x] **P0 治理基线**：保留现有 monorepo，不新建仓库；已新增 `docs/project-structure.md` 与 `.ccg/spec/guides/index.md`。
- [x] **主工作区分类规则**：已输出 `docs/reviews/project-normalization-p0-worktree-inventory.md`，明确 A/B/C/D/E 类处理口径。
- [x] **Codex + Claude 协作模式**：已输出 `docs/reviews/project-normalization-codex-claude-collaboration.md`，确认 Claude 只做草案/清单，Codex 落盘，Antigravity + Claude 双模型复审。
- [x] **T0 真值对齐**：已输出 `docs/reviews/project-normalization-truth-audit.md`，确认三层状态并存，不能整包同步或整包清理。
- [x] **T1 进度文档收口**：已将入口文档短版化，保留历史归档，不迁入运行时代码。
- [x] **T2 E 类本地工具状态 ignore 提案**：已输出提案文档；T3 已按“先抽取再 ignore”落地，不直接清理本地文件。
- [x] **T3 E 类本地工具落地**：已抽取 `.product-pm/prd/print-material-pack.md` 与 `.superpowers` HTML 预览摘要，并写入根路径锚定 ignore 规则；不删除本地文件。
- [x] **T4 C 类任务证据筛选**：已输出任务证据筛选报告；只登记高价值摘要、脱敏规则和后续任务，不提交原始 `.ccg/tasks` 包。
- [x] **T5 D 类外部材料索引**：已输出外部材料索引报告；只登记 Markdown 转正候选、PDF/二进制外部归档规则、OPC 输出处置，不提交原始外部材料。
- [x] **T5 派生旧 PDF、docs 旧材料与 deliverables 清理**：已将旧 B2G/B2B2C 方案 PDF、本地 docx 原稿、旧 handoff 交接文件、两个已弃用 HTML 预览和 `deliverables/` 宣传片 / 交付物 Markdown 移出正式 Git；原始材料归档到本地 `其他文档/`，仓库内保留 Markdown 摘要、审计事实、当前正式入口和 OPC 交付物 sha256 完整性记录。
- [x] **剩余候选分支定级**：已输出并更新 `docs/reviews/remaining-branch-candidates-2026-06-25.md`；旧 UI、QR 登录、Sprint1 订单、Sprint1 Partner dashboard、面试重设计本地候选与备份候选均已完成迁移 / 取舍 / 清理，当前无剩余本地或远程候选分支。

## P0：剩余分支 / worktree 收口

- [x] **QR 登录候选合入与旧 worktree 清理**：#91 已通过 rebase merge 合入 `main`，运行时代码基线为 `535587e0`；旧 `codex/qr-ticket-login` dirty worktree / 分支已按证据清理，本次过渡分支 `codex/qr-login-local-agent-bridge` 的本地 / 远程 head 也已清理。
- [x] **订单模型候选选择性迁入**：已从干净 `main` 另起 `codex/order-model-foundation`，仅迁入订单底座、打印任务创建时的未支付订单记录、Terminal 状态镜像、SQLite/PostgreSQL additive migration 和 `verify:order` 门禁；不迁 PaymentAttempt / Refund / Partner dashboard / 旧 Sprint1 顶层栈。源远程候选已在确认内容被主线覆盖后清理。
- [x] **Admin 订单只读补齐**：已从 `origin/feature/sprint1-partner-dashboard` 选择性提取订单只读价值，补齐 `GET /admin/orders` / `GET /admin/orders/:id` 与 Admin `/orders` 只读列表 / 详情；不迁标记支付、退款、改状态等旧写操作。
- [x] **Admin alerts 候选取舍**：已完成 Codex + Claude 只读复核；当前 `main` 的实时派生告警已有真实数据源和 `verify:admin-ops`，旧候选的持久化 `Alert` 表只有 dev seed、无生产告警生产器，故不迁数据库模型或处理按钮。
- [x] **Partner dashboard / profile 候选取舍**：已完成 Codex + Claude 只读复核；旧 profile 会扩大 Partner 自助改名、信用代码等权限，旧 dashboard 已被主线含政策统计的真实聚合取代；本分支仅新增当前主线形态的 `verify:partner-org-self` 锁住资料 allowlist、机构隔离、真实聚合和无伪指标边界。
- [x] **Sprint1 顶层旧栈最终清理**：`origin/feature/sprint1-partner-dashboard` 的订单、Admin orders、Admin alerts、Partner profile/dashboard 价值均已完成取舍；#98 已 rebase merge 到 `main`，旧远程 head 已删除。未整分支合并，未执行 `prune` / `gc`。
- [x] **面试重设计候选取舍**：已完成只读深审并由 #100 收口唯一可迁移的旧 `/interview/setup-preview` 清理点；正式 `/interview/setup` 真实链路保留，旧分叉本体不迁，fair verify residue guard 已由当前 `main` 更新版覆盖。
- [x] **最终清理**：#100 已 rebase merge 到 `main`，本地 / 远程过渡分支已清理；`feature/interview-setup-redesign`、`backup/interview-b65d6e48`、本地 `keep/b65d6e48` tag 和无独有内容的 `codex/kiosk-design-style-sample` worktree / 残留目录已删除。本 docs 分支合入并清理后，本地分支、远程 head、worktree 均只剩 `main` / 主仓；未执行 `prune` / `gc`。

## P0：上线前真实验收

- [ ] 生产域名与 HTTPS：完成域名解析、证书、nginx 反代、上传限制和自动续期。
- [ ] PostgreSQL 生产实例：`migrate deploy`、seed、核心 verify、备份恢复演练通过。
- [ ] Redis 生产连接：队列/缓存配置、访问权限和内网隔离确认。
- [ ] COS 生产私有桶：CAM 最小权限、上传/下载/删除 live 冒烟。
- [ ] 腾讯短信：签名/模板审核、真实 CAM Key、真号登录 E2E 后才能启用 `SMS_PROVIDER=tencent`。
- [ ] 百度 OCR / AI / TRTC / ASR / TTS：生产 Key、权限、失败兜底和 live 冒烟按启用范围验收；AI 简历相关功能先运行 `pnpm --filter @ai-job-print/api verify:llm-connectivity`。2026-06-30 本地已换入有效 DeepSeek key，并通过本地运行时配置同步 active LLM 功能；`verify:llm-connectivity -- --all` 已覆盖 `assistant_chat` / `resume_diagnosis` / `resume_generate` / `resume_optimize` / `mock_interview` 全部通过。后续仍需在预生产 / 生产环境分别注入有效密钥并做 live 冒烟，不得复用聊天中暴露过的旧 key。
- [ ] 生产运行时环境变量：部署脚本 / PM2 必须显式固定 `NODE_ENV=production`，并在 health / 启动日志验收中确认生产运行时门禁实际生效。
- [ ] Windows 真机：Terminal Agent、奔图打印机、打印真实出纸、扫描链路、断网/重启恢复逐项记录。
- [ ] 法务合规：用户协议、隐私政策、AI 免责声明、招聘信息来源免责声明审定。
- [ ] 小范围试运营：仅 1 台终端 + 1 台打印机先跑，问题记录按任务闭环处理。

2026-06-21 补充：`codex/preprod-deployment-acceptance` 已先把 TRTC assistant guard 代码包部署到百度云预生产，三端公网 HTTP health 均返回 PostgreSQL；COS live 冒烟通过并已切 `FILE_STORAGE_DRIVER=cos`；临时 HTTPS/hosts 映射已可用；预生产服务器上 `verify:member-assets-c2d` 与 `verify:activity-logs` 通过。下一步不能直接进入试运营，需先补百度 OCR Key 与 live 验证、AI/TRTC/ASR/TTS 按启用范围验证、腾讯短信审核后的真实登录 E2E、正式域名 HTTPS 复验，以及 Windows 裸机 + Terminal Agent + 奔图真机验收。

2026-06-22 补充：`codex/file-assets-preprod-integration` 已把用户文件资产商用闭环栈与预生产验收候选合到同一分支，后续预生产/试运营应以该集成候选为基线继续执行；这仍不代表真实生产/试运营执行完成。

## P0：打印扫描首期全功能收口

- [x] **打印扫描板块商用级方案确认与实施总计划**：已输出 `docs/product/print-scan-commercial-plan.md` 和 `docs/superpowers/plans/2026-06-30-print-scan-first-release-full-scope.md`，基于竞品调研、前台体验审计、后端 / Terminal Agent 审计、产品合规审计和 Antigravity 只读审查；2026-06-30 用户确认首期目标调整为全功能商用版本，Claude 复审因本地 Claude Code 会话额度限制未取得有效报告，用户已确认本轮改用 Antigravity 复审即可。Antigravity 修订后复审结论 `APPROVE`，剩余奔图 mode 映射和 Agent claim TTL 建议已补入计划。本项只代表方案与实施计划确认，不代表运行时代码、生产部署或真机验收完成。
- [ ] **首期安全底座**：打印任务创建时必须绑定目标 `terminalId`，Terminal Agent claim 必须按自身 `terminalId` 过滤；本地 SQLite / `better-sqlite3` 不可用时必须 fail-closed；Admin 必须能看到终端 degraded、离线、打印机异常和状态回传积压。
- [ ] **首期服务中心与能力开关**：首页“打印扫描”组标题进入 `/print-scan` 服务中心；`/print-scan` 展示文档打印、手机扫码上传、材料包、扫描、证件复印、证件照、U 盘、云上传、格式转换、签名盖章和我的文档 / 打印订单 / 异常反馈；所有能力由 FeatureGate / DeviceCapability / Admin 配置控制，未通过验收时不能创建正式任务。
- [ ] **首期基础打印闭环**：文档打印、图片打印、简历打印、求职材料打印、招聘会资料打印统一进入真实 `PrintTask`；补任务编号、目标终端、排队 / 已领取 / 打印中 / 完成 / 失败说明、关联反馈和可控重试；不得混用支付状态、打印状态和人工确认状态。
- [ ] **首期手机扫码上传 / 云上传 / 安全取件**：支持手机扫码上传到当前一体机、会员或一次性会话绑定当前终端、安全取件码或本机确认码；禁止公网远程直控打印机；签名 URL 过期、未确认上传和未取件任务必须自动 expired / 清理。
- [ ] **首期 AI 文件体检与材料包**：AI 检查尺寸、方向、空白页、清晰度、页数和敏感信息；材料包可从我的简历、我的文档、招聘会资料、求职材料中选择，支持 AI 建议组合、逐项参数、顺序打印、子任务失败单独重试。
- [ ] **首期真实扫描**：接入 TWAIN / WIA 或扫描目录监听，支持 ADF / 平板、DPI、单双面、PDF / JPG 输出、AI 裁边 / 纠偏 / 去阴影 / 去空白页 / OCR；扫描结果进入高敏短 TTL 文件流，支持保存、打印和删除。
- [ ] **首期证件复印与证件照**：证件复印支持身份证正反面 A4 合成，默认不长期保存；证件照支持上传照片、抠图、换底色、规格检测、排版 PDF 和打印；身份证 / 证件照采集必须通过“采集 -> 使用 -> 删除 -> 审计”真机验收。
- [ ] **首期 U 盘导入**：Terminal Agent 只读枚举 U 盘文件，校验扩展名、MIME、大小、隐藏文件和路径；拔出后清理本地缓存；只在用户确认后上传并创建正式 `FileObject`。
- [ ] **首期格式转换与签名盖章**：Word / 图片 / PDF 转换必须生成真实派生文件后再打印；隐私遮挡必须生成替换文件并由用户确认；签名盖章只作为图形排版能力，必须有“非 CA 电子签”免责声明。
- [ ] **首期 Admin 商业化和运营后台**：统一任务中心覆盖打印、扫描、复印、证件照、材料包；支持取消、重试、释放卡住任务、人工确认、重新派发；补价格策略、权益券、免费额度、补贴核销、退款 / 异常处理、终端 / 设备能力、文件生命周期、审计和统计看板。
- [ ] **首期验收门禁**：每个能力必须有前台页面、后端数据模型、Terminal Agent / 外设链路、Admin 管理、数据流、异常处理、审计和 verify；未通过真机、生产链路、隐私删除和合规验收前，不能对外宣称正式生产或试运营完成。

## P1：渐进式重构首批业务闭环

首批业务闭环不按目录搬家，按可验收业务流推进。

- [x] **我的页商用闭环计划与准入**：已输出 `docs/superpowers/plans/2026-06-21-profile-commercial-closure.md` 和 `docs/reviews/profile-commercial-closure-planning.md`；目标从“做出闭环”修正为“收口计划、拆分准入和首批执行任务定义”。
- [x] **我的页商用闭环 Branch 1：ProfilePage 拆分**：纯结构拆分，零行为变更；`ProfilePage.tsx` 已降到 177 行，入口、路由、文案和行为保持不变。
- [x] **我的页商用闭环 Branch 2：AI 服务记录页**：已新增 `/me/ai-records`，复用 `getMyAiRecords` / `deleteMyAiRecord`，修正「AI服务记录」入口，不展示 payload 或简历原文。
- [x] **我的页商用闭环 Branch 3：打印订单关联反馈**：从 `/me/print-orders` 跳转 `/me/feedback?category=print&relatedPrintTaskId=...`，提交时带 `relatedPrintTaskId`，以后端归属校验为安全边界；已补齐 `verify-member-print-orders` 分页正路径。
- [x] **AI 简历上传 / 资产中心计划与准入**：已输出 `docs/superpowers/plans/2026-06-21-ai-resume-assets-closure.md` 和 `docs/reviews/ai-resume-assets-closure-planning.md`；确认首个真实缺口是 `/me/resumes` Kiosk 页面缺失。
- [x] **AI 简历上传 / 资产中心 Branch 1：我的简历页**：新增 `/me/resumes`，复用 `getMyResumes`，Profile「我的简历」入口从上传页改为本人简历元数据页，上传入口保留在「AI简历服务」和空态 CTA。
- [x] **AI 简历上传 / 资产中心 Branch 2：我的简历动作 hardening**：确认报告回看、继续优化、岗位匹配、生成简历预览均通过 `taskId + member token` 恢复；不新增后端，除非现有页面确实缺门禁读取能力。
- [x] **AI 简历上传 / 资产中心 Branch 3：我的文档删除交互**：单独给 `/me/documents` 补本人删除按钮和两步确认，继续复用 `deleteMyDocument` 与 `verify:member-assets-c2d`。
- [x] **规范化治理与首批业务闭合集成收口**：`codex/normalization-business-closures-integration` 已从干净 `main` 快进集成 18 个已验证提交，完成总验证、敏感信息扫描和 Claude + Antigravity 最终审查；无 Critical，可交付。
- [x] **招聘会 / 校园招聘准入审查**：已输出 `docs/reviews/jobfair-campus-closure-admission.md` 和 `docs/superpowers/plans/2026-06-21-jobfair-campus-closure.md`；确认不新增入口、不做报名/签到/候选人闭环，后续拆为 3 个独立分支。
- [x] **招聘会 / 校园招聘 Branch 1：列表页本校优先接线**：`JobFairsPage` 调用 `getTerminalId()` 并透传 `getJobFairs(terminalId ? { terminalId } : undefined)`，对齐 `/campus` 已有本校优先排序；新增 `verify-jobfairs-terminal-priority` 防回退脚本，不改 UI、不改后端。
- [x] **招聘会 / 校园招聘 Branch 2：参展企业外部投递跳转记录**：新增 `fair_company` activity target，限定 `external_apply`；`FairCompanyDetailPage` 使用真实 `SourceUrlQr` 并记录本人外部入口打开；`/me/activity` 支持参展企业记录回跳。
- [x] **招聘会 / 校园招聘 Branch 3：大页面零行为拆分**：已拆分 `CampusPage`、`JobFairDetailPage`、`FairCompanyDetailPage`，保持路由、接口、文案和行为不变；新增 `verify:jobfair-size` 并接入 `verify:jobfair-ui`，已完成 Claude + Antigravity 双模型审查。
- [x] **招聘会三入口 AI 商用闭环首批实现**：已完成 P0 真实数据 / 合规防回退、P1 `fair_visit_plan` 参会准备单和来源签到入口。Kiosk 封堵 `aiMatchScore` / AI 百分比分、平台内投递 / 签到结果文案、`isMockData` 统计展示和活动资料签名 URL 过期；后端新增真实 `fair_visit_plan` AI 链路，基于已发布招聘会与本人简历生成准备单，落 `AiResumeResult(kind=fair_visit_plan)`，会员 AI 服务记录可见，PDF 走 `FileObject` + 打印确认链路。`扫码签到` 已接真实 `checkinUrl` 字段、Admin 审核详情、Partner 编辑 / 导入、Excel 白名单、Kiosk `/job-fairs/checkin` 和详情页二维码；Activity 只记录 `external_checkin_open` 打开动作，不记录签到结果。已通过 `verify:jobfair-commercial-closure`、`verify:fair-visit-plan`、`verify:jobfair-checkin`、API/Kiosk/Admin/Partner typecheck；仍需真实 PostgreSQL/COS/LLM 预生产浏览器验收、Windows 真机出纸和公网扫码域名验收。
- [x] **用户文件保存期限 Branch 2：策略服务与清理门禁**：`FileObject.expiresAt` 支持 `long_term` 的 `null` 语义；会员本人可改本人文件保存期限；原始文件首批仅 3/6 个月，`optimized/derived` 成果物可长期，证件/匿名/系统文件保持短期；补 `verify:file-retention` 与 Admin/Kiosk 可空兼容。
- [x] **用户文件保存期限 Branch 3：Kiosk 文件保存期限 UI**：`/me/documents` 展示当前保存期限和后端允许策略；本人可设置 3 个月 / 6 个月 / 成果物长期保存，6 个月 / 长期保存自动带当前保存条款版本；保存条款版本由 shared/API 本地副本常量收敛并有防回退验证。
- [x] **用户文件保存期限 Branch 4：Admin 文件生命周期运营视图**：Admin `/files` 复用现有入口展示保存策略、设置来源、同意时间、长期保存数量和即将到期/待清理统计；新增全库只读 `GET /files/lifecycle-summary`，不受列表 `limit=200` 截断；管理员无保存期限修改入口，查看文件兼容 COS 绝对签名 URL。
- [x] **用户文件保存期限 Branch 5：COS 生命周期与隐私文案验收**：采集点、帮助中心、隐私政策、Admin 文件横幅统一为短期 / 90 天 / 180 天 / 长期保存口径；新增 COS 生命周期合规文档，明确禁止 Bucket 全局过期规则、`long_term` 防误删人工验收和截图存档；新增 `verify:legal-retention-copy` 与 `verify:cos-lifecycle-policy`。
- [x] **用户文件与简历资产证据包**：新增 `docs/acceptance/user-file-assets-trial-acceptance.md` 和 `verify:file-assets-trial-acceptance`，把生产/试运营验收拆成 PostgreSQL、COS 私有桶、会员账号、上传原始文件、上传优化后或修改后文件、90 天 / 180 天 / 长期保存、重登查看、删除三态一致、过期清理、`long_term` 防误删、AuditLog 审计和证据脱敏；静态验证只证明证据包完整，不代表真实生产/试运营执行完成。
- [x] **用户文件资产 + 预生产候选集成**：`codex/file-assets-preprod-integration` 已合并文件资产保存期限栈、生产/试运营证据包、TRTC assistant 生产构建守卫和预生产阶段性记录；后续真实验收应基于该集成候选继续，不再用只含 TRTC guard 的预生产分支替代。
- [x] **简历素材库 / 求职材料商用闭环整改**：两个既有首页入口已拆成独立页面：`/resume/templates` 为简历素材库，只展示简历模板/版式素材并引导 AI 简历优化；`/resume/materials` 为求职材料库，保留求职信 / 感谢信 / 作品集封面 / 材料清单生成真实 PDF、会员 `FileObject` 进入 `/me/documents`、我的文档重签 URL 后打印、Admin 只读 `/job-materials` 运营统计。已补 Kiosk 防回退 verify 锁定两个入口不再混用；2026-06-30 已补本地真实 API + Redis + local storage + Playwright Chromium 页面级复验，覆盖 `/login?from=/resume/materials` 会员登录、生成 PDF、进入 `/me/documents`、从我的文档点击打印并到达 `/print/confirm`，测试文件已清理；同日预生产发现 Kiosk dist 缺草稿保存逻辑后，已只覆盖 `apps/kiosk/dist` 做静态包热更新，并用 `SESSION-B_REDIS_TEST_CODE` 完成新版 `/resume/materials -> 登录 -> 草稿恢复 -> 生成 PDF -> /me/documents -> /print/confirm` 公网浏览器 E2E，测试 COS 对象、FileObject、AuditLog、EndUser 和 Redis 会话已清理。本项不包含动态模板 CRUD、Partner 上传模板、支付套餐、平台投递、正式域名 HTTPS / 真实短信上线 E2E 或 Windows 真机验收。
- [x] **岗位信息页商用级代码侧整改**：Kiosk `/jobs` 已补岗位数据概览、筛选助手、来源机构、热门标签、客户数据接入提示、字段完整度和商用结果卡片；`/jobs/:id` 已补岗位摘要、职责与要求、来源可信区、后续动作、扫码投递和去来源平台投递；新增 `verify:job-info-ui` 防回退。该项只代表代码侧页面闭环增强，仍需客户真实岗位数据样本、预生产公网浏览器和一体机现场触控验收；不得误写为平台投递或招聘闭环完成。
- [x] **岗位信息 AI 商用闭环开发计划**：已输出 `docs/superpowers/plans/2026-06-30-job-info-ai-commercial-closure.md`，并记录 `.ccg/tasks/job-info-ai-commercial-closure/requirements.md` 与双模型审查摘要；计划明确先做生产禁 mock / 真实服务门禁，再做共享契约、数据库 additive schema、Job AI 后端、Kiosk 求职者优先页面、Admin 数据质量、Partner 来源质量、隐私同意 / 限流 / 删除导出和真实验收。本项仅代表计划完成，不代表运行时代码或商用闭环已完成。
- [x] **岗位信息 AI 商用闭环 Task 1：生产真实服务门禁**：后端生产启动门禁已要求 PostgreSQL、Redis、COS、腾讯短信、百度 OCR、`AI_PROVIDER=llm` 和真实 LLM 密钥，拒绝 mock AI、未闭环 AI provider stub、OCR disabled 和缺失 Redis；Kiosk 生产构建已拒绝非 `VITE_API_MODE=http`，避免生产包使用 mockAdapter。已通过 API/Kiosk `verify:production-real-services`、API `verify:production-runtime-gates`、API/Kiosk typecheck 和 `git diff --check`，CI 串行 verify 已接入 API/Kiosk 生产真实服务门禁与 Kiosk 生产构建配置验证。本项不代表岗位 AI 推荐、结果落库、Admin/Partner 看板、live 外部服务或真机验收完成。
- [x] **岗位信息 AI 商用闭环 Task 2：共享契约与 additive schema**：`packages/shared` 已补岗位质量、标准化字段、岗位 AI 会话、推荐请求/响应和三档参考等级契约；Prisma 已新增 `JobAiSession`、`JobAiRecommendation`、`AiServiceLog`、`UserAiConsent`、`UserDataRequest`、`JobDataQualitySnapshot`，并以可空 / 默认字段扩展 `Job`；SQLite/PostgreSQL 双 migration 均为 additive；`verify:job-ai` 已接入 CI，覆盖双迁移、隐私禁存、匿名 token hash / TTL 和禁止招聘闭环状态。该项不代表推荐接口、真实 LLM 调用、Admin/Partner 看板或生产迁移完成。
- [x] **岗位信息 AI 商用闭环 Task 3：岗位数据质量与来源可用性**：`JobQualityService` 已计算岗位必填字段、AI-ready 字段、来源 URL 格式、同步过期和有效期，写入 `JobDataQualitySnapshot`；API 导入、Webhook、Excel 确认、Partner 编辑和 JobSync 拉取后都会刷新质量快照；Import DTO 与 Excel 字段白名单已支持学历、经验、技能、福利、薪资上下限、薪资单位和有效期；公开列表对缺失薪资展示“来源平台未提供”。`verify:job-data-quality` 已接入 CI；本地验证覆盖 API typecheck、`verify:job-ai`、`db:pg:sync:check`、临时 SQLite 空库 `verify:job-fit` / `verify:job-sync`。该项不代表 AI 推荐接口、Admin/Partner 质量看板、生产迁移或客户真实数据验收完成。
- [x] **岗位信息 AI 商用闭环 Task 4 + Task 5 后端底座：Job AI 后端推荐 / 隐私 / 配额 API**：已新增 `JobAiModule` 与 recommendations / explain / match / me sessions 后端 API；推荐只基于 `approved + published` 真实岗位和已授权会员简历解析任务，匿名访问 token 仍只用于任务归属校验，简历推荐在无当前版本 `job_ai` 授权时 fail-closed；explain 未登录 fail-closed。`MemberPrivacyModule` 支持会员授权状态、授权、撤回、本人数据请求和 Admin 处理留痕；Admin 处理写入真实 `AuditLog.id`，`delete` 类型请求 completed 时会物理删除本人 `JobAiSession` 并依赖级联删除推荐明细；`JobAiQuotaService` 使用 Redis 按 member / terminal / IP 做日配额，Redis 异常 fail-closed，超限或异常会回滚已自增维度，配额自然日按北京时间计算。`AiServiceLog` 只存元数据，DB 元数据默认 90 天清理；LLM 输出过滤禁止百分比、录用概率、平台投递、候选人筛选、面试邀约和 Offer 语义，并已覆盖小数百分比。已通过 `verify:job-ai-backend`、`verify:job-ai-privacy`、`verify:job-ai`、API typecheck 和 lint；Antigravity 二次复审 `APPROVE` 且 Critical/Warning 为 0，Claude 审查进程失败未取得有效报告。该项不代表 Kiosk 授权确认 UI、Kiosk AI 推荐页面接线、Admin/Partner 看板、成本用量看板、预生产 live 或真机验收完成。
- [x] **岗位信息 AI 商用闭环 Task 6：Kiosk 授权 / 推荐 / 解读 / 匹配页面接线**：`/jobs` 已新增 AI岗位推荐入口，会员登录后检查 `job_ai` 授权，未授权弹出明确隐私确认；只允许选择本人 `kind=parse` 且 `status=completed` 的简历，调用真实 `/jobs/ai/recommendations` 展示推荐结果，结果面板叠加在常规岗位列表上方且可退出 AI 推荐。`/jobs/:id` 已新增 AI岗位解读与岗位匹配参考，分别调用真实 `/jobs/:id/ai/explain` 和 `/jobs/:id/ai/match`；结果只展示三档参考、匹配点、差距建议、准备动作和免责声明，不展示百分比、录用概率、通过率、平台投递、候选人筛选、面试邀约或 Offer。Kiosk Job AI service / HTTP adapter 使用内存会员 Bearer token 和 `x-terminal-id`，mock 模式 fail-closed；新增 `verify:job-ai-ui` 并接入 CI。已通过 Kiosk `verify:job-ai-ui`、typecheck、lint、build，Playwright 1080×1920 竖屏浏览器截图与未登录点击流复验通过；Antigravity 复审 `APPROVE` 且 Critical/Warning 为 0，Claude 审查按用户要求不作为本轮阻塞；仍不代表推荐历史回看、Admin/Partner 看板、预生产公网浏览器或一体机真机验收完成。
- [x] **岗位信息 AI 商用闭环 Task 7：Kiosk 用户侧历史回看 / 隐私授权入口**：`/me/ai-records` 已展示本人岗位 AI 会话元数据，读取真实 `GET /me/job-ai-sessions`，支持本人两步确认删除 `DELETE /me/job-ai-sessions/:id`；`/me/settings` 已展示 `job_ai` 授权状态并支持真实撤回 `POST /me/ai-consents/job_ai/revoke`。前端只展示操作、状态、时间、推荐数量和已发布岗位标题 / 公司，不展示简历原文、提示词或模型原始输出；mock 模式不产生假历史或假撤权结果。后端 `listMine` 已覆盖 explain 历史，并只用 `approved + published` 岗位补齐元数据。新增 `verify:job-ai-history-privacy-ui` 并接入 CI，`verify:job-ai-backend` 已补 explain 历史过滤断言；已通过 Kiosk/API/shared 相关类型、verify、lint、build 与 Antigravity 复审，Claude 按用户要求不作为本轮阻塞。仍不代表 Admin/Partner 看板、真实客户样本、预生产公网或一体机真机验收完成。
- [x] **岗位信息 AI 商用闭环 Task 8：Admin/Partner 运营看板与后端收口**：Admin AI 服务管理页已展示岗位 AI 调用、真实 token 用量、成本估算、异常告警和岗位来源质量摘要；Partner 岗位页已展示本机构岗位质量、AI 可读就绪率、字段缺失、来源链接异常和同步陈旧统计，后端 `/admin/jobs/quality-summary` 与 `/partner/jobs/quality-summary` 使用真实 `JobDataQualitySnapshot` 聚合，Partner 端按 JWT `orgId` 隔离。复审指出的质量摘要固定 `take:5000` 截断风险已改为按每个 `jobId` 最新 `checkedAt` 快照聚合，`jobMatch` 已透传 LLM provider / tokenUsage 到 `AiServiceLog` 并进入 Admin 成本统计，用户侧不暴露 prompt、简历原文或模型原文。已通过 `verify:job-ai-ops-dashboard`、`verify:job-fit`、Admin/Partner UI verify、API/Admin/Partner typecheck、lint、build；Antigravity 复审 `APPROVE`，Claude wrapper 两次状态 1 未取得有效报告。仍不代表真实客户样本、预生产公网或一体机真机验收完成。
- [x] **岗位信息 AI 真实验收证据包与静态门禁**：已补 `docs/acceptance/job-info-ai-real-acceptance.md`、`docs/acceptance/job-info-ai-preprod-execution-record.md` 和 `verify:job-info-ai-real-acceptance`，并接入 CI；静态门禁锁定客户真实岗位样本、预生产公网浏览器、一体机真机、证据脱敏、合规红线和禁止过度宣称要求。本项不连接预生产、不写客户数据、不执行硬件动作，不代表真实客户样本、预生产公网或一体机真机验收完成。

## P1：用户文件与简历资产商用闭环后续

- [ ] **真实生产/试运营执行**：按用户文件与简历资产证据包，使用 PostgreSQL + COS + 会员账号跑上传、设置保存期限、重登查看、删除、过期清理、`long_term` 防误删和审计查询全链路，并留存命令日志、浏览器截图、COS 控制台截图和 DB 抽样。
- [x] **文档产出：商用闭环完成度审计矩阵**：已输出 `docs/acceptance/user-file-assets-commercial-closure-audit.md`，明确哪些能力只是代码/文档候选已具备，哪些仍待 Gate 2/3/4、正式生产、Windows 真机和试运营真实验收；该审计不代表远端执行完成。
- [x] **文档产出：预生产 Gate 2 执行审批包**：已输出 `docs/acceptance/user-file-assets-gate2-approval-package.md`，把执行前必须确认的目标、非目标、远端允许修改内容、禁止事项、前置确认、验证方式、停止条件、回滚方式和用户确认口径集中到短入口；该审批包不代表 Gate 2 已执行。
- [x] **本地预检：预生产 Gate 2 候选包**：已输出 `docs/acceptance/user-file-assets-gate2-local-artifact-check.md`，确认完整归档会带入非运行时文档/任务资料，Gate 2 计划已改为裁剪运行时归档并使用 `gzip -n -9` 生成可复现 sha256；该预检不代表上传或远端执行完成。
- [x] **本地预检：预生产 Gate 2 裁剪包构建**：已输出 `docs/acceptance/user-file-assets-gate2-runtime-build-check.md`，确认裁剪包在 `/tmp` 解压目录可完成 install、Prisma client 生成、API build、Kiosk build、Admin build；同时修正 Gate 2 计划中前端生产构建变量，Kiosk/Admin 必须显式 `VITE_API_MODE=http` 与 `VITE_API_BASE_URL=/api/v1`。
- [x] **本地预检：预生产 Gate 2 候选刷新**：后续 Gate 2 建议目标候选已从 `9146fa1c` 刷新为 `2187f6a7`，并重新生成裁剪运行时归档完成 install、Prisma 双 client、API/Kiosk/Admin build；该预检不代表上传或远端执行完成。
- [x] **本地门禁：预生产 Gate 2 候选一致性防回退**：`verify:file-assets-trial-acceptance` 已检查操作型 Gate 2 refresh plan、审批包、执行记录、Gate 3/Gate 4 runbook、构建预检和进度入口均指向 `2187f6a7`，并阻断旧候选 `9146fa1c` 的操作型归档/目录/DEPLOY_SOURCE marker 回流；旧本地预检命令只保留为历史证据且已标记勿执行；该门禁不代表上传或远端执行完成。
- [x] **本地门禁：预生产 Gate 2 审批确认口径防回退**：`verify:file-assets-trial-acceptance` 已升级为执行后口径，检查 Gate 2 审批包记录 `PREPRODUCTION GATE 2 PASSED`，同时保留机读确认块、用户明确确认范围、同意/不同意范围、Gate 3/Gate 4 另行确认和 Gate 2 不等于试运营或商用闭环完成。
- [x] **本地门禁：预生产 Gate 3 文档静态门禁执行范围修正**：`verify:file-assets-trial-acceptance` 已明确为 Gate 0 本地/仓库侧静态文档门禁，不再列入预生产裁剪运行时包内 Gate 3 远端命令；不得为了远端运行该脚本把 `docs/` 或 `.ccg/` 加回裁剪包。
- [x] **本地门禁：历史集成计划静态门禁口径收口**：`docs/superpowers/plans/2026-06-22-file-assets-preprod-integration.md` 已将 `verify:file-assets-trial-acceptance` 从 API runtime gates 中拆出为 Gate 0 本地静态文档门禁，防止后续误按远端裁剪运行时包命令执行；该检查不代表 Gate 2/Gate 3/Gate 4 已执行。
- [x] **本地预检：预生产 Gate 3 命令清单防回退**：`verify:file-assets-trial-acceptance` 已检查 Gate 3/Gate 4 runbook 中远端 `verify:*` 命令顺序，并确认每条命令存在于 `services/api/package.json`；G3-08 静态证据包防回退已移至 Gate 0 本地执行，G3-09 AuditLog 槽位保留；该检查不代表 Gate 3 已执行。
- [x] **本地门禁：预生产 Gate 2 部署候选冻结口径**：Gate 2 远端部署候选冻结为 `2187f6a7`，治理提交不刷新部署候选；只有运行时代码、数据库 schema、构建输入、归档范围、生产构建变量或 Gate 2 执行命令变化，才重新生成候选包并刷新执行计划。该门禁不代表 Gate 2 已授权或已执行。
- [x] **只读复核：预生产 Gate 2 执行前就绪状态**：已输出 `docs/acceptance/user-file-assets-gate2-readiness-recheck.md`，确认本地候选包、预生产部署源、PM2、health、磁盘预算、API env、工具链和 PostgreSQL/Redis/Tencent COS 脱敏指纹；同时修正 Gate 2 主计划里的 Tencent COS key 名。该复核是 Gate 2 执行前历史证据，本身不代表远端执行。
- [x] **预生产 Gate 1 只读预检**：基于 `codex/file-assets-preprod-execution` 的计划，已只读检查预生产主机、部署 commit、PM2、health 和 PostgreSQL 连接状态；结论为主机/API/PostgreSQL 可达，但预生产实际部署源仍为 `6b055d6b`，不是当时目标候选 `9146fa1c`，已按计划停止。
- [x] **预生产 Gate 2 候选部署或刷新**：已完成。用户确认后按冻结候选 `2187f6a7` 执行部署刷新；候选包 sha256 校验通过，API/Kiosk/Admin build 通过，迁移前 DB 备份存在且 `pg_restore -l` 可读，仅应用两个预期 additive PostgreSQL migrations，PM2 online，本机和公网 health 均为 `db=postgres`。该项已完成但不代表 Gate 3/Gate 4、正式生产或试运营完成。
- [x] **预生产 COS bucket 切换**：已完成。腾讯云已创建隔离预生产 bucket 和预生产专用 CAM 子用户；预生产服务器仅替换 COS 相关 env，备份为 `/srv/ai-job-print-env-backups/api.env.20260622134416.bak`；新 bucket 脱敏指纹 `d855f7e900`、`strict_nonprod=true`、`prod_label=false`、region `ap-guangzhou`；PM2 online，health 为 `db=postgres`；G3-06 `verify:cos:live` 已通过 put/head/get/预签名下载/delete。
- [x] **预生产 Gate 4 账号/API 级验收**：已按用户确认的 B 方案临时切 `SMS_PROVIDER=log`，通过真实 HTTP API + PostgreSQL + Redis + COS 完成受控会员登录、原始文件上传、默认 90 天、设置 180 天、原始文件长期保存拒绝、签名 URL 内部访问、跨账号 403、删除三态、过期清理、Admin 生命周期汇总和审计抽样；执行后已回滚 `SMS_PROVIDER=tencent`，公网 health 复核 `db=postgres`，SSH 只读复核确认 `SMS_PROVIDER=tencent`、`FILE_STORAGE_DRIVER=cos`、`DATABASE_URL=postgres`、`REDIS_URL=set`。该项仍不是完整浏览器截图验收、正式生产或试运营完成。
- [x] **预生产 Gate 4 AI 导出产物补证**：真实 AI 导出产物自动标记 `assetCategory=optimized` / `sourceFileId` 的链路已部署到预生产 `76c06ca8`；自动 Gate 通过 `verify:production-runtime-gates`、`verify:production-db-guard`、`verify:resume-generate`、`verify:file-retention`；真实 COS 补证显示导出文件 digest `34f964913eec`、`assetCategory=optimized`、`sourceMatches=true`、COS HEAD 200、短 TTL 签名 URL 200→403、会员 B 拒绝访问。该项仍不是完整浏览器截图验收、正式生产或试运营完成。
- [x] **预生产 Gate 4 浏览器会员路径证据补齐**：2026-06-26 使用真实短信登录路径完成会员页、合成 PDF 上传窗口和 `/me/documents` 会员文件与保存期限截图；证据保存在仓库外 `/Users/wanglei/gate4-evidence/gate4-browser-20260625231841`，包含 `evidence-summary.md`、3 张 Chrome 窗口截图和合成测试 PDF。全程不把完整手机号、验证码、token、cookie、签名 URL 或 COS XML 写入仓库；坏的全屏截图 / Playwright 中间文件已删除；预生产中可见的 `gate4-synthetic-resume.pdf` 测试记录已清理。该项仍不等于完整 Gate 4 浏览器验收、正式生产或试运营完成。
- [ ] **预生产 Gate 4 剩余浏览器证据补齐**：仍需补 Admin 生命周期视图、签名 URL / 等待窗口、必要时 COS 控制台或 DB 脱敏摘要等剩余证据；执行前必须继续按 runbook 确认仓库外证据目录、地址栏 / 签名 URL / COS XML / 手机号 / token 脱敏规则，以及 Admin 仅筛选本轮测试文件；腾讯短信审核通过后还需用真实短信完成会员登录 E2E，避免把预生产 API/COS/部分浏览器证据误写成正式生产或完整试运营验收。
- [ ] **AI 简历诊断手机扫码上传联调复验**：本地 API + Redis + `FILE_STORAGE_DRIVER=local` 已通过 `verify:upload-sessions:http`，覆盖创建二维码会话、手机 multipart 上传 synthetic PDF、Kiosk 轮询 / 确认 / 取消、安全门禁、精确错误码、本地测试文件清理、member 真实 JWT + Redis session 成功绑定、匿名 / 其他会员 confirm 越权拒绝、status throttle、已绑定会员文件 cleanup 防误删和手机 token 仅从 fragment 读取；浏览器实际点击 `/resume/source` 可生成二维码且无会话创建错误。脚本默认不触发 `/resume/parse`、OCR 或 AI 配额；运行前必须确认被测 API 进程本身也以 `FILE_STORAGE_DRIVER=local` 启动。后续仍需在域名审核 / HTTPS / 反代 / H5 fallback 就绪后，用预生产或真机隔离对象存储和真实可解析 PDF 跑完整浏览器 E2E，覆盖手机上传真实简历、OCR/AI 诊断成功、报告页回填、会员绑定 / 我的简历资产回看和打印 / 导出入口；另需择期补 `/health` 暴露存储 driver、`EndUser.enabled` 可选会员一致性和 Multer 超限错误码统一。
- [x] **求职材料库真实浏览器与预生产验收**：已部署 `codex/job-materials-commercial-closure` 的 `64596c18` 运行时包到预生产；远端 `verify:job-materials` 在 PostgreSQL + COS 环境通过，Kiosk/Admin 静态 UI verify 通过，公网浏览器完成拆分前旧路径 `/resume/templates?tab=materials -> 登录 -> 生成 PDF -> /me/documents -> /print/confirm` 链路。2026-06-30 新版入口拆到 `/resume/materials` 后，本地已补 `verify:llm-connectivity -- --all`、`verify:job-materials`、`verify:job-material-library-ui` 和 Playwright 真实浏览器链路；预生产只读预检确认公网 `/resume/materials` 返回 200、远端 LLM active 功能 ping 全 PASS。随后使用用户确认的 `SESSION-B_REDIS_TEST_CODE` 复验，先发现远端 Kiosk dist 缺 `job-material-draft` 草稿保存逻辑，已从干净 `HEAD=0f6b28ab` 构建并只热更新 `apps/kiosk/dist`；热更新后公网浏览器完成 `/resume/materials -> 登录 -> 草稿恢复 -> 生成 PDF -> /me/documents -> /print/confirm`，登录 201、生成 201、预览 URL 200，测试 COS 对象、FileObject、AuditLog、EndUser 和 Redis 会话均已清理。该验收仍不代表正式生产、正式域名 HTTPS、真实短信上线 E2E、Windows 真机出纸或试运营完成。
- [ ] **求职材料库 Windows 真机打印验收**：待正式或试运营环境具备 Windows Terminal Agent、奔图打印机和真实出纸条件后，使用求职材料生成的 PDF 从 `/print/confirm` 进入打印任务，验收 Agent claim、驱动出纸、失败恢复、订单状态与异常反馈；该项未完成前不得宣称求职材料库达到真机商用闭环。
- [ ] **求职材料库二期动态治理设计**：如要开放 Admin 模板 CRUD、Partner 模板申请、版权素材上传、套餐收费或岗位关键词辅助，必须另起独立设计与审查，先补审核流、版权归属、字段白名单、滥用风控和合规文案，再写代码。
- [ ] **岗位信息页客户数据验收**：用客户真实 API / Excel / Webhook 岗位样本复验标准字段映射、筛选、来源链接、外部编号、同步时间、岗位描述、职责要求、企业关联和收藏 / 浏览 / 外部跳转记录；验收只记录打开来源入口，不记录投递结果。
- [ ] **岗位信息 AI 商用闭环下一阶段**：补客户真实岗位样本验收、预生产公网浏览器验收和一体机真机验收。推荐结果只能作为求职者参考，不得引入平台投递、候选人筛选、面试邀约、Offer 或向企业推荐候选人。未完成客户样本、预生产和真机验收前，不得对外宣称 AI 推荐或岗位匹配达到生产商用完成。

## P1：工程质量门禁

- [ ] 每个新任务先写目标、非目标、允许修改文件、验证方式。
- [ ] 后续另起分支统一 `docs/product/*` 和历史计划中旧文件 TTL 参考口径；本轮已完成 UI / 隐私政策 / shared copy / 送审材料 / 部署验收文档，产品参考文档历史口径不作为本分支继续扩范围修改。
- [ ] 超过 30 行 diff 或跨模块任务必须 Claude + Antigravity 双模型审查。
- [ ] 500 行以上文件新增功能前评估拆分；800 行以上不得继续堆新功能；1000 行以上进入拆分清单。
- [ ] P3 拆分候选：`apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx` 当前超过 500 行，后续反馈/通知扩展前先拆分表单、列表和详情面板。
- [x] **全局无感数据刷新机制 Partner 首轮推广**：Partner 岗位、招聘会、政策公告三类列表已接入统一 `useRefreshable`，新增 / 编辑抽屉、保存、下架、删除确认期间使用 hard lock；禁止回退到页面内 `load + setState` 的 `verify:partner-refresh-safe` 已补齐。
- [ ] **全局无感数据刷新机制继续推广**：后续按独立分支接入 Kiosk `/me/*` 资产页；智慧校园和屏保必须在保留各自失败语义后再接入。
- [ ] **终端设备档案生产验收**：`codex/terminal-device-profile-closure` 代码侧已补终端设备名 / MAC / 摆放位置 / 启停、Admin 编辑、公开 Kiosk config 白名单和停用终端拒绝打印任务；上线前仍需在 PostgreSQL 预生产执行 additive migration、确认无重复 MAC、用 Windows Terminal Agent 真机 register / heartbeat 上报 MAC，并实测 `enabled=false` 后 Kiosk 智慧校园关闭且 Agent 不再 claim 打印任务。
- [ ] **终端应用上架生产验收**：`codex/terminal-device-profile-closure` 代码侧已补 `TerminalToolboxConfig`、Admin `/toolbox` 上架页、百宝箱/智慧校园 placement、站内路由、外部 H5、二维码/小程序码、路径/域名白名单和 `toolbox_config.update` 审计；上线前仍需在 PostgreSQL 预生产执行 additive migration，配置 `KIOSK_EXTERNAL_APP_ALLOWED_HOSTS`，通过 Admin 对真实终端保存 1-2 个站内功能项与 1 个白名单外部/二维码项，确认 Kiosk 真实终端刷新后百宝箱无功能项时保留“待配置”占位、有功能项时展示功能卡片，智慧校园开启后投放项展示、关闭后整块消失，并复核未知路径、未白名单外链被后端拒绝。
- [ ] 删除旧页面/组件/脚本/文档前，必须确认无路由、import、测试/verify、当前文档、生产部署或硬件链路依赖。
- [ ] 构建产物、缓存、临时截图、录屏、数据库备份、密钥备份、可再生成文件不得进入 Git。

## 待用户确认

- [x] 是否确认后续每个业务闭环都独立分支、独立验证、双模型审查后再推进。
