# 小程序招聘会现场闭环：生产库最小可验证内容清单

> **这份文档写给准备内容的人（产品负责人 + 运营），不是写给工程师的。**
> 它只回答一个问题：**要让小程序的「招聘会现场助手」被真实走通一次，生产库里最少需要建什么？**
>
> **写作日期**：2026-09-02
> **取证基线**：`claude/miniapp-lane@242b060c8`（工作区干净）。下文每条结论都标了文件路径与行号，
> 全部来自该基线源码，不来自记忆、不来自旧文档、不来自对生产环境的写入探测。
> **本文没有新增或修改任何代码，也没有对生产环境发起任何写请求。**
>
> **本文记录的是「还没做的事」**，不是验收通过记录。文中没有任何一项可以读作「已完成」或「已验证」。

---

## 零、为什么现在必须先补内容

2026-09-02 对生产后端 `https://zyidai.cn` 做过只读探测，结论记在
[`docs/delivery/miniapp-fair-onsite-2026-09/evidence/EV-009-real-backend-readonly-probe.md`](../delivery/miniapp-fair-onsite-2026-09/evidence/EV-009-real-backend-readonly-probe.md)：

| 端点 | 结果 |
|---|---|
| `/health` | 200，`db: postgres`，`degraded: []` —— **服务本身是健康的** |
| `/jobs` `/job-fairs` `/policies` | 全部 `total=0` |
| `/terminals/public` | 空数组 |
| `/policies/eligibility-check` | `items: 0` |

小程序刚做完的现场助手五个页面（会场导览 / 参会企业 / 参会企业详情 / 活动资料 / AI 参会准备单），
入口全部挂在「招聘会详情页」的磁贴上，而磁贴在没有 `fairId` 时直接不可点
（`apps/miniapp/pages/fair-detail/fair-detail.js:66`）。**生产库里一场招聘会都没有，
所以这五页在生产上一步都走不到**，真机能验的只有壳、导航和空态。

> **真机冒烟的前置不是「有设备」，是「有内容」。**

### 本文与既有文档的关系

已有一份 [`docs/operations/seed-content-entry-checklist-2026-08.md`](../operations/seed-content-entry-checklist-2026-08.md)
（542 行，基线 `origin/main@a26eae3ca`），它讲的是**「政策 + 招聘会本体」怎么录进去、怎么发布**。
本文**不重复**那份文档，只补它完全没有覆盖的部分 —— 用 `FairCompany` / `FairVenueGuide` /
`FairMaterial` / 参会企业 / 会场导览 / 活动资料 / 展位 这七个关键词检索该文件，**零命中**。
（该文件唯一沾边的段落是 §六-D 对「AI 参会准备单 vs 参会回顾」模式判定的产品裁定，
不涉及本文讲的任何一类现场子数据。）

分工：

- **招聘会怎么变成前台可见** → 那份文档 + 本文第一节（本文补充它没写的公开列表过滤条件）
- **可见之后，现场五段各需要什么子数据** → 本文第二至四节（那份文档完全没有）
- **政策条件自测怎么才能出结果** → 本文第五节（那份文档 213 行只写了一句「可选，单独排期」）

---

## 一、一场招聘会要「可见」，必须同时满足什么

小程序读的是公开端点 `GET /job-fairs`、`GET /job-fairs/:id`。一条 `JobFair` 记录要能被读到，
要连过 **五关**，缺一即前台看不到。

### 1.1 第一关：这条记录得先存在 —— 而管理员后台建不了

**管理员后台没有任何「新增招聘会」入口，后端也没有对应端点。**

- `services/api/src/jobs/admin-fairs.controller.ts` 只有
  `@Get('admin/fairs')`（69 行）、`@Get('admin/fairs/:id')`（76 行）、
  `@Patch('admin/fairs/:id')`（83 行）—— **没有 `@Post('admin/fairs')`**。
- Admin 页面自己也这么写：`apps/admin/src/routes/fairs/index.tsx:99` 的空态文案是
  「招聘会由合作机构在机构后台导入,经「招聘会信息源」审核后在此进行内容运营。」
- 副标题 `apps/admin/src/routes/fairs/index.tsx:91` 同样声明「审核/发布请到「招聘会信息源」」。

**真正能创建 `JobFair` 行的只有三条路，都不在管理员后台：**

| 路径 | 代码位置 | 谁能用 |
|---|---|---|
| 合作机构后台手动录入 | `apps/partner/src/routes/fairs/index.tsx:253`（按钮「新增招聘会」）→ `POST /partner/fairs/import` | partner 账号 |
| Excel 导入确认 | `services/api/src/jobs/jobs-excel.service.ts:446` | partner 账号 |
| 数据源同步 | `services/api/src/job-sync/job-sync.service.ts:773` | 后台任务 |

服务端写入点：`services/api/src/jobs/jobs-partner.service.ts:470`（`jobFair.upsert`）。
Partner 页面的「新增」实际是「1 条记录的导入」，自动生成 `MANUAL-${Date.now()}-…` 形式的 externalId
（`apps/partner/src/routes/fairs/index.tsx:197-210`）。

> **操作含义**：必须先有一个 partner 账号。管理员账号录不了招聘会。

### 1.2 第二关：来源机构的类型必须允许录招聘会

`POST /partner/fairs/import` 第一件事就是查机构类型
（`services/api/src/jobs/jobs-partner.service.ts:449-450`）：

```ts
const org = await this.getEnabledPartnerOrg(user.orgId)
assertPartnerDataTypeCapability(org.type, 'fair')
```

白名单在 `services/api/src/jobs/partner-capabilities.ts:16-51`：

| 机构 `type` | 能录招聘会？ | 依据行号 |
|---|---|---|
| `school_employment_center` 高校就业中心 | ✅ | :22（`canImportFairs: true`）|
| `public_employment_service` 公共就业服务机构 | ✅ | :29 |
| `fair_organizer` 招聘会主办方 | ✅ | :43 |
| `licensed_hr_agency` 持证人力资源机构 | ❌ | :36（`canImportFairs: false`）|
| `enterprise_source` 企业来源 | ❌ | :50 |

机构还必须 `enabled: true`，否则 `getEnabledPartnerOrg` 拒绝。

### 1.3 第三关：数据库层的必填字段

`JobFair` 模型（`services/api/prisma/schema.prisma:1243-1302`）中**没有默认值也不可空**的列：

| 字段 | 说明 |
|---|---|
| `sourceOrgId` | 外键指向 `Organization`，机构必须先存在 |
| `externalId` | 与 `sourceOrgId` 组成唯一键（:1298 `@@unique`）|
| `sourceName` | 来源名称，由服务端取机构名自动填 |
| `sourceUrl` | 来源链接 |
| `title` | 招聘会名称 |
| `startAt` / `endAt` | 开始 / 结束时间（ISO 8601）|
| `venue` | 举办场馆 |
| `city` | 城市 |

有默认值：`theme='general'`、`reviewStatus='pending'`、`publishStatus='draft'`、
`companyCount=0`、`jobCount=0`、`viewCount=0`。

导入时的额外校验（`services/api/src/jobs/jobs-partner.service.ts:459-468`）：
时间必须是合法 ISO 8601，且 `endAt` 必须**严格晚于** `startAt`，否则 400
（`INVALID_DATETIME` / `INVALID_DATE_RANGE`）。

可空但影响现场体验的字段：`address`、`mapImageUrl`（会场导览的平面图）、`description`、
`coverImageUrl`、`latitude`/`longitude`（扫码导航）、`trafficInfo`、`checkinUrl`、`expectedAttendance`。

### 1.4 第四关：审核 + 三道发布闸门

顺序固定：**Partner 提交（`pending`/`draft`）→ Admin 审核通过（`approved`）→ Admin 发布（`published`）**。

- 审核：`PATCH /admin/fair-sources/:id/review`，Admin 页面 `apps/admin/src/routes/fair-sources/index.tsx`
  按钮「审核通过」（291 行）/「拒绝」（298 行，拒绝必须填原因）。
  审核通过后 `publishStatus` 被强制写回 `draft`（`services/api/src/jobs/jobs-admin.service.ts:162`）。
- 发布：`PATCH /admin/fair-sources/:id/publish`，同页按钮「发布」（308 行）/「下架」（317 行）。

`publishFairSource`（`services/api/src/jobs/jobs-admin.service.ts:192-214`）在 publish 时连做三次检查：

**闸门 A — 必须先审核通过**（:197-201）
未 `approved` 直接 400 `PUBLISH_REQUIRES_APPROVAL`。

**闸门 B — 来源机构必须「内容可信」**（:204-207）
调 `assertOrgContentTrustActive`。判据在 `services/api/src/common/content-trust.ts:76-81`：

```
contentTrustStatus === 'active'  &&  archivedAt == null
```

fail-closed：未标记（`null`）、`pending`、`suspended`、`revoked`、机构不存在 —— **一律拒绝**，
错误码 `ORG_CONTENT_TRUST_REQUIRED`。

> ⚠️ **管理员后台没有这个按钮。** 详见既有文档
> [`seed-content-entry-checklist-2026-08.md` §1.2](../operations/seed-content-entry-checklist-2026-08.md)
> ——本文复核结论一致：在本基线检索 `apps/admin/src/` 的 `eligibility`/`申领条件` 与 trust 相关控件，
> 仍未找到设置入口。需要工程师调
> `PATCH /api/v1/admin/orgs/:id/content-trust`（body `{ "status": "active", "reason": "<授权依据>" }`）
> 或跑 `maintenance:backfill-org-content-trust` 脚本。**标 `active` 时 `reason` 必填。**

**闸门 C — 来源可追溯字段必须完整**（:208）
`FAIR_PUBLISH_REQUIRED_FIELDS`（`services/api/src/common/publish-completeness.ts:67-78`）逐项非空：

`sourceOrgId` 来源机构 / `externalId` 外部ID / `sourceName` 来源名称 /
**`sourceUrl` 来源链接（必须 `http://` 或 `https://` 开头）** / `syncTime` 同步时间 /
`title` 招聘会名称 / `venue` 举办地点 / `city` 城市 / `startAt` 开始时间 / `endAt` 结束时间。

判空规则（`publish-completeness.ts:83-89`）：**纯空白串按空处理**，`Invalid Date` 按空处理。
失败错误码 `PUBLISH_INCOMPLETE_FIELDS`，错误信息会点名缺哪几个字段。

### 1.5 第五关：公开列表的「演示数据排除」过滤

这是既有文档没写、最容易踩的一条。

`services/api/src/jobs/jobs-shared.ts:712-720`：

```ts
export function withPublicFairDemoExclusion(where) {
  if (process.env['EXCLUDE_DEMO_PUBLIC_DATA'] !== 'true') return where
  return { AND: [where, { NOT: { OR: PUBLIC_FAIR_DEMO_FILTERS } }] }
}
```

`PUBLIC_FAIR_DEMO_FILTERS`（同文件 :702-710）会排除满足**任意一条**的招聘会：

| 条件 | 命中示例 |
|---|---|
| `sourceOrgId` 以 `org_vff_` 开头 | — |
| `externalId` 以 `VFF-` 开头 | — |
| `sourceUrl` 含 `example.org` | `https://example.org/fair/1` |
| `sourceName` 含「验证」 | 机构名叫「XX验证中心」 |
| **`title` 含「验证」** | **「2026 秋季验证专场招聘会」← 会被隐藏** |
| **`venue` 含「验证」** | — |
| **`city` 含「验证」** | — |

> ⚠️ **给准备内容的人的直接结论：招聘会名称、场馆、城市、来源名称里都不要出现「验证」二字，
> 来源链接不要用 `example.org`。** 否则这场招聘会会审核通过、发布成功，但前台列表和详情**全部 404**，
> 排障时极难定位（后端不报错，只是查不到）。

**生产上这个开关的实际取值：未查证到。** 仓库的 `.env.example`、CI 配置、部署文档里都没有设置
`EXCLUDE_DEMO_PUBLIC_DATA`；代码默认非 `'true'` 即不过滤。
既有分析 [`docs/reviews/empty-catalogs-root-cause-2026-08-16.md:205`](../reviews/empty-catalogs-root-cause-2026-08-16.md)
也明确写着这一项「招聘会恢复前必须核实」。**建内容之前请先向运维确认生产的实际取值。**
不确定时，按「开关是开的」准备内容最安全 —— 避开上述七个模式没有任何代价。

**应用范围不一致（本次查证发现）**：该过滤只套在
`jobs-kiosk.service.ts` 的列表 / 详情 / detail / companies / zones / map / stats
与 `fair-company-print.service.ts:185`；
而 `/job-fairs/:id/materials`（`fair-material.service.ts:247-250`）与
`/job-fairs/:id/venue-guide`（`fair-venue-guide.service.ts:183-186`）**没有套**，
只判 `approved + published`。含「验证」的招聘会会出现「列表查不到、但资料端点仍返回数据」的分裂状态。
这不影响本轮建内容（只要避开关键词即可），但排障时值得知道。

### 1.6 第一节小结：一张检查表

录第一场招聘会之前逐项打勾：

- [ ] 来源机构已建，`type` ∈ {`school_employment_center`, `public_employment_service`, `fair_organizer`}
- [ ] 机构 `enabled = true`
- [ ] 机构 `contentTrustStatus = 'active'` 且 `archivedAt` 为空（**需工程师调接口或跑脚本**）
- [ ] 该机构下有可登录的 partner 账号
- [ ] 招聘会九个必填字段齐全，`sourceUrl` 是 `http(s)://` 开头的真实可打开地址
- [ ] `endAt` 严格晚于 `startAt`
- [ ] **名称 / 场馆 / 城市 / 来源名称里没有「验证」二字，链接不含 `example.org`**
- [ ] Admin 已「审核通过」→ 再「发布」

---

## 二、现场闭环五段各自依赖什么数据

小程序路由注册在 `apps/miniapp/app.json:19-24`。五个页面全部是**公开只读**（`needAuth: false`），
只有三个「生成打印文件」的动作需要登录。

### 2.1 会场导览 —— `pages/fair-venue/`

**调三个端点，并行拉取**（`apps/miniapp/pages/fair-venue/fair-venue.js:129-133`）：

| 端点 | 后端实现 | 数据来源 |
|---|---|---|
| `GET /job-fairs/:id/venue-guide` | `fair-venue-guide.service.ts:182-189` | `FairVenueGuide` + `FairVenueHall` + `FairVenueHallCompany` + `FairVenueFacility` |
| `GET /job-fairs/:id/zones` | `jobs-kiosk.service.ts:220-231` | `FairZone` |
| `GET /job-fairs/:id/map` | `jobs-kiosk.service.ts:233-250` | `JobFair.mapImageUrl` + `FairZone`（排除 `category='innovation'`）|

**要建什么：**

`FairVenueGuide` 是**整图 PUT 覆盖**，一次提交全套（`PUT /admin/fairs/:id/venue-guide`）。
DTO 在 `services/api/src/jobs/dto/venue-guide.dto.ts`：

- `venueName` **必填**，≤100 字（:82-83）
- `halls[]` **数组必传**（可为空数组），最多 **12** 个展厅（:85-86）
  - 每个展厅：`hallCode` 必填、只允许字母数字、≤4 字符（:41-43）；`hallName` 必填 ≤50（:45-46）
  - 可选：`industryCategory`（≤60）、`description`（≤500）、`boothRange`（≤40，如 `A01-A30`）、`sortOrder`
  - `companies[]` **必传**（可为空数组），每厅最多 **100** 家（:60-61）；
    每项要 `fairCompanyId`（必填）+ 可选 `boothNo`（≤20）
- `facilities[]` **数组必传**（可为空数组），最多 **20** 个（:88-89）
  - `type` 必须是 `entrance` / `serviceDesk` / `printPoint` / `consulting` 之一（:26, :65-66）
  - `name` 必填 ≤50（:68-69）
  - **`locationLabel` 是可选的**（:71-72，schema `services/api/prisma/schema.prisma:1537` 也可空）

> **关键依赖顺序**：展厅里绑企业用的是 `fairCompanyId`，所以**必须先建好参会企业，再配导览**。
> Admin 的展厅编辑抽屉是从本场已有企业里挑（`apps/admin/src/routes/fairs/VenueGuideTab.tsx:405`
> 「+ 从本招聘会参展企业中添加…」）。

**不建会怎样（都是可解释空态，不会白屏）：**

| 未建 | 页面表现（`fair-venue.wxml`）|
|---|---|
| 整个 `FairVenueGuide` | L42「没有可展示的会场导览（展厅划分与设施点位）。以下为该场已发布的展区与展位信息。」 |
| `venueName` 空 | L28「本场未标注场馆名称」 |
| 无 `FairZone` | L33「没有可展示的分区数据」/ L182「没有可展示的展区划分」 |
| 无 facilities | L121「没有可展示的入口、服务台、打印点等设施点位」 |
| 展厅没绑企业 | L156「该展厅暂未录入企业清单」 |
| `JobFair.mapImageUrl` 空 | 平面图区块不渲染 |

**⚠️ 有一段无论如何都建不出来：「展位明细」。**
`getFairMap` 的返回里 `booths` 是**硬编码空数组**（`jobs-kiosk.service.ts:247`），
函数签名上就写死成 `booths: []`（:233）。小程序的 `boothGroups` 完全来自
`mapData.booths`（`fair-venue.js:161, 226`），所以「展位明细」区块**永远显示**
L204「没有可展示的展位明细」。这不是内容没录，是后端还没实现该数据面。
展位号信息目前只能通过「展厅 → 企业 → `boothNo`」这条路看到。

### 2.2 参会企业 —— `pages/fair-companies/` + `pages/fair-company-detail/`

**端点**：
- `GET /job-fairs/:id/companies`（`jobs-kiosk.service.ts:176-199`）—— 小程序按 `pageSize:100`
  连翻，最多 5 页（`fair-companies.js:8, 156-165`），即**上限 500 家**，超出显示「已显示前 N 家」
- `GET /job-fairs/:id/companies/:companyId`（`jobs-kiosk.service.ts:201-216`）
- `POST /job-fairs/:id/companies/:companyId/print-url?variant=profile|positions`（需登录）

**要建什么**：`FairCompany`，Admin 后台**有完整增删改**。
DTO `SaveFairCompanyDto`（`services/api/src/jobs/dto/admin-fair.dto.ts:127-160`）：

| 字段 | 必填 | 约束 |
|---|---|---|
| `name` | **是** | ≤200 |
| `industry` | 否 | ≤100，自由字符串 |
| `scale` | 否 | 只能是 `<50` / `50-500` / `500-2000` / `>2000`（:135）|
| `description` | 否 | ≤2000 |
| `sourceUrl` | 否 | ≤500；**空则详情页「去来源平台」按钮 toast「该企业未提供来源平台链接」** |
| `logoUrl` | 否 | ≤500 |
| `hiringTags` | 否 | 逗号分隔字符串，≤200 |
| `jobsCount` | 否 | 整数；**空则列表显示「暂无岗位」而不是「0 个岗位」** |
| `positions[]` | 否 | 最多 **50** 条（:157）；每条 `title` 必填 ≤200 |

**「哪些字段必填才不难看」的实操答案**：
`name` 是唯一硬必填。但只填 `name` 的话，列表卡片只剩一个名字 ——
`metaText`（行业 · 规模）、`placeText`（展位 · 展区）、`jobText` 全是空。
**建议每家至少填**：`name` + `industry` + `scale` + `positions` 至少 1 条（带 `title`）+ `sourceUrl`。
`description` 影响详情页观感，建议至少给 2–3 家填上。

**⚠️ `applyNote`：后端根本不下发，这是内容录不出来的。**

- 共享类型 `packages/shared/src/types/fairDto.ts:93` 把 `applyNote: string` 定义为
  **必填**字段，注释写着「合规提示文字（必须在企业详情页展示）」。
- 但后端实际返回的是 `services/api/src/jobs/fair.types.ts:77-99` 的 `FairCompany` ——
  **里面没有 `applyNote`**。在整个 `services/api/` 目录检索 `applyNote`，**零命中**。
- 小程序 `apps/miniapp/pages/fair-company-detail/fair-company-detail.wxml:98` 的合规提示块是
  `wx:if="{{company.applyNote}}"`，所以**永远不渲染**。
  `apps/miniapp/utils/normalize.js:716-723` 明确记录了这个决定：一体机端
  `apps/kiosk/src/services/api/httpAdapter.ts:218` 硬编了一句「如需了解更多，请扫码前往来源平台」
  冒充来源方的话，小程序**刻意不跟**，拿不到就保持缺失。
- **结论**：这条合规提示在小程序上目前无法出现，**不是内容没建，是后端缺字段**。
  需要后端补 `applyNote` 到 `FairCompany` 响应，或产品明确该提示改由前端固定文案承担。

**⚠️ `boothNumber` 与 `zoneId` 录不进去。**
`FairCompany` 的 schema 里有 `boothNumber` / `zoneId` / `honorTags` / `coverImageUrl` /
`founded` / `headquarters` / `registeredCapital`（`schema.prisma:1324-1330`），
但 `SaveFairCompanyDto`（`admin-fair.dto.ts:127-160`）**不接受这七个字段中的任何一个**，
Admin 表单也没有输入框。而全局 `ValidationPipe` 是 `forbidNonWhitelisted`
（`admin-fair.dto.ts:22` 注释），多传会直接 400。
所以小程序列表的 `placeText`（`展位 xx · 展区名`）与详情页的
「成立年份 / 总部所在 / 注册资本 / 企业荣誉标签」**目前只能是空**，除非直接写库。
展位号的可录入位置是**另一个模型** `FairVenueHallCompany.boothNo`，在场馆导览里录
（见 §2.1）。

**空态**（`fair-companies.wxml`）：无企业时 L56-59「暂无参会企业 / 可能是主办方尚未录入名单，
也可能这场招聘会已下线。」筛选无命中时 L65-66「没有匹配的企业」。

### 2.3 活动资料 —— `pages/fair-materials/`

**端点**：
- `GET /job-fairs/:id/materials`（`fair-material.service.ts:242-269`）
- `POST /job-fairs/:id/materials/:materialId/print-url`（**需登录**）

**公开列表的过滤条件**（`fair-material.service.ts:247-253`）：

1. 所属招聘会 `reviewStatus='approved'` 且 `publishStatus='published'`
2. 资料本身 `deletedAt = null`
3. 资料本身 `publishStatus = 'published'`

**要建什么**：`FairMaterial`，Admin 后台有上传 / 编辑 / 发布 / 删除。

| 项 | 要求 | 依据 |
|---|---|---|
| 文件格式 | **只接受 PDF / PNG / JPEG**，且做魔数校验防伪装 | `fair-material.service.ts:29, 127-133` |
| 文件大小 | ≤ **20 MB** | `fair-material.service.ts:26, 121-123` |
| `name` | **必填**，≤200 | `admin-fair.dto.ts:186-187` |
| `type` | 可选，只能是 `schedule`/`venue_map`/`company_list`/`position_list`/`brochure`/`other`；缺省 `other` | `admin-fair.dto.ts:189-190` |
| `pageCount` | 可选，**管理员手填**，服务端不解析文档分页；缺省 0 = 未知 | `admin-fair.dto.ts:195-197` |
| `publishStatus` | **上传后默认 `draft`**，必须单独点「发布」 | `schema.prisma:1422` |
| `allowPrint` | 默认 `true`；**只能在「编辑」抽屉里改，上传时设不了** | `schema.prisma:1421`；`apps/admin/src/routes/fairs/components/MaterialsTab.tsx:297` |

Word 文档必须先转 PDF —— Admin 页面自己就这么提示
（`MaterialsTab.tsx:135` 空态：「暂无活动资料,点击右上角"上传资料"(支持 PDF / PNG / JPEG)」）。

**发布资料也要过内容信任闸门**（`fair-material.service.ts:197-207`）：
资料本身没有 `sourceOrgId`，信任归属跟随所属招聘会的来源机构，同样 `ORG_CONTENT_TRUST_REQUIRED`。

**打印按钮能不能亮**，取决于 `prepare` 的四条件（`fair-material-print-bridge.service.ts:212-219`）：
资料 `deletedAt=null` + `publishStatus='published'` + **`allowPrint=true`** +
所属招聘会 `approved`+`published`。任一不满足 → `MATERIAL_NOT_PRINTABLE`。

**空态**：`fair-materials.wxml:26-27`「没有可展示的活动资料 / 主办方发布日程、展馆图或企业名册后会显示在这里。」

**文件本体不可替换**（`MaterialsTab.tsx:299`「文件本体不可替换;如需换文件,请删除后重新上传。」）——
上传前先确认文件是对的。

### 2.4 AI 参会准备单 —— `pages/fair-visit-plan/`

**这一段是唯一有真实前置门槛的：既要招聘会，也要「本人已有简历任务」。**

**依赖一：本机已有一份解析过的简历任务。**
页面从本地存储读 `RESUME_TASK`（`apps/miniapp/pages/fair-visit-plan/fair-visit-plan.js:165-172`，
key `zyd_resume_task`，`apps/miniapp/utils/storage.js:19`）。没有 `taskId` → `phase:'no-resume'`，
显示「还没有可用的简历 / 内容完全基于你的简历原文生成，需要先上传并解析一份简历。」
按钮跳 `/pages/resume-upload/resume-upload`。
注意是 **`taskId`（一次简历解析任务），不是 `resumeId`**。

服务端同样强制：`services/api/src/ai/resume/fair-visit-plan.service.ts:66-81` ——
先 `loadAuthorizedParse(taskId)`，再从 `fileId` 抽简历原文；
抽不到就返回 `status:'failed'`，`failReason` 是
「简历原文已按隐私策略自动清理，请重新上传简历后再生成参会准备单」。
**AI 准备单不会在没有简历的情况下生成任何内容。**

**依赖二：招聘会 `approved` + `published`。**
`loadFairContext`（同文件 :319-330）只查 `{ reviewStatus:'approved', publishStatus:'published' }`，
查不到抛 `FAIR_NOT_FOUND`「招聘会不存在或未发布」。
（注意此处**没有**套 `withPublicFairDemoExclusion`，与列表口径不同。）

**依赖三：参会企业 —— 不建也能生成，但生成出来是空的。**
`loadFairContext` 把 `fair.companies` 连同 `positions` 一起喂给模型（:333-355），
最多取 40 家（`llm-fair-visit-plan.service.ts:188`），推荐最多 6 家（:232），
且推荐结果被 `allowedCompanies` 集合过滤（:215, 225）——**模型编不出库里没有的企业**。
所以 `FairCompany` 为 0 时，「优先拜访企业」这一段必然为空，
`basedOn.companyCount` / `positionCount` 显示「暂无数据」（`fair-visit-plan.js:78`）。
**这一段是花钱的 LLM 调用**，用 0 家企业去跑等于白花钱。

**模式由服务端按 `endAt` 判定**（:34, :334）：未结束 → `preparation`「AI参会准备单」；
已结束 → `review`「AI参会回顾」。**验收已结束场次时看到「回顾」是预期行为，不是数据录错。**

**打印**：`POST /job-fairs/:id/visit-plan/:taskId/print`，需登录，返回 `fileId` 后跳 `print-upload`。

### 2.5 打印 —— 终端选择：**这一段建内容解决不了**

小程序的打印终端选择页 `pages/print-store/print-store.js:31` 调 `GET /terminals/public`。

后端实现 `services/api/src/terminals/terminals-admin.service.ts:757-783`，
一台终端要出现在返回列表里，**三个条件缺一不可**：

1. `enabled = true`（:759）—— Admin 可切
2. `lifecycleStatus = 'active'`（:759）—— **Admin 不能直接设**
3. **最近 5 分钟内有心跳**，且该心跳的 `localTaskDatabaseAvailable !== false`（:771-773）——
   不满足直接被 `flatMap` 过滤掉，不是标记离线，是**整条不返回**

**`locationLabel` 不是必需的**：它可空（`schema.prisma:33`），返回时按 `null` 下发（:779）；
`displayName` 为空时回落到 `terminalCode`（:778）。小程序对空地址显示
「暂未配置服务点说明」（`print-store.wxml:45`）。

**要到 `active` 必须有真实 Agent 在跑。** 路径：
Admin「预创建设备」→ `planned` → Admin 生成一次性绑定码 → Agent 绑定 → `commissioning`
（`terminal-credential-security.service.ts:251`）→ **首次心跳** → `active`
（`terminals-agent.service.ts:371-374`）。

而且「预创建设备」这个按钮**默认是废的**：
`terminals-admin.service.ts:191` 要求 `TERMINAL_PLANNED_PROVISIONING_ENABLED === 'true'`，
否则 403 `TERMINAL_PLANNED_PROVISIONING_DISABLED`；生产环境该变量必须显式声明，
且滚动部署阶段规定保持 `false`（`services/api/src/config/production-runtime-gates.ts:243-246`）。

**空列表时小程序的表现**（`print-store.wxml:34-38`）：显示「暂无可选门店」+
「仅展示已启用且有真实心跳的公开终端」，**不渲染任何示例门店**
（源码注释 `print-store.wxml:26` 明写「门店与机器状态需真实接口提供，未接入前不展示示例门店」）。
「去支付」按钮因为 `picked` 恒为空，点了只 toast「请先选择门店」（`print-store.js:60`）。
只有一台终端时会自动选中（`print-store.js:39`）；选中的终端 `isOnline=false` 时弹
「该终端暂时离线」（:64-68）。

> **结论：打印这一段的前置是「有一台真实终端 + Agent 在线心跳」，不是建内容。**
> 在没有终端的情况下，最多能验到「生成打印文件 → 跳到 print-upload → 报价 → 走到选门店页 → 空态」，
> **下不了单**（下单端点 `POST /me/print-orders` 需要 `terminalId`，
> `apps/miniapp/pages/print-pay/print-pay.js:43`）。

---

## 三、这些内容在 Admin 后台的哪一页建

已逐页核对本基线 `apps/admin/src/routes/`：

| 数据 | Admin 页面 | URL | 能不能建 |
|---|---|---|---|
| `JobFair` 本体 | `apps/admin/src/routes/fairs/index.tsx` | `/fairs` | ❌ **建不了**，只能「编辑基本信息」（:163）|
| `JobFair` 审核/发布 | `apps/admin/src/routes/fair-sources/index.tsx` | `/fair-sources` | 只有审核通过 / 拒绝 / 发布 / 下架 |
| `FairCompany` | `apps/admin/src/routes/fairs/components/CompaniesTab.tsx` | `/fairs` →「参展企业」tab | ✅ 「新增企业」（:114）|
| `FairZone` | `apps/admin/src/routes/fairs/components/ZonesTab.tsx` | `/fairs` →「展区管理」tab | ✅ 「新增展区」（:68）|
| `FairVenueGuide` | `apps/admin/src/routes/fairs/VenueGuideTab.tsx` | `/fairs` →「场馆导览」tab | ✅ 「开始配置」（:179）/「保存导览配置」（:309）|
| `FairMaterial` | `apps/admin/src/routes/fairs/components/MaterialsTab.tsx` | `/fairs` →「活动资料」tab | ✅ 「上传资料」（:119）+ 逐条「发布」|
| `Terminal` | `apps/admin/src/routes/terminals/index.tsx` | `/devices?tab=terminals` | ⚠️ 「预创建设备」（:393）**默认 403**，见 §2.5 |
| `PolicyPost` | `apps/admin/src/routes/policy-sources/index.tsx` | `/policy-sources` | ❌ **只有审核/发布，没有任何新建或编辑按钮** |
| `PolicyEligibilityRule` | — | — | ❌ **Admin 完全没有入口** |

Tab 定义在 `apps/admin/src/routes/fairs/index.tsx:32-35`。

### 没有 Admin 入口的五项（这是本节最重要的部分）

**① 招聘会本体建不了** —— 必须用 partner 账号在合作机构后台
`apps/partner/src/routes/fairs/index.tsx:253`「新增招聘会」。
该页自己也说明「现场活动资料由管理员在运营后台维护」（:362），职责是分开的。

**② 政策建不了也改不了** —— Admin `/policy-sources` 页只有审核 / 发布，
空态文案（`apps/admin/src/routes/policy-sources/index.tsx:173`）写着
「政策内容由合作机构在机构后台「政策公告」中提交」。
唯一录入面是 `apps/partner/src/routes/policy/index.tsx:231`「新增政策内容」。

**③ 政策申领条件：Admin 连看都看不到** ——
在 `apps/admin/src/` 检索 `eligibility-rules` / `申领条件`，**零命中**。
后端其实有一个只读复核端点
`GET /admin/policy-sources/:id/eligibility-rules`（`services/api/src/policies/policies.controller.ts:39, 214`
注释写着「Admin 只读复核已录入的申领条件(审核前要能看到条件与原文摘录)」），
但前端没有任何地方调它。
**净效果：管理员在 `/policy-sources` 点「审核通过」时，看不到自己正在批准的申领条件。**
唯一录入面在合作机构后台，见 §5。

**④ 机构「内容可信」标记没有按钮** —— 见 §1.4 闸门 B，需要工程师执行。

**⑤ `FairCompany.boothNumber` / `zoneId` 等七个字段**：schema 里有、Admin 表单没有、
后端 DTO 也不收（见 §2.2）。**只能直接写库，或先补后端 DTO 与前端表单。**

---

## 四、最小集：具体要建多少

目标是**把五段各走通一次**，不是把库填满。

### 4.1 必需（不建就走不到下一步）

| # | 内容 | 数量 | 在哪建 | 不建的后果 |
|---|---|---|---|---|
| 1 | 来源机构 `Organization` | **1 个** | Admin `/partners` | 招聘会无法归属，建不出来 |
| 2 | 机构标 `contentTrustStatus='active'` | **1 次** | ⚠️ 无按钮，需工程师 | 审核能过，**点发布必失败** |
| 3 | 该机构下的 partner 账号 | **1 个** | Admin 合作机构 → 账号 | 没人能录招聘会 |
| 4 | `JobFair` | **1 场** | Partner `/fairs`「新增招聘会」 | 五个页面全部进不去 |
| 5 | Admin 审核通过 + 发布 | **2 次点击** | Admin `/fair-sources` | 公开端点查不到 |
| 6 | `FairCompany` | **≥ 3 家**（建议 5–8 家）| Admin `/fairs` →「参展企业」| 参会企业页空态；导览无企业可绑；AI 准备单推荐段为空 |
| 7 | 每家企业的 `positions` | **≥ 1 条 / 家** | 同上（企业抽屉内）| 详情页「暂无岗位信息」；「生成岗位清单」按钮 toast 拒绝 |

**为什么企业至少 3 家**：少于 3 家时，参会企业页的搜索、展区筛选、
以及 AI 准备单「优先拜访 6 家」这三处都无法体现差异，验收等于没验。

### 4.2 建议建（不建的话对应板块只是空态，但验收覆盖度会缺一块）

| # | 内容 | 数量 | 在哪建 | 不建的表现 |
|---|---|---|---|---|
| 8 | `FairZone` | **2–3 个** | Admin `/fairs` →「展区管理」| 导览页「没有可展示的展区划分」；企业页展区筛选只有「全部」 |
| 9 | `FairVenueGuide` | **1 套**（2 个展厅 + 2 个设施）| Admin `/fairs` →「场馆导览」| 导览页走 L42 回退文案，只剩展区 |
| 10 | 展厅内绑企业 + `boothNo` | **每厅 2–3 家** | 同上 | 展厅卡「该展厅暂未录入企业清单」；**这是展位号唯一的可录入位置** |
| 11 | `JobFair.mapImageUrl` | **1 张图 URL** | Admin `/fairs` →「编辑基本信息」| 导览页不显示平面图，点击预览无从验证 |
| 12 | `FairMaterial`（已发布 + `allowPrint=true`）| **2 份**（建议 1 份 PDF + 1 份 PNG）| Admin `/fairs` →「活动资料」| 资料页空态；打印链路验不到 |
| 13 | 至少 1 份资料 `allowPrint=false` | **1 份** | 同上（编辑抽屉）| 验不到「不允许打印」的差异表现 |

### 4.3 一句话版本

> **1 个机构（已标内容可信）+ 1 个 partner 账号 + 1 场已发布招聘会
> + 5 家参会企业（每家至少 1 个岗位）+ 2 个展区 + 1 套导览（2 厅 2 设施，厅内绑企业带展位号）
> + 3 份活动资料（2 份可打印 / 1 份不可打印）+ 1 张平面图 URL。**

### 4.4 建之外还要准备的（不是「建内容」，但缺了同样走不通）

- **一份可上传的真实简历**（用于 AI 参会准备单）—— 必须在小程序里走一遍
  `/pages/resume-upload/resume-upload`，让本机存下 `taskId`
- **一个能登录的小程序会员账号** —— 三个「生成打印文件」动作都要登录
- **一台在线终端 + Agent** —— 见 §2.5，**这一项建内容解决不了**

---

## 五、政策条件自测：要出结果，光发布不够

生产 `/policies/eligibility-check` 返回 `items: 0`。查清了原因，是**两层**：

### 5.1 第一层：政策本身得先满足三个条件

`checkEligibility`（`services/api/src/policies/policy-eligibility.service.ts:98-116`）在
调用方**不指定 `policyIds`** 时（小程序正是这样 ——
`apps/miniapp/pages/policy-check/policy-check.js:71` 只传 `answers`），查询条件是：

```ts
where: {
  reviewStatus: 'approved',
  publishStatus: 'published',
  kind: 'policy_guide',      // 注释：notice 是公告，没有申领条件
}
```

> ⚠️ **`kind` 必须是 `policy_guide`（政策扶持条目），不能是 `notice`（公告）。**
> 录成公告的政策**永远不会进入条件自测**，哪怕它已发布。

单次最多比对 **50 条**（`MAX_POLICIES_PER_CHECK`，:71）。

**所以 `items: 0` 的准确含义是：生产库里一条 `approved` + `published` + `kind='policy_guide'`
的政策都没有。** 不是「有政策但没录条件」——那种情况 `items` 会 > 0，只是每条显示「未录入条件」。

政策发布的闸门比招聘会**少一道**：只过内容信任（`policies.service.ts:321`），
**不跑**字段完整性检查（`PolicyPost` 不在 `publish-completeness.ts` 的字段表里）。
所以政策的 `externalUrl` 和 `externalId` 可以留空，不影响发布。详见既有文档
[`seed-content-entry-checklist-2026-08.md` §零](../operations/seed-content-entry-checklist-2026-08.md)。

### 5.2 第二层：条件在哪录 —— 只有合作机构后台

模型是 `PolicyEligibilityRule`（`services/api/prisma/schema.prisma:656-687`）。

**Admin 没有任何入口**（见 §3-③）。唯一录入面：

- 合作机构后台 `apps/partner/src/routes/policy/index.tsx:297` 的「申领条件」按钮，
  `title="录入可机械比对的申领条件"`（:293），**只对 `kind='policy_guide'` 的行显示**（:86 注释）
- 抽屉 `apps/partner/src/routes/policy/EligibilityRulesDrawer.tsx`：
  「添加一条条件」（:222）、「保存条件并重新提审」（:173），
  空态「这条政策还没有录入申领条件」（:198）；抽屉内还有服务端「试算」预览
- 接口：`GET/PUT /partner/policies/:id/eligibility-rules`、
  `POST /partner/policies/:id/eligibility-preview`
  （`apps/partner/src/services/api/policies.ts:229-233`）

**每条规则的字段约束**（`services/api/src/policies/policy-eligibility.engine.ts`）：

| 字段 | 要求 |
|---|---|
| `label` | 条件标题，展示用，不作判定依据 |
| `sourceText` | **必填** —— 政策原文摘录，一字不改；空则拒绝入库（:57, :78）|
| `matchMode` | `all`（全部满足）或 `any`（任一满足）|
| `clauses[]` | 每条含 `questionKey` + `satisfiedValues[]` + `conflictValues[]` |

硬规则：
- 单条政策最多 **12** 条条件（`MAX_RULES_PER_POLICY`，:46, :65-68）
- `questionKey` 必须来自后端下发的 9 个问项之一（见下表）
- 「不确定」这个取值**不得出现在** `satisfiedValues` / `conflictValues` 任一侧（:53）
- 两侧不得相交（:56）
- 两侧都没命中的取值一律判 `unknown`，**绝不默认成「不符合」**

**9 个问项**（`services/api/src/policies/policy-eligibility.types.ts:55-146`，
与生产探测到的 9 项一致）：

`employment_status` 现在状态 / `household_social` 户籍社保 / `unemployed_duration` 离职多久 /
`age_range` 年龄段 / `graduation_year` 毕业年份 / `unemployment_registration` 失业登记 /
`social_insurance_months` 社保月数 / `separation_reason` 离职原因 / `prior_subsidy` 是否已享受

### 5.3 ⚠️ 顺序陷阱：先录条件，再让管理员审核

`replacePartnerRules` 在保存条件的同一个事务里，把政策**强制打回**
（`policy-eligibility.service.ts:258-268`）：

```ts
reviewStatus: 'pending',
publishStatus: 'draft',
rejectReason: null, reviewedBy: null, reviewedAt: null,
```

按钮文案也是「保存条件并重新提审」。

> **所以正确顺序是：Partner 录政策 → Partner 录申领条件 → Admin 审核通过 → Admin 发布。**
> 反过来做（先发布再补条件），政策会被自动下架，还得再走一遍审核发布。

### 5.4 最少录几条才能看到非空结果

分三个档，看你要验到哪一层：

| 目标 | 最小配置 |
|---|---|
| `items` 不为 0（页面不再说「没有可比对的政策」）| **1 条** `policy_guide` + `approved` + `published` 的政策，**条件可以一条都没有** —— 此时 `overall='no_recorded_conditions'`（`policy-eligibility.engine.ts:347`），页面显示该政策「未录入条件」|
| 看到一条真正的判定结论 | **1 条政策 + 1 条 `PolicyEligibilityRule`**，其 `clauses` 至少 1 个子句，`satisfiedValues` 里放一个用户会选的取值 → 作答命中后 `overall='all_recorded_conditions_matched'`（:350）|
| 三态都验到（符合 / 冲突 / 不确定）| **1 条政策 + 3 条规则**：一条命中 `satisfiedValues`、一条命中 `conflictValues`、一条 `questionKey` 用户不作答 → 分别得到 `matched` / `conflict` / `unknown`（:339-343）|

**建议按第三档准备**：1 条政策 + 3 条规则。这是唯一能一次验完判定引擎三种输出的配置，
而且总工作量只是多写两条 `sourceText`。

如果要验「多条政策排序」，再加 1 条政策即可（结果按 `publishedDate desc` 排，:111）。

---

## 六、查证时发现的、内容建不出来的问题

这五条**不是「还没录」，是录了也不会出现**。列在这里，避免验收时被误判成数据没准备好。

| # | 问题 | 依据 | 影响 |
|---|---|---|---|
| A | **`applyNote` 后端不下发** —— 共享类型声明为必填，`services/api/` 全目录零命中 | `packages/shared/src/types/fairDto.ts:93` vs `services/api/src/jobs/fair.types.ts:77-99` | 企业详情页的合规提示块永不渲染。一体机端是硬编假文案（`apps/kiosk/src/services/api/httpAdapter.ts:218`），小程序刻意不跟 |
| B | **`/job-fairs/:id/map` 的 `booths` 硬编码空数组** | `services/api/src/jobs/jobs-kiosk.service.ts:233, 247` | 导览页「展位明细」区块永远空态 |
| C | **`FairCompany` 七个展示字段录不进去**（`boothNumber` / `zoneId` / `honorTags` / `coverImageUrl` / `founded` / `headquarters` / `registeredCapital`）| schema `schema.prisma:1324-1330` 有列，但 `SaveFairCompanyDto`（`admin-fair.dto.ts:127-160`）不收，Admin 表单也没有；`forbidNonWhitelisted` 会 400 | 企业卡片的「展位 / 展区」与详情页的「成立年份 / 总部 / 注册资本 / 荣誉标签」只能空 |
| D | **Admin 看不到自己在批准的申领条件** —— 后端只读端点存在但前端零调用 | `services/api/src/policies/policies.controller.ts:214`；`apps/admin/src/` 检索 `eligibility-rules` 零命中 | 政策审核是盲批 |
| E | **机构「内容可信」没有后台按钮，且提示文案指向不存在的控件** | 复核了既有文档 [`seed-content-entry-checklist-2026-08.md` §六-A](../operations/seed-content-entry-checklist-2026-08.md) 的结论，本基线仍然成立 | 每次标记都要工程师介入 |

另外两条不阻塞但值得知道：

- **演示数据过滤应用不一致**：`/materials` 与 `/venue-guide` 没套
  `withPublicFairDemoExclusion`（`fair-material.service.ts:247-250`、
  `fair-venue-guide.service.ts:183-186`），而列表 / 详情 / companies / zones / map / stats 套了。
- **`getFairMap` 排除 `category='innovation'` 的展区**（`jobs-kiosk.service.ts:240`）——
  建成「创新展区」的 `FairZone` 会出现在 `/zones` 但不出现在 `/map`。

---

## 七、建完这批内容之后，真机能验到什么、还有什么验不了

### 7.1 能验到（假设 §4.1 + §4.2 全部建齐）

- **会场导览**：展厅列表、展厅内企业与展位号、设施点位（入口 / 服务台 / 打印点 / 咨询台）、
  展区列表、平面图加载与点击预览、本地企业/展位搜索
- **参会企业**：列表、首字母分组、关键词搜索、展区筛选、企业详情、岗位明细、
  「去来源平台」跳转、生成「企业资料」与「岗位清单」两种打印文件
- **活动资料**：列表、类型标签、`wx.downloadFile` 在线预览、2 小时签名 URL 过期后的重试文案、
  `allowPrint=false` 与 `true` 两种资料的按钮差异
- **AI 参会准备单**：上传简历 → 生成 → 优先拜访企业（真实企业名，模型编不出库里没有的）→
  准备清单 / 可咨询问题 / 现场提醒 → 生成打印文件。
  用一场 `endAt` 已过的招聘会还能验到 `review` 模式（「AI参会回顾」）
- **五页的全部空态与错误态**：缺 `fairId`、招聘会已下线（404）、
  未登录点打印、简历任务失效、网络失败重试
- **打印链路的前半段**：生成打印文件 → 跳 `print-upload` → 报价 → PII 扫描 → 走到选门店页

### 7.2 仍然验不了（建内容解决不了的）

| 验不了的 | 为什么 | 需要什么 |
|---|---|---|
| **选门店 → 下单 → 出纸** | `/terminals/public` 要求 5 分钟内真实心跳（§2.5），没有终端时列表恒空，`toPay` 按钮点了只 toast | 一台真实 Windows 一体机 + Terminal Agent 在线 |
| **企业详情的合规提示** | 后端不下发 `applyNote`（§六-A）| 后端补字段，或产品改口径 |
| **导览页「展位明细」** | 后端硬编码 `booths: []`（§六-B）| 后端实现该数据面 |
| **企业卡片的展位号 / 展区名，详情页的成立年份等四项** | DTO 不收（§六-C）| 补后端 DTO + Admin 表单 |
| **AI 长任务的真实耗时与超时行为** | 生产探测未测（EV-009 已注明）；`aiTimeout` 是 90s，而公开只读端点已经要 2–4s | 真机跑一次带真实简历的生成 |
| **`downloadFile` 合法域名配置** | 小程序后台的域名白名单未验（EV-009 已注明）| 微信小程序管理后台配置 + 真机验证 |
| **支付链路** | 本次未查证 | 单独排期 |

### 7.3 一句话判断

> 建完 §4 的最小集，**招聘会现场助手五个页面的信息展示与 AI 生成能被完整验证一次**，
> 打印链路能验到「生成文件 → 报价 → 选门店」为止。
> **出纸、以及 §六 列的五个字段级缺口，都不是建内容能解决的** ——
> 前者要真实终端与 Agent，后者要改代码。

---

## 八、取证依据

基线 `claude/miniapp-lane@242b060c8`（工作区干净，无未提交改动）。

**后端**
- 公开可见性：`services/api/src/jobs/jobs-kiosk.service.ts`、`jobs-shared.ts:702-720`
- 发布闸门：`services/api/src/common/content-trust.ts`、`services/api/src/common/publish-completeness.ts`
- 审核发布：`services/api/src/jobs/jobs-admin.service.ts:147-226`
- 录入能力矩阵：`services/api/src/jobs/partner-capabilities.ts`
- 招聘会导入：`services/api/src/jobs/jobs-partner.service.ts:445-527`
- 现场子数据：`services/api/src/jobs/admin-fairs.controller.ts`、`fair-material.service.ts`、
  `fair-venue-guide.service.ts`、`fair-company-zone.service.ts`、`fair-company-print.service.ts`、
  `fair-material-print-bridge.service.ts`
- DTO 约束：`services/api/src/jobs/dto/admin-fair.dto.ts`、`dto/venue-guide.dto.ts`
- AI 准备单：`services/api/src/ai/resume/fair-visit-plan.service.ts`、`llm-fair-visit-plan.service.ts`
- 终端：`services/api/src/terminals/terminals-admin.service.ts:757-783`、
  `terminals.controller.ts:102-107`、`services/api/src/config/production-runtime-gates.ts:243-246`
- 政策条件：`services/api/src/policies/policy-eligibility.service.ts`、
  `policy-eligibility.engine.ts`、`policy-eligibility.types.ts`、`policies.controller.ts`
- 数据模型：`services/api/prisma/schema.prisma`（`Organization` / `JobFair` / `FairCompany` /
  `FairCompanyPosition` / `FairZone` / `FairMaterial` / `FairVenueGuide` / `FairVenueHall` /
  `FairVenueHallCompany` / `FairVenueFacility` / `Terminal` / `PolicyPost` / `PolicyEligibilityRule`）

**前端**
- 小程序：`apps/miniapp/app.json:19-24`、`pages/fair-{detail,venue,companies,company-detail,materials,visit-plan}/`、
  `pages/{print-upload,print-store,print-pay,policy-check}/`、`utils/api.js`、`utils/normalize.js:705-745`
- 管理员后台：`apps/admin/src/routes/{fairs,fair-sources,policy-sources,terminals}/`
- 合作机构后台：`apps/partner/src/routes/{fairs,policy}/`
- 类型契约：`packages/shared/src/types/fairDto.ts`

**既有文档（本文引用，不重复其内容）**
- [`docs/operations/seed-content-entry-checklist-2026-08.md`](../operations/seed-content-entry-checklist-2026-08.md)
  —— 政策与招聘会本体的录入清单
- [`docs/reviews/empty-catalogs-root-cause-2026-08-16.md`](../reviews/empty-catalogs-root-cause-2026-08-16.md)
  —— 空库根因分析，含 `EXCLUDE_DEMO_PUBLIC_DATA` 生产取值待核实
- [`docs/delivery/miniapp-fair-onsite-2026-09/evidence/EV-009-real-backend-readonly-probe.md`](../delivery/miniapp-fair-onsite-2026-09/evidence/EV-009-real-backend-readonly-probe.md)
  —— 本文的起因

**本文没有查证的**：生产环境 `EXCLUDE_DEMO_PUBLIC_DATA` 与
`TERMINAL_PLANNED_PROVISIONING_ENABLED` 的实际取值（需向运维确认）；
支付链路；小程序后台的 `downloadFile` 合法域名配置。
