# 岗位链 · 字段级一致性审查（Partner → Admin → Kiosk）

> 审查日期：2026-08-11
> 触发：产品所有者提问「前端岗位信息的功能，和后端管理员岗位的字段/表信息，能否一一对应？
> 管理员、机构端、前端三者是否有关联和数据一致性？」
> 方法：**全部读一手代码**（含 components/ 目录与 http/mock 双轨），不采信二手结论。

---

## 一句话结论

**合规必填的 5 项完全对得上（5/5）；业务字段整体是乱的。**

> 本文档由 Claude 与 Codex（gpt-5.6-sol / xhigh）**独立审查后合并**，两侧结论一致的部分标注「双方确认」，
> 单侧发现的标注来源。Codex 的总判断：**「不能字段级一一对应……这条链的字段一致性，整体是乱」**。

### 🔴 两条硬伤（必须优先处理）

| # | 问题 | 性质 |
| --- | --- | --- |
| **H1** | **「来源类型：线上招聘平台」是硬编码死值** —— 学校、人力资源机构、聚合器、手工录入的岗位**全都显示成"线上招聘平台"** | **伪造信息**，违反 CLAUDE.md §9「不伪造能力」 |
| **H2** | **编辑校招岗位会把它变成全职岗位** —— `campus` 被表单回填成 `full_time`，保存后写成 `fulltime` | **数据损坏**，机构改一次描述，岗位类型就没了 |

### 其余核心问题

1. **`rejectReason` 机构看不到** —— Admin 拒绝必须填原因，但 Partner DTO 不返回，**机构只知道被拒、不知道为什么**。
2. **5 个字段白填/半白填**：学历、经验、技能、福利、有效期。
3. **`headcount` 是模型外孤儿**：导入 DTO 接受，Job 模型没有这一列，直接丢弃。
4. **`archivedAt` 未过滤**：Kiosk 只按 approved+published 查，**归档岗位仍会展示**。
5. **「行业」是隐式约定**：藏在 `tagsJson` 的 `行业:` 前缀里，Partner 输入框零提示。
6. **录入路径决定字段完整度**：手工 9 个字段，Excel/API 17 个。
7. **`sourceName` 一个字段两种含义**：手工/Excel/Webhook 取机构名，API 拉取取数据源名。

---

## 一、合规硬要求：✅ 全部满足

CLAUDE.md §10 要求岗位详情必须展示 5 项。逐项核实
（全部在 `apps/kiosk/src/pages/jobs/components/JobDetailSections.tsx` 的「来源可信区」）：

| # | 要求 | 实现 | 证据 |
| --- | --- | :---: | --- |
| 1 | 来源机构 | ✅ | `JobDetailSections.tsx:178`（另 `:48` 二维码区也展示一次） |
| 2 | 同步时间 | ✅ | `:180` `formatFullDate(job.syncTime)` |
| 3 | 外部 ID | ✅ | `:181`（另 `:49`） |
| 4 | 外部投递链接 | ✅ | `:186` + `:42` 二维码 `SourceUrlQr` |
| 5 | 数据来源说明 | ✅ | `:193`「本岗位来自第三方/官方来源，本系统不接收简历、不参与招聘流程」 |

**这条合规线是干净的**，不需要动。

---

## 二、字段级对照表

> 列含义：Partner手工＝机构在 `/jobs` 页表单能否填；Excel＝Excel 模板能否填；
> Admin＝`/job-sources` 列表或详情抽屉能否看到；Kiosk列表/详情＝求职者能否看到。

| Job 字段 | Partner手工 | Excel | Admin | Kiosk列表 | Kiosk详情 | 判定 |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| `title` | ✅ | ✅ | ✅ | ✅ | ✅ | 一致 |
| `company` | ✅ | ✅ | ✅ | ✅ | ✅ | 一致 |
| `city` | ✅ | ✅ | ✅ | ✅ | ✅ | 一致 |
| `sourceUrl` | ✅ | ✅ | ✅ | — | ✅ | 一致 |
| `salary` | ✅ | ✅ | ✅ | ✅ | ✅ | 一致 |
| `description` | ✅ | ✅ | ✅ | — | ✅ | 一致 |
| `requirements` | ✅ | ✅ | ✅ | — | ✅ | 一致 |
| `externalId` | 自动生成 | ✅ | ✅ | — | ✅ | 手工录入自动生成 `MANUAL-{ts}-{rand}`（`partner/routes/jobs/index.tsx:215`） |
| `sourceName` | 后端填 | 后端填 | ✅ | — | ✅ | 取机构名，机构不用填 |
| `syncTime` | 自动 | 自动 | ✅ | — | ✅ | 一致 |
| `category` | ✅(workType) | ✅ | ❌ | ✅ | ✅ | ⚠️ **Admin 审核时看不到岗位类型** |
| `tags` | ✅ | ✅ | ❌ | ✅ | ✅ | ⚠️ Admin 看不到 |
| **`industry`** | ⚠️隐式 | ⚠️隐式 | ❌ | ✅ | ✅ | 🔴 **不是字段，是 tags 里的 `行业:` 前缀约定** |
| `salaryMin/Max/Unit` | ❌ | ✅ | ❌ | 间接 | 间接 | 🟠 只通过 `formatSalaryDisplay` 影响薪资文案（`jobs-shared.ts:316`） |
| **`educationRequirement`** | ❌ | ✅ | ❌ | ❌ | ❌ | 🔴 **白填** |
| **`experienceRequirement`** | ❌ | ✅ | ❌ | ❌ | ❌ | 🔴 **白填** |
| **`skillsJson`** | ❌ | ✅ | ❌ | ❌ | ❌ | 🔴 **白填** |
| **`benefitsJson`** | ❌ | ✅ | ❌ | ❌ | ❌ | 🔴 **白填** |
| **`validThrough`** | ❌ | ✅ | ❌ | ❌ | ❌ | 🔴 **白填，且无过期过滤** |
| `reviewStatus` / `publishStatus` | 只读 | — | ✅ | — | — | 一致 |
| `companyProfileId` | ❌ | ❌ | ❌ | 间接 | 间接 | 由 Admin 企业页关联 |

---

## 三、两条硬伤详情（Codex 发现）

### H1 · 「来源类型」硬编码，所有来源都显示「线上招聘平台」

`apps/kiosk/src/pages/jobs/components/JobDetailSections.tsx:179`
在「来源可信区」里写死了 `<div className="v">线上招聘平台</div>`，
页面徽标同样是死值（`JobDetailPage.tsx:246`）。

**后果**：`SourceKind` 明明有 6 种取值
（`job_platform` / `hr_company` / `school` / `fair_organizer` / `aggregator` / `manual`），
但高校就业中心提供的岗位、人力资源机构的岗位、机构手工录入的岗位，
**在终端上全部显示为「线上招聘平台」**。

这是**向用户展示了不真实的来源类型**，撞 CLAUDE.md §9「不伪造能力」，
且与本项目「第三方来源信息入口」的定位直接冲突——来源类型正是这个定位的核心信息。

**修法**：把 `SourceKind` 投影到公开 DTO，按真实取值渲染；取不到时显示「来源类型未标注」而不是编一个。

### H2 · 编辑校招岗位会把它降级成全职

`apps/partner/src/routes/jobs/index.tsx:48` 的映射：
DB 的 `category`（`fulltime`/`intern`/`campus`/`parttime`）→ 表单的 `workType`（`full_time` 等）。

**问题**：`campus`（校园招聘）在回填时被映射成 `full_time`，
保存时再写回 `fulltime`——**校招岗位编辑一次就变成全职岗位**。

**后果**：机构只是改了个错别字，岗位就从校招专区消失了。
而且这个变化**没有任何提示**，机构不会知道。

**更糟的是 mock 双轨**：`partner/services/api/partnerMockAdapter.ts:274` 的 mock 编辑
**直接丢弃 workType 修改**，与真实后端行为不同——本地开发时测不出这个 bug。

**修法**：补全 `campus` ↔ `campus` 的双向映射；mock 与 HTTP 行为对齐。

---

## 四、问题一：机构填了但前端不展示（白填字段）

**5 个字段**，但要分两档（Codex 指出其中 2 个有旁路消费，不是完全没用）：

| 字段 | 岗位页展示 | 旁路消费 | 定性 |
| --- | :---: | --- | --- |
| `educationRequirement` | ❌ | 无 | **纯白填** |
| `experienceRequirement` | ❌ | 无 | **纯白填** |
| `benefitsJson` | ❌ | 无 | **纯白填** |
| `skillsJson` | ❌ | ✅ 进 AI 上下文（`job-ai/job-context.service.ts:42`） | 半白填：AI 用了，人看不到 |
| `validThrough` | ❌ | ✅ 进质量巡检（`job-ai/job-quality.service.ts:105`） | 半白填：巡检用了，**但公开查询不据此剔除过期岗位** |

另有一个**模型外的孤儿字段**（Codex 发现）：
**`headcount`（招聘人数）** —— 导入 DTO 接受它（`dto/import-jobs.dto.ts:51`），
但 **Job 模型根本没有这一列**，公开映射固定返回 `undefined`（`jobs-shared.ts:397`）。
机构填了招聘人数，**数据在导入那一刻就被丢弃**。

**链路是通的，最后一步被丢掉**：

| 环节 | 状态 | 证据 |
| --- | :---: | --- |
| Excel 模板有这些列 | ✅ | `services/api/src/jobs/excel-template.ts:39-46`（学历要求 / 经验要求 / 最低薪资 / 有效期…） |
| 导入时写入数据库 | ✅ | `jobs-excel.service.ts:386-411` |
| API 投影到响应体 | ✅ | `jobs-shared.ts:405` `validThrough: j.validThrough?.toISOString()` |
| Kiosk 详情页渲染 | ❌ | grep `educationRequirement|experienceRequirement|skills|benefits|validThrough` 在 `JobDetailPage.tsx` 与 `components/` **零命中** |
| Kiosk 列表页渲染 | ❌ | 同上 |
| Admin 详情抽屉渲染 | ❌ | `job-sources/index.tsx:323-336` 只有 11 行，无这些字段 |

**后果**：机构按 Excel 模板认真填了学历、经验、技能、福利、有效期，
**数据一路传到前端，前端拿到手里，然后不渲染**。求职者一个都看不到。

**特别是 `validThrough`**：全链路**没有任何过期过滤逻辑**
（grep 无 `validThrough` 参与查询条件），所以**过期岗位会一直展示在终端上**。

---

## 五、问题二：前端展示了但机构填不了

`job.industry` 在 Kiosk 列表与详情都展示（`JobsPage`、`JobDetailSections.tsx:97`），
**但 Job 模型里根本没有 `industry` 字段**。

真实机制（`services/api/src/jobs/jobs-shared.ts:232-249`）：

```ts
export const INDUSTRY_TAG_PREFIX = '行业:'
buildJobIndustryTag('互联网')  // → "行业:互联网"，存进 tagsJson
extractIndustry(tags)          // → 从 tags 找 "行业:" 前缀，剥掉返回
```

**它是编码在 tags 里的隐式约定。**

**后果**：Partner 的 tags 是一个自由文本输入框（`routes/jobs/index.tsx:84` 逗号分隔），
**没有任何说明告诉机构「行业要写成 `行业:互联网`」**。
机构填「互联网」→ 系统当成普通标签 → Kiosk 的「行业」行显示**「来源平台未提供」**。

同一个概念，三端三种形态：

| 端 | 形态 |
| --- | --- |
| 数据层 | `tagsJson` 里的 `"行业:互联网"` 字符串 |
| Partner | 自由文本 tags 输入框，无提示 |
| Kiosk | 独立的「行业」展示行 |

---

## 六、问题三：录入路径决定字段完整度

| 路径 | 可填字段数 | 证据 |
| --- | :---: | --- |
| **Partner 手工表单** | **9** | `routes/jobs/index.tsx:78-90`：title / company / city / sourceUrl / workType / salary / tags / description / requirements |
| **Excel 导入** | **17** | 上述 9 项 + educationRequirement / experienceRequirement / skills / benefits / salaryMin / salaryMax / salaryUnit / validThrough（`excel-template.ts:39-46`） |
| API / Webhook 同步 | 17 | `dto/import-jobs.dto.ts:76` 等同 Excel |

**后果**：同一个机构，用手工录入的岗位**永远缺 8 个字段**，
且界面上**没有任何提示**说「用 Excel 模板可以填更全」。

---

## 七、问题四：Admin 审核时看不全

Admin `/job-sources` 详情抽屉只有 11 行（`job-sources/index.tsx:323-336`）：
来源机构 / 来源链接 / 岗位标题 / 公司 / 城市 / 薪资 / 岗位描述 / 任职要求 / 同步时间 / 审核状态 / 发布状态。

**看不到**：`category`（岗位类型）、`tags`、以及全部 5 个扩展字段。

**后果**：审核员做「通过 / 驳回」判断时，**看到的信息比求职者看到的还少**——
求职者能看到岗位类型和标签，审核员看不到。

---

## 八、修复建议（按性质与性价比排序）

### 第一档：数据正确性 / 合规（必须做）

| # | 动作 | 为什么最急 | 成本 |
| --- | --- | --- | --- |
| **A1** | **修 H1：来源类型不再硬编码** —— 把 `SourceKind` 投影到公开 DTO，按真值渲染；取不到显示「来源类型未标注」 | **正在向用户展示不真实信息**，撞「不伪造能力」红线 | 小（一个字段投影 + 一处渲染） |
| **A2** | **修 H2：`campus` 双向映射** —— 补全映射表，mock 与 HTTP 行为对齐 | **正在损坏数据**，校招岗位编辑一次就变全职 | 小（映射表 + mock） |
| **A3** | **`archivedAt` 加入公开查询过滤** | 归档岗位仍在终端展示 | 小（一个 where 条件） |
| **A4** | **`rejectReason` 返回给 Partner** | 机构只知被拒不知原因，是当前最大的协作摩擦 | 小（DTO 加字段 + 页面展示） |

### 第二档：把已有数据用起来（性价比最高）

| # | 动作 | 收益 | 成本 |
| --- | --- | --- | --- |
| **B1** | **Kiosk 详情页渲染学历/经验/技能/福利** | 机构已填的数据立刻有价值；求职者信息量大增 | 前端一个区块，**后端零改动**（API 已返回） |
| **B2** | **`validThrough` 接入过期处理**：详情显示截止日 + 列表标记/降权 + 查询过滤开关 | 消除「过期岗位一直挂着」 | 前端 + 一个查询条件 |
| **B3** | **Admin 详情抽屉补齐**：至少加 category、tags、5 个扩展字段 | 审核员看得比求职者还少，看全才审得准 | 抽屉加几行 |

### 第三档：消除录入不一致

| # | 动作 | 收益 | 成本 |
| --- | --- | --- | --- |
| **C1** | Partner 手工表单补齐 8 个字段 | 消除「手工 9 字段 vs Excel 17 字段」的差异 | 表单加 8 个输入项 |
| **C2** | 「行业」显式化：独立下拉，提交时自动加 `行业:` 前缀 | 消除隐式约定 | 小 |
| **C3** | `headcount` 二选一：要么给 Job 加列，要么从导入 DTO 移除 | 消除「填了就丢」 | 小 |
| **C4** | `sourceName` 语义统一：手工/Excel/Webhook 取机构名 vs API 取数据源名，需定一个口径并在 UI 标注 | 消除一字段两义 | 中（涉及口径决策） |
| **C5** | 命名统一：外部编号/外部ID、来源链接/外部投递链接、岗位类型/工作类型/类型 | 减少三端认知摩擦 | 小（文案） |

**建议顺序**：A1 → A2 → A3 → A4 → B1 → B2 → B3 → C 系列。
**A 档四条都是小改动但影响正确性**，B1 后端完全不用改。

### 另需单独处理：mock 双轨不一致

Codex 指出（`partnerMockAdapter.ts:251,274`、`adminMockAdapter.ts:179`、`jobMockAdapter.ts:69,89`）：
- Partner / Admin / Kiosk 的 mock 是**三套互不相干的静态数据**——机构在 mock 里改了不会进 Admin，更不会进 Kiosk。
- Partner mock 编辑**丢弃 workType**，与真实后端不同（H2 因此在本地测不出来）。
- Kiosk mock 列表过滤审核发布状态，**详情按 ID 读取却不校验状态**，与 HTTP 语义不同。

**影响**：本地 mock 模式下走通的流程，**不能证明真实链路可用**。
建议至少让三端 mock 的字段口径与状态语义对齐，或在 mock 模式的页面上明示「mock 不跨端联动」。

---

## 九、对已有方案与原型的影响

| 位置 | 影响 |
| --- | --- |
| 方案 §4.3 B3「内容健康度」 | 「已过期未下架」检测**成立**，但要注明：**只对 Excel/API 导入的岗位有效**，手工录入的岗位没有 `validThrough` |
| 原型 `partner/jobs.html` 的「截止日」列 | 同上，需加注 |
| 方案 §9.1 岗位对应关系 | 补充本文档的字段级结论 |
| 健康度问题清单 | **应新增一项**：「手工录入缺 8 个结构化字段，建议改用 Excel 模板」——这是真实且高频的质量问题 |

---

## 附：本次审查的方法说明

上一轮因为限制了审查范围（「只看调了哪些 service 方法，不读全文」）导致误判企业链断点。
本次全程：
- 读页面时读**整个目录**（`index.tsx` + `components/` + 同级文件）
- 判断「某字段不展示」前做**全局 grep**，覆盖 kiosk/admin/partner 三端
- 区分「后端有没有」「API 返不返」「前端渲不渲染」三层，不混为一谈

结论中每一条都带 `文件:行号`，可复验。
