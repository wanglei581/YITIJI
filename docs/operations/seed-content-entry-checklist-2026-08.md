# 上线种子内容录入清单：30 条政策 + 20 场招聘会

> **这份文件写给准备真实内容的人（运营 + 数据负责人），不是写给工程师的。**
> 它回答四个问题：每条记录要填什么、录之前必须先做什么、照着哪张表准备、录完怎么确认真的上屏了。
>
> **配套阅读**：通用链路（六种接入方式、审核发布状态机、失败提示速查）见
> [content-ingestion-operator-guide.md](content-ingestion-operator-guide.md)。
> 本文不重复那份手册，只写「政策 / 招聘会种子数据」这一件事里跟它**不一样**的部分。
> 授权与生产写入纪律见 [production-content-data-replacement-list-2026-08.md](production-content-data-replacement-list-2026-08.md)。
>
> **取证基线**：`origin/main@a26eae3ca`（2026-08-18）。本文每条字段结论都来自该基线源码，
> 不来自记忆或旧文档。本文**没有**新增或修改任何代码。
>
> **本文不提供任何真实政策或招聘会内容。** 第三节的示范行全部是**结构示例**，
> 已逐格标注「示例·需替换」。项目红线：没有真实数据时留空并说明，不得伪造
> 政策名称、发文字号、金额、日期或链接。

---

## 为什么是政策和招聘会，不是岗位

三个信息库现在都是空的。先录这两类，是因为它们能**干净地**通过刚上线的两道发布闸门：

- 政策和招聘会都是**公开信息**，有官方来源，授权链条清楚。
- 「线下公司岗位」卡在两个地方：一是法务对无人力资源服务许可证下展示线下岗位的口径，
  二是岗位的 `sourceUrl` 必填且必须是求职者能打开并完成投递的真实地址（见操作手册第二节），
  纯线下岗位本就不该进岗位库。

所以本轮范围**只有**政策和招聘会。不要顺手补岗位。

---

## 零、一句话先说：政策和招聘会的发布闸门不一样

这是本文最容易被想当然搞错的地方。**运营常见误解是「三类内容要求一样」，实际不一样。**

| | 招聘会 | 政策 |
|---|---|---|
| 闸门①：来源机构内容可信 | ✅ 要过 | ✅ 要过 |
| 闸门②：来源可追溯字段完整 | ✅ **要过** | ❌ **不跑** |
| 来源链接（`sourceUrl` / `externalUrl`） | **必填，必须 http/https 开头** | **可空**，不影响发布 |
| 外部ID（`externalId`） | **必填**（后台自动生成） | **可空**；且后台没有输入框（见下 §6-B） |

**代码依据（`origin/main`）：**

- 招聘会发布 `services/api/src/jobs/jobs-admin.service.ts:192-210` —— 两个断言都调：
  ```ts
  await assertOrgContentTrustActive(..., { contentType: '招聘会', contentId: id })
  assertPublishFieldsComplete('招聘会', fair as ..., FAIR_PUBLISH_REQUIRED_FIELDS)
  ```
- 政策发布 `services/api/src/policies/policies.service.ts:293-311`（`publishPolicy`）—— **只调第一个**：
  ```ts
  await assertOrgContentTrustActive(..., { contentType: '政策内容', contentId: id })
  ```
  没有 `assertPublishFieldsComplete` 调用，`PolicyPost` 也不在
  `services/api/src/common/publish-completeness.ts` 的字段表里（该文件只定义
  `JOB_PUBLISH_REQUIRED_FIELDS` 和 `FAIR_PUBLISH_REQUIRED_FIELDS`）。

**这不是漏了，是刻意的**（理由见操作手册第四节）：政策的官方入口链接经常真的不存在——
很多地方政策只有红头文件，没有可跳转的网页；发文字号也不是每条都有。
`PolicyPost.externalId` 的 schema 注释写明：留空时按「来源未提供编号」处理，**不得伪造**。

> **实践口径：政策的链接和编号，有就填，没有就留空。留空能发布。**
> **招聘会的来源链接没有就不要录**——它是求职者「去来源平台预约 / 扫码预约」要打开的地址，
> 缺了这条招聘会对求职者是死的，闸门也会在发布那一刻拒绝。

---

## 一、录之前必须先做的事（漏了这步，30 条政策一条都发不出去）

### 1.1 建来源机构

- 在哪：**管理员后台 → 合作机构**（URL `/partners`，文件 `apps/admin/src/routes/partners/index.tsx`）
- 接口：`POST /api/v1/admin/orgs`（仅 admin）
- 机构类型 `type` 白名单（`services/api/src/orgs/dto/admin-org.dto.ts:25-31`）：

| type 取值 | 显示名 | 能录政策？ | 能录招聘会？ |
|---|---|---|---|
| `public_employment_service` | 公共就业服务机构 | ✅ | ✅ |
| `school_employment_center` | 高校就业中心 | ✅ | ✅ |
| `fair_organizer` | 招聘会主办方 | ❌ | ✅ |
| `licensed_hr_agency` | 持证人力资源机构 | ❌ | ❌ |
| `enterprise_source` | 企业数据来源 | ❌ | ❌ |

政策的类型限制在 `services/api/src/policies/policies.service.ts:349`
（`POLICY_CAPABLE_ORG_TYPES`），违反时报
`仅公共就业服务机构与高校就业中心可发布政策内容`。
招聘会的在 `services/api/src/jobs/partner-capabilities.ts` 的 `canImportFairs`。

> **强烈建议：本轮尽量把 30 条政策 + 20 场招聘会挂在同一个
> `public_employment_service` 或 `school_employment_center` 机构下。**
> 这两类机构两样都能录。理由不是省事，是下面 1.2 那一步**没有后台按钮**——
> 每多一个来源机构，就要多请工程师做一次手工标记。
> 如果 20 场招聘会确实来自不同主办方，就按真实主办方建机构，不要为了省事把来源写错。

### 1.2 把机构标记为「内容可信」——⚠️ 这一步目前没有后台按钮

**规则**：机构必须 `contentTrustStatus === 'active'` 且未归档（`archivedAt` 为空），
否则内容能录进来、能审核通过，但点「发布」必失败。fail-closed：
未标记（null）、`pending`、`suspended`、`revoked`、机构不存在，一律拒绝。

**现状（已对 `origin/main` 逐一取证）：管理员后台没有任何标记内容可信的界面。**

- `apps/admin/src/routes/partners/` 全目录检索 `trust` / `信任` / `可信` —— **零命中**。
- 全 `apps/` 检索 `contentTrust` 只命中两处，都只是**展示**批量发布被排除的条数，
  不能设置：`apps/admin/src/routes/components/BulkPublishButton.tsx:341-343`、
  `apps/admin/src/services/api/bulkPublish.ts:62`。
- 而 `BulkPublishButton.tsx:343` 的提示文案写的是「再到『合作机构』把该机构标记为内容可信」——
  **它指向的那个页面上并没有这个控件。**

所以实际只有两条路，**都需要工程师执行**：

**路径 A：调接口**（单个机构，推荐）

```
PATCH /api/v1/admin/orgs/:id/content-trust
Body: { "status": "active", "reason": "<核验依据>" }
```
仅 admin 角色。`status` 取值 `pending / active / suspended / revoked`
（`services/api/src/orgs/admin-org-content-trust.service.ts:29`）。
标 `active` 时 `reason` **必填**，否则报 `CONTENT_TRUST_REASON_REQUIRED`。
已归档机构标 `active` 会被拒（`ORG_ARCHIVED`）。
读当前状态：`GET /api/v1/admin/orgs/:id/content-trust`。

**路径 B：回填脚本**（多个机构一次标）

```
pnpm --filter @ai-job-print/api maintenance:backfill-org-content-trust \
  -- --ids=<org-id-1>,<org-id-2> --reason="<核验依据>" --actor=<真实 User.id>
# 确认输出无误后，再加 --apply 才真正写库
```
默认 dry-run，只打印改前/改后。**故意没有「全部一键 active」开关**。
任何一条被拒，整个进程退出码为 1。
（`services/api/scripts/backfill-org-content-trust.ts`）

**`reason` 该写什么。** 它会原样进 AuditLog，是事后「凭什么信这家机构」的唯一书面依据。
写**可核对的凭据标识**，不要写感想：

- ✅ 合作协议编号 / 授权书编号 + 签署日期
- ✅ 官方公开数据许可的出处（哪个政府网站的哪个公开栏目、哪份公告）
- ✅ 对方主体资质证明的文件名或编号
- ❌ 「已确认」「没问题」「内部沟通过」——事后无法核对，等于没写

**前置**：`reason` 不是填了就完事，它对应的**来源授权核验必须真的做过**——
确认这家机构确实有权把这些政策 / 招聘会信息交给我们展示。这道闸门是 2026-08-17
「5 条未授权第三方岗位进生产公网」事故之后加的，把它当填空题会让闸门失效。

### 1.3 建一个 partner 账号

政策和招聘会的录入端点都是 `@Roles('partner')`，**管理员账号录不了**：

- 政策：`POST /api/v1/partner/policies`
- 招聘会：`POST /api/v1/partner/fairs/import`

管理员后台**没有**「新增政策 / 新增招聘会」入口（已核：
`admin-fairs.controller.ts` 只有 `GET /admin/fairs` 与 `PATCH /admin/fairs/:id`，无 create）。
所以必须在 **管理员后台 → 合作机构 → 该机构 → 账号** 下建一个 partner 账号，
用它登录合作机构后台录入。

### 1.4 前置检查清单

录第一条之前，逐项打勾：

- [ ] 来源机构已建，`type` 是 `public_employment_service` 或 `school_employment_center`（政策必需）
- [ ] 已完成来源授权核验，拿到可写进 `reason` 的凭据标识
- [ ] 机构 `contentTrustStatus = active` 且未归档（`GET /admin/orgs/:id/content-trust` 确认）
- [ ] 该机构下已有可登录的 partner 账号
- [ ] 30 条政策 / 20 场招聘会的**真实内容**已备齐（见第三节表格），没有占位符

---

## 二、每条记录要填什么

### 2.1 政策（PolicyPost）

录入页：**合作机构后台 → 政策公告**（URL `/policy`，文件 `apps/partner/src/routes/policy/index.tsx`），
右上角「新增政策内容」。

| 字段 | 表单标签 | 必填 | 取值 / 格式 | 谁填 |
|---|---|---|---|---|
| `kind` | 内容类型 | ✅ | `policy_guide`（政策扶持条目）/ `notice`（政策公告） | 运营选 |
| `title` | 标题 | ✅ | 文本，≤200 字符 | 运营 |
| `audience` | 适用人群 | `kind=policy_guide` 时 ✅ | 见下方取值表 | 运营选 |
| `category` | 公告标签 | `kind=notice` 时 ✅ | `policy` / `announcement` / `notice` / `recruitment` | 运营选 |
| `summary` | 摘要（一体机列表展示） | 选填 | ≤500 字符 | 运营 |
| `content` | 正文 | 选填 | ≤10000 字符 | 运营 |
| `externalUrl` | 政策来源 / 办理链接 | 选填 | ≤500 字符，建议 http/https 开头 | 运营 |
| `publishedDate` | 展示日期 | 选填 | `YYYY-MM-DD` | 运营 |
| `externalId` | —— | 选填 | ≤120 字符 | ⚠️ **后台无输入框**，见 §6-B |
| `sourceOrgId` | —— | 自动 | 取登录账号所属机构 id | 系统 |
| `sourceName` | —— | 自动 | 取该机构名称 | 系统 |
| `syncTime` | —— | 自动 | 录入 / 修改时间 | 系统 |

`audience` 取值（`services/api/src/policies/dto/policy.dto.ts:29`，中文名取自
`apps/partner/src/routes/policy/index.tsx:20`）：

| 取值 | 中文 |
|---|---|
| `graduate` | 应届高校毕业生 |
| `flexible` | 灵活就业人员 |
| `migrant` | 返乡务工人员 |
| `hardship` | 困难群体就业援助 |
| `startup` | 创业扶持 |
| `general` | 通用 |

**两条会直接报错的规则**（`policies.service.ts:368-374`）：
`policy_guide` 不选适用人群 → `政策扶持条目必须选择适用人群`；
`notice` 不选公告标签 → `政策公告必须选择公告标签`。

**合规**：政策是 info-only —— 只写政策说明、材料清单、办理指引和官方入口。
**不得**出现「代申请」「包办理」「补贴保证到账」这类承诺性表述。

**结构化申领条件**（`PolicyEligibilityRule`）是**可选**的，不影响发布。
本轮 30 条种子数据**建议先不配**：它要求逐条摘录政策原文作为判定依据
（`sourceText` 必填且一字不改），工作量远大于录入本身。先把内容上屏，条件核对单独排期。

### 2.2 招聘会（JobFair）

录入页：**合作机构后台 → 招聘会信息管理**（URL `/fairs`，文件
`apps/partner/src/routes/fairs/index.tsx`），右上角「新增招聘会」。

> 注：后台「新增招聘会」实际调的是批量导入端点 `POST /api/v1/partner/fairs/import`，
> 单条也走 `items: [...]`。**没有**单独的「创建招聘会」端点。

| 字段 | 表单标签 | 必填 | 取值 / 格式 | 谁填 |
|---|---|---|---|---|
| `title` | 招聘会名称 | ✅ | 文本，≤200 字符 | 运营 |
| `theme` | 主题类型 | 选填 | `general` / `campus` / `campus_corp` / `industry`，默认 `general` | 运营选 |
| `startAt` | 开始时间 | ✅ | ISO 8601 日期时间 | 运营 |
| `endAt` | 结束时间 | ✅ | ISO 8601，**必须晚于 `startAt`** | 运营 |
| `venue` | 举办场馆 | ✅ | 文本，≤200 字符 | 运营 |
| `city` | 城市 | ✅ | 文本，≤100 字符 | 运营 |
| `address` | 详细地址 | 选填 | ≤500 字符 | 运营 |
| `sourceUrl` | 来源平台预约链接 | ✅ | **必须 http/https 开头**，≤500 字符 | 运营 |
| `checkinUrl` | 来源平台签到链接 | 选填 | ≤500 字符 | 运营 |
| `description` | 简介 | 选填 | ≤5000 字符 | 运营 |
| `externalId` | —— | ✅（自动） | 页面生成 `MANUAL-<时间戳>-<随机>` | 系统（前端） |
| `sourceOrgId` / `sourceName` / `syncTime` | —— | 自动 | 取登录机构与当前时间 | 系统 |

**两条会直接报错的规则**（`services/api/src/jobs/jobs-partner.service.ts:459-468`）：
时间解析不了 → `INVALID_DATETIME`；`endAt <= startAt` → `INVALID_DATE_RANGE`。

**`externalId` 不要手改。** 页面自动生成的 `MANUAL-…` 含义是「本机构手工台账第 N 条」，
不声称来自任何第三方系统——这是诚实的。**绝对不要**手填一个看起来像其他平台编号的值，
那等于宣称这条数据来自那个平台。（生成位置 `apps/partner/src/routes/fairs/index.tsx:197`。
注意：这个生成器在**前端**，任何绕过后台直接调接口的客户端必须自己提供 `externalId`。）

**`sourceUrl` 是最容易出事的一格。** 它的定义是：求职者在一体机上点
「去来源平台预约」时会打开的那个地址。判据只有一条——**求职者打开它之后，
真的能看到这场招聘会并完成预约吗？**

合法填法（按优先级）：① 主办方官网该场次的页面；② 该场次在官方 / 第三方平台的公开链接；
③ 本机构自己的公开公示页（人才市场官网、公众号推文等，且页面上真的有这场招聘会）。

绝对不可以：填主办方首页凑数、填不含该场次的页面、填占位域名、填内网地址。
**三种都没有的，这场招聘会本轮就不要录。**

**表单未暴露的字段**：`mapImageUrl`、`coverImageUrl`、`companyCount`、`jobCount`
接口收但后台表单没有。本轮不需要，不要为它们绕接口。

**已结束的场次不要录。** 已结束（`endAt < 现在`）的招聘会会被批量发布排除
（`bulk-publish-expiry.ts` → `buildFairStatusWhere('ended')`），
且前台仍会展示（只是排在最后，见第五节）。录进去只会制造过期内容。

---

## 三、待录清单模板

把下面两张表复制成表格文件填写。**先填满、逐条核对来源，再开始录**——
一边查一边录最容易把「还没核实的」当成「已核实的」录进去。

### 3.1 政策待录清单（目标 30 条）

列即必填 / 建议填字段。`externalId`（发文字号）列**保留但暂不可录**，原因见 §6-B。

| # | kind 内容类型 | title 标题 | audience 适用人群 | category 公告标签 | summary 摘要 | content 正文 | externalUrl 官方链接 | publishedDate 展示日期 | 〔备查〕发文字号 | 〔备查〕来源出处 |
|---|---|---|---|---|---|---|---|---|---|---|
| 示例1 | `policy_guide` | 〈示例·需替换〉高校毕业生一次性求职创业补贴申领指引 | `graduate` | （不填） | 〈示例·需替换〉一句话说明补贴对象与办理渠道；原文没写的金额不要自己加 | 〈示例·需替换〉照抄官方原文的申领条件、材料清单、办理流程 | 〈示例·需替换：官方原文页面 URL，http/https 开头；无网页原文则留空〉 | 〈示例·需替换：官方发文日期 YYYY-MM-DD；不确定则留空〉 | 〈示例·需替换：原文发文字号；没有就留空，不要编〉 | 〈示例·需替换：哪个官网哪个栏目 / 哪份文件〉 |
| 示例2 | `policy_guide` | 〈示例·需替换〉灵活就业人员社会保险补贴办理指引 | `flexible` | （不填） | 〈示例·需替换〉 | 〈示例·需替换〉 | 〈示例·需替换，无则留空〉 | 〈示例·需替换，无则留空〉 | 〈示例·需替换，无则留空〉 | 〈示例·需替换〉 |
| 示例3 | `notice` | 〈示例·需替换〉XX 年度就业服务经办渠道调整公告 | （不填） | `announcement` | 〈示例·需替换〉 | 〈示例·需替换〉 | 〈示例·需替换，无则留空〉 | 〈示例·需替换，无则留空〉 | 〈示例·需替换，无则留空〉 | 〈示例·需替换〉 |
| 4 … 30 | | | | | | | | | | |

**上面三行是结构示例，全部需替换为真实内容。** 标题里的政策名称是**典型结构举例**
（「〈地区〉+〈人群〉+〈事项〉+ 指引 / 公告」），不是真实存在的某条政策；
所有 URL、日期、发文字号一律留作占位，**未经核实不得填入系统**。

填表要点：

- `kind` 二选一：讲**能领什么、怎么办**的写 `policy_guide`；讲**通知、公告、办事变更**的写 `notice`。
- `policy_guide` 行必须有 `audience`，`notice` 行必须有 `category`，另一列留空。
- 最后两列（发文字号、来源出处）**不进系统**，是给审核人核对用的备查列。
  发文字号目前录不进去（§6-B），但必须在表里留痕——否则将来补上输入框时无从追溯。
- 摘要会显示在一体机列表页，正文在详情页。摘要写不出来说明这条政策还没读透。

### 3.2 招聘会待录清单（目标 20 场）

| # | title 招聘会名称 | theme 主题 | startAt 开始时间 | endAt 结束时间 | venue 举办场馆 | city 城市 | address 详细地址 | sourceUrl 来源预约链接 | checkinUrl 签到链接 | description 简介 | 〔备查〕主办方 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 示例1 | 〈示例·需替换〉XX 市春季人才交流会 | `general` | 〈示例·需替换：YYYY-MM-DDTHH:mm，须晚于当前时间〉 | 〈示例·需替换：须晚于开始时间〉 | 〈示例·需替换：公开场馆全称〉 | 〈示例·需替换〉 | 〈示例·需替换〉 | 〈示例·需替换：主办方官网该场次页面 URL，必填，http/https 开头〉 | 〈示例·需替换，无则留空〉 | 〈示例·需替换〉 | 〈示例·需替换：真实主办单位〉 |
| 示例2 | 〈示例·需替换〉XX 学院 XX 届毕业生校园双选会 | `campus` | 〈示例·需替换〉 | 〈示例·需替换〉 | 〈示例·需替换〉 | 〈示例·需替换〉 | 〈示例·需替换〉 | 〈示例·需替换，必填〉 | 〈示例·需替换，无则留空〉 | 〈示例·需替换〉 | 〈示例·需替换〉 |
| 3 … 20 | | | | | | | | | | | |

**同样是结构示例，全部需替换。** 招聘会名称给的是典型命名结构，不指向任何真实场次。
`sourceUrl` 一格**不给示例 URL**，因为一个能打开却不含该场次的链接，
比留空危险得多——留空发布时会被拦下，填错则会一路上屏。

填表要点：

- `theme`：`general` 综合场；`campus` 校园双选 / 宣讲；`campus_corp` 校企专场；`industry` 行业专场。拿不准填 `general`。
- 时间建议带时区，至少精确到分钟。**只录尚未结束的场次。**
- 每一行的 `sourceUrl` 都要**实际点开验证一次**再写进表里。

---

## 四、用哪种方式录：**手动录入（manual），两类都用它**

六种接入方式（`api` / `excel` / `csv` / `webhook` / `manual` / `json`）里，
本轮 30+20 条的场景，**明确推荐 `manual` 手动录入**。理由按重要性排：

1. **政策根本没有第二个选项。** 政策条目不在数据源体系里——`PolicyPost` 没有数据源外键，
   Excel / CSV / API / Webhook 四种方式对政策全部**不适用**。
   如果招聘会走 Excel，就等于同一批种子数据要跑两套完全不同的流程、两套排错方式。
   统一走 `manual`，运营只需要学一遍。
2. **20 场招聘会摊不平 Excel 的前置成本。** Excel / CSV 路径要先建数据源、
   再配字段映射、再上传预览确认。这套开销是为成百上千行准备的，20 行不值得。
3. **Excel 有一个已实测的坑，正好会咬到这批数据。** 来源链接是**空单元格但列存在且被映射**时，
   可能一路导入成功，直到点「发布」才被拒（`缺少必填字段:来源链接`）。
   手动录入时这一格是表单必填项，当场就挡住了。
4. **手动录入的 `externalId` 是系统生成的，不会填错。** Excel 路径要求运营自己提供
   `externalId`，而这个字段一旦填成像第三方平台编号的样子，就是伪造来源。
5. **其余三种方式对本场景不可用或不该用：**
   - `json`：**只有壳，没有解析器**。上传 `.json` 会被拒
     （`文件格式不受支持：当前仅支持 .xlsx 与 .csv`）。不要用。
   - `api`：**半通**——落库半段实测通过，但「真能从第三方公网接口拉到数据」本机判别不了；
     且需要对方提供公网 JSON 接口 + 管理员启用。本轮没有这个对接对象。
   - `webhook`：**只收岗位**，推招聘会字段会被 DTO 白名单 400 拒收；政策同样不支持。
   - `csv`：能力上可行（控制台入口已补），但优势只在批量，见理由 2。

> **结论：30 条政策走合作机构后台「政策公告 → 新增政策内容」，
> 20 场招聘会走合作机构后台「招聘会信息管理 → 新增招聘会」，都是逐条手工录。**
> 录完统一交管理员在「政策信息源」/「招聘会信息源」审核 + 发布。

**如果将来招聘会规模涨到上百场**，再切 Excel / CSV，届时字段映射规则会被记住、可复用。
本轮不要为了「将来可能用得上」先建数据源。

---

## 五、录完怎么验

### 5.1 关键前提：发布 = 前台可见，没有第二道隐藏条件

**已对 `origin/main` 取证**：政策和招聘会的**公开读取路径不校验机构内容可信状态**。

- 政策 `services/api/src/policies/policies.service.ts:107-113`：`where` 只有
  `reviewStatus: 'approved'` + `publishStatus: 'published'` + 可选的 kind/audience/category。
- 招聘会 `services/api/src/jobs/jobs-kiosk.service.ts:139-142`：同样只有这两个条件
  （外面包的 `withPublicFairDemoExclusion` 是**演示数据排除**，不是信任过滤，
  且默认不生效——只在 `EXCLUDE_DEMO_PUBLIC_DATA === 'true'` 时启用）。

所以：**`已通过` + `已发布` 就是前台可见的充分必要条件。**
不存在「发布成功但因为机构信任问题前台看不到」这种情况。
内容信任只在**发布那一刻**卡一次。

> 反过来的风险要知道：机构在内容发布**之后**被改成 `suspended` / `revoked` / 归档，
> **已发布内容不会自动下架**，仍然公开可见，必须人工点「下架」。

### 5.2 逐条验：两个匿名接口（无需登录）

API 前缀 `/api/v1`。这两个端点没有任何鉴权守卫，浏览器直接开也行。

**政策：**
```
GET /api/v1/policies?pageSize=200
```
- 看 `pagination.total` 是不是等于你发布的条数。
- `kind` / `audience` / `category` 可筛，但**服务端不校验取值**——拼错不会报错，
  会安静返回 0 条。查不到时先确认参数没拼错。
- **没有政策详情端点**（`GET /policies/:id` 不存在），列表返回全部字段。

**招聘会：**
```
GET /api/v1/job-fairs?pageSize=100&keyword=<招聘会名称片段>
GET /api/v1/job-fairs/:id/detail
```
- `keyword` 是服务端在 `title / sourceName / venue / city / description` 上的模糊匹配。
- `status` 可填 `upcoming` / `ongoing` / `ended`；填别的会被**静默忽略**（等于不筛）。
- `pageSize` 上限 100。

### 5.3 上机验：一体机前台

| 内容 | 前台路径 | 页面文件 |
|---|---|---|
| 政策扶持条目（`policy_guide`） | `/renshi` 或 `/renshi?tab=policy` | `apps/kiosk/src/pages/renshi/RenshiPage.tsx` |
| 政策公告（`notice`） | `/renshi?tab=notice` | 同上 |
| 招聘会列表 | `/job-fairs` | `apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx` |
| 招聘会详情 | `/job-fairs/:id` | `JobFairDetailPage.tsx` |

> ✅ **验政策直接看 `?tab=policy` 就行**（2026-08-18 起，见下方问题 C 的「已修」标注）。
> 该页现在分两个区：上面是「**政策库**」，标题行直接写着条数
> （合作机构发布 · 管理员审核后展示 · N 条），一条都没进来时显示
> 「**政策库还没有内容**」空态；下面是「通用办事指引」，标注
> **本机整理参考 · 不属于政策库**，不计入政策库条数。
> **所以「政策库 N 条」这个数就是验收数**，和 5.2 接口的
> `pagination.total`（政策 + 公告合计）对得上即可。
> 旧口径（改看 `?tab=notice` 绕开混排）不再需要，但仍然有效。

### 5.4 怎么确认没有一条「发布了但前台看不到」

因为 5.1 已证明发布即可见，这类问题只会来自**计数对不上**，逐项对：

1. **管理员后台点数**：`/policy-sources` 与 `/fair-sources`，筛选「已通过」+「已发布」，记下条数。
2. **接口点数**：`GET /api/v1/policies?pageSize=200` 的 `pagination.total`；
   `GET /api/v1/job-fairs?pageSize=100` 的 `pagination.total`。
3. **两个数必须相等。** 不等的话按下面三条查：

| 症状 | 真正原因 | 处理 |
|---|---|---|
| 后台显示已发布，接口 total 少 | 大概率是**审核状态不是 approved**（只发布没审核过不可能，但机构侧编辑过会打回 pending+draft 并**自动撤下**） | 重新审核 + 发布 |
| 政策接口 total 对，但一体机列表条数更多 | ~~`?tab=policy` 混入了内置指引~~（2026-08-18 已修：内置指引独立分区、不计入政策库条数） | 直接看政策库分区标题上的条数 |
| 招聘会接口 total 对，一体机可见的更少 | 前台在取回的 100 条里**再做本地筛选**（地区 / 收藏 / 状态），且列表页只取 `pageSize: 100` | 清掉前台筛选条件重看 |

4. **过期检查**：已结束的招聘会**不会被前台隐藏**，只是排到最后
   （`jobs-shared.ts:100-132` 始终同时输出未结束和已结束两个桶），
   详情页更是永久可开（详情端点无任何日期条件）。
   所以录完后要确认：20 场里没有 `endAt` 已经早于当天的。
5. **数量上限**：一体机取政策时**不传 `pageSize`**
   （`apps/kiosk/src/services/api/policies.ts:38`），依赖服务端默认值 200。
   30 条远低于上限，安全；但**已发布政策总数一旦超过 200，前台会静默截断**，
   将来扩量前要先处理这一点。

### 5.5 不要在生产上跑的东西

- `verify:content-pipeline-e2e` 等 verify 脚本**会创建 / 删除数据**，
  只能在隔离库跑（`VERIFICATION_DATABASE_TARGET=isolated`），**不得对生产执行**。
- 唯一为真实部署设计的只读盘点是 `probe:recruitment-wave2` /
  `inventory:recruitment-wave2:full`，但它们需要具名授权引用和限时窗口
  （`RECRUITMENT_WAVE2_TARGET=authorized-readonly` 等一组环境变量），
  **不是随手可跑的命令**，须单独授权。
- 日常验收用 5.2 的两个匿名 GET 就够了，零风险。

---

## 六、查证过程中发现的代码问题（**只登记，本轮不修**）

以下均已对 `origin/main@a26eae3ca` 取证。它们不阻塞本轮录入，但会影响运营体验或数据完整性。

**A. 内容可信标记没有后台界面，且提示文案指向了一个不存在的控件。**
`apps/admin/src/routes/partners/` 无任何 trust 控件；全 `apps/` 检索 `contentTrust`
仅命中 `BulkPublishButton.tsx:341-343` 与 `bulkPublish.ts:62`，都只读不写。
而 `BulkPublishButton.tsx:343` 明确提示运营「到『合作机构』把该机构标记为内容可信」——
那个页面上没有这个功能。运营照提示操作会卡死。
**影响**：每次标记都要工程师调接口或跑脚本。**建议**：在合作机构详情页补一个标记入口
（后端 `PATCH /admin/orgs/:id/content-trust` 已就绪，只缺前端）。

**B. `PolicyPost.externalId`（发文字号）录不进去，也不显示。**
后端完整支持：schema 有列、`CreatePolicyPostDto.externalId` 收、`mapPolicy` 回。
但 `apps/partner/src/routes/policy/index.tsx:56-65` 的 `PolicyFormState`
**没有 externalId 字段**，Admin `policy-sources` 页也检索不到。
所以走控制台录入的政策，该字段**永远是 null**。
更进一步：schema 注释要求「消费方按 null 展示『来源未提供编号』」，
但全仓检索 `来源未提供编号` **只命中 schema 与 migration 注释，没有任何前端消费方**——
即这条兜底展示也没实现。
**影响**：CLAUDE.md §10 要求外部来源数据展示「外部ID」，政策这一项目前无法满足。
**建议**：补 Partner 表单输入框 + 前台 null 兜底文案。本轮先用第三节的备查列留痕。

**C. ~~`/renshi?tab=policy` 把后端数据和内置硬编码指引合并展示。~~ ✅ 已修（2026-08-18，PR #708）。**
原问题：`RenshiPage.tsx:69-70` 合并两者，政策库为空时页面看起来也是满的，
既与 CLAUDE.md §9「不伪造能力」相冲突，也让验收失去判别力。
**补充发现**：该页当时**根本没有可达空态**——空态挂在 `visible.length === 0` 上，
而内置指引里有一条 `audiences` 含 `'general'`，对任何身份筛选都命中，那条分支永远走不到。
**修法**：两个分区分开渲染（`data-policy-section=library|builtin`），
政策库有独立空态并区分「库里没有」与「被身份筛掉」；内置指引保留但明确标注非政策库内容。
**闸门**：`verify:renshi-policy-ui` 的 J1（AST，禁止再合并）/ K，
加 `fusion-w4.spec.ts` 两条浏览器断言（空库时政策库 0 卡 + 空态文案）。

**D. 已结束的招聘会在前台不隐藏，详情页永久可开。**
列表把已结束场次排到最后但仍计入 `pagination.total`（`jobs-shared.ts:100-132`）；
`GET /job-fairs/:id` 和 `/detail` **完全没有日期条件**。
对比：岗位在列表和详情两侧都套了 `jobValidityWhere()`。
**影响**：过期招聘会会长期挂在一体机上。**建议**：明确产品口径——
是排序靠后即可，还是应当过期即隐藏。

> **复核结论（2026-08-18，PR #708 期间）：判定为「不是缺陷」，未改代码。**
> 产品口径定为**显示但标注「已结束」**，不完全隐藏：大厅场景下上周结束的场次是噪音，
> 所以必须沉底 + 明确标注 + 收掉只对活动场次有意义的按钮（现状已经做到：
> `.past` 类降透明度、「已结束」状态 chip、列表整块操作区隐藏、
> 详情页 `!isEnded` 收掉扫码签到与扫码预约、首页高亮位与签到页只取 ongoing/upcoming）；
> 但「找上次那场招聘会的资料」是真实需求，**完全隐藏会让详情页、收藏、浏览记录、
> 二维码里的旧链接集体失效，所以详情端点不应该加日期条件**。
> 与岗位口径不同是刻意的：过期岗位会让人照着去投递（故 `getPublishedJobById`
> 套 `jobValidityWhere()`），招聘会资料是档案。
>
> ⚠️ **同一口径下曾发现一处真实漏网 —— ✅ 已实现（2026-08-18，PR #715，方案 B）。**
> 原问题：「AI参会准备单」全链路对招聘会状态无感——`JobFairDetailPage.tsx` 的
> AI准备单按钮**落在 `!isEnded` 守卫之外**（同一 actionBar 里签到/预约都收了，只有它漏了）、
> `JobFairDetailTabs.tsx` 磁贴只判 `hasManagedData`、`FairVisitPlanPage.tsx` 不取 fair
> 也不读 status、`services/api/src/ai/resume/fair-visit-plan.service.ts` 查询只有
> `approved+published` 没有 `endAt`。净效果：可为已结束场次生成并打印「出发前逐项核对」
> 清单，还付一次 LLM 调用。
>
> **产品裁定取 (B)：不隐藏按钮，改语义** —— 已结束场次产出「参会回顾与后续跟进」。
> 保留 LLM 调用（简历 × 参展企业名册的匹配推理在活动结束后**更有用**，企业仍在招人）；
> 换掉语义已坏的三段（参会前准备清单 / 现场可咨询问题 / 现场提醒）。
> 新增**非 LLM 事实区**「你在本机留下的记录」，只列本机打开过来源投递入口的参展企业，
> **刻意不列签到入口**（打开签到入口 ≠ 到场）；并固定展示诚实声明
> 「本系统不记录你是否到场，也不记录你在现场取得的材料」，屏幕与打印版同文。
> `mode` 由服务端按 `endAt` 判定并盖章入库，读取/打印双路在**渲染之前** fail-closed，
> 旧链接与旧二维码一律拒发。
>
> **运营影响**：验收已结束场次时，AI 入口会显示「AI参会回顾」而不是「AI准备单」，
> 这是预期行为，不是数据没录对。

**E. 公开 `GET /policies` 不校验 `kind` / `audience` / `category` 取值。**
原始字符串直接进 Prisma `where`，拼错安静返回 0 条而非 400。
**影响**：排障时容易误判成「数据没进来」。

**F. `theme` 白名单在 6 处重复硬编码，没有共享常量。**
`import-fairs.dto.ts:32`、`admin-fair.dto.ts:43`、`partner-edit.dto.ts:57`、
`excel-template.ts:63-64`，加上 `fair.types.ts` 与 `packages/shared/src/types/fair.ts`
两个类型联合，以及前端 `apps/partner/src/routes/fairs/index.tsx:42-47`。
**影响**：新增主题时漏改必然漂移。**建议**：收敛到 `packages/shared`。

---

## 七、本文的取证依据

基线 `origin/main@a26eae3ca`（2026-08-18）。结论来源：

- 发布闸门：`services/api/src/common/publish-completeness.ts`、`services/api/src/common/content-trust.ts`
- 招聘会：`services/api/src/jobs/jobs-partner.service.ts`、`jobs-admin.service.ts`、
  `dto/import-fairs.dto.ts`、`jobs-kiosk.service.ts`、`jobs-shared.ts`
- 政策：`services/api/src/policies/policies.service.ts`、`policies.controller.ts`、`dto/policy.dto.ts`
- 机构与信任：`services/api/src/orgs/admin-org-content-trust.service.ts`、
  `dto/admin-org.dto.ts`、`services/api/src/jobs/partner-capabilities.ts`、
  `services/api/scripts/backfill-org-content-trust.ts`
- 前端：`apps/partner/src/routes/{policy,fairs}/index.tsx`、
  `apps/admin/src/routes/{policy-sources,fair-sources,partners}/index.tsx`、
  `apps/kiosk/src/pages/{renshi,job-fairs}/`
- 数据模型：`services/api/prisma/schema.prisma`（`PolicyPost` / `JobFair` / `Organization`）

链路本身已由 `pnpm --filter @ai-job-print/api verify:content-pipeline-e2e`
（117 断言，2026-08-18）证明可通。**本文解决的是「链路通了但库是空的」这一步，不改代码。**
