# 内容链数据关联总账（岗位 / 招聘会 / 政策 / 企业 / 线下机构 / 线上平台）

> 汇总日期：2026-08-11
> 方法：Claude 与 Codex（gpt-5.6-sol / xhigh）**独立审查后合并**，全部读一手代码
> （含 `components/` 子目录与 http/mock 双轨），每条带 `文件:行号`，可复验。
> 明细：[岗位链](./job-chain-field-consistency-2026-08.md) · 招聘会/政策/企业链结论并入本表
> 机构类型覆盖度：[partner-org-type-coverage-2026-08.md](../product/partner-org-type-coverage-2026-08.md)
> 修复方案：[partner-console-integration-plan-2026-08.md](../product/partner-console-integration-plan-2026-08.md)

---

## 一、六类内容健康度

> 2026-08-11 追加：产品所有者指出前端岗位页已加入**线上招聘平台**与**线下招聘公司**，
> 核查后补入本表——它们的问题性质与前四条链不同：**不是字段断裂，是后台压根没有管理入口**。

| 内容 | 主表字段 | 子实体 | Partner 可填 | 问题数 | 健康度 |
| --- | :---: | :---: | :---: | :---: | --- |
| **政策** `PolicyPost` | 20 | 0 | 8（业务字段全覆盖） | **6** | 🟢 **最干净**——但有 1 处合规风险 |
| **企业** `CompanyProfile` | 35 | 2 张关联表 | 20 | **7** | 🟡 结构好，有 2 处硬伤 |
| **岗位** `Job` | 38 | 0 | 手工 9 / Excel 17 | **11** | 🟠 字段断裂多 |
| **招聘会** `JobFair` | 33 | **10 张** | 主表 10，子实体 **0** | **12** | 🔴 **最乱**——唯一同时有伪造/损坏/合规三类问题 |
| **线下招聘机构** `OfflineAgencyProfile` | — | `OfflineAgencyBranch` | **0（无入口）** | **1** | 🟠 Admin 能管、Kiosk 能看、**机构自己管不了** |
| **线上招聘平台** `OnlinePlatformDirectory` | 18 | 0 | **0（无入口）** | **1** | 🔴 **两个后台都没有写入口**，只能靠 seed 或改库 |

**合计 38 条**（去重后）。

### 后两类的性质不同

前四条链的问题是**「字段断裂」**——数据流通了但某一环没接上。
后两类是**「入口缺失」**——前端在展示，后台没有管理面：

| 内容 | 数据归属 | 问题 |
| --- | --- | --- |
| 线下招聘机构 | `Organization.offlineAgencyProfile`（1:1） | **J1**：机构自己的门店档案（地址/营业时间/服务/分支）只能由平台管理员改 —— 与招聘会子实体是同一类**权责错配** |
| 线上招聘平台 | `Organization.onlinePlatformDirectories`（1:N） | **J2**：全局仅 2 处引用（Prisma client + 一处只读 service），**两个后台都无写入口** |

**J2 的修法与 J1 不同**：线上平台目录是**平台向求职者推荐第三方平台**，
推荐权属于平台的编辑责任，**不能让机构自己往目录里加**。
该表的字段本身就带治理意图——`operatorLegalName`、`officialDomainsJson`（官方域名白名单）、
`evidenceFileId`（资质证据）、**`neutralDescription`（中立描述）**。
最后这个命名说明设计上就要求平台保持中立、不做倾向性推荐。

→ **Admin 需新建治理页**（这是 Admin 侧真正需要新增的页面）；
Partner 侧只能「申请收录 / 提交更新」，不能发布、不能改排序。

---

## 二、按问题类型归类（**修复时按类批量做，比按链做高效**）

### A 类 · 伪造与展示不实（7 条）🔴 最高优先

> 共同点：**向用户展示了不真实的信息**，全部撞 CLAUDE.md §9「不伪造能力」。
> **A1–A3 可以一次性统一处理**（都是「来源语义」问题）。

| # | 链 | 问题 | 证据 | 修法 |
| --- | --- | --- | --- | --- |
| **A1** | 岗位 | 「来源类型」硬编码「线上招聘平台」，6 种 `SourceKind` 全显示成一种 | `kiosk/pages/jobs/components/JobDetailSections.tsx:179` | 投影真实 `SourceKind`；取不到显示「未标注」 |
| **A2** | 企业 | 「来源类型」硬编码「第三方来源」 | `kiosk/pages/companies/CompanyDetailPage.tsx:426-437` | 同 A1，**一起改** |
| **A3** | 招聘会 | **`sourceName` 被当成「主办方」展示** —— 来源机构 ≠ 主办方 | `jobs-shared.ts:461-463` → `JobFairDetailTabs.tsx:123-125` | 加独立 `organizer` 字段，或 UI 改标「来源机构」 |
| **A4** | 招聘会 | `tagline`/`onsiteServices`/`admissionMethod` **无数据库来源却在校园页展示** | `packages/shared/src/types/job.ts:84-90` | 补数据源或移除展示 |
| **A5** | 招聘会 | **企业签到状态伪造为「未签到」**——系统无签到实体 | `admin/routes/fairs/components/StatsTab.tsx:45` 自陈无实体 | 不显示该状态，或建签到实体 |
| **A6** | 招聘会 | 公开详情**活动资料数固定为 0** | — | 返回真实计数 |
| **A7** | 招聘会 | `viewCount` **无递增写入**，后台仍称「终端浏览次数」 | — | 真实递增，或改名并标「未接入」 |

### B 类 · 数据损坏（3 条）🔴

> 共同点：**机构的正常编辑操作会破坏数据，且无提示**。B1/B2 是同一个 bug 模式。

| # | 链 | 问题 | 证据 | 修法 |
| --- | --- | --- | --- | --- |
| **B1** | 岗位 | 编辑校招岗位 → `campus` 回填成 `full_time` → 保存写回 `fulltime`，**岗位从校招专区消失** | `partner/routes/jobs/index.tsx:48` | 补 `campus ↔ campus` 双向映射 |
| **B2** | 招聘会 | Excel 复导主题为空 → `campus`/`industry` **降级成 `general`** | `jobs-excel.service.ts:444-449`、`jobs-partner.service.ts:485-490` | 空值保留原值，不覆盖 |
| **B3** | 政策 | 切换 `kind` 不清除另一类的 `audience`/`category`，留矛盾脏字段 | `partner/routes/policy/index.tsx:144-152` | 切换时清理 |

> ⚠️ **B1 在 mock 里测不出来**——`partnerMockAdapter.ts:274` 直接丢弃 workType 修改。

### C 类 · 合规缺口（4 条）🔴

| # | 链 | 问题 | 证据 | 修法 |
| --- | --- | --- | --- | --- |
| **C1** | 政策 | **Admin 审核看不到 `content`（正文）与 `externalUrl`（办理入口）**，而 Kiosk 两者都展示 | `admin/routes/policy-sources/index.tsx:149-193` vs `kiosk/pages/renshi/NoticePanel.tsx:80-95` | 审核抽屉补这两项 |
| **C2** | 政策 | **「官方入口」不校验官方域名**：`externalUrl` 可空、只校验字符串；Kiosk 只要求 http/https | `policies/dto/policy.dto.ts:41-45`、`kiosk/lib/url.ts:5-13` | 校验 URL + HTTPS + **官方域名白名单**（可复用百宝箱已有机制） |
| **C3** | 招聘会 | **合规 4/5**：已结束场次隐藏来源预约入口 | `JobFairDetailPage.tsx:225-240` | 保留入口，标注「本场已结束」 |
| **C4** | 企业 | `sourceUrl` 合规要求必有，**模型却可空** | `schema.prisma:745-750` | 加非空约束或提交校验 |

> **C1 + C2 合起来是本次审查最需要优先堵的口子**：政策正文与办理链接 Admin 看不到、
> URL 不校验官方域名，审核通过后直接展示给求职者并可扫码跳转。政策涉及补贴与社保，是最敏感的内容。

### D 类 · 白填（填了三端不用，5 条）🟠

| # | 链 | 字段 | 证据 |
| --- | --- | --- | --- |
| **D1** | 岗位 | `educationRequirement` / `experienceRequirement` / `benefitsJson` **纯白填**；<br>`skillsJson` 进 AI 上下文、`validThrough` 进质量巡检（**半白填**） | Excel 能填 `excel-template.ts:39-46` → API 返回 `jobs-shared.ts:405` → 三端渲染 **零命中** |
| **D2** | 岗位 | **`headcount` 模型外孤儿**：DTO 接受但 `Job` 无此列，映射固定 `undefined` | `dto/import-jobs.dto.ts:51`、`jobs-shared.ts:397` |
| **D3** | 企业 | `foundedAt` 可录可审，**公开 DTO 无此字段** | `packages/shared/src/types/company.ts:99-123` |
| **D4** | 政策 | 政策扶持类的 `summary` 转换后**从未渲染** | `kiosk/pages/renshi/shared.ts:63-68` |
| **D5** | 招聘会 | `coverImageUrl` 主表白填 | `jobs-shared.ts:457-488` 不返回 |

> **修 D1 的性价比最高**：Kiosk 详情页加一个区块即可，**后端零改动**（数据已在响应体里）。

### E 类 · 断链（数据不通，5 条）🔴

| # | 链 | 问题 | 证据 |
| --- | --- | --- | --- |
| **E1** | 企业 | **企业信息存三张互不关联的表**：`CompanyProfile`（找企业页）/ `FairCompany`（参会企业页，**无 `companyProfileId`**）/ `FairCompanyBooth`（`companyName` 是字符串非外键） | grep `companyProfileId` 在 `FairCompany` **零命中** |
| **E2** | 招聘会 | **`FairCompanyBooth` 除 schema 外全局零引用**（死表）；`/map` 页真实无展位数据——**两套展位链不互通** | `schema.prisma:2513-2523` |
| **E3** | 全部 | `BrowseLog`/`ExternalJumpLog` **无 `sourceOrgId`**，机构效果无法归因 | 两模型字段 |
| **E4** | 企业 | 企业关联岗位**未过滤归档岗位** | `companies.service.ts:113-120,246-255` |
| **E5** | 岗位/招聘会 | 公开查询**未过滤 `archivedAt`** | `jobs-kiosk.service.ts:48,133-136` |

> **E1 的后果**：同一家企业，在「找企业」页和「招聘会参会企业」页显示**两份独立数据**；
> 机构改一处另一处不变，且不会知道。**三处冲突**：展位号两个字段、荣誉三份两种格式、企业名三处各存一份。

### F 类 · 机构看不到 / 管不了（5 条）🟠

| # | 链 | 问题 | 证据 |
| --- | --- | --- | --- |
| **F1** | 岗位 + 招聘会 | **`rejectReason` 不回传**（政策/企业**已回传** ✅） | `jobs-shared.ts:120,514-535` |
| **F2** | 招聘会 | **11 个模型只能管主表**：参展企业/展区展位/活动资料/场馆导览/统计**全归 Admin** | `partner/routes/fairs/index.tsx:362` 自陈 |
| **F3** | 企业 | 4 个展示开关（`showOpenJobCount`/`showCity`/`showEmployeeScale`/`showBoothNo`）**后端 DTO 允许 Partner 传，前端完全没有** | `companies/dto/company.dto.ts:71-82` vs `partnerCompanies.ts:38-59` |
| **F4** | 岗位 | **录入路径字段数不一致**：手工 9 / Excel 17，界面无提示 | `routes/jobs/index.tsx:78-90` |
| **F5** | 招聘会 | **录入路径四套**：手工 10 / Excel 13 / 批量 API 15 / 定时拉取 9 | 四处 DTO |

### G 类 · 隐式约定（3 条）🟡

| # | 链 | 问题 | 证据 |
| --- | --- | --- | --- |
| **G1** | 岗位 | 「行业」不是字段，藏在 `tagsJson` 的 `行业:` 前缀里，Partner 输入框**零提示** | `jobs-shared.ts:232-249` |
| **G2** | 招聘会 | 校园招聘判定依赖**标题/主办方/简介/来源名关键词**——比 G1 更脆弱 | `kiosk/pages/campus/CampusPage.tsx:46-53` |
| **G3** | 政策 | 是否可收藏/上报依赖 ID 以 `builtin-` 开头 | `kiosk/pages/renshi/RenshiPage.tsx:24-33` |

### H 类 · Admin 审核看得比用户少（3 条）🟠

| # | 链 | 看不到什么 |
| --- | --- | --- |
| **H1** | 岗位 | `category`（岗位类型）、`tags`、5 个扩展字段——**求职者能看到类型和标签，审核员看不到** |
| **H2** | 政策 | **`content`（正文）、`externalUrl`（办理入口）**——见 C1，最严重 |
| **H3** | 招聘会 | 城市、地址、交通、地图、预计人数 |

> 企业链**不在此列**——Admin 详情表单覆盖了 Kiosk 展示字段（`CompanyDetailDrawer.tsx:97-121`）。

### I 类 · mock 三端互不相干（4 条链全部）🟡

| 链 | 表现 |
| --- | --- |
| 岗位 | Partner/Admin/Kiosk 三套独立静态数据；Partner mock **丢弃 workType**（B1 因此测不出）；Kiosk mock 详情**不校验审核状态** |
| 招聘会 | **四套**独立集合（Partner / Admin 审核 / Admin 运营 / Kiosk）；mock 新增编辑**丢失 `checkinUrl`** |
| 政策 | 三套独立静态数组 |
| 企业 | Partner/Admin 各自独立内存数组；**Kiosk mock 直接失败** |

> **影响**：本地 mock 走通的流程，**不能证明真实链路可用**。至少要让三端 mock 字段口径与状态语义对齐，
> 或在 mock 模式页面上明示「不跨端联动」。

### J 类 · 入口缺失（前端在展示，后台没有管理面，2 条）🔴

> 与 A–I 九类不同：**不是数据流断了，是压根没有管理入口**。

| # | 内容 | 问题 | 证据 | 修法 |
| --- | --- | --- | --- | --- |
| **J1** | 线下招聘机构 | 机构自己的门店档案（地址/营业时间/服务项目/分支）**只能由平台管理员改** | Admin 有 `AgencyForm`/`JobsDrawer`/`ReviewDialog`；`grep offlineAgency apps/partner/src` **零命中** | 给拥有 `OfflineAgencyProfile` 的机构开放自助维护，走 pending 审核 |
| **J2** | 线上招聘平台 | **两个后台都没有写入口**——全局仅 2 处引用（Prisma client + 一处只读 service） | `OnlinePlatformDirectory` 在 `admin/` `partner/` 下均无命中 | **Admin 新建治理页**（收录/审核/排序/上下架/域名白名单/证据）；Partner 只能申请，不能发布 |

**J1 与 F2（招聘会子实体）是同一类问题**：权责错配——办事的是机构，管数据的是平台。

**J2 不能照 J1 修**：线上平台目录是**平台向求职者推荐第三方平台**，
推荐权属于平台的编辑责任。该表字段本身带治理意图
（`operatorLegalName` / `officialDomainsJson` / `evidenceFileId` / **`neutralDescription`**），
最后一个命名说明设计上就要求平台保持中立。**不能让机构自己往推荐位里加。**

> ⚠️ **J2 的域名白名单与 C2（政策官方入口）是同一类问题**——
> 都决定用户从终端跳到哪里去。**建议合并成一套域名校验机制**（可复用百宝箱已有的白名单）。

---

## 三、修复归属与分期

| 期 | 修什么 | 条数 | 特点 |
| --- | --- | :---: | --- |
| **W0** | **A 类 7 条 + B 类 3 条 + C 类 4 条** | **14** | **全是小改动，但都在展示假信息 / 损坏数据 / 留合规口子**。必须最先做 |
| **W1** | D 类 5 条（尤其 D1，后端零改动）+ H 类 3 条 | 8 | 让已有数据产生价值；审核员看得全 |
| **W2** | E3/E4/E5（归因与过滤）+ `ContentEffectDaily` 聚合表 | 3 | 需 schema 迁移 + 双 CI |
| **W3** | F1/F3/F4/F5（回传与录入一致）+ G 类 3 条 | 7 | 消除机构侧认知落差 |
| **W4** | **E1/E2（企业与展位去重）+ F2（招聘会子实体开放）+ J1（线下机构自管）** | 4 | **需产品先决策**（档案 vs 快照）+ 补 Partner 专属 API |
| **W4b** | **J2 线上平台 Admin 治理页** | 1 | **这是 Admin 侧真正需要新增的页面**；与 C2 合并做域名校验 |
| **随时** | I 类 mock 对齐 | 4 | 独立，可穿插 |

### W0 的 14 条（**建议一个 PR 一类，三个 PR 做完**）

- **PR-1｜来源语义**：A1 + A2 + A3（三条链的来源类型/主办方）
- **PR-2｜数据损坏与合规**：B1 + B2 + B3 + C1 + C2 + C3 + C4（**C2 与 J2 的域名白名单一起设计**）
- **PR-3｜移除伪造展示**：A4 + A5 + A6 + A7

---

## 四、验收方法（每类一条可执行的断言）

| 类 | 验收断言 |
| --- | --- |
| **A** | 构造 6 种 `SourceKind` 的岗位各一条，Kiosk 详情显示**六种不同**的来源类型；招聘会「主办方」与「来源机构」**取值可不同**；无签到实体时**不显示签到状态** |
| **B** | 建一条 `campus` 岗位 → Partner 编辑标题保存 → **`category` 仍为 `campus`**；Excel 复导主题留空 → **原 `theme` 不变** |
| **C** | 政策审核抽屉**能看到正文与办理入口**；提交非 HTTPS / 非白名单域名的 `externalUrl` → **拒绝**；已结束招聘会详情**仍展示来源入口** |
| **D** | Excel 导入含学历/经验/技能/福利的岗位 → **Kiosk 详情四项都能看到** |
| **E** | 改 `CompanyProfile` 简介 → **参会企业页同步变化**（或明确提示不同步）；归档岗位 → **企业详情的在招岗位数减少** |
| **F** | 岗位被驳回 → **Partner 列表能看到驳回原因**；`fair_organizer` 机构**能自己增删参展企业** |
| **G** | Partner 填「互联网」→ **Kiosk 行业行显示「互联网」**（而不是「来源平台未提供」） |
| **H** | Admin 审核抽屉展示的字段集合 **⊇** Kiosk 详情展示的字段集合 |
| **I** | mock 模式下 Partner 新增岗位 → **Admin mock 能看到**（或页面明示不联动） |

---

## 五、给 Codex 的执行提示

1. **按类做，不要按链做**——A1/A2/A3 是同一处理，B1/B2 是同一 bug 模式，一次改完更省。
2. **W0 十四条全是小改动**，但每一条不修都在持续产生错误数据或错误展示。
3. **D1 后端零改动**——数据已在响应体里，只差前端渲染，是投入产出比最高的一条。
4. **E1/F2 需要产品先决策**，不要自行选型：
   - 参会企业的信息，是**企业档案**还是**这场会的快照**？
   - 招聘会子实体开放给主办方后，Admin 还保留哪些权限？
5. **mock 与 HTTP 行为不一致会掩盖 bug**（B1 就是例子）——改任何一条时，同步检查 mock。
6. 每条修复都要能对应到第四节的验收断言，**没有断言的修复不算完成**。
