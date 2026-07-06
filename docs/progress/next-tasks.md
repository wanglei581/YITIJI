# 下一步任务

> 最后更新：2026-07-06
> 入口用途：当前任务池与执行顺序。历史任务长记录文本已归档到 `docs/progress/archive/2026-06-20-next-tasks-pre-normalization.md`；归档时行尾空格按仓库 whitespace 检查规范化。

> 2026-07-01 纠偏：`82.157.43.217` 是腾讯云公司网站服务器上的临时预览环境，仅保留为历史 smoke 记录，不作为本项目正式上线 / Windows 真机验收依据。正式验收以百度云项目服务器 `120.48.13.190` 为准：Kiosk `http://120.48.13.190/`，Admin `http://120.48.13.190:8081/`，API `http://120.48.13.190/api/v1`。任何打印扫描真机验收报告必须明确连接百度云项目服务器，不能把腾讯云临时预览 smoke 写成正式验收结论。

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
- [ ] 百度 OCR / AI / TRTC / ASR / TTS：生产 Key、权限、失败兜底和 live 冒烟按启用范围验收。
- [x] 打印扫描首期安全底座 + 状态运营处理 + preflight 门禁（代码侧）：打印任务创建、领取、状态回写和 Agent 本地库不可用降级已形成 fail-closed 契约；Kiosk 进度页已展示真实状态并处理取消；Admin `/orders` 已支持受状态门控的取消 / 重分配终端；新增 `verify:print-scan-preflight` 只读检查未完成任务 / 订单缺少目标终端或目标不一致。
- [x] 真实库打印扫描 preflight（隔离预生产库）：已在服务器当前 monorepo 隔离 PostgreSQL 数据库 `ai_job_print_preprod` 上运行 `verify:print-scan-preflight:postgres`，结果无未完成打印任务 / 订单目标终端异常；该结论仅覆盖新建隔离预生产空库，不代表既有线上 `zlixc-api` 所连生产库、Windows 真机、扫描、证件照或 U 盘验收完成。
- [x] 预生产部署目录确认：已选择新建并使用独立目录 `/www/wwwroot/ai-job-print-preprod/current` 部署当前 monorepo，不覆盖现有 `/www/wwwroot/zlixc-api`；服务器密码已在聊天中暴露，生产切换前必须轮换或改 SSH key。
- [x] 预生产 env 与后端启动门禁：隔离目录 `/www/wwwroot/ai-job-print-preprod/current` 已完成依赖安装、typecheck、lint、text-only 前端 build、独立 staging `.env`、PostgreSQL migration、Redis 配置、`db:pg:sync:check`、`verify:production-runtime-gates` 自测、服务器 API build、独立 PM2 `ai-job-print-preprod-api` 启动、本机 health、`verify:print-scan-first-release` 和 `verify:print-scan-preflight:postgres`；现有 `zlixc-api` 仍 online。本项仍不代表 nginx 公网预览、正式生产部署或 Windows 真机完成。
- [x] 预生产 nginx 预览入口（腾讯云临时预览历史记录）：曾使用 `82.157.43.217:8897/8898/8896` 做隔离 HTTP 预览；2026-07-01 已纠偏确认 `82.157.43.217` 是腾讯云公司网站服务器上的临时预览环境，仅保留为历史 smoke 记录，不作为本项目正式上线 / Windows 真机验收依据。正式验收以百度云项目服务器 `120.48.13.190` 为准。
- [x] 预生产浏览器功能联调（腾讯云临时预览历史记录）：该轮 smoke 基于 `82.157.43.217` 三个临时 HTTP 预览入口，仅证明当时 Kiosk 首页、Admin 登录后 `/orders`、Partner 登录后 dashboard、Kiosk `/print-scan`、`/print/upload?source=document`、直达 `/print/progress` 保护分支可在该临时环境打开；不代表百度云项目服务器、正式 HTTPS、Windows 真机出纸或试运营验收。后续浏览器 / 真机验收必须使用 `120.48.13.190` 对应 Kiosk/Admin/API 地址重新执行。
- [ ] Windows 真机：Terminal Agent、奔图打印机、打印真实出纸、扫描链路、断网/重启恢复逐项记录。2026-07-06 已完成 Windows PDF 物理打印补证：直接烟测、Kiosk 同源代理正式端点链路、PS-G5 二次 PDF 样本均通过 `Pantum CM2800ADN Series` / `USB001` 打印 1 页，PrintService 有 Event ID 307 / 842，Windows PrintQueue 计数器累计 `TotalPagesPrinted 27 -> 30`。其中 PS-G5 任务 `ptask_kiosk_638475ac307beb0c` / `ORD-20260706-7B04908AD7` 由另一个可访问远程 API 的智能体仅调用 `/files/kiosk-upload -> /print/jobs` 下发，未启动 `terminal-agent agent`、未运行 claim loop；状态流转 `pending -> claimed -> printing -> completed`，现场人工反馈“已出纸”，满足“后端 completed + PrintService 有事件 + 现场确认出纸”。该结果只关闭“PDF 样张真实出纸 + Agent claim/printing/completed + 计数器/PrintService + 现场出纸确认”子项；仍不等于 Windows 真机整体验收通过。现场补验必须使用 `codex/print-scan-windows-acceptance` 当前验收候选 `0aa97b8`，不得继续要求 HEAD 为原始候选基线 `06287e11`；Windows 端先执行 `git fetch origin`、`git switch codex/print-scan-windows-acceptance`、`git pull --ff-only`，并确认 `git rev-parse --short HEAD` 输出 `0aa97b8`。验收地址固定为 Kiosk `http://120.48.13.190/`、Admin `http://120.48.13.190:8081/`、API `http://120.48.13.190/api/v1`。验收前必须确认 Kiosk 构建注入正确 `VITE_TERMINAL_ID` 且后台终端已注册并启用；`agent_degraded` 视为本地 Agent DB 降级，需要人工重启 Agent 后复测；真机打印必须由真实 Kiosk 页面上传创建真实终端绑定任务，不使用 `ptask_seed_001` 等 seed 任务替代。后续至少补验：真实 Kiosk 页面人工上传 PDF 1 单、PNG/JPG 打印 1 单，逐单记录 `taskId` / `orderNo`，肉眼或摄像头确认真实出纸、页数、方向、清晰度、彩色/黑白，核对 Kiosk 进度页最终状态与 Admin `/orders` 状态一致，并补测离线、取消、失败、Agent 重启、`agent_degraded` 中至少两个异常场景。扫描继续标记为“未完成 / 待单独任务”，不得写通过。PS-G5 暴露 `amountCents=100`、`payStatus=unpaid` 仍被 claim 并 completed，免费/付费试运营配置口径与支付门禁上线前需单独收口。

  Windows 现场补验返回报告最少包含：Git（branch、commit）、Server（Kiosk/Admin/API 地址）、PDF 打印（taskId、orderNo、是否真实出纸、页数/方向/清晰度、Kiosk 最终状态、Admin 最终状态）、图片打印（taskId、orderNo、是否真实出纸、页数/方向/清晰度、Kiosk 最终状态、Admin 最终状态）、异常场景（至少两个场景与结果）、扫描（未完成/成功、阻塞点）、结论（是否可回 Mac 收口、仍需修复的问题）。判断标准不变：PDF 和图片没有真实出纸，不能回 Mac 写最终通过；Kiosk 和 Admin 状态不一致，也不能收口。
- [ ] 法务合规：用户协议、隐私政策、AI 免责声明、招聘信息来源免责声明审定。
- [ ] 小范围试运营：仅 1 台终端 + 1 台打印机先跑，问题记录按任务闭环处理。

## P0：商用 Windows Terminal Agent 授权闭环（2026-07-05 收尾）

- [x] **生产 Agent 一键加固脚本**：新增 `apps/terminal-agent/scripts/install-production-agent.ps1`，固定远程 API、校验打印机、DPAPI 加密 token、安装/启动 Windows 服务并验证远程心跳；当前会话安全验证通过。
- [x] **生产 Agent onboarding 文档**：新增 `docs/device/production-agent-onboarding.md`，约定云端作为唯一任务源、禁止 production 指向 localhost、并说明 `AGENT_PROFILE=local-debug` 是唯一允许本地 API 调试的显式开关。
- [x] **一次性终端绑定码后端接口**：`TerminalBindCode` SQLite/PostgreSQL additive migration 已部署到本地库；`POST /api/v1/admin/terminals/:terminalId/bind-code` 与 `POST /api/v1/auth/terminal/exchange-bind-code` 已接入；安装脚本新增 `-BindCode` 用绑定码换 token 路径；绑定码固定 20 位可视字符，同终端重新生成会撤销旧的未使用/未过期绑定码；新增 `verify:terminal-bind-code` 锁定 hash 落库、审计不写明文、旧码撤销、兑换后标记 used 和 DPAPI 安装脚本路径；`verify:terminal-bind-code`、`db:pg:sync:check`、API typecheck + lint 通过。
- [x] **Admin UI 接入绑定码按钮**：终端管理页已在每行“编辑档案”旁增加「生成绑定码」入口，停用终端禁用；弹窗已拆到 `TerminalBindCodeDialog.tsx`，包含 TTL 选择、明文 bindCode 显示 + 可复制 + 倒计时、预设 `install-production-agent.ps1` 命令模板；命令模板使用真实 PowerShell 反引号续行，并含 `-BindCode/-PrinterName`；适配 `http` / `mock` 双模式；新增 `verify:admin-terminal-bind-code-ui` 静态门禁，断言 devices/http/mock 出口、按钮/弹窗出现、命令示例与“bindCode 不入日志/审计”等防回退项；Admin typecheck + lint 通过。
- [x] **本地调试 production 互斥保护**：Terminal Agent `agent` 启动时已接入 `assertAgentProfileAllowsApiBaseUrl`；发现 `apiBaseUrl` 指向 `localhost` / `127.0.0.1` / `::1` / `0.0.0.0` 时默认拒绝启动，只有显式 `AGENT_PROFILE=local-debug` 才允许本地调试；新增 `verify:agent-profile-guard` 防回退，并通过 Terminal Agent typecheck / build / verify。
- [ ] **正式生产与真机验收**：当前绑定码 API 仅在本地 SQLite 自测通过；正式上线前需要在 PostgreSQL 预生产复跑绑定码生成/兑换/撤销/审计，并通过 Windows 真机 `install-production-agent.ps1 -BindCode` 完成首次授权并出纸。

2026-06-21 补充：`codex/preprod-deployment-acceptance` 已先把 TRTC assistant guard 代码包部署到百度云预生产，三端公网 HTTP health 均返回 PostgreSQL；COS live 冒烟通过并已切 `FILE_STORAGE_DRIVER=cos`；临时 HTTPS/hosts 映射已可用；预生产服务器上 `verify:member-assets-c2d` 与 `verify:activity-logs` 通过。下一步不能直接进入试运营，需先补百度 OCR Key 与 live 验证、AI/TRTC/ASR/TTS 按启用范围验证、腾讯短信审核后的真实登录 E2E、正式域名 HTTPS 复验，以及 Windows 裸机 + Terminal Agent + 奔图真机验收。

2026-06-22 补充：`codex/file-assets-preprod-integration` 已把用户文件资产商用闭环栈与预生产验收候选合到同一分支，后续预生产/试运营应以该集成候选为基线继续执行；这仍不代表真实生产/试运营执行完成。

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
- [x] **用户文件保存期限 Branch 2：策略服务与清理门禁**：`FileObject.expiresAt` 支持 `long_term` 的 `null` 语义；会员本人可改本人文件保存期限；原始文件首批仅 3/6 个月，`optimized/derived` 成果物可长期，证件/匿名/系统文件保持短期；补 `verify:file-retention` 与 Admin/Kiosk 可空兼容。
- [x] **用户文件保存期限 Branch 3：Kiosk 文件保存期限 UI**：`/me/documents` 展示当前保存期限和后端允许策略；本人可设置 3 个月 / 6 个月 / 成果物长期保存，6 个月 / 长期保存自动带当前保存条款版本；保存条款版本由 shared/API 本地副本常量收敛并有防回退验证。
- [x] **用户文件保存期限 Branch 4：Admin 文件生命周期运营视图**：Admin `/files` 复用现有入口展示保存策略、设置来源、同意时间、长期保存数量和即将到期/待清理统计；新增全库只读 `GET /files/lifecycle-summary`，不受列表 `limit=200` 截断；管理员无保存期限修改入口，查看文件兼容 COS 绝对签名 URL。
- [x] **用户文件保存期限 Branch 5：COS 生命周期与隐私文案验收**：采集点、帮助中心、隐私政策、Admin 文件横幅统一为短期 / 90 天 / 180 天 / 长期保存口径；新增 COS 生命周期合规文档，明确禁止 Bucket 全局过期规则、`long_term` 防误删人工验收和截图存档；新增 `verify:legal-retention-copy` 与 `verify:cos-lifecycle-policy`。
- [x] **用户文件与简历资产证据包**：新增 `docs/acceptance/user-file-assets-trial-acceptance.md` 和 `verify:file-assets-trial-acceptance`，把生产/试运营验收拆成 PostgreSQL、COS 私有桶、会员账号、上传原始文件、上传优化后或修改后文件、90 天 / 180 天 / 长期保存、重登查看、删除三态一致、过期清理、`long_term` 防误删、AuditLog 审计和证据脱敏；静态验证只证明证据包完整，不代表真实生产/试运营执行完成。
- [x] **用户文件资产 + 预生产候选集成**：`codex/file-assets-preprod-integration` 已合并文件资产保存期限栈、生产/试运营证据包、TRTC assistant 生产构建守卫和预生产阶段性记录；后续真实验收应基于该集成候选继续，不再用只含 TRTC guard 的预生产分支替代。
- [x] **简历素材库 / 求职材料商用闭环整改**：两个既有首页入口已统一进入 `/resume/templates` 求职材料库；内置模板通过 `JobMaterialsModule` 生成真实 PDF 并以会员 `FileObject` 进入 `/me/documents`；我的文档支持重签 URL 后打印；Admin 新增只读 `/job-materials` 运营统计；已补 API/Kiosk/Admin 防回退 verify 和三端 typecheck，并已完成预生产公网浏览器受控会员生成 PDF 到打印确认链路验收。本项不包含动态模板 CRUD、Partner 上传模板、支付套餐、平台投递、正式域名 HTTPS / 真实短信上线 E2E 或 Windows 真机验收。

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
- [x] **求职材料库真实浏览器与预生产验收**：已部署 `codex/job-materials-commercial-closure` 的 `64596c18` 运行时包到预生产；远端 `verify:job-materials` 在 PostgreSQL + COS 环境通过，Kiosk/Admin 静态 UI verify 通过，公网浏览器完成 `/resume/templates?tab=materials -> 登录 -> 生成 PDF -> /me/documents -> /print/confirm` 链路。执行中临时切 `SMS_PROVIDER=log`，结束后已回滚 `SMS_PROVIDER=tencent`；本轮受控测试 EndUser、FileObject、AuditLog 和 COS 对象已清理。该验收仍不代表正式生产、正式域名 HTTPS、真实短信上线 E2E、Windows 真机出纸或试运营完成。
- [ ] **求职材料库 Windows 真机打印验收**：待正式或试运营环境具备 Windows Terminal Agent、奔图打印机和真实出纸条件后，使用求职材料生成的 PDF 从 `/print/confirm` 进入打印任务，验收 Agent claim、驱动出纸、失败恢复、订单状态与异常反馈；该项未完成前不得宣称求职材料库达到真机商用闭环。
- [ ] **求职材料库二期动态治理设计**：如要开放 Admin 模板 CRUD、Partner 模板申请、版权素材上传、套餐收费或岗位关键词辅助，必须另起独立设计与审查，先补审核流、版权归属、字段白名单、滥用风控和合规文案，再写代码。

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
