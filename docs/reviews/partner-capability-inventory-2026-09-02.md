# 合作机构后台能力盘点 + 与一体机前端的对应关系（2026-09-02）

只读审查，未改任何代码。结论全部对本 worktree 工作区源码复核得出，逐条给出 `文件:行号`。

## 0. 穷举范围与方法

判定「不存在」前穷举过的范围，全部列在这里；范围外的东西一律写进第四节「未判定」，不猜。

| 维度 | 穷举方式 | 结果 |
|------|---------|------|
| 后端端点全集 | `docs/graph/graph.json` `api.endpoints` 共 **471** 条，程序化过滤前缀 `/api/v1/partner/` | **41 条** |
| 合作机构控制台实际调用的非 partner 前缀端点 | 对 `apps/partner/src` 全量 grep 字符串字面量 `'/xxx'` / 模板串，逐条回查 graph | **10 条**（`/auth/*` 9 条 + `/policies/eligibility-questions`） |
| 运行时路由 | `apps/partner/src/routes/index.tsx:18-38` 逐行读，与 graph `apps.partner.routes` 交叉核对 | **13 条**，两处一致 |
| 设计稿 | `docs/design/console-ai-os-2026-08/partner/*.html` | **12 张** |
| 越界能力 | 对 `apps/partner/src` 全量 grep `简历/候选人/投递/面试/offer/resume/candidate/apply/applicant`；对 41 条 partner 端点逐条读 controller + DTO | 见第五节 |

**不是靠关键词匹配定端点**：41 条是按路径前缀机械枚举出来的，然后逐条打开
`jobs.controller.ts` / `companies.controller.ts` / `policies.controller.ts` /
`partner-org.controller.ts` / `partner-stats.controller.ts` /
`smart-campus.controller.ts` / `recruitment-integration.controller.ts` 读的实现。

前端侧同样不靠 graph：`graph.json` 里每条 partner 路由的 `endpoints` 字段是**通过共享
service 模块传递闭包算出来的**，所以 `/companies` 被记成调用了 35 个端点、`/login` 被记成
调用 9 个。真实的「哪页调哪个端点」以 `apps/partner/src/services/api/*` 的 adapter 为准，
下表按 adapter 读出来重排过。graph 另有一处符号失真：多页记录了
`DELETE /partner/excel/:param/confirm`，实际实现是 `DELETE /partner/excel/:batchId`
（`partnerHttpAdapter.ts:261`）——graph 把同一模板串的两条路径混了。

---

## 一、能力盘点

动作分类口径：**看** = 只读；**改** = 新增/编辑/导入（一律回 `pending`+`draft` 重审）；
**停** = 下架/停用（只改发布或启停状态，不触发重审）；**查** = 执行痕迹（同步日志/审计）。

### 1.1 数据源 `JobSource`（7 条）

| 方法 | 路径 | 动作 | 页面 |
|---|---|---|---|
| GET | `/partner/data-sources` | 看 | `/sources` |
| GET | `/partner/data-sources/capabilities` | 看 | `/sources` |
| POST | `/partner/data-sources` | 改 | `/sources` |
| PATCH | `/partner/data-sources/:id/toggle` | 停 | `/sources` |
| GET | `/partner/data-sources/integration-contract` | 看 | **无页面** |
| POST | `/partner/data-sources/preflight/jobs` | 看（`persistence=none`） | **无页面** |
| POST | `/partner/data-sources/preflight/fairs` | 看（`persistence=none`） | **无页面** |

后三条是给外部集成方的机器可读契约与零写入预检（`recruitment-integration.controller.ts:28-40`，
`recruitment-integration.contract.ts:142-143`）。对 `apps/` 全量 grep `integration-contract`
与 `preflight/jobs|preflight/fairs`，三端前台**零引用**——这是设计如此（对接文档口径），
不是缺口，但盘点时必须点名，否则会被误当成「后台有能力没接线」。

数据源生命周期只覆盖到「建 + 启停」：
- API/Webhook 源由管理员启停，机构端显式禁止（`jobs-partner.service.ts:172-179`，
  前端呈现见 `sources/index.tsx:488-491`）。
- **凭证只能写一次**。`encryptedCredential` / `webhookSecret` 在全仓库唯一的写入点是
  `jobs-partner.service.ts:136-138`（创建时）；无任何更新/轮换路径。
- **全 471 条端点里没有任何 `JobSource` 的 DELETE**（程序化枚举确认）。

### 1.2 岗位 `Job`（5 条）

| 方法 | 路径 | 动作 | 页面 |
|---|---|---|---|
| GET | `/partner/jobs` | 看 | `/jobs` |
| GET | `/partner/jobs/quality-summary` | 看 | `/jobs`（`JobQualitySummaryPanel.tsx`） |
| POST | `/partner/jobs/import` | 改（手工新增也走这条，`jobs/index.tsx:213-217`） | `/jobs` |
| PATCH | `/partner/jobs/:id` | 改 | `/jobs` |
| PATCH | `/partner/jobs/:id/publish` | 停 | `/jobs` |

### 1.3 招聘会 `JobFair`（4 条）

| 方法 | 路径 | 动作 | 页面 |
|---|---|---|---|
| GET | `/partner/fairs` | 看 | `/fairs` |
| POST | `/partner/fairs/import` | 改 | `/fairs` |
| PATCH | `/partner/fairs/:id` | 改 | `/fairs` |
| PATCH | `/partner/fairs/:id/publish` | 停 | `/fairs` |

招聘会的**全部子实体**（参展企业 / 展区 / 活动资料 / 场馆导览 / 现场统计）只有 Admin 端点，
`admin-fairs.controller.ts:69-244` 每个 handler 都挂 `@Roles('admin')`；partner 前缀下零对应端点。

### 1.4 企业展示 `CompanyProfile`（4 条）

| 方法 | 路径 | 动作 | 页面 |
|---|---|---|---|
| GET | `/partner/companies` | 看 | `/companies` |
| POST | `/partner/companies/import` | 改 | `/companies` |
| PATCH | `/partner/companies/:id` | 改 | `/companies` |
| PATCH | `/partner/companies/:id/publish` | 停 | `/companies` |

### 1.5 政策 `PolicyPost` / `PolicyEligibilityRule`（8 条）

| 方法 | 路径 | 动作 | 页面 |
|---|---|---|---|
| GET | `/partner/policies` | 看 | `/policy` |
| POST | `/partner/policies` | 改 | `/policy` |
| PATCH | `/partner/policies/:id` | 改 | `/policy` |
| DELETE | `/partner/policies/:id` | 改（真删） | `/policy` |
| PATCH | `/partner/policies/:id/publish` | 停 | `/policy` |
| GET | `/partner/policies/:id/eligibility-rules` | 看 | `/policy`（`EligibilityRulesDrawer.tsx`） |
| PUT | `/partner/policies/:id/eligibility-rules` | 改（整组替换 + 强制重审） | `/policy` |
| POST | `/partner/policies/:id/eligibility-preview` | 看（服务端试算） | `/policy` |

政策是唯一有**真删**的业务对象；岗位/招聘会/企业只有下架。

### 1.6 Excel/CSV 导入 `ImportBatch` / `ImportRecord` / `FieldMappingRule`（6 条）

| 方法 | 路径 | 动作 | 页面 |
|---|---|---|---|
| GET | `/partner/excel/template` | 看 | `/sources` → `ExcelImportModal` |
| POST | `/partner/excel/parse` | 看（无状态取列名） | 同上 |
| GET | `/partner/excel/mapping-rule` | 看（上次映射回填） | 同上 |
| POST | `/partner/excel/preview` | 改（建 pending 批次） | 同上 |
| POST | `/partner/excel/:batchId/confirm` | 改（upsert + 写 SyncLog + 存映射） | 同上 |
| DELETE | `/partner/excel/:batchId` | 停（取消 pending 批次） | 同上 |

四步向导：`ExcelImportModal.tsx:68-74`（upload → mapping → preview → done）。
入口只挂在 `/sources` 页的数据源行上（`sources/index.tsx:470-478`，且只对
`accessMode ∈ {excel, csv}` 显示）——`/jobs`、`/fairs`、`/companies` 三页**都没有** Excel 导入入口。

### 1.7 同步日志 `SyncLog`（1 条）

`GET /partner/sync-logs` → `/sync-logs`（只读，最多 100 条，`jobs-partner.service.ts:654-676`）。
「重试」按钮已被主动移除，原因写在 `sync-logs/index.tsx:142`：后端无按日志重放的端点。

### 1.8 机构档案 `Organization`（2 条）

`GET /partner/profile` / `PUT /partner/profile` → `/profile`。
只能改 `contact` / `contactPhone` 两个字段（`orgSelf.ts:109-112`）；名称/类型/场景模板/启用模块归 Admin。

### 1.9 聚合视图（2 条）

- `GET /partner/dashboard` → `/`（本机构岗位/招聘会/政策计数 + 数据源计数 + 最近 5 条同步，
  `jobs-partner.service.ts:605-652`）
- `GET /partner/stats?period=week|month|quarter` → `/stats`

### 1.10 智慧校园 `Terminal`（2 条）

`GET /partner/smart-campus/terminals` / `PUT /partner/smart-campus/terminals/:terminalId/config`
→ `/smart-campus`。服务端要求 `org.type === 'school_employment_center'`
（`smart-campus.service.ts:238`）。

### 1.11 控制台依赖的非 partner 前缀端点（10 条）

`POST /auth/login`、`POST /auth/login/sms`、`GET /auth/me`、`POST /auth/sms-code`、
`POST /auth/password/reset/{start,verify,complete}`、`POST /auth/phone/{code,verify}`、
`GET /policies/eligibility-questions`。全部存在（逐条回查 graph 确认），全部无角色守卫
（登录态自身或公开字典）。这 10 条不在 `/api/v1/partner/` 前缀下，靠路径关键词是搜不到的。

### 1.12 两条路由完全没有端点

`/terminals`（`terminals/index.tsx:5-14`）与 `/account`（`account/index.tsx:5-14`）
各 15 行，只渲染一个 `EmptyState`，文案分别是「终端明细暂由平台统一运营」「账号与角色由平台侧统一管理」。
它们**没有伪造能力**——诚实空态，符合 CLAUDE.md §9。但对照
`docs/product/partner-permission-matrix.md:102`（子账号配额 5/20/10/5/3）与 `:103`
（查看本机构操作日志 ✅），这两页对应的是矩阵里已经写成 ✅ 的能力。

### 1.13 全局性质：控制台默认跑在 mock 模式

`apps/partner/src/services/api/client.ts:3-4`：`VITE_API_MODE` 不等于 `'http'` 一律降级 `'mock'`。
`/jobs`、`/fairs`、`/companies`、`/sources`、`/policy`、`/smart-campus`、`/stats`、`/`、`/profile`
九页各自有 mock adapter。页面顶部有明确横幅提示（`routes/Page.tsx:16-20`），
政策申领条件在 mock 下如实抛 `ELIGIBILITY_REQUIRES_BACKEND`（`policies.ts:298-304`），
没有伪造保存成功。这条不是缺陷，是盘点任何「这个功能通不通」时必须先钉住的前提。

---

## 二、与一体机前端的对应关系

### 2.1 四条链的完整路径

| 链 | Partner 录入 | 落库模型 | Admin 审核 | Admin 发布 | Kiosk 读取 | Kiosk 页面 |
|---|---|---|---|---|---|---|
| 岗位 | `POST /partner/jobs/import`、`PATCH /partner/jobs/:id`、`POST /partner/excel/:batchId/confirm` | `Job` | `PATCH /admin/job-sources/:id/review` | `PATCH /admin/job-sources/:id/publish` | `GET /jobs`、`GET /jobs/:id` | `/jobs`、`/jobs/:id` |
| 招聘会 | `POST /partner/fairs/import`、`PATCH /partner/fairs/:id`、Excel confirm | `JobFair` | `PATCH /admin/fair-sources/:id/review` | `PATCH /admin/fair-sources/:id/publish` | `GET /job-fairs`、`GET /job-fairs/:id`（+ 7 个子资源端点） | `/job-fairs`、`/job-fairs/:id`、`/campus` |
| 政策 | `POST /partner/policies`、`PATCH /partner/policies/:id` | `PolicyPost` | `PATCH /admin/policy-sources/:id/review` | `PATCH /admin/policy-sources/:id/publish` | `GET /policies`、`POST /policies/eligibility-check` | `/policy-service`、`/renshi` |
| 企业 | `POST /partner/companies/import`、`PATCH /partner/companies/:id` | `CompanyProfile` | `PATCH /admin/companies/:id/review` | `PATCH /admin/companies/:id/publish` | `GET /companies`、`GET /companies/:id` | `/companies`、`/companies/:id` |

**四条链的审核与发布入口在 Admin 都真实存在**（`apps/admin/src/routes/` 下
`job-sources`、`fair-sources`、`policy-sources`、`companies` 四个目录都在，端点也都在）。
所以「partner 能录但 admin 没有审核入口」这一类断点，四条主链上**一条都不存在**。

断点在别处，逐条列在下面。

### 2.2 断点 A：新建机构的内容永远发不出去，直到 Admin 单独标信任

`services/api/src/common/content-trust.ts` 给所有发布路径装了 fail-closed 闸门：
`contentTrustStatus === 'active' && archivedAt == null`，null 即拒。
而 `admin-orgs.service.ts:311-321` 的 `createOrg` **不写** `contentTrustStatus`，
schema 里该列是 `String?`（`schema.prisma:555`）。

后果：新建的合作机构，其岗位/招聘会/政策/企业无论审核通过多少次，
Admin 点发布一律 `ORG_CONTENT_TRUST_REQUIRED`。必须先调
`PATCH /admin/orgs/:id/content-trust`。这一步**在 Partner 控制台完全不可见**——
机构侧看到的只有「已通过 / 待发布」，不知道卡在哪。

这是闸门的设计意图（文件头注释记录了一起真实事故），不是 bug；但它是这条链上最容易漏掉、
且对机构完全不透明的一环，上线前必须写进运营手册。

### 2.3 断点 B：岗位与招聘会的驳回原因不回传机构

- Admin 拒绝时 `rejectReason` 落库（`Job.rejectReason` / `JobFair.rejectReason`）。
- `prismaJobToAdminDto`（`jobs-shared.ts:577` 起）返回 `rejectReason` / `reviewedBy` / `reviewedAt`。
- **`prismaJobToPartnerDto`（`jobs-shared.ts:603-619`）三个字段都不返回。**
- **`prismaFairToPartnerDto`（`jobs-shared.ts:678-700`）同样不返回。**

对照组：政策的 `PartnerPolicyRecord` 有 `rejectReason`（`apps/partner/src/services/api/policies.ts:32`），
企业的 `PartnerCompanyRecord` 有（`partnerCompanies.ts:32`）。

后果：机构在 `/jobs`、`/fairs` 上只看得到「已拒绝」三个字，改什么全靠猜；`/policy`、`/companies` 上能看到原因。
四条链里两条通两条断，且断的是量最大的两条。

### 2.4 断点 C：机构填进去、库里存着、Kiosk 不渲染的 5 个岗位字段

`educationRequirement` / `experienceRequirement` / `skills` / `benefits` / `validThrough`：

- Excel 模板有（`excel-template.ts:39-46`），Excel confirm 写库（`jobs-excel.service.ts:404-411`）；
- `ImportJobItemDto` 接收（`import-jobs.dto.ts:54-76`）；
- `prismaJobToListItem` 全部返回给 Kiosk（`jobs-shared.ts:556-564`）；
- **对 `apps/kiosk/src` 全量 grep：`educationRequirement`、`experienceRequirement`、`validThrough` 零命中**，
  `skills`/`benefits` 只命中简历域，与岗位无关。`jobCompleteness()`
  （`jobs/utils/jobDisplay.ts:150-165`）的 12 个字段里也没有它们。

后果：机构把学历/经验/技能/福利/有效期认真填进 Excel，求职者在终端上一个都看不到。
后端零改动即可修，是这份盘点里成本最低的一条。

### 2.5 断点 D：Partner 手工表单只有 9 个字段，Excel 有 19 个

`apps/partner/src/routes/jobs/index.tsx:414-447` 的抽屉表单字段：
title / company / city / workType / salary / sourceUrl / tags / description / requirements（9 个）。
前端类型 `ImportJobItem`（`services/api/types.ts:130-142`）也只有这 9 个 + industry。

而 `JOB_TEMPLATE_FIELDS`（`excel-template.ts:22-48`）有 19 个字段。差集是：
`headcount`、`educationRequirement`、`experienceRequirement`、`skills`、`benefits`、
`salaryMin`、`salaryMax`、`salaryUnit`、`validThrough`。

其中 **`headcount` 是 Kiosk 会渲染的**（`JobDetailSections.tsx:104-108`，
无值时显示「来源平台未提供」，注释引五部门 2026-01 通知要求招聘信息含招聘人数）。
所以手工录入的岗位在终端上招聘人数一栏**必然**是「来源平台未提供」。

`UpdatePartnerJobDto`（`partner-edit.dto.ts:24-51`）同样没有这 9 个字段，
所以哪怕岗位是从 Excel 进来的、`headcount` 有值，机构也**无法在页面上修改它**。
招聘会侧同理：`UpdatePartnerFairDto`（`:53-83`）没有 `coverImageUrl` / `mapImageUrl` /
`companyCount` / `jobCount`，而 `ImportFairItemDto`（`import-fairs.dto.ts:51-70`）有前两个。
`coverImageUrl` / `mapImageUrl` 只有 Admin 改得了（`apps/admin/src/routes/fairs/components/EditFairDrawer.tsx:140,143`）。

### 2.6 断点 E：招聘会子实体全归 Admin，`fair_organizer` 机构办不了会

Kiosk 招聘会详情下挂 7 个子资源页（参展企业、企业详情、展区/展位图、活动资料、
现场数据、场馆导览、参会计划）。这些数据的写入端点**全部**是
`admin-fairs.controller.ts` 里的 `@Roles('admin')`（`:99` companies、`:131` zones、
`:159` materials、`:235` venue-guide）。

`partner-capabilities.ts:38-45` 把 `fair_organizer` 定义为「只能录招聘会、不能录通用岗位」的机构类型，
`/fairs` 页面底部也写着「现场活动资料由管理员在运营后台维护」（`fairs/index.tsx:362`）。
即：招聘会主办方能建一个招聘会壳，但参展企业、展位图、可打印物料一条都动不了，全得打电话找平台。

### 2.7 断点 F：Kiosk 招聘会详情的「主办方」显示的是数据来源机构

`JobFair` 表**没有 organizer 列**（`schema.prisma:1243-1300` 逐字段核对）。
三个 mapper 一律 `organizer: f.sourceName`（`jobs-shared.ts:626`、`:659`、`:683`）。
Kiosk 直接渲染成「主办方」（`job-fairs/components/JobFairDetailTabs.tsx:123-124`）。

后果：一场由 A 单位主办、经 B 机构同步进来的招聘会，终端上「主办方」写的是 B。
Partner 侧没有任何字段可以录真实主办单位。

### 2.8 断点 G：Kiosk 招聘会详情的「活动资料 N 份」恒为 0

`prismaFairToListItem` 硬编码 `managedMaterialCount: 0`（`jobs-shared.ts:641`），
Kiosk 详情页照渲染 `{fair.managedMaterialCount} 份 · 可打印`
（`JobFairDetailTabs.tsx:213`）。详情页走的是 `getJobFairById`
→ `GET /job-fairs/:id` → `getPublishedFairById` → `prismaFairToListItem`
（`jobs-kiosk.service.ts:160-166`），确实是这条 mapper。

而 `GET /job-fairs/:id/materials` 是真的（`adminFairs.getPublishedFairMaterials`）。
所以：资料真实存在、点进去能看到，但入口磁贴上永远写着「0 份」。属于「做了但显示成没做」。

### 2.9 断点 H：主题在复导时被降级

- Excel confirm 的 update 分支：`theme: mapped.theme || 'general'`（`jobs-excel.service.ts:468`）
- Partner JSON 导入的 update 分支：`theme: item.theme ?? 'general'`（`jobs-partner.service.ts:493`）

后果：一场已标 `campus` / `campus_corp` / `industry` 的招聘会，只要用主题列留空的表复导一次，
主题就被打回 `general`，`/campus` 校招专区从此不再收录它（`CampusPage.tsx:52` 按 theme/关键词筛）。

同一段 update 分支还漏掉了 `companyCount` / `jobCount`（create 分支 `jobs-excel.service.ts:459-460` 有），
复导时这两个数不会更新。

### 2.10 断点 I：政策的「外部ID」机构填不了，Kiosk 上恒显示「来源未提供」

- schema 有 `PolicyPost.externalId String?`（`schema.prisma:616`，其上 `:609-615` 的注释明写是为补齐 CLAUDE.md §10）
- 后端 `CreatePolicyPostDto` / `UpdatePolicyPostDto` 都接收（`policies/dto/policy.dto.ts:54-56`、`:84-85`）
- service 写库（`policies.service.ts:155`、`:191`）
- Kiosk 条件核对结果页按 §10 渲染外部ID，缺失时显示「来源未提供」
  （`apps/kiosk/src/pages/renshi/EligibilityResults.tsx:132-135`）
- **Partner 前端 `SavePolicyInput`（`apps/partner/src/services/api/policies.ts:37-46`）没有这个字段，
  `/policy` 表单（`policy/index.tsx:367-401`）也没有这个输入框。**

后果：凡是经合作机构后台录入的政策，`externalId` 恒为 null，终端上恒显示「来源未提供」。
唯一能填的路径是直接打 API。

### 2.11 断点 J：企业详情的 4 个展示开关，后端收、前端不发

`PartnerImportCompanyItemDto` / `PartnerUpdateCompanyDto` 都继承 `CompanyFieldsDto`
（`companies/dto/company.dto.ts:121`、`:139`），因此**接受**
`showOpenJobCount` / `showCity` / `showEmployeeScale` / `showBoothNo`（`:70-82`）。
Partner 前端的 `CompanyFieldsInput`（`apps/partner/src/services/api/partnerCompanies.ts:39-59`）
四个都没有，`/companies` 表单也没有。机构只能用库里的默认值（`schema.prisma` 里
`showOpenJobCount/showCity/showEmployeeScale` 默认 true、`showBoothNo` 默认 false）。

### 2.12 断点 K：手工录入的内容不进同步日志、不挂数据源

全仓库 `syncLog.create` 只有 4 处：Webhook 接收（`sync/sync.service.ts:140,165`）、
Excel confirm（`jobs-excel.service.ts:493`）、API 拉取 worker（`job-sync/job-sync.service.ts:829`）。

`POST /partner/jobs/import`、`POST /partner/fairs/import`、`POST /partner/companies/import`、
`POST /partner/policies` **都只写 AuditLog，不写 SyncLog**（例：`jobs-partner.service.ts:273-283`）。

连锁后果三条：
1. `/sync-logs` 页与工作台 `recentSyncs` 永远看不到手工录入；
2. `/stats` 的 `sync.totalBatches / totalAdded / successRate` 对手工为主的机构系统性漏计
   （数据取自 SyncLog）；
3. `/sources` 每行的「成功数 / 失败数」来自 `syncLog.groupBy`
   （`jobs-partner.service.ts:70-86`），手工录入永远是 0。

另：`importJobs` 的 create/update 分支**都不写 `Job.sourceId`**
（`jobs-partner.service.ts:218-265`），而 Webhook 路径写（`:309`）、Excel 路径写
（`jobs-excel.service.ts:397` 岗位、`:450` 招聘会）。所以手工录入的岗位 `sourceId` 为 null，
Admin 的 `GET /admin/job-sync/sources/:sourceId/impact`（按 `where: { sourceId }` 计数，
`job-sync.service.ts:241-246`）与 `POST .../unpublish-content` 一条都够不着它们。

### 2.13 断点 L：数据源建完就改不了，而页面教用户去删

`/sources` 的 Webhook 接入说明抽屉写着「webhookSecret 仅在创建时下发一次，平台不再回显；
**如遗失请删除数据源后重建**」（`sources/index.tsx:556`）。

但：全 471 条端点里没有 `JobSource` 的 DELETE（程序化枚举确认），
`docs/product/partner-permission-matrix.md:44` 也明写「删除数据源 ❌ 未上线，P1 改为归档」，五类机构全 ❌。
凭证也没有轮换路径（§1.1）。

后果：Webhook 密钥一旦丢失，这个数据源就是**永久废件**——既改不了、也删不掉、也归档不了，
只能在列表里一直挂着。页面给出的补救办法是一个不存在的操作。

### 2.14 §10 七个字段的产出情况（逐个确认）

CLAUDE.md §10 要求外部岗位与招聘会必须带七个字段。逐条对**机构录入链路**核对：

| 字段 | 岗位 | 招聘会 | 判定 |
|---|---|---|---|
| `source_org_id` | `sourceOrgId` 从 JWT `user.orgId` 强制取（`jobs-partner.service.ts:211`），前端不可自报 | 同（`:451`） | ✅ 产得出，且防跨机构污染 |
| `external_id` | 必填（`import-jobs.dto.ts:18-19`）；手工录入前端生成 `MANUAL-<ts>-<rand>`（`jobs/index.tsx:215`） | 必填（`import-fairs.dto.ts:26-27`） | ✅ 产得出 |
| `source_name` | 后端按 orgId 反查 `Organization.name`（`jobs-partner.service.ts:212`） | 同（`:452`） | ✅ |
| `source_url` | 必填 `@IsNotEmpty()`，表单必填校验 `jobs/index.tsx:196` | 必填 | ✅ |
| `sync_time` | 每次导入/编辑写 `new Date()`（`:238`、`:263`、`:420`） | 同（`:487`、`:509`、`:590`） | ✅ |
| `review_status` | 一律 `'pending'`，编辑也强制回 pending（`:237`、`:258`、`:415`） | 同 | ✅ |
| `publish_status` | 一律 `'draft'` | 同 | ✅ |

**七个字段全部产得出，一个不缺。** `Job.sourceUrl` / `JobFair.sourceUrl` 在 schema 里是
非空 `String`，DTO 是 `@IsNotEmpty()`，不存在空值绕过。

§10 还要求岗位详情必须展示五项，Kiosk 侧逐条核对
（`apps/kiosk/src/pages/jobs/components/JobDetailSections.tsx:176-206`）：

| 要求 | 实现 | 位置 |
|---|---|---|
| 来源机构 | `job.sourceName` | `:188` |
| 同步时间 | `formatFullDate(job.syncTime)` | `:190` |
| 外部ID | `job.externalId` | `:191` |
| 外部投递链接 | `job.sourceUrl`（无效时显示「来源平台未提供有效链接」） | `:196` |
| 数据来源说明 | `job.dataSourceNote`（服务端拼，`jobs-shared.ts:572`） | `:204` |

**岗位详情五项全展示。** 招聘会详情同样有来源机构 + 外部编号
（`JobFairDetailPage.tsx:256-257`、`:269-270`）。企业详情有来源机构/同步时间/外部ID
（`CompanyDetailPage.tsx:441-443`）。

唯一缺口是**政策**：`PolicyPost.externalId` 因 §2.10 的表单缺口恒为 null，
终端如实显示「来源未提供」。这是唯一一处 §10 意义上产不出的字段——注意它的性质是
「录入链路缺输入框」，不是「模型缺字段」或「展示缺渲染」，模型和渲染都已就位。

### 2.15 断点 M：侧栏 12 项对五类机构完全一样，服务端却按类型拒写

`PartnerLayoutWrapper.tsx:39-52` 的 `NAV_ITEMS` 是**静态常量**，无任何 capability 过滤；
`getPartnerCapabilities()` 的返回值在整个 `apps/partner/src` 里只被 `/sources` 页用来筛接入方式
（`sources/index.tsx:91-92`），从不影响导航。

服务端的类型闸门是真的：
- `partner-capabilities.ts:38-45`：`fair_organizer` → `canImportJobs: false`
- `:46-52`：`enterprise_source` → `canImportFairs: false`
- `policies.service.ts:349` + `:142`：只有 `public_employment_service` 与
  `school_employment_center` 能**创建**政策
- `smart-campus.service.ts:238`：只有 `school_employment_center` 能配智慧校园

而**列表端点不校验类型**（`getPartnerJobs` / `getPartnerFairs` 只查 orgId，
`jobs-partner.service.ts:196-203`、`:436-443`），下架也不校验。

后果：招聘会主办方点进「岗位信息管理」，列表正常打开、「新增岗位」按钮正常显示，
点保存才 403 `PARTNER_CAPABILITY_DENIED`。企业来源方在「招聘会信息管理」上同理，
非人社/高校机构在「政策公告管理」上同理。这是「隐藏导航 ≠ 权限控制」的反面：
权限控制在，但导航没做对应的能力投影，机构只能靠撞墙学习。

### 2.16 一处非链路的显示缺陷：机构类型标签用的是废弃词表

`apps/partner/src/routes/profile/index.tsx:16-25` 自建了一份 `ORG_TYPE_LABELS`，
键是 `school` / `hr_company` / `job_platform` / `government` / `aggregator` / `other`。

而 `Organization.type` 的权威取值只有 5 个（`packages/shared/src/types/partner.ts:8-13`，
`orgs/dto/admin-org.dto.ts:26-30`）：`school_employment_center`、`public_employment_service`、
`licensed_hr_agency`、`fair_organizer`、`enterprise_source`。两套词表只有 2 个交集。

渲染是 `ORG_TYPE_LABELS[profile.type] ?? profile.type`（`profile/index.tsx:113`），
所以高校就业中心在自己的「机构资料」页上看到的类型字面是
`school_employment_center` 而不是中文。`packages/shared` 里有现成的
`PARTNER_TYPE_LABELS`（`partner.ts:165-171`），同文件第 2-6 行已经 import 了 shared 的另外三个常量。

---

## 三、13 条运行时路由 vs 12 张设计稿

### 3.1 一一对应关系

| 运行时路由 | 组件文件 | 设计稿 | 稿子自标 |
|---|---|---|---|
| `/` | `routes/dashboard/index.tsx` | `dashboard.html` | 改造 |
| `/profile` | `routes/profile/index.tsx` | `profile.html` | 改造 |
| `/jobs` | `routes/jobs/index.tsx` | `jobs.html` | 改造 |
| `/companies` | `routes/companies/index.tsx` | `companies.html` | 改造 |
| `/fairs` | `routes/fairs/index.tsx` | `fairs.html` | 改造 |
| `/smart-campus` | `routes/smart-campus/index.tsx` | `smart-campus.html` | 改造 |
| `/policy` | `routes/policy/index.tsx` | `policy.html` | 改造 |
| `/sources` | `routes/sources/index.tsx` | `sources.html` | 改造 |
| `/sync-logs` | `routes/sync-logs/index.tsx` | `sync-logs.html` | 改造 |
| `/terminals` | `routes/terminals/index.tsx` | `terminals.html` | 空壳填充 |
| `/stats` | `routes/stats/index.tsx` | `stats.html` | 空壳填充 |
| `/account` | `routes/account/index.tsx` | `account.html` | 空壳填充 |
| **`/login`** | `routes/login/index.tsx`（757 行，全 partner 最大文件） | **无稿** | — |

**12 = 13 − `/login`。** 没有「有稿无路由」的孤儿稿——`docs/design/console-ai-os-2026-08/README.md`
提到的孤儿是 admin 侧的 `admin/online-platforms.html`，不在 partner 目录。

`/login` 无稿这件事值得单独记：757 行里包含密码登录、短信登录、忘记密码三步找回、
手机验证、法务文档弹窗（`LegalDocsModal.tsx`），是 partner 侧最复杂的单页，却没有任何视觉基线。

### 3.2 稿子里有、运行时没有的功能

按稿逐张核对，运行时缺口如下。

**`account.html`**（运行时 = 15 行 EmptyState）
- 子账号列表 + 新增/编辑 + 按机构类型的配额（5/20/10/5/3）→ 运行时无 `/partner/accounts` 类端点（471 条枚举确认）
- 本机构操作日志 Tab → 审计只有 `GET /admin/audit-logs`，`@Roles('admin')`（`audit.controller.ts:15-21`），无按 orgId 的机构视图
- 平台通知 + 工单 Tab → 无任何模型与端点
- 稿子自己已标注前置：`User` 模型只有粗粒度 role，机构内子角色未建模；
  `partner-account-action.controller.ts` 的 9 个端点整体锁在 admin 角色下

**`terminals.html`**（运行时 = 15 行 EmptyState）
- 投放点位清单 + 曝光/详情浏览/打开来源平台/资料打印四列 → 稿子自标需新增
  `GET /partner/coverage/points`、`POST /partner/coverage/request`，均不存在
- 依赖与 `/stats` 同一个前置：`BrowseLog` / `ExternalJumpLog` 加 `sourceOrgId`

**`stats.html`** — 稿子的前提已经过期
- 稿子写「运行时只有 20 行空态，后端 `GET /partner/stats` 早就写好了，前端一行没调」。
  **这条已不成立**：`routes/stats/index.tsx` 现为 416 行，经
  `services/api/stats.ts:192` 实调 `GET /partner/stats?period=`，快照/同步趋势/状态分布全部接真。写稿时的现状已被后续实现覆盖。
- 稿子里仍未实现的部分是：转化漏斗、内容排行、零跳转内容、时段与点位分布、AI 解读、导出月报 PDF。
  运行时对此有明确的、成文的拒绝：`stats/index.tsx:13-17` 与 `:206-231` 说明
  `BrowseLog`/`ExternalJumpLog` 无不可变 `sourceOrgId` 快照，宁可留空也不给会漂移的漏斗，
  `attribution.available` 恒 false（`apps/partner/src/services/api/stats.ts:48-59` 同口径，
  服务端 `StatsAttribution.available` 类型上就被钉成字面量 `false`）。
  **这是有意为之的空缺，不是遗漏。**

**`jobs.html`**：质检列、提交前 AI 预审、「内容健康度」Tab、「驳回归因」Tab、批量操作、岗位详情页
→ 运行时只有一个 93 行的 `JobQualitySummaryPanel`；驳回归因 Tab 的数据前置就是 §2.3 的 DTO 缺口。

**`companies.html`**：AI 预审、AI 写简介草稿、质检列、批量提交审核、批量补字段、Excel 导入按钮
→ 运行时都没有。其中 **Excel 导入对企业根本不通**：`/partner/excel/*` 的 `dataType`
只白名单 `'job' | 'fair'`（`jobs.controller.ts:511`、`:534`、`:572`），无 company 分支。
稿子里「审核链路是通的」那段自我更正与运行时一致（Admin companies 审核发布确实存在）。

**`fairs.html`**：主办方作战室（参展企业/展位平面图/议程/物料/现场数据五个 Tab）
→ 全部对应 Admin-only 端点，见 §2.6。稿子自己列了两条硬前置（权限要先搬、现场数据只能给聚合），
并列了 12 条审查编号。其中与 partner→kiosk 链路直接相关、本次独立复核**确认为真**的有
FA1（§2.7）、FA2（§2.9）、FA6（§2.8）。

**`policy.html`**：AI 合规预审、AI 结构化整理、「申报期」列、「材料清单 N 项」列
→ 运行时无。而且 **`PolicyPost` 模型里既没有申报期字段、也没有结构化材料清单字段**
（`schema.prisma:594-635` 逐字段核对），只有自由文本 `content`。
稿子写「材料清单是必填项」在当前模型上无处落脚。

**`profile.html`**：资质合规 Tab、账单与用量 Tab、线下机构档案 Tab、线上平台收录 Tab、
按 capability 投影的能力范围面板 → 运行时 `/profile` 只有基本信息 + 接入概况，
且只能改联系人/电话。`QualificationRecord` 模型在 schema 里存在但无 partner 端点。
「侧栏按 capability 投影渲染」的诉求 = §2.15。

**`sources.html`**：编辑数据源、测试连接、轮换凭证、立即同步、归档、AI 字段映射建议
→ 全部无端点。稿子自己点了两条：连接测试曾因无端点被主动移除（不能再放死按钮，
必须先有 `POST /partner/data-sources/:id/test`）；归档而非删除。
`docs/product/partner-permission-matrix.md:42` 把「手动触发同步 ✅」写给了全部五类机构，
但 `POST /admin/job-sync/sources/:sourceId/trigger` 挂在 `@Controller('admin/job-sync')`
+ `@Roles('admin')`（`job-sync.controller.ts:34-36`）——**矩阵与实现不一致**。

**`sync-logs.html`**：AI 失败归因、导出错误明细 → 运行时无。
稿子明确否掉了「一键重试」（SyncLog 未关联 ImportBatch 与逐行失败记录），
与运行时 `sync-logs/index.tsx:142` 的移除理由一致。

**`smart-campus.html`**：迎新内容 CMS（报到流程/办事窗口/官方链接/校历）、使用统计
→ 运行时 `OrientationPanel` 存在但标注「未开放」，与稿子对现状的描述一致。

### 3.3 反向：运行时有、稿子没画的

只有 `/login`（757 行）。其余 12 页运行时能力都是稿子所描述现状的子集或等集，
没有发现「运行时做了但稿子完全没提」的功能。

---

## 四、越界能力核查（合规红线）

**结论：未发现任何越界能力。** 穷举方式与证据如下。

1. **DTO 层**：全局 `ValidationPipe` 开 `forbidNonWhitelisted`（`main.ts:4`、`:22-24` 及其
   `exceptionFactory`）。partner 的三个导入 DTO 都是显式白名单：
   `ImportJobsDto`（`import-jobs.dto.ts:87-90`，文件注释逐字写明候选人姓名/邮箱/电话/简历/Offer
   出现即 400 拒绝而非静默剥离）、`ImportFairsDto`（`import-fairs.dto.ts:73-76`）、
   `PartnerImportCompaniesDto`（`company.dto.ts:132-138`，元素类型 `PartnerImportCompanyItemDto` 见 `:121`）。逐字段读过，无任何求职者维度字段。
2. **端点层**：41 条 partner 端点逐条读实现，业务对象只有
   `JobSource` / `Job` / `JobFair` / `CompanyProfile` / `PolicyPost` /
   `PolicyEligibilityRule` / `ImportBatch` / `ImportRecord` / `FieldMappingRule` /
   `SyncLog` / `Organization` / `Terminal`。**没有任何端点触碰简历、投递、候选人、面试、Offer。**
3. **文案层**：对 `apps/partner/src` 全量 grep
   `简历|候选人|投递|面试|offer|resume|candidate|apply|applicant`，命中 16 处，逐条读完：
   14 处是合规免责声明（如 `jobs/index.tsx:389`、`companies/index.tsx:481`、
   `sources/index.tsx:316`「只接收岗位/招聘会展示字段，不接收简历、候选人、面试、Offer 等招聘闭环数据」），
   2 处是 `partnerCompanies.ts` 里名为 `applyFields` 的本地函数（mock adapter 的字段合并工具，与 apply 语义无关）。
4. **按钮文案**：partner 侧唯一涉及投递语义的用户可见字符串是
   `jobs/index.tsx:436-437` 的字段标签「外部投递链接(来源平台)」与占位符
   「求职者跳转外部平台投递」，以及 `:449` 的说明「求职者通过"去来源平台投递/扫码投递"跳转」。
   这些描述的是外链本身，且引用的是 CLAUDE.md §2 白名单原词；未出现
   「一键投递 / 立即投递 / 平台投递 / 企业收简历 / 候选人管理」任一禁用表述。
5. **`/stats` 的口径**：`stats/index.tsx:22-23`、`:235-236` 明确「打开来源平台」只统计外链点击次数，
   不代表投递结果，且服务端 `attribution.available` 恒 false，不给漏斗。这是主动收紧，不是越界。
6. **设计稿**：12 张稿逐张读完，`fairs.html`、`companies.html`、`stats.html`
   都主动写了红线（「不做企业端账号、不收求职者简历、不做候选人管理」；
   「『打开来源平台』只能这么叫……不是投递数、不是意向数、不是简历数」）。**无越界提案。**

---

## 五、未判定

以下项目本次没有得出可靠结论，不猜。

1. **`/policy` 的 `EligibilityRulesDrawer` / `EligibilityRuleEditor` 完整行为**（315 + 243 行）。
   读了 service 契约与 mock 的 501 拒绝分支，未逐行读两个抽屉组件的交互，
   因此「申领条件录入在真实后端下是否完全可用」未判定。

2. **`/login` 757 行的实际链路完整度**。9 个 `/auth/*` 端点确认存在，但短信通道、
   密码找回三步、法务文档弹窗是否端到端可跑，未验证（需要真实后端 + 短信服务商配置）。

3. **`Organization.type` 存量数据的实际取值分布**。本次只确认了「权威词表是 5 个值」
   与「`profile` 页用的是另一套 8 个值」。库里现有机构行的 `type` 究竟是哪套，
   需要连 PostgreSQL 生产实例查，本次未做。若存量行用的是旧词表，
   `getPartnerCapabilities()` 会对它们直接 `ForbiddenException`（`partner-capabilities.ts:63`），
   影响面比 §2.16 的标签显示大得多——**这是本份盘点里最需要下一步取证的一条**。

4. **`GET /partner/stats` 的服务端实现细节**。只读了前端契约与注释口径
   （`apps/partner/src/services/api/stats.ts`），未读
   `services/api/src/orgs/partner-stats.controller.ts` / service 的聚合实现，
   因此「周期切分、环比基期、成功率算法是否与注释一致」未判定。

5. **`jobs.controller.ts` 里 `@PaidAiThrottle` 的绑定目标**。
   `:385`、`:416`、`:591` 三处装饰器与其后的方法之间隔着 JSDoc 注释块，
   写法上应绑定到紧随其后的 `importJobs` / `updatePartnerJob` / `confirmExcelImport`，
   但这种排版容易读错，未实测其运行时是否真的生效。

6. **`docs/reviews/four-chain-data-integrity-ledger-2026-08.md` 里 FA3/FA4/FA5/FA7~FA12 的现状**。
   `fairs.html` 引用了 12 条编号，本次只独立复核了与 partner→kiosk 链路直接相关的
   FA1 / FA2 / FA6（均确认为真，见 §2.7~2.9）。其余各条未复核，
   不知道它们在这份总账写成之后是否已被修复。

7. **Excel `preview` 阶段对空 `sourceUrl` 的拦截强度**。
   `jobs-excel.service.ts` 的 confirm 分支用 `mapped.sourceUrl ?? ''` 写库，
   理论上空串会污染 §10 的 `source_url`。`sourceUrl` 在模板里标了必填
   （`excel-template.ts:27`），推测 preview 阶段会拒掉，但未读
   `excel-import.dto.ts` 的 `JOB_REQUIRED_FIELDS` 校验实现，未判定。
