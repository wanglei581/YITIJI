# 下一步任务

> 最后更新：2026-05-27（Phase 8.1C Terminal Agent 长期运行加固完成）  
> 关联文档：[current-progress.md](./current-progress.md)

---

## ✅ 已完成阶段

### Phase 0 - 项目初始化（已封板）

| 验收项 | 状态 |
|--------|------|
| pnpm lint | ✅ 通过（零报错） |
| pnpm typecheck | ✅ 通过（零错误） |
| pnpm build | ✅ 三端均通过（Vite 6.4.2） |
| pnpm audit | ✅ No known vulnerabilities found |
| .gitattributes（LF 统一） | ✅ 已补全 |
| .DS_Store / zip 已移出 git 索引 | ✅ 已清理 |
| 合规边界干净（无禁用文案/密钥泄漏） | ✅ 审查通过 |
| 三端 app 引用 ui/shared 公共包 | ✅ 已验证 |

### Phase 1 - 设计系统基建（已完成）

| 交付项 | 状态 |
|--------|------|
| tokens.css（@theme 变量） | ✅ |
| cn 工具（clsx + twMerge） | ✅ |
| Button/Card/StatusBadge/PageHeader cva 重构 | ✅ |
| Spinner/EmptyState/LoadingState/ErrorState | ✅ |
| KioskLayout/AdminLayout/PartnerLayout | ✅ |
| 三端 `@source` 样式扫描修复 | ✅ |
| pnpm lint/typecheck/build/audit 复核通过 | ✅ |

### Phase 2 - 页面框架与导航接线（已完成 2026-05-24）

| 交付项 | 状态 |
|--------|------|
| 三端路由骨架（React Router v7） | ✅ |
| KioskLayout 底部导航联动 | ✅ |
| AdminLayout 14 路由侧栏联动 | ✅ |
| PartnerLayout 10 路由菜单联动 | ✅ |
| Fast Refresh warning 修复 | ✅ |
| Playwright 截图验收 | ✅ |

### Phase 3 - 一体机前台 MVP（已封板 2026-05-25）

| 模块 | 页面 | 状态 |
|------|------|------|
| 打印流程 | 5页（upload→preview→confirm→progress→done） | ✅ |
| 扫描流程 | 4页（start→settings→progress→result） | ✅ |
| AI简历服务 | 5页（source→parse→report→optimize→export） | ✅ |
| 我的记录 | 1页（profile，整合三流程承接） | ✅ |
| P1 白屏修复 | ResumeReportPage ErrorState | ✅ |

**数据状态**：全部 mock + location.state，不接后端  
**合规**：禁用文案审查通过，DEV 失败按钮隔离 ✅  
**构建**：lint/typecheck/build 全通过 ✅

### Phase 4 - 岗位和招聘会信息（已完成 2026-05-25）

| 模块 | 页面 | 状态 |
|------|------|------|
| 岗位列表 | JobsPage（5条mock岗位，标签筛选） | ✅ |
| 岗位详情 | JobDetailPage（完整信息+来源+合规说明） | ✅ |
| 招聘会列表 | JobFairsPage（3条mock招聘会，状态筛选） | ✅ |
| 招聘会详情 | JobFairDetailPage（详情+来源+合规+打印资料） | ✅ |

**类型**：`ExternalJob`、`ExternalJobFair`、`JobFairStatus` 已加入 packages/shared  
**合规**：去来源平台投递/扫码投递/扫码预约，无一键投递/候选人等禁用文案 ✅  
**构建**：lint/typecheck/build 全通过 ✅

---

## 🚧 Phase 5 - 管理员后台（P0/P1核心页面完成，P2/P3待填充）

当前状态：14路由骨架完成，7个核心页面已填充（Dashboard / Terminals / Orders / Printers / JobSources / FairSources / Partners）。

### 已完成页面

| 优先级 | 页面 | 状态 |
|--------|------|------|
| P0 | 工作台（Dashboard） | ✅ 9指标卡 + 最新告警 |
| P0 | 终端管理 | ✅ 10台终端 + 状态筛选 + 标记维护 |
| P0 | 订单管理 | ✅ 类型筛选 + 退款操作 |
| P0 | 打印机管理 | ✅ 碳粉余量 + 纸张状态 + 故障信息 |
| P1 | 岗位信息源 | ✅ 第三方岗位数据审核/发布 |
| P1 | 招聘会信息源 | ✅ 招聘会数据审核/发布/打印 |
| P1 | 合作机构管理 | ✅ 机构类型 + 启用停用 + 绑定终端 |

### 已完成 P1 页面

| 优先级 | 页面 | 状态 |
|--------|------|------|
| P1 | 告警中心 | ✅ 9类告警 + 级别/状态双维度筛选 + 标记处理中/已解决 |
| P1 | 文件管理 | ✅ 5类文件 + 三维度筛选 + 高敏感风险提示 + 合规说明 |

### 待填充页面（P2/P3，Phase 5 后期或视需求填充）

| 优先级 | 页面 | 说明 |
|--------|------|------|
| P2 | AI服务管理 | ✅ 已完成（Phase 7.8/7.9：指标卡+日志表+service layer+后端接口） |
| P2 | 日志审计 | 操作日志列表、筛选 |
| P3 | 权限管理 | 角色/用户管理 |

---

## ✅ 招聘会服务数字化模块（已完成 2026-05-25）

**Kiosk 新增 5 页（现场服务子路由）：**
- `/job-fairs/:id/companies` — 参会企业列表（展区筛选 + 全文搜索 + 签到状态）
- `/job-fairs/:id/companies/:companyId` — 企业详情（岗位信息展示 + 扫码二维码，合规：不接收简历）
- `/job-fairs/:id/map` — 展馆导览（展区概览卡 + 展位格子，点击查看详情/跳转企业）
- `/job-fairs/:id/materials` — 活动资料（按类型展示，免费打印接入打印流程）
- `/job-fairs/:id/stats` — 现场数据（企业签到进度 + 服务行为统计，无求职者个人数据）

**JobFairDetailPage 新增"现场服务"区块：** 4 个快捷入口按钮（有 managed 数据时显示）

**Admin 新增"招聘会管理"（`/fairs`）：**
- 招聘会选择器（卡片式，3 场招聘会可切换）
- 标签页：参会企业（签到状态筛选 + Excel 导入入口）/ 展位管理（展区分组 + 展位格子）/ 活动资料（发布/下架）/ 数据统计（指标卡 + 签到进度 + 展区分布）

**合规边界全程保持：**
- 系统不接收简历，不提供候选人管理、企业查看简历、一键投递
- 所有投递/预约均以二维码形式跳转来源平台
- 统计数据只记录服务行为（浏览/扫码/打印/签到），不记录求职者个人信息

---

## ✅ Phase 6.5+ - 统一合作机构类型系统（已完成 2026-05-25）

**新增 `packages/shared/src/types/partner.ts`：**
- `PartnerType`（5值）× `SceneTemplate`（3值）× `EnabledModule`（9值）统一权限配置模型
- `PROHIBITED_MODULES`（永久禁用5项）：`in_platform_apply`、`candidate_management`、`resume_delivery_to_enterprise`、`interview_invitation`、`offer_management`
- `SCENE_DEFAULT_MODULES`：每个 SceneTemplate 的默认启用模块集合
- `PartnerSceneConfig`：含 public_employment_service 专用字段（jurisdictionArea/serviceLevel/govOrgCode）
- 全部标签常量：`PARTNER_TYPE_LABELS`、`SCENE_TEMPLATE_LABELS`、`MODULE_LABELS`、`PUBLIC_SERVICE_LEVEL_LABELS`

**已升级页面：**
- `admin/partners`：使用共享类型，双维度筛选（合作状态+机构类型），表格新增机构类型/场景模板/启用模块列
- `partner/profile`：mock 改为 public_employment_service，新增"场景与模块配置"卡片（启用模块 chips + 永久禁用合规说明）

---

## ✅ Phase 6 - 合作机构后台 P0（已完成 2026-05-25）

| 页面 | 状态 |
|------|------|
| Dashboard（工作台） | ✅ 8指标卡 + 最近同步记录 |
| Profile（机构资料） | ✅ 基本信息 + 场景配置 + 永久禁用合规说明 + 绑定终端（已升级共享类型） |
| Jobs（岗位信息管理） | ✅ 类型/审核双筛选 + 外部编号/来源链接 + 下架/二维码 |
| Fairs（招聘会信息管理） | ✅ 状态筛选 + 预约链接 + 打印/二维码/下架 |
| Sources（数据源管理） | ✅ Excel/API/Webhook + 启用停用 + 测试连接 + Excel 导入 4 步向导 MVP |
| SyncLogs（同步日志） | ✅ 成功/失败/重复/异常字段/失败原因 + 重试 |

**合规边界**：所有页面底部含合规说明；Jobs/Fairs 无简历收集、无候选人管理 ✅  
**类型体系**：packages/shared 外部数据源类型已完整收口（SourceKind×AccessMode 双维度，ImportBatch/ImportRecord/FieldMappingRule，敏感字段服务端隔离）✅

### 待填充页面（P1/P2）

| 优先级 | 页面 | 说明 |
|--------|------|------|
| P1 | 数据统计 | 展示量、跳转量、打印次数 |
| P2 | 账号权限 | 子账号管理、操作日志 |

---

## ✅ Phase 7.6 - 后端 AI Provider 骨架完成（2026-05-26）

> **状态**：后端 AI Provider 骨架完成，暂不接真实数据库和真实 AI Provider。

### 7.6 已完成

| 项 | 文件 | 状态 |
|----|------|------|
| NestJS AI 模块骨架（`services/api/src/ai/`） | ai.module.ts | ✅ |
| `AiProvider` 接口 + 全部类型 | interfaces/ai-provider.interface.ts | ✅ |
| `MockAiProvider`（完整实现） | providers/mock.provider.ts | ✅ |
| OpenAI / Claude / Local / Qwen / Zhipu stub（NotImplementedException） | providers/*.stub.ts | ✅ |
| `POST /resume/parse` | ai.controller.ts | ✅ |
| `GET /resume/records/:taskId` | ai.controller.ts | ✅ |
| `GET /resume/records/:taskId/optimize` | ai.controller.ts | ✅ |
| `POST /assistant/chat` | ai.controller.ts | ✅ |
| AI 元数据日志（taskId/provider/latency/tokenUsage/cost/status，禁记简历内容） | ai-log.service.ts | ✅ |
| 未知 AI_PROVIDER 启动时抛异常（不 fallback mock） | ai.service.ts | ✅ |
| qwen/zhipu 未实现时 NotImplementedException（不 fallback mock） | ai.service.ts | ✅ |
| task 不存在返回 AI_TASK_NOT_FOUND（NotFoundException） | ai.service.ts | ✅ |
| DTO 校验：@IsNotEmpty + @MaxLength | dto/*.dto.ts | ✅ |

### 7.6 未完成（后续阶段实现）

| 项 | 说明 |
|----|------|
| 真实 Claude / OpenAI Provider | 需配置 API Key，替换 stub |
| 真实 Qwen / Zhipu Provider | 需配置 API Key，替换 stub |
| Prisma AiTask 持久化 | In-memory store → DB（重启后 task 消失） |
| `GET /admin/ai/usage` | ✅ Phase 7.9 已完成（聚合统计，仅元数据） |
| `GET /admin/ai/logs` | ✅ Phase 7.9 已完成（元数据列表，limit≤500） |
| Provider 配置管理页面 | ✅ Phase 7.8 已完成（Admin AI 服务管理页） |
| 限流、配额、成本控制 | 生产级保障 |
| 生产级鉴权（JWT Guard） | Auth stub 当前直通 |

### 7.6 参考文档

- [AI 服务提供商接入指南](../product/ai-provider-integration.md)
- [后端骨架架构设计](../api/backend-architecture-phase7.md)

---

## ✅ Phase 7.7 - AI 助手页面接 service（已完成 2026-05-26）

| 项 | 文件 | 状态 |
|----|------|------|
| AssistantPage 完整重写（chat UI + loading + 错误态） | kiosk/pages/assistant/AssistantPage.tsx | ✅ |
| `chatWithAssistant()` 接入，mock/http adapter 均支持 | services/api.ts | ✅ |
| sessionId localStorage 持久化（kiosk restricted mode 容错） | AssistantPage.tsx | ✅ |
| http 失败显示"AI 服务暂不可用"，不 fallback | AssistantPage.tsx | ✅ |
| 路由白名单过滤 actions（`/resume/ /print/ /scan/ /jobs /job-fairs /policy`） | AssistantPage.tsx | ✅ |
| 所有 AI 回复标注"内容仅供参考" | AssistantPage.tsx | ✅ |
| 底部免责文案：AI 回复内容仅供参考，**不构成正式建议** | AssistantPage.tsx | ✅ |
| cancelledRef 防 unmount 后 setState | AssistantPage.tsx | ✅ |
| 合规：无一键投递/候选人/HR查看等禁用词 | 全文审查 | ✅ |

**数据状态**：mock adapter（`VITE_API_MODE=mock`）正常；http adapter 失败→错误气泡  
**构建**：lint/typecheck/build 全通过 ✅

---

## ✅ Phase 7.8 - Admin AI 服务管理页（已完成 2026-05-26）

| 项 | 文件 | 状态 |
|----|------|------|
| AI 服务管理页（`/ai-services`） | admin/routes/ai-services/index.tsx | ✅ |
| 8个指标卡（调用量/成功率/平均延迟/parseResume/optimizeResume/chatAssistant/失败数/估算费用） | index.tsx | ✅ |
| 失败原因统计（TIMEOUT + NotImplementedException 带红色徽章） | index.tsx | ✅ |
| 操作类型 + 状态双维度筛选日志表 | index.tsx | ✅ |
| 日志列：taskId(截断)/服务类型/Provider(紫色徽章)/状态/响应时间/时间戳 | index.tsx | ✅ |
| mock 数据只含元数据（无简历内容/聊天原文/文件名） | index.tsx | ✅ |
| 底部合规说明卡："AI 日志仅记录元数据，不保存完整简历内容和聊天原文" | index.tsx | ✅ |
| 显式声明后端 `/admin/ai/logs` API 待实现 | index.tsx | ✅ |

## ✅ Phase 7.9 - Admin AI 接口闭环（已完成 2026-05-26）

| 项 | 文件 | 状态 |
|----|------|------|
| 后端 `GET /admin/ai/usage`（聚合统计，仅元数据） | ai.controller.ts + ai-log.service.ts | ✅ |
| 后端 `GET /admin/ai/logs`（列表，limit≤500，仅元数据） | ai.controller.ts + ai-log.service.ts | ✅ |
| `AiLogService.record()` 自动写入 `createdAt` ISO string | ai-log.service.ts | ✅ |
| `AiLogService.getUsage()` + `getLogs()` 方法 | ai-log.service.ts | ✅ |
| `AiService.getProviderName()` 方法 | ai.service.ts | ✅ |
| 前端 `adminAiMockAdapter` | admin/services/api/adminAiMockAdapter.ts | ✅ |
| 前端 `adminAiHttpAdapter` | admin/services/api/adminAiHttpAdapter.ts | ✅ |
| 前端 `aiUsage` service layer（mock/http 切换） | admin/services/api/aiUsage.ts | ✅ |
| Admin AI 服务页改为 `useEffect + service layer` | admin/routes/ai-services/index.tsx | ✅ |
| API 文档 `sk-...` → `<server-only-secret>` | docs/api/api-v1-design.md | ✅ |
| 合规说明简化（移除"后端接口待实现"声明） | admin/routes/ai-services/index.tsx | ✅ |

**数据合规**：返回字段只含 taskId/provider/operation/status/latencyMs/errorCode/createdAt，无简历内容/聊天原文/文件名/fileId  
**构建**：lint/typecheck/build 全通过 ✅

### 7.9 未完成（后续阶段实现）

| 项 | 说明 |
|----|------|
| Prisma AiTask 持久化 | in-memory store → DB，重启后日志消失 |
| 真实 Provider（OpenAI/Claude/Qwen/Zhipu） | 配置 API Key 后替换 stub |
| Provider 切换 UI | Admin 界面配置，不含 Key 明文 |
| 用量告警配置 | 日调用量超限触发告警 |
| `pnpm audit` 补跑 | 网络可用时执行，当前因网络失败未完成 |

---

---

## ✅ Phase 7.10 - 后端岗位/招聘会真实 API（已完成 2026-05-26）

| 项 | 文件 | 状态 |
|----|------|------|
| 后端 JobsModule：DTOs（ReviewAction/PublishAction/ImportJobs/ImportFairs） | services/api/src/jobs/dto/*.dto.ts | ✅ |
| 后端 JobsService（in-memory store + 种子数据 8岗位 5招聘会） | services/api/src/jobs/jobs.service.ts | ✅ |
| 后端 JobsController（14 个接口，Kiosk 4/Admin 6/Partner 6） | services/api/src/jobs/jobs.controller.ts | ✅ |
| 后端 JobsModule 注册到 app.module.ts | services/api/src/app.module.ts | ✅ |
| Admin 类型 R1 补全（sourceUrl/sourceOrgId/tags/description/requirements） | apps/admin/src/services/api/types.ts | ✅ |
| Admin review-types.ts（ReviewAction/PublishAction） | apps/admin/src/services/api/review-types.ts | ✅ |
| Admin mockAdapter / httpAdapter 对齐新接口 | adminMockAdapter.ts / adminHttpAdapter.ts | ✅ |
| Admin wrapper 方法保持兼容（approveJobSource/rejectJobSource/publishJobSource/unpublishJobSource） | apps/admin/src/services/api/sources.ts | ✅ |
| Partner R2 sourceName 补全（PartnerJobRecord/PartnerFairRecord） | apps/partner/src/services/api/types.ts | ✅ |
| Partner R3 字段重命名（addedCount/errorCount/status/errorDetail） | apps/partner/src/services/api/types.ts | ✅ |
| Partner sync-logs 页面字段对齐（l.status / l.addedCount / l.errorCount / l.errorDetail） | apps/partner/src/routes/sync-logs/index.tsx | ✅ |
| Partner importPartnerJobs / importPartnerFairs 方法 | partnerMockAdapter.ts / partnerHttpAdapter.ts / partnerContent.ts | ✅ |

**状态机**：`pending→reviewing→approved+draft`（审核），`draft→published→unpublished`（发布），approve ≠ publish  
**合规**：Kiosk 只展示 approved+published；Partner 导入默认 pending+draft；PUBLISH_REQUIRES_APPROVAL 保护  
**R4 延期**：partner/sources DisplaySource 对齐 DataSourceConfig → Phase 7.11  
**构建**：lint 0 warnings / typecheck 0 errors / build ✅（admin 387KB / partner 338KB / kiosk 418KB）

---

## ✅ Phase 8.1B 已完成（2026-05-27）

| 项 | 状态 |
|----|------|
| 后端 TerminalsModule（4 接口 + sample-visible.pdf）| ✅ |
| Windows 真机端到端联调（670ms 打印，Pantum CM2800ADN Series） | ✅ |

## ✅ Phase 8.1C 已完成（2026-05-27）

| 能力 | 文件 | 状态 |
|------|------|------|
| DPAPI 加密 agentToken（PowerShell stdin，LocalMachine scope） | dpapi.ts | ✅ |
| SQLite 任务幂等（restart 不重打；markTaskDone before PATCH） | db.ts | ✅ |
| 单实例 PID 锁（ESRCH 僵尸锁接管，DUPLICATE_INSTANCE exit 1） | instance-lock.ts | ✅ |
| 断网 PATCH 重试队列（60s 轮询，指数退避，max 10，4xx 放弃） | offline-queue.ts | ✅ |
| Windows 服务（install-service / uninstall-service 子命令） | index.ts | ✅ |
| adminSecret 注册后清除；Phase 8.1B token 自动迁移 | config-manager.ts | ✅ |
| typecheck 0 errors / build 通过 / macOS 冒烟验证 | — | ✅ |

---

## 📋 Phase 8.1D — Windows 真机验收（待执行）

| 选项 | 内容 | 说明 |
|------|------|------|
| **A — Phase 8.1D** | Windows 真机验证 8.1C 全部 5 项 | DPAPI / SQLite 幂等 / 断网恢复 / 单实例 / 服务安装 |
| **B — Phase 9 UI Polish** | Kiosk/Admin/Partner 视觉收口 | 动效、响应式、暗色模式等 |
| **C — Phase 8.2** | Prisma 持久化 | 服务端 PostgreSQL 持久化打印任务 |

### Phase 8.1D：Windows 真机验收步骤与验收标准

```powershell
# === 前置准备 ===
git pull                        # 拉取最新代码（包含 Phase 8.1C）
pnpm install                    # 安装依赖（better-sqlite3 在 Windows 本地编译）
pnpm --filter terminal-agent build
# 确保 Mac API 已启动（services/api）并在 agent-config.json 中设置正确 apiBaseUrl
```

#### 验收项 1 — DPAPI 加密存储

```powershell
# 前提：删除已有的 agent.token（如果存在）
#        清空 config.json 中的 terminalId（如已注册则先清空）
node dist/index.js agent
```

| 验收标准 | 期望结果 | 状态 |
|---------|---------|------|
| 注册成功后 config.json 不含 agentToken 字段 | config.json 只有 terminalId，无 agentToken | ⏳ |
| config.json 不含 adminSecret 字段（注册后清除） | adminSecret 字段已被移除 | ⏳ |
| `%ProgramData%\AIJobPrintAgent\agent.token` 存在 | 文件存在，内容为 base64 密文 | ⏳ |
| 重启后 Agent 正常工作（DPAPI 解密成功） | 心跳/claim 正常，无 DPAPI 错误 | ⏳ |

#### 验收项 2 — SQLite 重启幂等

```powershell
# 1. 运行一次完整打印任务（等待 "PATCH status=completed"）
# 2. Ctrl+C 停止 Agent
# 3. 重新启动
node dist/index.js agent
```

| 验收标准 | 期望日志 | 状态 |
|---------|---------|------|
| 重启后对已完成任务不重新打印 | `task ptask_seed_001: already done in local DB, skipping` | ⏳ |
| 日志中不出现 downloading / printing 对该已完成 taskId | （无此日志） | ⏳ |
| 打印机不出纸（无重复打印） | 无纸张输出 | ⏳ |

#### 验收项 3 — 断网 PATCH 重试队列

```powershell
# 1. 运行 Agent
# 2. 任务开始打印后，拔掉网线（或禁用网卡）
# 3. 等待打印完成，观察 PATCH status=completed 失败日志
# 4. 重新接上网线
```

| 验收标准 | 期望日志 | 状态 |
|---------|---------|------|
| PATCH 失败时写入离线队列 | `db: PATCH status=completed for task xxx enqueued for offline retry` | ⏳ |
| 网络恢复后（最长 60s）自动重试 | `offline-queue: PATCH status=completed for xxx ✓` | ⏳ |
| 重试成功后队列清空（不再重复上报） | 无第二次重试日志 | ⏳ |

#### 验收项 4 — 单实例 PID 锁

```powershell
# 终端 1：
node dist/index.js agent
# 终端 2（另开一个 PowerShell 窗口）：
node dist/index.js agent
```

| 验收标准 | 期望结果 | 状态 |
|---------|---------|------|
| 第二个进程立即退出（exit code 1） | 日志含 `DUPLICATE_INSTANCE: agent already running (pid=xxx)` | ⏳ |
| 第一个进程继续正常运行 | 无受影响 | ⏳ |

#### 验收项 5 — Windows 服务安装与自启动

```powershell
# 安装服务（需管理员权限）
node dist/index.js install-service
# 验证服务状态
Get-Service -Name "AIJobPrintAgent"
# 重启 Windows
shutdown /r /t 0
# 重启后检查（约 30s 后）
Get-Service -Name "AIJobPrintAgent"
# 卸载服务
node dist/index.js uninstall-service
```

| 验收标准 | 期望结果 | 状态 |
|---------|---------|------|
| install-service 成功执行 | 任务管理器"服务"标签中出现 AIJobPrintAgent | ⏳ |
| 服务状态为"正在运行" | `Status: Running` | ⏳ |
| Windows 重启后服务自动启动 | 重启后 30s 内 `Status: Running` | ⏳ |
| Agent 在服务模式下心跳正常 | 后端收到心跳，terminalId 不变 | ⏳ |
| uninstall-service 成功卸载 | 服务从列表中消失 | ⏳ |

---

## 📋 Phase 7.10 后：下一步方向

| 选项 | 内容 | 说明 |
|------|------|------|
| **A — Phase 7.11** | Partner Sources R4 对齐 | DisplaySource → DataSourceConfig；Partner 数据源页面重写 |
| **B — Phase 5/6 填充** | Admin/Partner 剩余页面补齐 | Admin：日志审计、权限管理；Partner：数据统计、账号权限 |

### pnpm audit 补跑（网络可用时）

```bash
pnpm audit   # 当前因网络原因未完成，0 known vulnerabilities 目标
```

---

## 决策待定项（Phase 7 前确定）

| 待定事项 | 说明 |
|---------|------|
| 后端语言 | ✅ 确定：NestJS + Prisma（TypeScript 全栈，与前端共享类型更顺畅） |
| 部署方案 | 云服务器还是本地 |
| 文件存储 | MinIO / 阿里云 OSS / 腾讯 COS |

---

---

## 📋 后续特色功能规划（Phase 8.1B 已完成，可进入排期）

> **Phase 8.1B 已完成（2026-05-27）**：后端 4 接口全部实现，Agent + 后端冒烟联调通过。下一步：Windows 真机端到端联调（`pnpm --filter terminal-agent agent`），然后根据结果决定是否进入特色功能排期。  
> 合规边界：所有功能均不得新增招聘闭环功能（一键投递、候选人管理、企业查看简历、面试邀约、Offer 管理）。  
> 详细需求定义见：[feature-scope.md §六](../product/feature-scope.md)

| 功能 | 优先级 | 前置依赖 | 当前状态 |
|------|--------|---------|---------|
| 打印材料包 | P1 | Phase 8.1B + Phase 7 AI | 📋 规划中，未开发 |
| 求职打印套餐 | P1 | Phase 8.1B | 📋 规划中，未开发 |
| 招聘会现场模式增强 | P2 | Phase 8.1B + 现有 `/job-fairs/:id/*` 页面 | 📋 规划中，未开发 |
| 面试练习轻量版 | P2 | Phase 7 AI（非数字人） | 📋 规划中，未开发 |
| AI求职路线规划 | P3 | 用户画像 + 推荐规则 | 📋 规划中，未开发 |

**命名约束**：打印相关功能文案使用"打印材料包"，**禁止使用"一键打印材料包"**（避免与"一键投递"等合规禁用表达混淆）。

---

## 📋 Phase 9 - UI Polish / Kiosk 视觉升级（Phase 8 完成后启动）

> **触发条件**：Phase 5 Admin、Phase 6 Partner、Phase 7 API、Phase 8 设备联调全部完成后，统一升级 Kiosk 前台视觉质感。  
> **不提前做**：当前页面功能完整、合规边界清晰，视觉打磨属于锦上添花，不阻塞核心流程交付。

### 升级目标

参考秒哒成熟页面质感，不照抄，在现有设计系统基础上提升层级感和专业度。

### 升级范围

| 模块 | 当前状态 | 升级方向 |
|------|---------|---------|
| **首页** | 功能卡片平铺，层级单一 | 强化业务入口视觉层级；图标质感升级；主入口卡片与次入口卡片区分更明确 |
| **打印/扫描/AI简历流程页** | 基础布局，空白区域多 | 增强步骤进度感（步骤条或分段指示器）；状态反馈更丰富；减少空旷感 |
| **岗位/招聘会列表与详情** | 信息卡片层级偏平 | 岗位卡片主次信息层级更清晰；薪资/标签/来源信息排版升级；状态徽章更专业 |
| **我的记录（ProfilePage）** | 四个 section 平铺 | 文件/订单/AI记录分区视觉更像真实产品；空状态高度压缩；卡片信息密度提升 |
| **二维码弹层** | 基础占位框 | 统一弹层美化；QR 区域视觉优化；操作说明排版升级 |
| **失败态 / 空状态** | 基础 ErrorState/EmptyState | 插画/图标升级；文案更具引导性；操作按钮更突出 |

### AI数字人引导员（Phase 9.1 起）

> 详细需求见：[AI数字人引导员需求规划](../product/ai-avatar-guide.md)

定位：数字人是 Kiosk 前台的“AI就业服务引导员”，用于首页、AI助手、简历服务、打印扫描、招聘会导览等场景的操作引导，不进入 Admin/Partner 后台。

第一阶段不追求真人级视频数字人，优先做轻量 3D 方案：

| 阶段 | 目标 | 交付 |
|------|------|------|
| Phase 9.1 | 静态 3D 引导员 | AvatarGuide 组件、3D 模型加载、idle 动画、文字气泡、关闭/静音、WebGL 降级 |
| Phase 9.2 | 语音与嘴型 | TTS 播报、简单嘴型同步、重播提示、页面欢迎语 |
| Phase 9.3 | 功能引导 | 快捷问题、intent router、跳转简历/打印/招聘会/政策页面 |
| Phase 9.4 | AI助手融合 | 用户提问、AI回答、回答转语音、意图跳转 |
| Phase 9.5 | AI模拟面试官 | 根据简历/岗位方向生成问题、训练问答、报告保存与打印 |

必须遵守：

- 默认不启用摄像头。
- 默认不启用麦克风。
- 不做人脸识别、情绪识别。
- 不保存用户音频或视频。
- 面试训练报告只给求职者本人。
- 不把简历、面试报告、训练结果推送给企业。
- 不新增一键投递、候选人筛选、面试邀约、Offer 管理等招聘闭环功能。

### 执行约束

- 保持所有合规边界，**不新增**招聘闭环、一键投递、候选人管理等功能
- 不破坏现有 location.state 数据流，只改样式不改逻辑
- 升级后必须通过 lint/typecheck/build 全量验证
- 视觉升级参考秒哒风格，但所有代码重新编写，不复制旧代码

---

## ✅ Phase 8 - Windows Terminal Agent（设计文档 + API/文档对齐 + 设备名称/Provider分层修正 已完成 2026-05-27）

> 完整设计文档：[windows-terminal-agent-design.md](../device/windows-terminal-agent-design.md)  
> 本地打印 Spike：[local-print-spike.md](../device/local-print-spike.md)  
> Pantum API 设计：[pantum-api-design.md](../device/pantum-api-design.md)

✅ **API/文档对齐已完成（2026-05-27）**：PrintJobParams 字段统一（pageRange?）、PrintTaskCreate DTO、/tasks/claim 完整 9 字段 params、§5.1 打印机状态检测、V12–V15 WMI 状态检测验证项

✅ **设备名称/Provider分层修正（2026-05-27）**：
- 打印机名称统一为 `Pantum CM2800ADN Series`（Windows 真机确认），禁止在代码中硬编码具体型号字符串，必须通过 `printerName` 配置项传入
- `PrintJobParams` 新增可选字段 `collate?` / `paperType?` / `feeder?`（开放 API 预留，驱动待验证）
- `colorMode: 'color'` 的 Pantum 开放 API `mode` 取值标注 TODO（待厂家确认）
- `windows-terminal-agent-design.md` 新增 **§12 Provider/Executor 分层**（LocalAgentDispatchProvider / PantumCloudDispatchProvider / 三种本地 Executor）
- 新建 `docs/device/pantum-api-design.md`（签名算法/PrintJobParams 映射/预留接口/7项未解决问题清单）

### Phase 8.0 技术验证（先于编码，在真机完成）

| # | 验证项 | 优先级 | 来源 |
|---|--------|--------|------|
| V01 | TWAIN 在 LocalSystem 服务账号下是否可用 | ⚠️ 必验 | windows-terminal-agent-design.md |
| V02 | TWAIN 在 User Session Helper 下可用 | ⚠️ 必验 | windows-terminal-agent-design.md |
| V03 | Named Pipe + ACL 跨进程通信（Service ↔ Helper） | ⚠️ 必验 | windows-terminal-agent-design.md |
| V04 | localAuthToken / actionToken（HMAC+nonce+expires）校验 | ⚠️ 必验 | windows-terminal-agent-design.md |
| V05 | Claim lease 超时重新领取 | ⚠️ 必验 | windows-terminal-agent-design.md |
| V06 | node-printer 调用奔图打印机 | ⚠️ 必验 | local-print-spike.md |
| V07 | PowerShell 打印备用方案 | 备用 | local-print-spike.md |
| V08 | Windows 服务开机自启 + 崩溃重启 | ⚠️ 必验 | windows-terminal-agent-design.md |
| V09 | CreateProcessAsUser 启动 Helper | ⚠️ 必验 | windows-terminal-agent-design.md |
| V10 | 打包方案对比（pkg / nexe / electron-builder / .NET wrapper） | ⚠️ 必验 | windows-terminal-agent-design.md |
| V11 | DPAPI 加密（原机解密成功，换机失败） | ⚠️ 必验 | windows-terminal-agent-design.md |
| V12 | **Get-PrintJob 活动任务可见（WMI）** | ⚠️ 必验 | local-print-spike.md §5.1 |
| V13 | **Win32_Printer 离线状态可识别（WMI）** | ⚠️ 必验 | local-print-spike.md §5.1 |
| V14 | **Win32_Printer 缺纸状态可识别（WMI）** | ⚠️ 必验 | local-print-spike.md §5.1 |
| V15 | **不可识别状态 → UNKNOWN_PRINTER_STATUS** | ⚠️ 必验 | local-print-spike.md §5.1 |

### Phase 8.1 子阶段拆分

| 子阶段 | 名称 | 状态 | 核心内容 |
|--------|------|------|---------|
| Phase 8.1A | Local Print MVP | ✅ **已完成** | 统一 `print(file, printerName, params)`；image-to-pdf(pdfkit)；临时 PDF 清理；printerName 配置化 |
| Phase 8.1B | Agent API / Claim / Heartbeat | ✅ **Agent 侧已完成（2026-05-27）** | 注册/心跳/claim/下载/MD5/print()/状态上报；后端接口待联调 |
| **Phase 8.1B** | **后端接口联调** | 🚧 **当前任务** | 实现 `/auth/terminal/register`、`/terminals/:id/heartbeat`、`/terminals/:id/tasks/claim`、`/print-tasks/:id/status`；Agent 端对接验证 |
| Phase 8.1C | Windows Service / DPAPI / Named Pipe | 📋 | 开机自启崩溃重启；DPAPI 加密 token；单实例 Mutex；Service+Helper 双进程架构 |
| Phase 8.1D | 扫描 | 📋 | TWAIN/WIA（V01/V02 先验证）；SMB 备用方案；扫描→PDF→上传 |

#### Phase 8.1A 详细能力（已完成 2026-05-27）

| 能力 | 说明 | 状态 |
|------|------|------|
| 统一 `print()` 函数 | `print(file, printerName, params)` 路由 PDF / 图片 | ✅ |
| PDF 打印 | `.pdf` → Method B（pdf-to-printer/SumatraPDF）直接打印 | ✅ |
| 图片打印（JPG/PNG）| pdfkit 生成临时 PDF → Method B → 打印后删除临时文件 | ✅ |
| 图片打印（BMP/TIFF）| Phase 8.1B+（需 sharp 预处理）| 📋 |
| printerName 配置化 | 从 `DEFAULT_PRINTER`（config.ts）读取，不硬编码 | ✅ |
| 临时文件清理 | 打印后立即删除；启动时清理超过 1 小时的残留 | ✅ |

#### Phase 8.1B 详细能力

> **当前阶段主任务（Phase 8.1B）：** Agent 注册 → 心跳 → Claim → 下载文件 → 调用 `print()` → 状态上报。  
> 所有特色功能（打印材料包、招聘会现场增强等）均在本阶段完成后才启动，不并行开发。

| 能力 | 说明 | 状态 |
|------|------|------|
| 终端注册 | 注册获取 terminalId + agentToken + actionTokenSecret + localAuthToken | 📋 |
| 单实例 Mutex | 启动时加锁，重复启动自动退出 | 📋 |
| 心跳上报 | 每 30s，携带打印机基本状态 | 📋 |
| 打印任务 Claim | `POST /api/v1/terminals/:terminalId/tasks/claim`，lease 原子防重复 | 📋 |
| 打印任务执行 | 下载 → MD5 校验 → 调用统一 print() → 回传状态 | 📋 |
| 文件上传 | POST /files/upload（multipart） | 📋 |

#### Phase 8.1C 详细能力

| 能力 | 说明 | 状态 |
|------|------|------|
| 临时文件安全清理 | 任务结束立即删除 + 每小时兜底；目录 ACL 保护 | 📋 |
| Windows 服务 + Helper | Service 开机自启崩溃重启；Helper 用户登录后由 Service 启动 | 📋 |
| local-api-server | 127.0.0.1:9527；localAuthToken（查询）+ actionToken（动作）全鉴权 | 📋 |
| DPAPI 加密 | agentToken / actionTokenSecret / localAuthToken DPAPI 加密存储 | 📋 |

#### Phase 8.1D 详细能力

| 能力 | 说明 | 状态 |
|------|------|------|
| 扫描任务执行 | Named Pipe 触发 Helper → TWAIN → PDF 合并 → 上传 → 回传 | 📋 |
| SMB 备用方案 | TWAIN 不可用时监听 SMB 共享目录 | 📋 |

### Phase 8.2 扩展（Phase 8.1 完成后）

| 能力 | 说明 |
|------|------|
| U 盘监听 | USB 存储挂载检测，文件列表推送 Kiosk |
| 设备事件告警 | 缺纸、墨粉不足、卡纸主动上报 |
| 离线任务队列 | 断网缓存，恢复后自动补发（幂等） |
| SMB 扫描备用方案 | TWAIN 不可用时监听 SMB 共享目录 |

### Phase 8.3 扩展（更后期）

| 能力 | 说明 |
|------|------|
| 摄像头 | Helper 进程 DirectShow 采集，证件照上传 |
| 扫码器 | Helper 进程 node-hid 输入拦截 |
| Agent 自动更新 | 后端下发版本，自动下载替换 |

### 关键风险（见设计文档 §10）

- **R2（高）**：TWAIN 在 LocalSystem 下可能不可用 → 双进程架构已针对此设计；V01/V02 必验
- **R3（高）**：node-printer 兼容性 → V06/V07 提前验证，PowerShell 备用就位
- **R11（高）**：Named Pipe 在特殊策略下失败 → V03 验证，localhost:9528 降级备用
- **R12（高）**：CreateProcessAsUser 受限 → V09 验证，任务计划程序备用

---

## 近期不做

- 后端数据库 / Prisma schema 迁移（Phase 7.6 第一步先出骨架和 stub）
- **Kiosk 视觉打磨（第 9 阶段）** ← Phase 7/8 全部完成前不启动
- **AI数字人互动（第 9 阶段）** ← Phase 8 完成前不启动；需求规划已在 [ai-avatar-guide.md](../product/ai-avatar-guide.md)，当前阶段不写任何实现代码
- **底部 Tab 扩展** ← 底部导航固定为"首页 / AI助手 / 我的"三项，不增加第四个 Tab
- **打印材料包 / 求职打印套餐 / 面试练习 / AI求职路线** ← Phase 8.1B 完成前不启动，不并行开发
- 企业招聘端（已确认删除，永不开发）
- 平台内一键投递、候选人管理、企业查看简历、面试邀约、Offer 管理（永不开发）
