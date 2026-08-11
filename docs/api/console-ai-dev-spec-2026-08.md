# 双后台 AI 化改造 · 开发任务书（给 Codex）

> 立项日期：2026-08-11 · 重新定位：2026-08-11
>
> ## 本文件已从「实现规格」重新定位为「任务书」
>
> **原因（诚实记录）**：初版试图把 Prisma 字段、API 路径、状态机转移、迁移脚本
> 全部写死到可直接抄写的程度。Codex（gpt-5.6-sol / xhigh）终审找出 **78 条问题**，
> 其中 **50 条集中在数据模型、API 契约、状态机、迁移四章**——
> 根因不是个别笔误，而是**这些内容不该由未逐行核对代码的一方写死**：
>
> - 引用了不存在的端点（`PATCH /admin/ai/config` 实为 `PUT /admin/ai-config`）
> - 写错了现有取值（资质状态实为 `pending|valid|expired|revoked|rejected`，我写了 `approved`）
> - 把工程难题当成已解决（账本并发配额、多实例迁移双写、reserve/commit CAS）
>
> **返工方式**：不逐条打补丁，而是改变本文件的职责边界——
>
> | 本文件**负责** | 本文件**不再负责**（交给开发在读代码后定） |
> | --- | --- |
> | 做什么、为什么、边界在哪 | Prisma 字段名与类型 |
> | **已验证的一手事实基线**（§2） | 具体 API 路径与 DTO 形态 |
> | 必须解决的设计难题清单（§5–§7） | 状态机的每一条转移 |
> | IA 冻结、权限、口径、验收、合规开关 | 迁移脚本的具体步骤 |
>
> **这样做的好处**：Codex 读代码比本文件准（三轮审查已证明）。
> 与其给它一份需要边看边纠错的伪精确规格，不如给它**准确的事实 + 明确的难题 + 不可越过的边界**。
>
> **§2 的事实基线全部来自 Codex 一手代码核查，可直接引用。**
> 78 条问题清单保留在 [`console-ai-dev-spec-codex-findings-2026-08.md`](./console-ai-dev-spec-codex-findings-2026-08.md)，
> 作为设计难题的原始出处，不再作为"待修 bug 列表"。
>
> 上级文档：[console-ai-upgrade-plan-2026-08.md](../product/console-ai-upgrade-plan-2026-08.md)（方案与裁决）
> 原型：`docs/design/console-ai-os-2026-08/`（页面形态与四态）
> **冲突时：裁决与红线以方案为准，页面形态以原型为准，事实基线以本文件 §2 为准。**

---

## 第一部分 · 怎么用这份规格

### 1.1 三份文档的分工

> 2026-08-11 增补：前端新增「线上招聘平台 / 线下招聘公司」对应的三处后台页面变更、
> 以及迎新板块只保留「证件与材料复印」的产品决策与依据，见**方案第十二部分**。
> 原型：`admin/online-platforms.html`、`admin/job-materials.html`、`partner/profile.html`。

| 文档 | 回答什么 | 冲突时 |
| --- | --- | --- |
| 方案 `console-ai-upgrade-plan` | 做什么 / 为什么 / 边界在哪 / 分几期 | **裁决与红线以它为准** |
| **本任务书** | 已验证事实基线 / 必须解决的设计难题 / IA 冻结 / 权限 / 口径 / 验收 / 合规开关 | **事实基线与边界以它为准**；实现细节由开发在设计评审中定 |
| 原型 `console-ai-os-2026-08/` | 页面长什么样 / 四态怎么切 / 文案怎么写 | **视觉与文案以它为准** |

### 1.2 开工顺序（按此推进，不要跳）

```
S0  独立缺陷修复        ← 见 §4，注意其中两件不是单文件改动
S1  ai-core 内核         ← 必须先完成 §5.1 账本并发 + §5.2 迁移协议的设计评审
S1.5 组件拆分            ← 只拆不加，行为零变化（§3.4）
S2  Admin AI 治理        ← 必须先解决 §5.3 状态机未决问题 + §5.4 语义冲突
S3  Prompt 与质量        ← 同上
S4a Partner 效果第一步   ← 独立，接已有端点；注意 §2.1 F-4 的两个坑
S4b 归因改造             ← 需先补 §8 带 ⚠️ 的数据结构
S5–S7                    ← 按方案 §6

⚠️ **S1 与 S2 有设计前置**：§5 的难题不解决就开工，会在第一周撞上并发、
多实例分叉、状态机死锁。这些不是编码问题，是设计问题。
```

### 1.3 五条贯穿全程的硬约束

1. **不新增侧栏项、不新增顶级路由**（方案裁决）。子路由与 Tab 深链见 §3。
2. **超过 500 行的文件先拆再改**（CLAUDE.md §8）。S1.5 是专门的拆分阶段。
3. **L1 规则不得调模型**，界面上也不标「AI」（方案 §11.3）。能力分层见 §6.5。
4. **没有真实数据源的位置显示「未接入」**，不显示 0、不编造（CLAUDE.md §9）。
5. **第二类收费项（招聘内容相关）以功能开关关闭**，许可结论明确前不得启用（§10）。

---


## 第二部分 · 已验证事实基线（开工前必读）

> 全部来自 Codex 一手代码核查（2026-08-11，无范围限制）。
> **开工时以本节为准，不要相信任何与之冲突的旧描述——包括本文件的历史版本。**

### 2.1 已经做完的事（不要重复实现）

| # | 事实 | 证据 |
| --- | --- | --- |
| F-1 | **Admin 企业链早已接通**：详情抽屉、新建、审核、发布、岗位关联全部已接线 | `apps/admin/src/routes/companies/components/ReviewPublishSection.tsx:47-72` |
| F-2 | **`companiesAdmin` 方法齐全**：HTTP 与 mock 双轨均含 review / publish / 候选岗位 / 关联 / 解绑 | `apps/admin/src/services/api/companiesAdmin.ts:123-132,186-202,288-325` |
| F-3 | **`reviewing` 端点已存在**，只缺 UI 入口 | 见 findings 一.5 |
| F-4 | **Partner `/stats` 前端 service 已存在**，不是「一行没调」——但它多发未声明的 `timezone`，且把响应当 `{data}` 解包，直接接会 400 或取错 | `apps/partner/src/services/api/stats.ts:141-157` vs `partner-stats.controller.ts:16-35` |

### 2.2 现有端点的真实形态（别按想当然写）

| 主题 | 真实情况 | 证据 |
| --- | --- | --- |
| AI 配置写入 | `PUT /admin/ai-config` 与 `PUT /admin/ai-configs/:featureKey`（**不是** `PATCH /admin/ai/config`）；测试端点为 `/test` 与 `/:featureKey/test` | `ai-config.controller.ts:36-124` |
| AI 管理面 | **已有** `/admin/ai/usage`、`/admin/ai/logs` + 两套 ai-config Controller | `ai.controller.ts:407-420` |
| 企业审核 DTO | 审核 `{action:'approve'\|'reject', rejectReason?}`；发布 `{publish:boolean}`；关联 `{jobIds:string[]}` | `companies/dto/company.dto.ts:102-117` |
| Partner 数据源 | **已有** GET/POST、capabilities、`PATCH :id/toggle` | `jobs.controller.ts:311-343` |
| 资质查询 | **已有**，嵌套在 recruitment-content 下（含证件访问） | `admin-recruitment-content.controller.ts:22-24,56-90` |
| 错误响应 | `{success:false, error:{code,message,details}, requestId}`（**不是**平铺结构） | `common/filters/http-exception.filter.ts:75-80` |
| 校验失败码 | ValidationPipe 默认返回 **400**，不是 422 | `main.ts:82-100` |

### 2.3 现有字段与真实取值

| 对象 | 真实取值 / 字段 | 常见误写 |
| --- | --- | --- |
| `QualificationRecord.status` | `pending \| valid \| expired \| revoked \| rejected` | ~~`approved`~~ |
| 资质有效期字段 | `validUntil` | ~~`expiresAt`~~ |
| `AiOperation` | **字符串联合类型，不是 enum**；新增需同步 operation 列表与前端映射 | ~~当 enum 加两项~~ |
| `AiServiceLog.tokenUsageJson` | **非空，默认 `"{}"`**；ASR/TTS 缺 usage 时也序列化为 `{}` | ~~`null`~~ |
| `PrintTask` 成功态 | `completed` | ~~`done`~~ |
| `BrowseLog` | **没有 `type` 字段**；去重口径是 **30 分钟**（外跳每次都落记录） | ~~30 秒 / 5 分钟~~ |
| 活动归因 targetType | 还包含 `company_profile`、`fair_company` | `activity.types.ts:9-10` |
| `AuditLog` action | 现为 `company.review`、`company.publish` 两个（**不是**四个细分动作） | `companies.service.ts:380-416` |
| 打印契约 | **A4 / 黑白 / 单面 / 每张一页**，请求含**单个** `fileUrl` | `create-print-job.dto.ts:23-52,64-89` |
| 机构类型→场景模板 | **严格 1:1**：school→`school`、public_employment_service→`public_employment`、licensed_hr_agency→`licensed_hr_service`、fair_organizer/enterprise_source→`null` | `admin-orgs.service.ts:88-140` |

### 2.4 现有行为的真实语义

| # | 事实 |
| --- | --- |
| F-5 | **`AuditService.write` 会吞掉数据库失败**——关键事务必须用 `writeRequired`（`audit/audit.service.ts:45-105`） |
| F-6 | **`assistant_chat` 不是流式**：上游 `stream:false`，Controller 是普通 POST（`llm-chat.service.ts:265-272`） |
| F-7 | **自我探索的降级不只 catch 分支**：JSON 解析失败也返回 `completed`（`llm-self-assessment.service.ts:106-130`） |
| F-8 | **`status:'degraded'` 当前类型不接受**：服务、共享类型、前端契约只允许 `completed\|rejected`——改它不是单文件修改 |
| F-9 | **Admin 更新企业不会重置 `reviewStatus`**（`companies.service.ts:368-377`）——若要「编辑后回 pending」是行为变更，需单独决策 |
| F-10 | **PG schema 由 SQLite 单一事实源生成**，不可人工编辑两份（`scripts/sync-postgres-schema.ts:4-6`） |
| F-11 | **`ORG_TYPE_MATRIX` 只在建/改机构时校验，下发终端时根本没读**——Kiosk 配置响应不含 `sceneTemplate/enabledModulesJson`（`terminals-admin.service.ts:612`） |
| F-12 | **政策写接口不校验机构类型**（已于 2026-08-11 在创建路径修复；更新/下架/删除刻意不校验，避免锁死存量违规内容） |

### 2.5 基础设施「没有什么」（决定了哪些要求不能直接提）

| # | 缺什么 | 后果 |
| --- | --- | --- |
| N-1 | **没有细粒度 RBAC**：`RolesGuard` 只认 `admin\|partner\|kiosk`，User/JWT 无子角色载体 | `org_admin/org_editor/org_viewer` 无法直接实现 |
| N-2 | **没有全局幂等基础设施**：无拦截器、无存储、无响应重放、无过期规则 | 统一 `Idempotency-Key` 要求必须先补基础设施 |
| N-3 | **没有乐观并发字段**：schema 与 PATCH API 均无 `version/etag/If-Match` | 「后写覆盖提示」无实现基础 |
| N-4 | **没有 Ticket 模型**：87 个 model 中无工单、`reopenCount`、`slaBreached` | 工单状态机无数据支撑 |
| N-5 | **没有 ComplianceRule model** | `AiComplianceHit.ruleId` 无处引用 |
| N-6 | **前端路由是静态顶层同步 import**：不会自动匹配子路由 | 子路由需显式新增 route object + lazy/Suspense + 非法 tab 处理 |
| N-7 | **`LlmConfigService` 是同步读内存缓存**（`getConfig/getApiKey/isReady`），Prisma 是异步 | DB-first 改造需先定义预热、刷新、跨实例失效、DB 故障策略 |
| N-8 | **`PrintMaterialPack` 是空壳**：无会员归属、无文件条目、无批次/订单关系；`bundle_render` 只返回 `skeleton/queued:false` | 材料包不是接上界面就能用 |

### 2.6 Prisma 可行性结论（Codex 已核查，可直接采信）

**总体可用**：拟建各表只用 `String/Int/Float/Boolean/DateTime`，无 enum、array、native JSON；
87 个现有 model 中无同名冲突（`schema.prisma:15-17`）。

**但以下几点必须在建表时解决**（不是可选优化）：

| # | 问题 | 要求 |
| --- | --- | --- |
| P-1 | `activeVersionId`/`canaryVersionId` 若为裸 String，可指向不存在或属于其他模板的版本 | 定义两个**具名关系**及反向字段 |
| P-2 | `[templateId,status]` 不唯一，并发发布可产生两个 active | 用模板指针 + **CAS/事务锁** |
| P-3 | `costCny Float` 累计有精度误差 | 用**整数最小计费单位**，或经双库验证的 Decimal |
| P-4 | 账本的 capabilityKey/orgId/terminalId/endUserId 全是裸 ID | 数据库不保证引用完整性，需显式取舍并记录理由 |
| P-5 | 配额查询需要 `[orgId,capabilityKey,createdAt]` 与 `[endUserId,capabilityKey,createdAt]` | 单维复合索引覆盖不了 |
| P-6 | 聚合表唯一键若含 nullable `terminalId`，SQLite/PG 都允许多条 NULL 组合 | 「全部点位合计行」会重复——需哨兵值或独立表 |
| P-7 | `BrowseLog`/`ExternalJumpLog` 加 `sourceOrgId` 是安全的，但**写链不同步就会持续产空值** | 加列与写入改造必须同批 |
| P-8 | 现有 `[organizationId,status,validUntil]` 不支持不限定 org 的全局到期扫描 | 「无需新索引」是错的 |
| P-9 | 高频写表加索引会增加写成本 | 索引应在查询需求确认后以**第二个迁移**建立 |

---

## 第三部分 · IA 冻结（路由 / 子路由 / 深链 / 重定向）

### 3.1 Admin 路由表（最终态）

**顶级路由零新增。** 侧栏 32 项保持，仅做分域重排。

| 路由 | 变化 | 子路由 / 深链 |
| --- | --- | --- |
| `/ai-config` | 主体改造为能力清单 | `/ai-config/:capabilityKey` → 打开该能力详情抽屉<br>`/ai-config/:capabilityKey/:tab` → `model`\|`prompt`\|`gate`\|`degrade`\|`evidence`\|`history` |
| `/ai-services` | 加 4 个 Tab | `/ai-services/:tab` → `usage`\|`quality`\|`incident`\|`compliance`\|`interview`<br>`/ai-services/quality/:sampleId` → 打开某条抽检样本 |
| `/companies` | 加审核发布 | `/companies/:id` → 详情抽屉 |
| `/job-sources` 等三页 | 加预审排序 | `/job-sources/:id` → 详情抽屉 |
| `/alerts` | 加 AI 归因 | `/alerts/:groupId` → 展开某个聚合组 |
| `/audit` | 加自然语言检索 | `/audit?q=<自然语言>` → 预填检索框 |
| `/permissions` | **从侧栏摘除，路由保留** | 直接访问仍可打开（显示未开放说明） |

**旧 URL**：无需新增重定向（顶级路由未变）。
`/terminals`、`/printers`、`/peripherals` → `/devices?tab=` 的现有重定向**保持不动**。

### 3.2 Partner 路由表（最终态）

| 路由 | 变化 | 子路由 / 深链 |
| --- | --- | --- |
| `/stats` | 空壳 → 内容效果 | `/stats?period=week\|month\|quarter` |
| `/terminals` | 空壳 → 投放覆盖 | — |
| `/account` | 空壳 → 3 Tab | `/account/:tab` → `users`\|`logs`\|`notice` |
| `/jobs` | 加 2 Tab | `/jobs/:tab` → `list`\|`health`\|`reject`；`/jobs/detail/:id` |
| `/companies` | 加质检与预审 | `/companies/detail/:id` |
| `/fairs` | 加 6 Tab | `/fairs/:id/:tab` → `base`\|`corp`\|`map`\|`agenda`\|`mat`\|`live` |
| `/profile` | 加 2 Tab | `/profile/:tab` → `base`\|`qual`\|`bill` |
| `/sources` | 加生命周期 | `/sources/:id` → 编辑抽屉 |
| `/sync-logs` | 加归因与导出 | `/sync-logs/:id` → 失败明细 |
| `/smart-campus` | 加迎新 CMS | `/smart-campus/:tab` → `switch`\|`orient`\|`usage` |

### 3.3 Tab 的工程要求（不是「塞进一个组件」）

方案裁定「新增 0 页」是**导航层面**的承诺。工程上每个 Tab 仍须：

| 要求 | 说明 |
| --- | --- |
| 独立子路由 | 见 §3.1/3.2，可深链、可前进后退、可收藏 |
| 独立权限校验 | Tab 级路由仍走 `@Roles('admin')` 守卫；**不能只靠前端 Tab 隐藏**（§7.1） |
| 按需加载 | `React.lazy` 分块，不把 5 个 Tab 的代码打进主 bundle |
| 独立数据加载 | 切 Tab 才请求，不在页面挂载时并发拉全部 |
| 独立空/错/降级态 | 每个 Tab 自己的四态，不共用父页面的 |

### 3.4 S1.5 组件拆分清单

| 文件 | 当前行数 | 拆成 |
| --- | --- | --- |
| `admin/routes/dashboard/index.tsx` | 654 | `index` + `MetricRow` + `DailyBriefCard` + `RecentTasks` + `TodoReview` |
| `admin/routes/ai-services/index.tsx` | 634 | `index` + `UsageTab` + `QualityTab` + `IncidentTab` + `ComplianceTab` + `InterviewTab` |
| `partner/routes/companies/index.tsx` | 631 | `index` + `CompanyList` + `CompanyForm` + `CompanyDetail` + `QualityPanel`<br>（**可直接参照 Admin 企业页的拆法**：`routes/companies/components/` + `shared.ts`，那边已从 1116 行拆到 192 行） |
| `partner/routes/sources/index.tsx` | 545 | `index` + `SourceList` + `CreateWizard` + `AccessGuide`（`ExcelImportModal` 已独立） |
| `partner/routes/jobs/index.tsx` | 455 | `index` + `JobList` + `JobForm` + `JobDetail` + `HealthTab` + `RejectTab` |
| `partner/routes/fairs/index.tsx` | 440 | `index` + `FairList` + `FairForm` + `FairDetail`（6 个 Tab 各一个组件） |
| `admin/routes/ai-config/index.tsx` | 411 | `index` + `CapabilityTable` + `CapabilityDrawer`（6 个 Tab 各一个组件） |

**拆分纪律**：
- **只拆不加功能**，行为零变化，单独提交。
- 拆完每个文件 ≤ 300 行。
- 拆分提交必须跑通现有 typecheck + lint + 相关 verify，**页面表现与拆分前逐像素一致**。

---


## 第四部分 · S0 独立缺陷（不依赖任何架构决策，可立即开工）

> 每条都标注了 Codex 核查出的**真实前置条件**——初版把这五件事都当成「单文件小改」，
> 实际只有两件是。

### 4.1 ~~企业链断点~~ —— **撤回**

早已实现（见 §2.1 F-1/F-2）。**这条曾被写成 S0 第一项并称「全项目唯一真断点」，是错的**：
成因是采信了一次受限范围审查（只看页面调了哪些 service 方法、未进 `components/`）的否定性结论，
且未复核一手代码。**教训已写入方案 §9.2。**

附带问题：初版另提「批量通过并发布」，但**现有接口都是单条操作**，
既无批量端点，也无部分失败格式与幂等规则——那是新功能，不是 S0。

### 4.2 影子测试：连通性测试不再写线上配置 ✅ 可做

**前置条件（Codex 核查）**：当前测试 Controller 用的是 **TypeScript interface，不是 class**，
因此**无法被全局 ValidationPipe 做白名单与字段校验**（`ai-config.controller.ts:19-34`、`main.ts:82-100`）。
→ **新端点必须另建 class-validator DTO**，不能沿用现有形态。

### 4.3 `getUsage` 的 provider 过滤 ✅ 可做

无额外前置条件。

### 4.4 自我探索的诚实降级 ⚠️ 不是单文件

**两个前置条件**：
1. **`status:'degraded'` 当前类型不接受**——服务、共享类型、前端契约都只允许 `completed|rejected`（§2.4 F-8）。
   改它会立刻触发共享 DTO 与前端类型错误，**是跨包改动**。
2. **降级不只 catch 分支**——JSON 解析失败也返回 `completed`（§2.4 F-7）。
   只覆盖「模型不可用」会漏掉解析失败这条路径，仍在伪装成功。

### 4.5 计量补齐 ⚠️ 缺输入来源

**`terminalId` 从哪来没有答案**：当前面试日志 helper 的参数里**没有** `terminalId`
（`ai/mock-interview.service.ts:404-424`）。
把固定 `null` 改成「真实值」之前，必须先确定它从请求上下文哪一层取、以及取不到时写什么。

---

## 第五部分 · 必须先解决的设计难题（不是待修 bug，是真问题）

> 这些是 Codex 从 78 条问题中暴露出的**工程难题**。
> 初版把它们当作已解决写进了状态机与迁移章节——**那是虚构**。
> 本节只负责把问题定义清楚、给出约束，**解法由开发在设计评审中确定**。

### 5.1 计量账本的并发正确性 🔴 最难的一个

| 难点 | 说明 |
| --- | --- |
| **幂等键防不住并发超额** | 两个不同 `idempotencyKey` 可同时读到余额充足并各自 reserve。需要原子预算计数 / CAS / Serializable 重试 / 按预算主体加锁——**必须选一种并说明理由** |
| **清理与 commit 竞态** | 过期任务 release 后，模型请求仍可能 commit。需 `UPDATE ... WHERE state='reserved'` 的状态 CAS，**并定义 CAS 失败后调用方拿到什么结果** |
| **「账本不可变」与 reserve→commit 自相矛盾** | 要么账本可变（那就不是不可变账本），要么用分录追加（需 `entryType`、`parentLedgerId`、退款幂等键） |
| **步骤顺序自相矛盾** | 初版写「先 reserve 后查缓存」，但缓存路径又声明不 reserve；L1/L2 也在 reserve 后提前返回，而验收却要求无账本记录 |

**约束**：AI 运维日志不能当计费账本（`compliance-boundary.md:345`）——账本必须独立且不可丢。

### 5.2 配置迁移（JSON 文件 → 数据库）🔴 多实例是关键

Codex 给出的**安全滚动顺序**（可直接采用）：

```
expand schema → 全实例兼容部署 + 暗读比对 → 共享开关切流
→ 等待在途 reservation 清空 → 至少两个发布周期后再 contract
```

初版写错的地方：

| # | 初版 | 问题 |
| --- | --- | --- |
| M-1 | 任意读一份 JSON 后 upsert | JSON 是**每实例本地文件**，各主机内容可能不同。必须先指定权威实例并校验 checksum |
| M-2 | 「计数即迁移标记」 | 部分导入 / 并发导入 / 将来新增能力都会误判。应用带版本与源 checksum 的迁移记录，在单事务或数据库锁内完成 |
| M-3 | 只做双读 | 滚动升级期旧实例仍写 JSON、新实例写 DB，**立即分叉**。必须先发布兼容双写版本，或冻结配置写入，或用事务 outbox |
| M-4 | DB 无记录就回退 JSON | 未区分「not-found」与「DB 故障」。DB 超时时回退会**悄悄恢复旧配置**——只有明确 not-found 才可回退 |
| M-5 | 第 6 步归档 JSON 文件 | 仍在运行的旧实例依赖原文件。必须等所有旧实例退出后按实例归档 |
| M-6 | 保留旧 JSON = 能回滚 | DB 期间的修改**不会反写 JSON**。回滚前必须冻结写入并执行 DB→JSON 导出，或全程双写 |
| M-7 | 「第 4 步前删表」 | 违反本文件自己的 additive 原则。已部署未切流的表应保留，回滚应用而非 drop |
| M-8 | 逐能力六批切流 | 缺跨实例切换机制。不同版本实例会分走旧配额与新账本，同一重试可能调用两次、扣两套额度。需**共享 feature flag** 或按能力版本门控 |

**还缺的输入**：19 条 capability 的权威 seed 清单、旧 `featureKey`→新 key 映射、
完整配置字段映射（现有 JSON 还含 `systemPrompt`/`roleScope`/`forbiddenWords`/`enabled`，初版迁移步骤没保存它们）。

### 5.3 状态机的未决问题

| 主题 | 必须决定的事 |
| --- | --- |
| **Prompt 版本** | draft 缺取消/archive 出口；回滚时 active/canary 指针如何**原子更新**；是否引入版本 CAS |
| **能力状态双真相** | `status` 与 `enabled` 可组成 `disabled + enabled=true`。二选一，或明确从属关系 |
| **运行态存哪** | `degraded`/`circuit_open` 无模型也无共享存储，**多实例间无法一致**——是进 DB、进 Redis，还是接受单实例语义 |
| **内容审核 claim** | 「开发时二选一」不是定稿。选「认领制」就要 `reviewerId`/`claimedAt` + 认领/释放端点；选「不认领」就从 UI 移除 `reviewing` |
| **编辑是否回 pending** | 现有企业逻辑**不重置** `reviewStatus`（§2.4 F-9）。若要改是行为变更，需单独决策并评估存量影响 |
| **资质过期的影响面** | **不能批量覆盖 `publishStatus`**——那会把 draft、expired、运营主动 unpublished 压成同一状态，续期时无法恢复。需独立的 visibility suspension + reason，或逐内容保存先前状态并 CAS |
| **资质多次过期** | 单值 `degradedAt`/`restoredAt` 表达不了「一个资质影响多条不同发布状态的内容」且「可能多次过期」 |
| **事故唯一性** | 同一 capability 可有多个 open incident，恢复动作无 `incidentId` 也无唯一 open 约束；演练与真实事故会互相关闭 |

### 5.4 API 契约的语义冲突（不是重名，是职责重叠）

| # | 冲突 | 必须决定 |
| --- | --- | --- |
| C-1 | 新 AI 路由 vs 已有 `/admin/ai/usage`、`/admin/ai/logs` + 两套 ai-config Controller | 切流期会出现**两套配置写入口和两套成本口径**——谁是权威 |
| C-2 | Partner 数据源已有 `PATCH :id/toggle`，新增 PATCH/archive/sync | **toggle 与 archive 之后谁是最终状态权威** |
| C-3 | 资质：已有嵌套在 recruitment-content 下的查询，若新建 `/admin/qualifications` | 会产生**两套鉴权、DTO、审计入口**——建议在现有 controller 上加动作 |

---

## 第六部分 · 能力分层与安全闸（设计原则，不随实现变化）

### 6.5 能力分层（L1/L2/L3）与「不得调模型」

| tier | 含义 | 实现位置 | 界面标注 |
| --- | --- | --- | --- |
| **L1** | 确定性规则，零 token，结果可复现 | `ai-core/rules/` 纯函数 | 标 `E1`，**不标「AI」** |
| **L2** | 统计聚合与排序，无语言理解 | SQL / 聚合服务 | 标 `E1`/`E2`，**不标「AI」** |
| **L3** | 需要语言理解或生成 | 走网关调模型 | 标 `E3` + 免责声明 |

**服务端强制**：`AiCapability.tier` 为 L1/L2 时，网关第 6 步直接跳过；
若该能力配了 `vendor/model` → 启动时校验失败（fail-fast）。

**必须归为 L1 的（不要包装成 AI）**：
字段缺失检测、薪资区间跨度、截止日已过、重复内容检测（哈希/相似度）、
401/超时归因、对账差异码翻译、链接可达性、资质到期计算。

### 6.6 Guard：脱敏与安全闸

**复用**：`contract-review-pii-masker.ts`（499 行）与 `contract-review-safety-gate.service.ts`（337 行）
**泛化后移入** `ai-core/guard/`，contract-review 改为调用泛化版本。

**脱敏契约**

```ts
maskPII(text: string, policy: PiiPolicy): { masked: string; map: Record<string,string> }
unmaskPII(text: string, map: Record<string,string>): string
```

- 占位符格式 `[[PII:类型:序号]]`，例 `[[PII:NAME:1]]`。
- **回填在网关第 8 步做**，用户看到的仍是自己的真实信息。
- 脱敏后**必须再扫一遍残留**（沿用 contract-review 的二次检查），有残留 → fail-closed。

**按能力声明允许外发的字段**（`PiiPolicy` 存在 `AiCapability` 上或独立表）：

| 能力 | 允许外发 | 必须脱敏 |
| --- | --- | --- |
| `resume_diagnosis` | 学历/经历/技能描述 | 姓名、手机、邮箱、身份证、住址、学号 |
| `job_fit` | 简历摘要、岗位描述 | 同上 |
| `mock_interview` | 简历摘要 | 同上（**当前 `resumeDigest` 明文落库，S1 一并修**） |
| `content_prescreen` | 机构自有内容全文 | 内容里的个人联系方式 |

**安全闸词库**（`AiComplianceHit.ruleLevel`）

| 级别 | 词/模式 | 处置 |
| --- | --- | --- |
| **red** | 包过 / 保offer / 保录用 / 内推保证 / 代投简历 / 帮你投递 / 推荐给企业 | **硬拦截**，整块换降级文案 |
| **warn** | 一定能 / 绝对 / 保证 | **改写**为「通常会 / 有较大可能」 |
| **watch** | 名企直通 / 内部渠道 | 只记录 |

---


## 第七部分 · 权限与租户模型

> ⚠️ **前置事实（§2.5 N-1）**：`RolesGuard` 只认 `admin|partner|kiosk`，
> User/JWT **没有子角色载体**。因此 `org_admin/org_editor/org_viewer` 一类设计
> **不能直接实现**，本节的细粒度权限点只作为未来 RBAC 的输入清单，不是当前契约。

### 9.1 Admin 侧：**本轮不做细粒度权限**，用「统一角色 + 高危二次确认 + 审计」

> ⚠️ **规格自查修正（2026-08-11）**：初稿列了 9 个细粒度权限点（`ai:capability:read` 等），
> **但现有代码完全没有支撑机制**——
> `common/decorators/roles.decorator.ts` 的 `UserRole` 只有 `admin|partner|kiosk` 三个值，
> `User` 模型只有一个 `role: String`，**全库没有任何权限/角色关联表**。
> 照初稿做，开发第一天就会卡在「这个权限点往哪儿加」。
> 且方案已裁定：**真实 RBAC 落地前，`/permissions` 从侧栏摘除、不填假 RBAC**。
> 细粒度权限与之矛盾。**本节按现实重写。**

**S2/S3 的实际做法**

| 层 | 做法 |
| --- | --- |
| 接口鉴权 | 统一 `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin')`，与现有 controller 完全一致 |
| 高危操作 | **不靠权限点拦，靠三件事**：① 前端二次确认弹窗 ② 请求体 `reason` 必填（服务端校验非空） ③ 强制写 `AuditLog` |
| 可追溯 | 审计记录 `actorId` + `action` + `before/after` 快照，出问题能查到人 |

**必须走「高危三件套」的操作清单**

| 操作 | action 名 |
| --- | --- |
| 启用/停用某个 AI 能力 | `ai.capability.toggle` |
| 修改日预算 / 超额动作 | `ai.capability.budget` |
| 拆分共用 feature key | `ai.capability.split` |
| Prompt 全量发布 | `ai.prompt.publish` |
| Prompt 回滚 | `ai.prompt.rollback` |
| 手动降级 / 恢复某能力 | `ai.capability.degrade` |
| 全站 AI 熔断 | `ai.global.killswitch` |
| 发起降级演练 | `ai.drill.start` |
| 违禁词库变更 | `ai.compliance.rule.update` |
| 查看质量抽检样本（含脱敏摘要） | `ai.quality.sample.view` |
| 查看资质证件原件 | `qualification.document.view` |

**给未来 RBAC 的输入**（S7 做真实 RBAC 时直接用这张表当权限点清单）

`ai:capability:read` / `:write` / `:toggle` / `:admin` ·
`ai:prompt:read` / `:write` / `:publish` ·
`ai:quality:review` · `ai:incident:operate` · `ai:compliance:manage` · `ai:budget:manage`

**本轮不实现它们**，只把上表的 action 名与高危标记落到审计里——
S7 建权限系统时，按 action 名反查即可映射成权限点。

### 9.2 Partner capability 投影（唯一事实源）

**顺序不可颠倒**：① 服务端投影 → ② API 与路由双重校验 → ③ 侧栏按投影渲染。

```jsonc
// GET /partner/capabilities
{
  "orgId": "org-...",
  "orgType": "school_employment_center",
  "modules": {
    "jobs":        { "visible": true,  "actions": ["create","edit","unpublish","import"] },
    "fairs":       { "visible": true,  "actions": ["create","edit","unpublish"], "scope": "own_school" },
    "policy":      { "visible": true,  "actions": ["create","edit"], "scope": "campus_only" },
    "companies":   { "visible": true,  "actions": ["create","edit","unpublish"] },
    "smartCampus": { "visible": true,  "actions": ["toggle","cms"] },
    "sources":     { "visible": true,  "accessModes": ["api","excel","webhook"] },
    "stats":       { "visible": true,  "scope": "own_org" },
    "coverage":    { "visible": true },
    "account":     { "visible": true,  "subAccountQuota": 5 }
  }
}
```

**取值来源**：`Organization.type` + `partner-permission-matrix.md` 的矩阵，
在服务端实现为常量表 + 单元测试锁定（矩阵改了测试必须跟着改）。

**红线**：隐藏导航 ≠ 权限控制。每个 partner 端点都要
① 校验 `orgId` 归属 ② 校验该 orgType 是否有该 action ③ 校验 scope。

### 9.3 机构内子角色

| 角色 | 能做 |
| --- | --- |
| `org_admin` | 全部模块 + 子账号管理 |
| `org_editor` | 内容增删改与提审，**不能**管子账号、不能改机构资料 |
| `org_viewer` | 只读 + 导出 |

**配额**（来自权限矩阵）：school 5 / public 20 / hr_agency 10 / fair_organizer 5 / enterprise 3。

**高风险操作保持平台侧**（方案 §4.5 D3 裁定）：手机号换绑、账号删除 → 走工单，不开自助。

### 9.4 跨租户隔离测试（S6 验收必跑）

- [ ] 用 A 机构 token 访问 B 机构的 `/partner/jobs/:id` → **403**
- [ ] 用 A 机构 token 请求 `/partner/stats` → 返回的数据里**不含** B 机构内容
- [ ] 用 `org_viewer` 调任何写端点 → **403**
- [ ] 子账号数达配额后再创建 → **422 `SUB_ACCOUNT_QUOTA_EXCEEDED`**

---


## 第八部分 · 统计口径字典

> ⚠️ **本节的数据来源列已按 Codex 核查更正**：初版引用了不存在的字段与错误的成功态。
> 带 ⚠️ 的行表示**现有模型支撑不了该口径**，必须先补数据结构——不要按初版直接实现。

> **大屏与机构效果页都用这一份口径。** 口径不统一时，两个页面的同名指标会对不上，
> 这是运营最容易失去信任的地方。

### 10.1 指标定义

| 指标 | 定义 | 数据源 | 不能叫什么 |
| --- | --- | --- | --- |
| **列表曝光** | 内容在终端列表中被渲染的次数（进入视口） | ⚠️ **`BrowseLog` 没有 `type` 字段**——需先加列或另建表 | 不叫「触达人数」 |
| **详情浏览** | 内容详情页被打开的次数 | ⚠️ **同上**，现有模型区分不了曝光与详情浏览 | 不叫「意向数」 |
| **打开来源平台** | 用户点击外部跳转/扫码按钮的次数 | `ExternalJumpLog` | ❌ **绝不叫「投递数 / 意向数 / 简历数」** |
| **资料打印** | 与该内容关联的打印任务成功出纸的份数 | `PrintTask(status=completed)` ⚠️ **且 PrintTask 无内容/会话归因关系** | 不叫「转化数」 |
| **服务人次** | **会话数**，不是自然人数 | `KioskSession` | ❌ **绝不叫「服务人数」**，屏上必须标口径 |
| **覆盖点位** | 该机构内容当前投放到的终端数 | `Terminal` × 内容投放关系 | — |

### 10.2 时间与去重

| 规则 | 值 |
| --- | --- |
| 时区 | `Asia/Shanghai`，所有日聚合按本地日切分 |
| 「今日」 | **自然日**（00:00–24:00）。⚠️ 现有 `AI_USAGE_WINDOW_MS` 是滚动 24 小时，**页面必须写「近 24 小时」**，不能写「今日」 |
| 曝光去重 | ⚠️ **现状是 30 分钟**（`activity.service.ts:32-37`）。若要改成 30 秒需评估记录量与存量口径断裂 |
| 跳转去重 | ⚠️ **现状是每次都落记录**，无去重（`activity.service.ts:124-188`） |
| 归因窗口 | 打印归因到内容：同一会话内 30 分钟 |

### 10.3 隐私抑制（N=5 只是起点）

Codex 指出「N=5 不是完整隐私方案」——多维筛选 + 时间窗口 + 重复导出可差分推断。**完整规则**：

| 规则 | 要求 |
| --- | --- |
| **最小样本** | 任一分组 < 5 条 → 显示「样本不足」，**不显示 0 也不显示近似值** |
| **维度粗化** | 低于阈值时自动合并到上级分类（如「城南街道」→「本市」），而不是直接隐藏 |
| **查询预算** | 同一机构同一时间窗的下钻查询 ≤ 50 次/小时，超限提示稍后再试 |
| **导出限制** | 导出走审批 + 结果带机构水印 + 写审计；导出的行同样过抑制 |
| **跨查询一致性** | 同一分组在不同筛选组合下的抑制结论必须一致（防止 A∩B 反推） |
| **绝不下发** | 任何 `endUserId`、手机号、会话 ID 到机构侧 |

### 10.4 `orgId` / `sourceOrgId` 的取值规则

| 场景 | 取值 |
| --- | --- |
| AI 调用的 `orgId` | 由 `terminalId` → `Terminal.orgId` 反查；终端无归属则为 null（不猜） |
| 内容浏览的 `sourceOrgId` | **写入时**从内容当时的 `sourceOrgId` 取并冻结（归因快照） |
| 历史回填 | join 内容表取**当前**值——只能近似，**统计页必须标注「X 日之前为近似归因」** |
| 内容转移机构 | 历史记录**不回写**，新记录用新值 |

---


## 第九部分 · 验收标准

### 9.1 每个页面改动的通用清单

- [ ] **四态**：默认 / 空数据 / AI 不可用 / 加载失败，**同一套版面**，不重排不抻长
- [ ] **角色**：Admin 与 Partner 各跑一遍。⚠️ **超管/受限、org_admin/org_viewer 目前不存在**（§2.5 N-1），
      在 RBAC 落地前这一条只能验「admin 可进、partner 被拒」
- [ ] **权限**：越权访问返回 403，且**前端不靠隐藏兜底**
- [ ] **空态**：文案说清「为什么空 + 下一步做什么」，不是「暂无数据」
- [ ] **错误态**：区分「本页读不到」与「业务本身出问题」，并说明是否影响终端
- [ ] **并发**：两个标签页同时改同一条 → 后写覆盖前写时有提示。
      ⚠️ **schema 与 API 均无 `version/etag/If-Match`（§2.5 N-3）**——该验收项需先补基础设施，否则不可能通过
- [ ] **回滚**：feature flag 关闭后页面回到改造前形态
- [ ] **审计**：所有写操作有 `AuditLog`，能在 `/audit` 查到。
      ⚠️ **`AuditService.write` 会吞掉数据库失败（§2.4 F-5）**——关键事务必须用 `writeRequired`，否则「有审计」不成立
- [ ] **前台回归**：按 mapping 表「对应前台哪里」那一列，验证对应 Kiosk 页面不受影响
- [ ] **可访问性**：键盘可达、焦点可见、表格有表头关联
- [ ] **性能**：首屏 ≤ 2s（本地 mock），列表 100 行滚动不掉帧

### 9.2 阶段级门禁

| 阶段 | 必跑 |
| --- | --- |
| S0 | `typecheck` + `lint` + 相关 verify + **http 模式对真实后端跑通企业链闭环** |
| S1 | 全量 typecheck/lint + **AI 链路回归**（⚠️ **「5 个 active 能力」无权威清单**——开工前必须先产出 capability seed 清单，见 §5.2 末段）+ 双 CI（SQLite + postgres-readiness） |
| S1.5 | 拆分前后**页面表现逐像素一致**；bundle 体积不增加 |
| S2/S3 | 同上 + **降级演练**（在测试终端置 ai-down，验证 30 个前台页降级正确）+ **违禁词拦截验证**（构造招聘承诺输出，确认被拦） |
| S4 | 同上 + migration 双 CI + **最小样本验证**（构造 <5 样本，确认显示「样本不足」）+ **差分抑制验证**（A∩B 组合不能反推） |
| S5 | 同上 + **机构侧 AI 三条硬约束验证**（不判断求职者 / 不生成承诺 / 不自动生效） |
| S6 | 同上 + **§7.4 跨租户隔离四条全过** |

### 9.3 上线前的一次性验收

- [ ] 47 页逐页核对 mapping 表的「对应前台哪里」，无「找不到消费端」的新增项
- [ ] 所有 L1/L2 能力确认**未调用模型**（查 `AiUsageLedger` 无对应记录）
- [ ] 所有 E3 输出**均带免责声明**（抽样 100 条）
- [ ] 第二类收费项开关**处于关闭态**（§12）
- [ ] 大屏（若已做）的「服务人次」标注了口径

---


## 第十部分 · 功能开关与合规闸

### 12.1 必须存在的开关

| 开关 | 默认 | 控制什么 | 谁能改 |
| --- | --- | --- | --- |
| `BILLING_CLASS2_ENABLED` | **false** | 招聘内容相关的计费 SKU、发票、升级入口（`compliance-boundary.md` §8.8.1 第二类） | 仅超管 + 需法务结论记录 |
| `AI_GLOBAL_KILLSWITCH` | false | 全站 AI 熔断（**打印/扫描/浏览不受影响**） | 超管 |
| `PARTNER_SELF_SERVICE_ACCOUNT` | false | 机构子账号自助增删改 | 超管 |
| `SCREEN_WALL_ENABLED` | false | 运营大屏（方案 §10） | 超管 |
| `AI_CANARY_ENABLED` | false | Prompt 灰度分流总开关 | `ai:prompt:publish` |

### 12.2 `BILLING_CLASS2_ENABLED` 的实现要求

- 关闭时：Partner 账单页的第二类 SKU **不渲染**（不是灰掉），发票申请入口不出现，
  `AiCapability.billingClass='class2'` 的能力 `billable` 强制为 false。
- 开启需要：法务结论文档 ID + 属地主管部门答复记录，写进开关的变更审计。
- **计量能力不受开关影响**——曝光/跳转统计照常采集（用于运营与对账是允许的）。

### 12.3 合规自检（每次发布前跑）

```
□ 用户可见文案里没有：一键投递 / 立即投递 / 平台投递 / 企业收简历 / 候选人管理
□ 机构侧统计里没有：投递数 / 意向数 / 简历数
□ AI 输出经过 red 级词库拦截（包过/保offer/保录用/内推保证/代投简历/帮你投递/推荐给企业）
□ 机构侧看不到任何 endUserId 或个人可识别信息
□ 第二类收费开关处于关闭态（除非有法务结论）
□ 没有在没有真实数据的位置显示 0 或编造值
```

---

## 附录 · 给 Codex 的开工提示

1. **先读方案 §11**（终审结论），了解哪些是已确认的裁决、哪些还是开放问题。
2. **S0 五件事可以立刻开始**，互不依赖，建议五个提交。
3. **S1 动手前**，先确认本规格 §4 的 Prisma 定义与两套 schema 的兼容性（SQLite 无 enum/array）。
4. **遇到本规格没写的细节**：先看方案有没有裁决 → 再看原型的形态与文案 → 都没有则**记录为待定项并问**，不要自行发明产品口径。
5. **三件方案里定不了、需要你确认的事**（方案附录 D.4）：
   - 排版/意图/ASR/TTS 四个能力现在的配置从哪来
   - Agent 侧 WMI 能否读到打印机耗材余量数值
   - `contract_review` 并入网关的实际成本
