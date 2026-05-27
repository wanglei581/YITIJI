# 当前开发进度

> 最后更新：2026-05-27  
> 关联文档：[CLAUDE.md](../../CLAUDE.md) | [feature-scope.md](../product/feature-scope.md)

---

## 一、已确认的项目决策

| 决策项 | 结论 | 确认时间 |
|--------|------|---------|
| 项目定位 | AI求职打印服务终端（非招聘平台） | 2026-05 |
| 底部导航 | 仅保留：首页、AI助手、我的 | 2026-05 |
| AI工具箱入口 | 不作为一级导航 | 2026-05 |
| 企业招聘端 | 删除，不开发 | 2026-05 |
| 合作机构后台 | 保留，只做数据与运营后台 | 2026-05 |
| 管理员后台 | 保留，管理整个终端运营体系 | 2026-05 |
| 打印机型号 | 奔图 CM2800/CM2820 系列（Windows 识别名：`Pantum CM2800ADN Series`） | 2026-05（Windows 真机确认 2026-05-27） |
| 岗位/招聘会数据 | 只做第三方/官方来源信息入口 | 2026-05 |
| 旧秒哒项目 | 仅作参考库，不作为正式工程 | 2026-05 |
| 技术栈 | React + Vite + TypeScript + Tailwind + shadcn/ui | 2026-05 |
| AI数字人 | Phase 9 做轻量 3D 就业服务引导员，不做招聘官/候选人筛选官 | 2026-05 |

---

## 二、当前开发阶段

**当前阶段：Phase 8.1B 全链路联调完成（2026-05-27）**

---

### ✅ Phase 8.1B 已完成（2026-05-27）

> Agent 侧 + 后端接口全部实现，联调冒烟全部通过。  
> 链路：register → heartbeat → claim → download → MD5 → print → PATCH completed ✅

**Agent 侧（`apps/terminal-agent/src/agent/`）：**

| 能力 | 文件 | 状态 |
|------|------|------|
| Agent 配置加载 | `src/agent/config-manager.ts` | ✅ |
| 类型定义（AgentConfig/ClaimTask/HeartbeatPayload 等） | `src/agent/types.ts` | ✅ |
| HTTP 客户端（axios + 5xx 重试 + 脱敏日志） | `src/agent/api-client.ts` | ✅ |
| 终端注册（POST /auth/terminal/register） | `src/agent/registration.ts` | ✅ |
| 心跳上报（PUT /terminals/:id/heartbeat，每 30s） | `src/agent/heartbeat.ts` | ✅ |
| Claim 循环（POST /terminals/:id/tasks/claim，每 5s） | `src/agent/task-runner.ts` | ✅ |
| 文件下载 + MD5 校验 | `src/agent/task-runner.ts` | ✅ |
| 调用统一 print()（Phase 8.1A） | `src/agent/task-runner.ts` | ✅ |
| PATCH /print-tasks/:id/status（printing/completed/failed） | `src/agent/task-runner.ts` | ✅ |
| 临时文件 try/finally 清理 | `src/agent/task-runner.ts` | ✅ |
| `agent` CLI 命令（src/index.ts） | `src/index.ts` | ✅ |
| config/agent-config.json 排除 git | `.gitignore` | ✅ |
| typecheck 0 errors / build 通过 | — | ✅ |

**后端（`services/api/src/terminals/`）：**

| 能力 | 文件 | 状态 |
|------|------|------|
| POST /auth/terminal/register（in-memory + agentToken） | `terminals.service.ts` | ✅ |
| PUT /terminals/:id/heartbeat（Bearer 鉴权） | `terminals.service.ts` | ✅ |
| POST /terminals/:id/tasks/claim（原子 claim，5 min expire） | `terminals.service.ts` | ✅ |
| PATCH /print-tasks/:id/status（状态机 + 幂等） | `terminals.service.ts` | ✅ |
| GET /test/sample.png（1×1 PNG mock 文件端点） | `terminals.controller.ts` | ✅ |
| 种子任务 ptask_seed_001（fileUrl→sample.png，fileMd5 匹配） | `terminals.service.ts` | ✅ |
| Claim 过期自动重置（setInterval 30s） | `terminals.service.ts` | ✅ |
| DTOs（register/heartbeat/claim/patchStatus） | `dto/` | ✅ |
| TerminalsModule 注册 + AppModule 接入 | `terminals.module.ts` | ✅ |
| typecheck 0 errors | — | ✅ |

**Phase 8.1B 未做（Phase 8.1C）：**
- Windows 单实例 Mutex
- DPAPI 加密 agentToken
- printerStatus / diskFreeGB 真实 WMI 查询
- lease 续租（`PATCH /terminal-tasks/:id/lease`）
- SQLite 任务幂等记录

---

**Phase 8.1A 收口确认（2026-05-27）：**

| 验收项 | 状态 |
|--------|------|
| JPG → pdfkit → Method B → 真实出纸（882ms） | ✅ |
| PNG → pdfkit → Method B → 真实出纸（553ms） | ✅ |
| 临时 PDF 打印后自动删除 | ✅ |
| DOCX / BMP 正确拒绝（UNSUPPORTED_FILE_TYPE） | ✅ |
| TypeScript typecheck 0 错误 | ✅ |

**Phase 4 加固封板确认（2026-05-25，无剩余 M1/M2 阻塞项）：**

| 加固项 | 状态 |
|--------|------|
| mock 数据抽离至 data/externalSources.ts | ✅ |
| 详情页刷新/直达容错（state 缺失时 mock 查找） | ✅ |
| QR overlay 增强（来源机构/外部编号/手机引导） | ✅ |
| 合规词修正："录用率" → "招聘结果" | ✅ |
| 禁用招聘闭环功能检查（无候选人/投递/HR 等） | ✅ |

---

## 三、优先级任务列表

### P0（MVP 核心）

- [x] 新建正式项目（monorepo 结构）
- [x] 建立设计系统（颜色/字体/按钮/卡片/状态标签规范）
- [x] 完成一体机首页
- [x] 完成打印扫描核心流程（打印 5 页 + 扫描 4 页，含失败路径和重试）
- [x] 完成管理员后台基础框架
- [x] 完成岗位/招聘会外部来源展示逻辑（合规展示）

### P1（重要功能，第二批）

- [x] AI简历服务（上传、解析、诊断、优化、打印）
- [ ] 文件自动清理机制
- [ ] 打印任务状态实时追踪
- [ ] 合作机构后台（岗位/招聘会数据管理）
- [ ] 数据源同步功能

### P2（扩展功能，有时间再做）

- [ ] Windows Terminal Agent 开发
- [ ] 奔图打印机接口对接
- [ ] 扫描目录监听
- [ ] 告警中心
- [ ] 数据统计报表

---

## 四、各阶段完成情况

| 阶段 | 名称 | 状态 |
|------|------|------|
| 第 0 阶段 | 项目初始化 | ✅ 完成封板 |
| 第 1 阶段 | 设计系统 | ✅ 完成 |
| 第 2 阶段 | 公共组件 | ✅ 完成 |
| 第 3 阶段 | 一体机前台 | ✅ 完成封板 |
| 第 4 阶段 | 岗位和招聘会信息 | ✅ 完成 |
| 第 5 阶段 | 管理员后台 | P0/P1 全部完成（9页），P2/P3 页面待填充 |
| 第 6 阶段 | 合作机构后台 | P0 完成（6页）+ Excel 导入向导 MVP，P1 待填充 |
| 第 7 阶段 | 后端 API | Phase 7.6–7.10 ✅（Provider 骨架/AI Chat UI/Admin AI 管理页/接口闭环/岗位招聘会真实 API）；真实 Provider / Prisma 持久化待开发；`pnpm audit` 因网络原因未完成，网络可用时补跑 |
| 第 8 阶段 | Windows Terminal Agent | ✅ Phase 8.0/8.0.1/8.0.2/8.1A/8.1B 全部完成：PDF/图片打印✅；Agent 注册/心跳/Claim/PATCH 全链路✅；后端 4 接口联调通过✅；**下一步：Windows 真机端到端联调** |
| 第 9 阶段 | UI Polish / Kiosk 视觉升级 + AI数字人引导员 | 📋 已规划，Phase 8 完成后启动 |

---

## 五、Phase 3 封板记录（2026-05-25）

### 完成内容

| 模块 | 页面数 | 路由 |
|------|--------|------|
| 打印流程 | 5 | /print/upload → preview → confirm → progress → done |
| 扫描流程 | 4 | /scan/start → settings → progress → result |
| AI简历服务 | 5 | /resume/source → parse → report → optimize → export |
| 我的记录 | 1 | /profile |

### 数据状态

- 全部为 mock 数据 + `location.state` 传递，本阶段不接后端
- DEV 模拟失败按钮均通过 `import.meta.env.DEV` 隔离，生产 build 不包含

### 验收结果

- pnpm lint：✅ 0 warnings
- pnpm typecheck：✅ 0 errors
- pnpm build：✅ 三端均通过
- P1 白屏修复：`ResumeReportPage if (!report) return null` 改为错误引导页 ✅
- 合规词全文审查：一键投递/立即投递/HR查看/候选人/录用率等均未出现 ✅

---

## 六、Phase 4 完成记录（2026-05-25）

### 完成内容

| 模块 | 页面 | 路由 |
|------|------|------|
| 岗位列表 | JobsPage | /jobs |
| 岗位详情 | JobDetailPage | /jobs/:id |
| 招聘会列表 | JobFairsPage | /job-fairs |
| 招聘会详情 | JobFairDetailPage | /job-fairs/:id |

### 类型扩展

- `packages/shared/src/types/job.ts` 新增 `ExternalJob`、`ExternalJobFair`、`JobFairStatus`
- 所有外部数据类型继承 `ExternalJobSource`，强制包含：`sourceOrgId`、`externalId`、`sourceName`、`sourceUrl`、`syncTime`、`reviewStatus`、`publishStatus`

### 合规边界执行情况

| 检查项 | 结果 |
|--------|------|
| 按钮文案：查看详情 / 去来源平台投递 / 扫码投递 | ✅ |
| 按钮文案：去来源平台预约 / 扫码预约 | ✅ |
| 无"一键投递"/"立即投递"/"投递简历" | ✅ |
| 无"候选人"/"HR 查看"/"推荐给企业" | ✅ |
| 每个岗位/招聘会展示来源机构、同步时间、外部ID | ✅ |
| 页面内合规说明文案（不参与招聘流程） | ✅ |
| "去来源平台投递"以扫码形式模拟（Kiosk 不支持直接跳转外链） | ✅ |

### 验收结果

- pnpm lint：✅ 0 warnings
- pnpm typecheck：✅ 0 errors
- pnpm build：✅ 三端均通过

---

## 七、Phase 7 前端已知结构性风险（Phase 6.5 复查记录）

以下差异在前端 mock 阶段可接受，**Phase 7 后端 API 设计时必须解决**，不建议在前端写 adapter 临时掩盖。

| # | 涉及位置 | 差异描述 | Phase 7 解决方向 |
|---|---------|---------|-----------------|
| R1 | admin/job-sources + admin/fair-sources 本地接口 | 缺少 `sourceUrl`、`sourceOrgId`、`description`、`tags`、`requirements` 字段 | ✅ **Phase 7.10 已解决**：AdminJobSourceRecord/AdminFairSourceRecord 补全所有字段；adminMockAdapter 数据对齐 |
| R2 | partner/jobs + partner/fairs 本地接口 | 缺少 `sourceName` 字段 | ✅ **Phase 7.10 已解决**：PartnerJobRecord/PartnerFairRecord 新增 `sourceName`；mock 数据已补全 |
| R3 | partner/sync-logs 本地 `SyncLog` 接口字段命名不一致 | 字段命名不同：`successCount`/`addedCount`、`failCount`/`errorCount`、`result`/`status` | ✅ **Phase 7.10 已解决**：PartnerSyncLog 字段已重命名为 `addedCount`/`errorCount`/`status`；sync-logs 页面已对齐 |
| R4 | partner/sources `DisplaySource` 接口与 `DataSourceConfig` 不对齐 | 完全自定义视图模型，不对应任何 shared 类型 | 📋 **延至 Phase 7.11**：不在本期 jobs/fairs 主链路内，单独处理 |

---

## 八、正确开发节奏

```
干净架构 → 设计系统 → 核心页面 → 后端 API → 打印机对接 → 上线测试
```

不要跳过设计系统直接写页面。  
不要在旧秒哒项目里继续堆功能。  
不要一次性想完成所有功能。

---

## 九、更新记录

| 日期 | 更新内容 | 操作人 |
|------|---------|--------|
| 2026-05-23 | 建立项目文档体系（CLAUDE.md + 4 个文档） | Claude Code |
| 2026-05-23 | 整理目录结构，新增 AGENTS.md、README.md、ai-collaboration-rules.md、next-tasks.md，compliance 文档移至独立目录 | Claude Code |
| 2026-05-23 | 补充跨平台运行要求：CLAUDE.md 新增第 17 节、README.md 新增平台说明、新建 terminal-agent-windows.md | Claude Code |
| 2026-05-23 | 第 0 阶段完成：pnpm monorepo 初始化，三端 app 可运行，packages/ui 和 packages/shared 已创建，lint/typecheck/dev 全部通过 | Claude Code |
| 2026-05-23 | Phase 0 修复：Button 触控尺寸修正、forwardRef、.env.example、三端引用 ui/shared、tsconfig.node.json 修复、构建产物清理、pnpm build 通过 | Claude Code |
| 2026-05-23 | Codex Phase 0 复审收尾：补 .gitattributes、路径别名、StatusBadge 无障碍语义、Vite/Esbuild 安全升级，lint/typecheck/build/audit 均通过 | Codex |
| 2026-05-23 | 提交前清理：移除 .DS_Store 和 zip 出 git 索引，补 *.zip gitignore 规则，全部检查通过，Phase 0 正式封板 | Claude Code |
| 2026-05-23 | Phase 1 设计系统基建：tokens.css(@theme)、cn()工具、cva重构Button/Card/StatusBadge、Spinner/EmptyState/LoadingState/ErrorState、KioskLayout/AdminLayout/PartnerLayout，lint/typecheck/build全通过 | Claude Code |
| 2026-05-24 | Phase 1 视觉验证修复：三端 index.css 补 `@source "../../../packages/ui/src"` 指令，修复 Tailwind v4 不扫描 workspace 包导致样式全部缺失的问题，截图确认三端布局/颜色/组件均正常 | Claude Code |
| 2026-05-24 | Phase 2 完成：Admin 14路由、Partner 10路由、Kiosk /policy 路由及首页按钮接线；路由结构统一（router→routes/index.tsx，布局→layouts/），App.tsx 薄包装；Fast Refresh warning 修复；废弃 settings 路由删除；Playwright 截图验收全部通过 | Claude Code |
| 2026-05-24 | Phase 3 打印流程完成：PrintUploadPage→PreviewPage→ConfirmPage→ProgressPage→DonePage，含成功/失败/重试路径；DEV 模拟失败按钮；CONTROL_FIELDS 黑名单重试；Mavis 视觉修复；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-24 | Phase 3 扫描流程完成：ScanStartPage→SettingsPage→ProgressPage→ResultPage，4 页扫描流程，含类型选择/参数配置/进度/结果；DEV 模拟失败；黑名单重试；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-24 | Phase 3 AI简历服务完成：ResumeSourcePage→ParsePage→ReportPage→OptimizePage→ExportPage，5 页流程；合规说明；DEV 模拟失败；ProfilePage 整合承接；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 3 封板：P1白屏修复（ResumeReportPage return null → ErrorState），lint/typecheck/build 全通过，合规词审查通过，推送 GitHub main | Claude Code |
| 2026-05-25 | Phase 4 完成：JobsPage+JobDetailPage+JobFairsPage+JobFairDetailPage，ExternalJob/ExternalJobFair 类型扩展，合规边界执行，lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 4 加固：mock 数据抽离至 data/externalSources.ts；详情页刷新/直接访问 fallback 到 mock 查找；QR overlay 增加来源机构/外部编号/"请使用手机前往来源平台办理"；ResumeReportPage "录用率"→"招聘结果"合规修正；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 5 Admin P0/P1 全部完成（9页）：Dashboard/Terminals/Orders/Printers/JobSources/FairSources/Partners/Alerts/Files；Alerts 双维度筛选（级别×状态）+标记处理中/已解决；Files 三维度筛选+高敏感风险提示+手动删除/立即清理+合规说明；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 6 Partner P0 完成（6页）：Dashboard（8指标卡+最近同步记录）、Profile（机构资料+绑定终端+权限范围）、Jobs（岗位管理+类型/审核双筛选+二维码/下架操作）、Fairs（招聘会管理+预约二维码/打印/下架）、Sources（数据源管理+连接状态+启用停用）、SyncLogs（同步日志+异常字段+重试）；合规说明全覆盖；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | 外部数据源类型体系收口：packages/shared 统一 ReviewStatus/PublishStatus/SourceKind/AccessMode/AuthType；DataSourceType 拆分为 sourceKind×accessMode 双维度；DataSourceAccess 移除 apiKey，加 credentialConfigured；新增 ImportBatch/ImportRecord/FieldMappingRule/MappingValidationError；更新 external-data-source-design.md 和 CLAUDE.md §18；externalSources.ts 修正 reviewStatus 值；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 6 Excel 导入向导 MVP：Sources 页新增 ExcelImportWizard 4 步向导（基本信息→模拟上传→字段映射→导入预览），使用 FieldMappingRule/ImportBatch/ImportRecord 共享类型，AUTO_SUGGEST 自动预填映射，5 个必填字段校验，7 条 mock 记录（5 ok/1 invalid/1 dup）；合规说明全覆盖；Fast Refresh 安全（命名组件模块级定义）；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 6.5 数据链路一致性复查（第一轮）：①4 个文件本地 ReviewStatus 补全 'reviewing'；②4 个文件本地 PublishStatus 补全 'draft'/'expired'；③更新对应 REVIEW_MAP/PUBLISH_MAP/REVIEW_FILTERS/counts；④admin job-sources/fair-sources handleApprove 修正为 →draft（正确流程：pending→reviewing→approved/draft→published），新增 handlePublish 操作；⑤admin 两个文件 sourceOrg 字段重命名为 sourceName（与 ExternalJobSource.sourceName 一致）；⑥mock 数据增加 reviewing/draft/expired 状态样本；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 6.5 数据链路一致性复查（第二轮）：①partner/fairs reserveUrl → sourceUrl（与 ExternalJobSource.sourceUrl 一致，招聘会预约链接即 sourceUrl）；②partner/fairs + admin/fair-sources fairStatus → status（与 ExternalJobFair.status 一致，FairStatus 类型名保留）；记录4项 Phase 7 结构性风险（见下节）；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | 统一合作机构类型系统（Phase 6.5+）：新增 packages/shared/src/types/partner.ts，定义 PartnerType(5)/SceneTemplate(3)/EnabledModule(9)/PROHIBITED_MODULES(5)/PartnerCoopStatus/PublicServiceLevel/PartnerSceneConfig/PartnerProfile/SCENE_DEFAULT_MODULES/全部展示标签常量；admin/partners 页面重写使用共享类型（双维度筛选+场景模板+启用模块列）；partner/profile 页面重写为 public_employment_service mock，展示"场景与模块配置"卡片（启用模块 chips + 永久禁用模块合规说明）；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | 招聘会服务数字化模块：新增 packages/shared/src/types/fair.ts（FairCompany/FairZone/FairBooth/FairMaterial/FairLiveStats 等类型及标签常量）；kiosk 5个新页面（FairCompaniesPage+FairCompanyDetailPage+FairMapPage+FairMaterialsPage+FairStatsPage）+5个新路由；JobFairDetailPage 新增"现场服务"子导航（参会企业/展馆导览/活动资料/现场数据）；admin 新增"招聘会管理"页面（fair-sources 旁独立入口，5 tab：企业/展位/资料/统计，含 Excel 导入入口）；fairData.ts mock 数据含 f1/f2 两场完整数据；合规：系统仅记录浏览/扫码/打印/签到，不接收简历，不做候选人管理；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | 新增 AI数字人引导员需求规划：docs/product/ai-avatar-guide.md，明确 Phase 9 执行轻量 3D 就业服务引导员路线（Three.js/VRM/GLB、TTS、嘴型、intent router、AI助手融合、面试训练后置）；同步 next-tasks.md Phase 9 规划；合规约束：不做人脸识别、不保存音视频、不向企业推送简历/面试结果、不做招聘闭环 | Codex |
| 2026-05-26 | Phase 7.4 Admin Service Layer：job-sources/fair-sources 从内联 mock 改为 service/adapter 模式；新建 adminMockAdapter.ts + adminHttpAdapter.ts + sources.ts；6 个 service 文件全部 ✅；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7.5 Partner Service Layer：partner jobs/fairs/sync-logs 页面内联 mock 清除；新建/扩展 partnerMockAdapter.ts + partnerHttpAdapter.ts + partnerContent.ts；7 个 service 文件全部 ✅；4 个页面全部走 service 层；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7.4+7.5 Service Layer 复查：输出 docs/reviews/phase7-service-layer-review.md；合规词 8 项全部 CLEAN；文档补全（api-client-adapter.md、current-progress.md、next-tasks.md）；记录 R1–R4 结构性风险（Phase 7.6 API 设计时解决）；lint 0 warnings / typecheck 0 errors / build ✅（admin 369KB / partner 337KB / kiosk 409KB） | Claude Code |
| 2026-05-26 | Phase 7 AI Service Layer（前端）完成：新增 packages/shared/src/types/ai.ts（8 种类型）；新增 aiMockAdapter + aiHttpAdapter + ai.ts（4 个服务函数）；改造 ResumeParsePage/ResumeReportPage/ResumeOptimizePage（mock 数据移出页面层，通过 submitResumeParse/getResumeRecord/getResumeOptimize 获取）；新增 docs/product/ai-provider-integration.md；API Key 只在服务端，前端类型不含凭证；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7 AI Service Layer 文档收口：api-v1-design.md 补充 §8 AI 助手（POST /assistant/chat + 会话历史）、§9 AI 服务用量统计（GET /admin/ai/usage + logs）、AI 错误码（AI_TASK_NOT_FOUND/AI_QUOTA_EXCEEDED/AI_RATE_LIMITED）；current-progress.md + next-tasks.md 更新；合规检查：所有"候选人/面试邀约"等词均在禁止/声明语境中，无功能入口 | Claude Code |
| 2026-05-26 | Phase 7.6 后端 AI Provider 骨架：services/api NestJS 结构初始化；AiProvider 接口；MockAiProvider（完整实现）；OpenAI/Claude/Local/Qwen/Zhipu stub（NotImplementedException）；4 个 AI 接口（/resume/parse /resume/records/:id /resume/records/:id/optimize /assistant/chat）；AiLogService（只记元数据，禁止记简历内容）；未知 AI_PROVIDER 启动抛异常、task 不存在返回 AI_TASK_NOT_FOUND、DTO @IsNotEmpty+@MaxLength 补强；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7.7 AI 助手页面接 service：AssistantPage 完整重写为 chat UI（消息列表/加载动画/输入框/发送/错误气泡）；接入 chatWithAssistant() mock/http adapter；sessionId localStorage 持久化（kiosk restricted mode 容错）；actions 路由白名单过滤（/resume/ /print/ /scan/ /jobs /job-fairs /policy）；http 失败显示错误气泡不 fallback；底部免责"不构成正式建议"；cancelledRef 防 unmount setState；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7.8 Admin AI 服务管理页：admin/ai-services 页面完成；8 指标卡（调用量/成功率/平均延迟/三类操作量/失败数/估算费用）；失败原因统计；操作类型+状态双维度筛选日志表；mock 数据只含元数据（无简历内容/聊天原文）；底部合规说明"AI 日志仅记录元数据"；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7.9 Admin AI 接口闭环：后端新增 GET /admin/ai/usage（聚合统计：总量/成功率/平均延迟/按操作分布/错误码分布）和 GET /admin/ai/logs（元数据列表，limit 参数，上限 500）；AiLogService 新增 getUsage()/getLogs()，record() 自动写入 createdAt；前端新建 adminAiMockAdapter/adminAiHttpAdapter/aiUsage service layer；Admin AI 服务页从内联 mock 改为 useEffect + service layer（含 LoadingState/ErrorState）；API 文档 sk-... 改为 <server-only-secret>；pnpm lint/typecheck/build 全通过（0 errors 0 warnings） | Claude Code |
| 2026-05-26 | Phase 7.10 后端岗位/招聘会真实 API：后端 JobsModule（DTOs/Service/Controller）14 个接口（Kiosk 4/Admin 6/Partner 6）；审核流 pending→reviewing→approved+draft，发布流 draft→published→unpublished，PUBLISH_REQUIRES_APPROVAL 保护；Kiosk 只展示 approved+published；Partner 导入默认 pending+draft；Admin R1 字段补全（sourceUrl/sourceOrgId/tags/description/requirements）；Partner R2 sourceName 补全、R3 字段重命名（addedCount/errorCount/status）；admin wrapper 方法保持兼容（approveJobSource→reviewJobSource）；R4 延至 Phase 7.11；pnpm lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 8 Windows Terminal Agent 设计文档 v1.0：docs/device/windows-terminal-agent-design.md（10 节完整设计：定位/核心能力/模块划分/7 API/打印流程/扫描流程/安全/Windows 兼容性/MVP/10 项风险；MVP Phase 8.1 = 注册+心跳+打印+扫描+文件上传+Windows服务；技术选型：Node.js 20 + DPAPI） | Claude Code |
| 2026-05-26 | Phase 8 设计文档 v1.1：补充双进程架构（Service + User Session Helper，Named Pipe + ACL）；local-api-server 安全重设计（删除无鉴权、localAuthToken 查询类、actionToken 动作类、HMAC+nonce+expiresAt 防重放、403 返回规范）；GET /tasks → POST /api/v1/terminals/:terminalId/tasks/claim（原子 lease，claimedBy+claimExpiresAt，崩溃后超时重新领取）；临时文件路径全文统一为 %ProgramData%\AIJobPrintAgent\temp\（ACL 仅 Agent 服务账号/管理员）；单实例 Windows Mutex；Phase 8.0 技术验证清单 15 项（含 Named Pipe/TWAIN/actionToken/claim lease/打包方案对比/DPAPI/断网幂等/单实例 Mutex）；风险清单扩展至 R12；打包方案对比（pkg/nexe/electron-builder/.NET wrapper）| Claude Code |
| 2026-05-26 | Phase 8 设计文档 v1.2（审计补充）：新增 §4.8 actionToken 签发接口（POST /api/v1/terminals/:id/action-tokens，body: action/taskId，response: actionToken/expiresAt/nonce）；新增 §4.9 claim lease 续租接口（PATCH /api/v1/terminal-tasks/:id/lease，body: claimedBy/extendSeconds，response: ok/newExpiresAt 或 LEASE_RENEW_FAILED）；Named Pipe ACL 细化（明确禁止 Everyone/Users/Authenticated Users，仅允许 Service SID + Helper SID + BUILTIN\Administrators）；§2.4 claim 补充续租机制（最多 3 次，总 lease 20 分钟，超限 LEASE_RENEW_FAILED） | Mavis |
| 2026-05-26 | Phase 7.10 收口复查：6 项检查全部通过——① Kiosk 双重过滤（approved+published）✅；② 状态机（approve→approved+draft，PUBLISH_REQUIRES_APPROVAL，publish≠approve）✅；③ Partner 导入硬编码 pending+draft，4 个必填字段均有 @IsNotEmpty 校验✅；④ 所有 DTO 无 apiSecret/accessToken/clientSecret/password✅；⑤ 违规功能词全文扫描 CLEAN（仅出现于合规注释/说明文案）✅；⑥ lint 0 warnings / typecheck 0 errors / build ✅（admin 387KB / partner 338KB / kiosk 418KB）；1 个次要观察：approve 对已发布记录重复调用会将 publishStatus 重置为 draft（边缘场景，正常流程不可达）| Claude Code |
| 2026-05-27 | Phase 8.0.1/8.0.2 图片打印补充验证完成：QA-1 PDF Method B 真实出纸✅；QA-2/QA-3 Method A JPG/PNG 假成功（exitCode=0 但未出纸，Windows 11 Photos app PrintTo verb 问题）；mspaint /pt 排除（mspaint.exe 不存在）；Phase 8.1 图片路径确定为 pdfkit→临时 PDF→Method B；可进入 Phase 8.1 MVP | Claude Code |
| 2026-05-27 | Phase 8.0 V01–V15 验证清单执行完成（Windows 11 + Node.js v24 + pnpm 10 + Pantum CM2800ADN Series USB）：V01–V11 全部 PASS；Method A/B 均可用（PDF/JPG/PNG）；错误码 FILE_NOT_FOUND/PRINTER_NOT_FOUND/UNSUPPORTED_FILE_TYPE 均正确；WMI 正常/Unknown 状态可读；V12 PARTIAL（小文件 spooler 过快）；V13 PARTIAL（WorkOffline=True→PrinterStatus=2）；V14 待物理缺纸测试；V15 PASS；config.ts DEFAULT_PRINTER 修正为 `Pantum CM2800ADN Series`；**Phase 8.1 可启动** | Claude Code |
| 2026-05-27 | Phase 8 打印链路 API/文档对齐：① PrintJobParams.pageRange 从 `'all'\|string` 改为 `pageRange?: string`（缺省=全部，4 处对齐：shared/types/print.ts / PrintPreviewPage / PrintConfirmPage / terminal-agent/types）；② api-v1-design.md 新增 §5.3（POST /api/v1/print-tasks PrintTaskCreateDto + GET /api/v1/print-tasks/:taskId）、§4.3 /tasks/claim 响应完整 params: PrintJobParams（9 字段，替代旧 4 字段 options）、标注旧 POST /print/orders 字段 colorMode:"bw\|color"/duplexMode 为过时命名；③ windows-terminal-agent-design.md §4.3 claim 响应 options→params（9 字段）、新增 §5.1 打印机状态检测（Phase 8.0 WMI Spike 目标表 + Phase 8.1 打印任务状态机）；④ local-print-spike.md 新增 V12–V15（Get-PrintJob/Win32_Printer 离线缺纸/UNKNOWN_PRINTER_STATUS）、Phase 8.1 状态机说明 | Claude Code |
| 2026-05-27 | Phase 8.1B 后端联调全部完成：新建 TerminalsModule（terminals.service.ts + terminals.controller.ts + terminals.module.ts + 4 个 DTO），实现 POST /auth/terminal/register、PUT /terminals/:id/heartbeat、POST /terminals/:id/tasks/claim（原子 claim + 5min 过期自动重置）、PATCH /print-tasks/:id/status（状态机 + 幂等），GET /test/sample.png（1×1 PNG 种子文件）；种子任务 ptask_seed_001 在服务启动时写入；app.module.ts 接入 TerminalsModule；冒烟测试全部通过（register→heartbeat→claim→PATCH printing/completed 幂等 PATCH 均返回 200）；typecheck 0 errors；修复 import type 导致 whitelist: true 剥离 DTO 字段的 bug（改为 value import） | Claude Code |
| 2026-05-27 | Phase 8 设备名称/Provider分层修正：① CLAUDE.md §3 打印机型号更新为奔图 CM2800/CM2820 系列（Windows 识别名 `Pantum CM2800ADN Series`），新增硬件能力 vs 开放 API 能力对比表、Pantum 签名算法（MD5）、云打印架构说明；② PrintJobParams 新增可选字段 collate/paperType/feeder（共享类型+Agent类型同步），colorMode cloud TODO 注释；③ windows-terminal-agent-design.md 全文 CM2820ADN→CM2800ADN/CM2820ADN系列，新增 §12 Provider/Executor 分层（LocalAgentDispatchProvider/PantumCloudDispatchProvider/LocalPrintExecutor/三种 Executor）；④ 新建 docs/device/pantum-api-design.md（签名算法/PrintJobParams映射/预留接口/7项未解决问题）；⑤ current-progress.md 打印机型号记录更新 | Claude Code |

---

> 每次完成开发任务后，请更新本文档的任务清单和更新记录。

---

## 十一、Phase 8.0 本地打印 Spike（2026-05-26）

### 目标

在 Windows 主机上验证 Terminal Agent 能否稳定把本地文件打印到奔图 CM2800ADN/CM2820ADN 系列（Windows 识别名：`Pantum CM2800ADN Series`），不接云端、不接 Kiosk。

### 创建内容

| 文件 | 说明 |
|------|------|
| `apps/terminal-agent/package.json` | Node.js 项目，commander + pdf-to-printer |
| `apps/terminal-agent/tsconfig.json` | TypeScript strict 配置 |
| `apps/terminal-agent/src/index.ts` | CLI 入口：`print` / `list-printers` 命令 |
| `apps/terminal-agent/src/config.ts` | 默认打印机名称、支持格式、超时配置 |
| `apps/terminal-agent/src/logger.ts` | 带时间戳的控制台日志 |
| `apps/terminal-agent/src/printer/types.ts` | PrintResult / PrintErrorCode / PrinterInfo 类型 |
| `apps/terminal-agent/src/printer/printer-status.ts` | PowerShell Get-Printer 列举和检查打印机 |
| `apps/terminal-agent/src/printer/print-with-powershell.ts` | Method A：Start-Process -Verb PrintTo |
| `apps/terminal-agent/src/printer/print-with-pdf-to-printer.ts` | Method B：pdf-to-printer（SumatraPDF）|
| `apps/terminal-agent/samples/README.md` | 测试文件说明和命令示例 |
| `apps/terminal-agent/.gitignore` | 保护测试文件不被提交 |
| `docs/device/local-print-spike.md` | 完整验证清单（V01–V11）和方法对比 |

### 错误码

`PRINTER_NOT_FOUND` / `FILE_NOT_FOUND` / `UNSUPPORTED_FILE_TYPE` / `PRINT_COMMAND_FAILED` / `PRINT_TIMEOUT` / `UNKNOWN_PRINT_ERROR`

### 两种方法

| | Method A | Method B |
|---|---|---|
| 机制 | PowerShell Start-Process -Verb PrintTo | pdf-to-printer / SumatraPDF |
| PDF | 待确认（Windows 11 未物理测试）| ✅ 真实出纸（QA-1 确认）|
| 图片 | ❌ 假成功（exitCode=0 但不打印）| N/A（不支持；用 pdfkit 转 PDF 后再 Method B）|

### Phase 8.0.1/8.0.2 实机验证收口（2026-05-27）✅

- **QA-1 Method B PDF 真实出纸 ✅**（557ms，`Pantum CM2800ADN Series`）
- **QA-2/3 Method A JPG/PNG 假成功 ❌**（exitCode=0 但纸未出，根因：Windows 11 Photos app PrintTo verb 不触发打印）
- **mspaint /pt 方案排除 ❌**（Windows 11 无 mspaint.exe）
- **图片打印路径已确定**：pdfkit 生成临时 PDF → Method B → 打印完成删除临时文件

V01–V11 全部 PASS（11/11）；V05 真实出纸 ✅；V03/V04 假成功 ❌；V12 PARTIAL；V13 PARTIAL；V14 待测；V15 PASS。

### Phase 8.1A Local Print MVP 已完成（2026-05-27）✅

- 目标：统一 `print(file, printerName, params)` 函数
- PDF → Method B 直接打印
- 图片（.jpg/.png）→ pdfkit 临时 PDF → Method B → 删除临时文件
- BMP/TIFF → Phase 8.1B（需 sharp 预处理）
- printerName 从 `DEFAULT_PRINTER` 配置读取，不硬编码
