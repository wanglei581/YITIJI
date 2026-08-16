# 三大信息库线上全空的根因与录入方案（2026-08-16）

> 基线：`origin/main@67145a855a6eaaab2b5823182d530f817eee806b`（本文所有代码引用均以 `git show origin/main:<path>` 为准，非工作区检出）
> 方式：只读代码调研 + 生产公开端点只读 GET。未做任何写操作、未登录、未使用任何凭证。

## 0. 结论先行

**不是「没人录入」，也不是「同步坏了」——是「录了、审了、然后被人工整体下架了」，且 Admin 后台缺少把它们重新上架的按钮。**

| 库 | 定性 | 一句话 |
|---|---|---|
| **岗位 Job** | **卡发布**（数据在、审核已过、被下架） | 生产有 219 条记录，其中 217 条是 `approved + unpublished`，2026-08-07 由数据负责人授权的内容治理动作统一下架；Admin「岗位信息源」页对 `unpublished` 行不渲染「发布」按钮，UI 上无法恢复 |
| **招聘会 JobFair** | **卡发布 + 内容过期** | 3 场全部 `approved + unpublished`，且都是 2026-06 已结束场次；同样缺「发布」按钮 |
| **政策 PolicyPost** | **真·没录入** | 表里 0 条，从来没有任何机构提交过；且政策只能由 Partner 账号创建，Admin 无新建入口 |
| **企业 CompanyProfile（对照组）** | **演示 seed 残留** | 线上 3 条 = `prisma/seed-companies.ts` 的 3 家「演示」企业，2026-06-18 写入生产库，2026-08-07 的下架清理**漏掉了 CompanyProfile 这张表** |

---

## 1. 数据从哪来：四条写入路径

Prisma 模型对应 `Job` / `JobFair` / `PolicyPost`（`services/api/prisma/schema.prisma:688 / 1061 / 487`）。

### 1.1 Partner Excel 导入（岗位 + 招聘会）

- 端点：`services/api/src/jobs/jobs.controller.ts:476`（模板）、`:495`（映射规则）、`:512`（parse）、`:525`（preview）、`:564`（confirm）、`:574`（cancel），全部 `@Roles('partner')`
- 落库：`jobs-excel.service.ts:325` `confirmExcelImport()`
- 写入状态：`:394,414`（Job）与 `:441,455`（JobFair）均硬写 `reviewStatus:'pending', publishStatus:'draft'`
- 单次上限 10000 行：`jobs/partner-import-file.ts:5`
- 模板必填列：`jobs/excel-template.ts:21-26`（岗位：externalId / title / company / city / sourceUrl）、`:48-55`（招聘会：externalId / title / startAt / endAt / venue / city / sourceUrl）
- 前端：`apps/partner/src/routes/sources/ExcelImportModal.tsx:68-70`

### 1.2 Webhook 接收（**只收岗位，不收招聘会**）

- `POST /api/v1/sync/webhook?source=<jobSourceId>` — `sync/sync.controller.ts:37-41`
- 无 JWT，靠 `webhookSecret` + HMAC-SHA256 + 时间窗 + nonce：`sync/sync.service.ts:80-131`
- 落库复用 Partner 逻辑：`jobs/jobs-partner.service.ts:284`，状态 `pending + draft`（`:322,:343-344`）
- 招聘会无 webhook 通道，能力矩阵已 fail-closed：`jobs/partner-capabilities.ts:37-43`

### 1.3 BullMQ API 拉取 worker（岗位 + 招聘会）

- 注册：`job-sync/job-sync.module.ts:11,26-35` —— **只有设了 `REDIS_URL` 才注册 BullMQ**，否则走进程内 inline
- 定时：`job-sync.scheduler.ts:19-20`，每 30 分钟
- 选源条件：`job-sync.service.ts:180-193` — `enabled:true` 且 `accessMode:'api'` 且 `org.enabled`
- 落库：`:597 upsertJobs()` / `:720 upsertFairs()`，状态 `pending + draft`
- Admin 手动触发：`job-sync.controller.ts:44`

### 1.4 Admin 手工录入 —— **岗位/招聘会/政策都没有**

| 对象 | Admin 新建端点 | 说明 |
|---|---|---|
| Job | **无** | Admin 只有 review（`jobs.controller.ts:258`）/ publish（`:269`）/ 质量汇总（`:251`） |
| JobFair | **无**（本体） | `admin-fairs.controller.ts` 只能改已有场次、挂参展企业/分区/物料 |
| PolicyPost | **无** | 创建只在 `policies.controller.ts:56` `POST partner/policies`，`@Roles('partner')` |
| CompanyProfile | **有** | `companies.controller.ts:119` → `companies.service.ts:346` |

**三个核心库都没有「管理员直接手打一条」的路子。必须先有 Partner 机构账号 + JobSource，从 Partner 侧进来。**

---

## 2. 审核与发布两道门

### 2.1 公开列表要求 `approved` 与 `published` 同时满足

| 端点 | 条件 | 位置 |
|---|---|---|
| `GET /jobs` | `{reviewStatus:'approved', publishStatus:'published'}` | `jobs/jobs-kiosk.service.ts:48-50`（count 同 where `:64-70`） |
| `GET /jobs/:id` | 同上 | `:80` |
| `GET /job-fairs` | 同上 + `withPublicFairDemoExclusion()` | `:133-152` |
| `GET /policies` | 同上 | `policies/policies.service.ts:102-116` |
| `GET /companies` | 同上 | `companies/companies.service.ts:30,71,104-113` |

`withPublicFairDemoExclusion()`（`jobs/jobs-shared.ts:548-556`）只在 `EXCLUDE_DEMO_PUBLIC_DATA==='true'` 时生效，且**只作用于 JobFair**。Job 与 CompanyProfile 无此过滤 —— 这就是带「（演示）」字样、`sourceUrl` 为 `example.com` 的 3 家企业能公开可见的原因。

### 2.2 状态机

- 审核（`pending → reviewing → approved/rejected`）：`jobs/jobs-admin.service.ts:43-90`（Job）、`:131-172`（Fair）、`policies/policies.service.ts:249-284`
- **approve 后 publishStatus 强制置 `draft`**：`jobs-admin.service.ts:65`、`:146`、`policies.service.ts:263` —— 审核通过 ≠ 上线
- 发布：`jobs-admin.service.ts:97-125`，`action==='publish'` 只校验 `reviewStatus==='approved'`（`:103-107`），**不校验当前 publishStatus** → `unpublished` 的行在 API 层可以直接重新发布
- 审核终态不可回退：`:48-53`、`policies.service.ts:254-258`
- **Partner 只能下架不能上架**：`jobs.controller.ts:379` → `jobs-partner.service.ts:365-386`
- **Partner 编辑打回重审**：`jobs-partner.service.ts:399-412`
- **停用数据源级联下架**：`job-sync.service.ts:256-320`，`setSourceEnabled(false)` 批量改 `unpublished`（`:311-316`）

### 2.3 【关键缺陷】Admin UI 对 `approved + unpublished` 不渲染「发布」按钮

```
apps/admin/src/routes/job-sources/index.tsx:275
  {s.reviewStatus === 'approved' && s.publishStatus === 'draft' && ( ...「发布」... )}
apps/admin/src/routes/job-sources/index.tsx:284
  {s.publishStatus === 'published' && ( ...「下架」... )}
```

`approved + unpublished` 两个条件都不满足 → 操作列**只剩「查看」**。招聘会页同样：`apps/admin/src/routes/fair-sources/index.tsx:289,298`。

政策页写法是对的：`apps/admin/src/routes/policy-sources/index.tsx:225` 用 `r.publishStatus !== 'published'`。

底层 API 客户端齐全：`apps/admin/src/services/api/sources.ts:40` `publishJobSource(id)` → `PATCH /admin/job-sources/:id/publish`。**只是没有按钮调它。**

> **生产库里那 217 条 `approved + unpublished` 的岗位，管理员在后台点不出来。**

---

## 3. seed / 演示数据脚本

| 脚本 | 命令 | 产出 | 守卫 |
|---|---|---|---|
| `prisma/seed.ts` | `db:seed` | 1 admin + 2 partner org + 13 Job（11 条 approved+published） | `:21 assertDemoSeedAllowed()` + `:29-32` production 跳过 |
| `prisma/seed-companies.ts` | `db:seed:companies` | 1 演示机构 + **3 家 approved+published 企业** + 6 条 approved+published 岗位 | `:14` + `:64-67` |
| `prisma/seed-fairs.ts` | `db:seed:fairs` | 招聘会 approved+published | `:23` + `:240` |
| `prisma/seed-venue-guide.ts` | `db:seed:venue-guide` | 场馆导览 | — |

守卫 `prisma/seed-guard.ts`：要求 `NODE_ENV ∈ {development,test}` 且 `DEMO_SEED_CONFIRM=I_UNDERSTAND_DEMO_DATA_WILL_BE_WRITTEN`。

**会不会污染生产：会，而且已经污染过一次。** 守卫是 `af6c9592`（2026-08-06）才加的；`seed-companies.ts` 建于 `80eabccd`（2026-06-12）。生产库 3 家演示企业 `syncTime = 2026-06-18T04:46:30.476Z`，正落在窗口内。

即便有守卫，它只看 `NODE_ENV` 和确认字符串，**不看 `DATABASE_URL` 指向哪个库** —— 本机 `NODE_ENV=development` 配生产连接串依然能写穿。这是仍存在的风险面。

---

## 4. 线上到底有没有记录

### 4.1 本次只读 GET（2026-08-16，无认证头、无 Cookie）

```
GET /api/v1/health              → {"status":"ok","db":"postgres"}
GET /api/v1/jobs?page=1&pageSize=1        → data:[], pagination.total = 0
GET /api/v1/job-fairs?page=1&pageSize=1   → data:[], pagination.total = 0
GET /api/v1/policies?page=1&pageSize=1    → data:[], pagination.total = 0
GET /api/v1/companies?page=1&pageSize=10  → total = 3
GET /api/v1/companies/stats               → companyCount=3, openJobCount=0, fairCompanyCount=1
GET /api/v1/companies/<demo-co-1>         → externalId="demo-co-1",
                                            sourceUrl="https://example.com/demo/company-1",
                                            syncTime="2026-06-18T04:46:30.476Z"
GET /api/v1/companies/<同上>/jobs          → items:[], total = 0
```

这些字段与 `prisma/seed-companies.ts:19,26` 逐字一致；`fairParticipant:true` 只有 demo-co-1（`:25`），对上 `fairCompanyCount:1`。region / industry / companyType 也与 `:22-23,37-38,50-51` 完全吻合。

**3 家企业 100% 是 `db:seed:companies` 的产物，不是通过 Admin/Partner 录入路径进来的。**

### 4.2 私有表状态：只读端点无法区分，但仓库有已归档的授权只读证据

`docs/reviews/production-data-governance-readonly-audit-2026-08-07.md` §2.1–2.3（基线 `main@35d53d6a`，生产 COMMIT `389f37ff`）：

- **Job 总数 219**：`approved|unpublished = 217`、`approved|draft = 1`、`pending|draft = 1`、**`published = 0`**
- 来源分布：腾讯公开岗位样本 100、腾讯招聘公开来源样本（预生产验证）100、市人社公共就业平台（演示）6、市人才网 6、高校就业信息网 7
- **JobFair 3 场**：全部 `approved|unpublished`，均为 2026-06 已结束场次
- **PolicyPost：0**
- JobSource 4 个：`src-hr-api`（api, enabled=true, lastSyncAt 空）、`preprod-tencent-real-source-0701162419`（excel, disabled）、`src-tencent-real-excel-20260701`（excel, disabled）、`src-uni-excel`（excel, enabled=true, lastSyncAt 空）

配套执行记录 `docs/operations/production-content-data-replacement-list-2026-08.md`：2026-08-07 由数据负责人确认后执行，215 条预生产/演示岗位、3 场已结束招聘会下架，2 个预生产样例数据源停用，备份锚点 `pre-content-cleanup-20260807T081738Z.dump`。§3.1 明确「已全部下架（215 条，**保留记录可恢复**）」。

**时效性**：以上是 2026-08-07 快照，不是今天的实时状态。但今天的公开探针与该快照完全自洽。

### 4.3 为什么 3 家企业活下来了

2026-08-07 审计的盘点范围是 Job / JobFair / OfflineAgency / OfflineJob / PolicyPost / JobSource —— **没有 CompanyProfile 这一栏**。执行清单的五张表也是「岗位 / 招聘会 / 政策 / 线下机构 / 线上平台目录」，同样没有「企业展示」。

同一个 seed 脚本在同一循环里创建的企业和岗位（`seed-companies.ts:77-94`），今天岗位全没了、企业还在 —— 唯一解释是那次下架按对象类型执行，**漏了 CompanyProfile**。

---

## 5. 最小可行录入方案：岗位库达到 ≥21 条 approved+published

分页默认 `pageSize=20`（`jobs.controller.ts:108`），小程序不传 pageSize（`apps/miniapp/utils/api.js:32`），所以 **21 条 = 2 页**，刚好够验分页与搜索。

### 路线 A（最快）：恢复已 approved 的存量 —— 需先补 1 行 UI 代码

| 步 | 做什么 | 谁做 |
|---|---|---|
| A0 | 重跑具名授权的生产只读盘点，确认 217 条仍在。命令见 `docs/operations/recruitment-wave2-readonly-planning-runbook.md` §3.1 | 数据负责人授权 + 运维 |
| A1 | **逐条核实来源授权**。200 条腾讯预生产样本明确「未授权不进入生产」，演示 6 条不能上，剩市人才网 6 + 高校 7 = 13 条也需确认 —— **光靠存量凑不够 21 条合规的** | 数据负责人 |
| A2 | **修 Admin UI 发布按钮**：`apps/admin/src/routes/job-sources/index.tsx:275` 的 `s.publishStatus === 'draft'` 改为 `!== 'published'`，对齐 policy-sources 写法；`fair-sources/index.tsx:289` 同改 | 开发 |
| A3 | Admin →「数据内容 → 岗位信息源」`/job-sources` → 逐条点「发布」 | 管理员 |
| A4 | 公网校验 `GET /api/v1/jobs?page=2` 有数据、`?keyword=` 命中 | 任何人 |

**A2 是硬阻塞**：不改这行，A3 点不出按钮。

### 路线 B（干净，推荐用于真实上线）：Partner Excel 导入 21+ 条真实岗位

| 步 | 做什么 | 谁做 |
|---|---|---|
| B1 | 确认或新建有授权的来源机构 + Partner 账号（Admin →「合作机构管理」`/partners`） | 管理员 |
| B2 | 机构类型须支持导岗位：`school_employment_center` / `public_employment_service` / `licensed_hr_agency` / `enterprise_source`；**`fair_organizer` 不能导岗位**（`jobs/partner-capabilities.ts:16-51`） | 管理员 |
| B3 | Partner 新建 JobSource（`accessMode='excel'`），`POST /partner/data-sources`（`jobs.controller.ts:325`） | 机构对接人 |
| B4 | 下载模板 → 填 ≥21 行（必填 5 列，来源链接须 http(s) 开头）→ 上传 → 映射 → 预览 → 确认导入 | 机构对接人 |
| B5 | 落库全部 `pending + draft` | — |
| B6 | Admin →「岗位信息源」→ 每条「审核通过」→ 再「发布」。**无批量选择，21 条 = 42 次点击**（`job-sources/index.tsx:257-283` 全是逐行按钮，服务端也无 batch 端点） | 管理员 |
| B7 | 验证 `?page=1`/`?page=2` 各有数据、`total ≥ 21`、`?keyword=`/`?city=`/`?category=` 正确收敛 | 任何人 |

**为什么建议 B 而非 A**：A 恢复的是被判定为「样例/预生产」的数据，执行清单 §5 明确禁止「把预生产隔离样本直接当生产数据」。

### 顺带修掉的三件事

1. **清理 3 家演示企业**：seed 残留，`sourceUrl` 指向 `example.com`，正在生产公开展示。Admin →「企业展示管理」`/companies` → 逐家下架（`PATCH /admin/companies/:id/publish {publish:false}`）。此路径 UI 是通的。
2. **招聘会**：3 场都是 2026-06 已结束场次，恢复无意义。新场次走 Partner 导入或 Excel（dataType=fair）。
3. **政策**：库里 0 条，必须先有 Partner 账号提交（`POST partner/policies`，前端 `apps/partner/src/routes/policy/index.tsx`）。Admin 只能审核+发布。这是真正的「没人录」。

---

## 6. 不确定项（只读证据无法判定，不猜）

1. **今天（2026-08-16）私有表的实时行数与状态矩阵**。公开 GET 返回的 `total` 已被 `approved+published` 过滤。最新私有表证据停在 2026-08-07。要区分「0 条」与「N 条被过滤」，必须以管理员视角或具名授权只读 SQL 重新盘点。
2. **那 217 条是否仍存在**。2026-08-07 之后可能有删除、二次治理或迁移。路线 A 全部前提挂在这上面。
3. **生产 `EXCLUDE_DEMO_PUBLIC_DATA` 的实际取值**。代码默认非 `'true'` 即不过滤（`jobs-shared.ts:549`），仓库 `.env.example`、CI、部署文档都没设置它。3 家演示企业可见只能说明该开关**不作用于 CompanyProfile**，不能反推开关是关的。招聘会恢复前必须核实。
4. **生产 `REDIS_URL` 是否配置**。决定 BullMQ 是真队列还是 inline。不影响「为什么空」的结论，但影响后续接真实 API 源的可靠性。
5. **`src-hr-api` 与 `src-uni-excel` 是否为已授权真实来源**。两者 `lastSyncAt` 均为空 —— 配了但从没成功拉过。是授权、endpoint 还是 worker 没跑，只读无法判定。
6. **3 家演示企业的写入途径**。字段逐字一致是极强证据，但审计日志需管理员视角。**查这 3 个 companyProfileId 有没有 `company.create` 审计记录即可一锤定音**（seed 不写审计，`POST admin/companies` 会写）。
7. **`prisma/seed.ts` 的 13 条演示岗位是否也在生产库**。2026-08-07 来源分布里「市人才网 6 + 高校就业信息网 7 = 13」与 seed.ts 的 13 条巧合可疑，值得按 `sourceOrgId` 核一下。

---

## 7. 本次调研边界

- 只做了无认证 HTTPS GET：`/health`、`/jobs`、`/job-fairs`、`/policies`、`/companies`、`/companies/stats`、`/companies/filters`、`/companies/:id`、`/companies/:id/jobs`
- 未登录、未使用任何凭证或密钥、未做任何 POST/PATCH/DELETE、未连接任何数据库
- 未改动任何生产代码，未触碰 `docs/progress/`
- 线上返回内容不含任何个人信息；文中企业名/描述均为仓库 seed 中已存在的演示占位数据
