# 招聘会三入口 AI 商用闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不突破招聘平台合规红线、不使用 mock 或假数据的前提下，把首页招聘会模块的「社会招聘会 / 校园招聘会 / 扫码签到」三个既有入口升级为真实数据、AI 助力、打印沉淀、本人记录可追溯的商用闭环。

**Architecture:** 保留现有首页入口、路由和业务分组，不做大改版、不新增重复入口。所有展示数据来自后端真实接口、PostgreSQL、COS/签名 URL、已发布来源数据和本人归属数据；AI 只基于真实招聘会、参展企业、岗位、资料和用户本人输入生成个人参会准备，不生成企业可见候选人数据。

**Tech Stack:** React + Vite + TypeScript + NestJS + Prisma + PostgreSQL + Redis + COS + AI provider + Terminal Agent 打印链路。

---

## 1. 功能归位声明

- 功能 / 业务闭环名称：招聘会三入口 AI 商用闭环。
- 前端：`apps/kiosk`，限定已有路由 `/job-fairs`、`/job-fairs/:id/*`、`/campus`，以及后续可启用的扫码签到既有首页卡片对应路由。
- 后端：`services/api`，限定招聘会只读接口、活动记录、AI 结果、文件资产、打印任务。
- 终端：本计划不直接改 `apps/terminal-agent`；真机出纸验收阶段才涉及 Agent claim、打印驱动和状态回传。
- 共享类型：`packages/shared`，只在新增真实契约时修改，例如 `fair_visit_plan`、`external_checkin_open`、`FilePurpose` 等。
- 共享 UI：不新增业务逻辑组件；仅在后续实现时复用现有 UI 组件。
- 文档：本计划为准入计划；实现完成后同步 `docs/product/user-data-flow-matrix.md`、`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。

本计划明确不做：

- 不新增首页入口。
- 不创建第二套招聘会页面。
- 不做平台内报名、投递、收简历、候选人池、企业筛选、面试邀约、Offer。
- 不记录第三方平台上的预约结果、签到结果、投递结果。
- 不使用 `apps/kiosk/src/services/api/mockAdapter.ts` 或 `apps/kiosk/src/data/fairData.ts` 作为商用验收数据。
- 不用 AI 编造企业、岗位、展位、活动资料、统计数字或来源平台链接。

## 2. 市场参考与可借鉴边界

### 可借鉴

- 招聘平台的分类、筛选和专区组织方式：校招、社招、实习、兼职、地区、职类、企业专区。
- 活动管理平台的活动官网、日程、展商、签到入口、渠道、API、数据看板、展位导览等组织能力。
- 人岗匹配研究和 AI 求职助手的解释型建议：帮助求职者理解岗位要求、准备材料、规划沟通顺序。

### 不可借鉴

- 活动平台的参会者管理、名单管理、群发通知、商机线索、1 on 1 Meeting、胸卡身份打印。
- 招聘 SaaS 的候选人筛选、HR 流程、人才库、面试邀约、Offer 管理。
- 招聘平台的站内投递、简历回流企业、企业查看求职者资料。

参考来源：

- 活动行企业版公开页面展示活动官网、日程、展商、参会者管理、API、数智签到、1 on 1 Meeting 等能力；本项目只吸收活动信息组织与外部入口展示，不吸收候选人或参会者管理能力。`https://www.huodongxing.com/enterprise`
- Person-Job Fit 相关研究说明人岗匹配可提高招聘/求职效率；本项目仅用于本人求职准备，不输出录用概率，不回传企业。`https://arxiv.org/abs/2208.08612`

## 3. 真实数据准入门槛

任何页面或能力进入“完成 / 商用级”前，必须满足以下门槛：

1. Kiosk 以 `VITE_API_MODE=http` 运行；mock 模式仅用于本地开发，不计入验收。
2. API 使用 PostgreSQL 真实数据，不使用内存假数据、seed 演示数据、前端静态数组冒充线上能力。
3. 招聘会只展示 `reviewStatus=approved` 且 `publishStatus=published` 的真实来源数据。
4. 招聘会资料只来自 `FairMaterial` 已发布记录，文件访问必须使用后端签名短时 URL。
5. 展位、企业、岗位数、资料数、打印次数、浏览量、跳转量必须来自真实表或真实聚合；没有数据时显示空态，不造数字。
6. 商用模式下 `FairLiveStatsDTO.isMockData` 必须为 `false`；如果后端返回 `isMockData=true`，统计区必须显示“真实统计暂未接入”的空态，不能展示任何 mock 数字。
7. `FairCompanyDTO.aiMatchScore` 不得作为 AI 匹配结果展示。首期停用该字段；若后续保留，必须改名为“机构标注参考”这类非 AI 语义，并且不得参与本人契合度、排序或推荐。
8. AI 只允许读取真实招聘会、参展企业、岗位、导览、资料元数据，以及用户本人选择的简历/目标方向；不得生成不存在的企业、岗位或展位。
9. AI provider 未配置或调用失败时，页面展示真实空态和替代动作，例如“先打印活动资料 / 生成求职材料 / 查看历史 AI 记录”，不得返回本地模板假报告。
10. 扫码签到只展示来源平台 / 主办方入口；没有来源签到链接时显示“主办方暂未提供签到入口”，不得生成本平台签到码。
11. 所有本人资产必须落库：`AiResumeResult`、`FileObject`、`PrintTask`、`BrowseLog`、`ExternalJumpLog`；不能只保存在前端 state、localStorage 或 URL 参数里。
12. 浏览器、预生产、真机验收截图只能使用真实 API 环境；mock 截图不能作为交付证据。

## 4. 数据契约

| 能力 | 真实数据来源 | 可以展示 | 不允许展示 |
| --- | --- | --- | --- |
| 招聘会列表 | `GET /job-fairs?terminalId=` → `ExternalJobFairDTO` | 名称、主办、时间、地点、状态、来源、同步时间、岗位数、企业数、主题 | 假招聘会、无来源活动、未审核活动 |
| 社会招聘筛选 | `ExternalJobFairDTO.city/theme/status/startTime/endTime`，必要时后端扩展查询 | 地区、状态、时间、主题 | 无字段支撑的行业/人群筛选硬编码 |
| 校园招聘会 | 同上 + `terminalId` 本校优先排序 | 本校优先、校园主题、参展企业、导览、资料 | 非本校伪装成本校、分页漏选后前端硬凑 |
| 参展企业 | `GET /job-fairs/:id/companies` → `FairCompanyDTO` | 企业名、行业、规模、展位、岗位标题、来源链接 | HR 联系方式、候选人入口、收简历入口、`aiMatchScore` 伪 AI 评分 |
| 场馆导览 | `GET /job-fairs/:id/venue-guide` → `FairVenueGuideDTO` | 展厅、展位、设施点、企业位置 | AI 编造路线或不存在展位 |
| 活动资料 | `GET /job-fairs/:id/materials` → `FairMaterialDTO.previewUrl` | 已发布资料、页数、大小、打印次数 | 无签名 URL 的可打印按钮 |
| 统计 | `GET /job-fairs/:id/stats` → `FairLiveStatsDTO` | `isMockData=false` 时展示预计/来源数据、真实服务行为计数 | `isMockData=true` 的 mock 数字、求职者个人信息、投递/预约结果 |
| 浏览记录 | `BrowseLog` | 本人浏览招聘会/企业记录 | 匿名本机历史、他人记录 |
| 外部入口记录 | `ExternalJumpLog` | 打开来源预约/投递/签到入口的事件；`external_apply` 仅允许指向 `sourceUrl`，按钮文案统一为“去来源平台投递 / 扫码投递” | 预约成功、签到成功、投递结果、平台内投递文案 |
| AI 参会准备 | 新增 `AiResumeResult(kind='fair_visit_plan')` | 本人可见摘要、路线、材料清单、问题准备 | 企业可见评分、录用概率、候选人推荐 |
| AI 参会准备 PDF | 新增 `FileObject(purpose='fair_visit_plan', ownerType='user')` | 我的文档、打印确认 | 无落库 PDF、仅前端 blob |
| 打印 | `PrintTask` + Terminal Agent | 打印状态、参数、订单记录 | 未经签名的文件 URL、绕过打印队列 |

## 5. 页面闭环方案

### 5.1 社会招聘会：`/job-fairs`

定位：社会求职者查看公开招聘会、准备现场材料、打印活动资料、进入来源平台预约。

P0 真实化范围：

- 保留现有页面，不重做“工作台”布局。
- 继续用 `getTerminalId()` 透传 `getJobFairs(terminalId ? { terminalId } : undefined)`。
- 列表筛选只使用真实字段：地区、状态、日期、主题。
- 详情入口继续进入 `/job-fairs/:id`、`/companies`、`/map`、`/materials`、`/stats`。
- 二维码只使用 `fair.sourceUrl`，文案为“扫码预约 / 去来源平台预约”。

P1 AI 助力：

- `AI 活动摘要`：基于 `ExternalJobFairDTO` 和 `FairCompanyDTO` 生成 5 条以内摘要，明确数据来源。
- `AI 参会准备单`：根据用户选择的目标方向和该场真实参展企业/岗位，生成本人材料清单、建议沟通企业、展位顺序、准备问题。
- `AI 风险提示`：如果企业岗位数据不足，直接提示“主办方暂未提供完整岗位信息”，不得补写。
- `生成 PDF`：服务端生成 A4 PDF，落 `FileObject(purpose='fair_visit_plan')`，进入 `/me/documents`，可去 `/print/confirm`。

闭环：

```text
社会招聘会入口
→ 真实招聘会列表
→ 查看详情 / 企业 / 导览 / 资料
→ 打开来源平台预约入口，记录 ExternalJumpLog
→ AI 生成本人参会准备单，记录 AiResumeResult
→ PDF 落 FileObject
→ 打印进入 PrintTask
→ 后续在招聘会业务页、我的文档、打印订单、AI 服务记录中回看
```

### 5.2 校园招聘会：`/campus`

定位：高校场景下的本校就业季服务页，保留现有 5 Tab。

P0 真实化范围：

- 保留 `企业速览 / 参展企业 / 导览图 / AI求职 / 打印服务` 五个 Tab。
- 继续使用 `terminalId` 选择本校优先招聘会。
- 如果没有本校或校园主题活动，返回真实空态：“暂无校园招聘会数据，请稍后再试”。
- 不从社会招聘会页面复制新入口。

P1 增强：

- `参展企业` Tab 增加真实筛选：行业、岗位类型、学历、城市。筛选字段必须来自 `FairCompanyDTO.positions` 或后端扩展字段。
- `导览图` Tab 增加“扫码带走地图”，二维码指向静态只读 H5 或现有导览页，不能收集个人信息。
- `AI求职` Tab 增加“校招准备包”：简历检查点、目标企业沟通问题、宣讲/招聘会日程提醒、面试练习入口。
- `打印服务` Tab 串联招聘会资料、求职材料库、简历打印、AI 参会准备单打印。

闭环：

```text
校园招聘会入口
→ 本校优先招聘会
→ 查看企业 / 展位 / 导览 / 资料
→ AI 校招准备包
→ 打印简历 / 求职材料 / 参会准备单
→ 打开来源平台预约或来源签到入口
→ 记录沉淀到本人浏览、外部入口、AI 服务记录、我的文档、打印订单
```

### 5.3 扫码签到：既有首页卡片后续启用

定位：来源平台签到入口与现场服务，不是平台内签到系统。

页面命名：

- 首页卡片可保留“扫码签到”以符合既有入口。
- 页面标题必须使用“到场服务 / 来源签到入口”。
- 二维码弹层说明必须写清：签到动作发生在主办方或来源平台，本系统不生成参会资格。

P0 条件：

- 未取得真实签到链接前，首页卡片继续 disabled。
- 如果启用，必须先有真实来源字段，例如 `JobFair.checkinUrl` 或 `FairExternalEntry(kind='checkin')`。
- 没有今日活动时展示真实空态和可选招聘会列表，不显示假二维码。

P1 功能：

- 根据终端位置、当前时间和已发布招聘会，推荐“今日现场活动”。
- 展示来源平台签到二维码、预约二维码、导航二维码、服务台资料打印入口。
- 新增 `external_checkin_open` 动作时，只记录“打开来源签到入口”，不记录签到结果。
- 用户可打印本机材料清单，但不得生成入场券、参会证、主办方凭证。

闭环：

```text
扫码签到入口
→ 选择今日真实招聘会
→ 展示来源签到 / 预约 / 导航入口
→ 记录 ExternalJumpLog(action='external_checkin_open' 或 external_appointment)
→ 提供资料打印、材料清单、导览
→ 后续在本人外部入口记录和打印订单中回看
```

## 6. AI 能力设计

### 6.1 必须是真实 AI 服务

- 生产验收必须使用真实 AI provider。
- API 未配置 AI provider 时返回明确错误，前端展示不可用状态。
- 不允许在 Kiosk 端写本地模板假装 AI 结果。
- AI 输出必须带 `provider`、`createdAt`、`fairId`、`sourceSnapshot` 或等价审计元数据。

### 6.2 新增 AI 记录类型

新增类型建议：

```ts
MemberAiRecordKind =
  | 'parse'
  | 'optimize'
  | 'generate'
  | 'job_fit'
  | 'career_plan'
  | 'fair_visit_plan'
```

新增 `AiResumeResult(kind='fair_visit_plan')` 用于本人招聘会参会准备，不复用 `career_plan` 或 `job_fit`，避免数据语义混乱。

AI payload 必须包含：

- `fairId`
- `fairName`
- `sourceName`
- `sourceUrl`
- `generatedAt`
- `inputs`：用户目标方向、选择的简历任务 ID 或“未使用简历”
- `sections`：活动摘要、关注企业、展位顺序、材料清单、沟通问题、风险提示
- `disclaimer`：仅供本人求职准备参考，不代表录用结果，不回传企业

AI payload 不得包含：

- 企业可见候选人评分
- 录用概率
- 投递建议按钮
- 第三方预约 / 签到结果
- 企业联系人或 HR 私密信息

### 6.3 新增 PDF 文件用途

新增 `FilePurpose='fair_visit_plan'`：

- `ownerType='user'`
- `endUserId=当前会员`
- `assetCategory='derived'`
- `sensitiveLevel='sensitive'`，因为可能包含本人目标方向和简历摘要
- 默认留存遵循会员文件留存策略；首期不开放长期保存，默认 3 个月 / 6 个月可选，不长期保存原始敏感内容

## 7. 后台与合作机构配套

P0 不新增 Partner 自助能力，只复用现有导入 / 审核 / 发布链路。

Admin 需要保证：

- 招聘会来源审核通过后才发布。
- 参展企业、展区、资料、导览数据为真实录入或真实导入。
- 活动资料上传后进入 `FairMaterial`，发布后才给 Kiosk 展示。
- 统计看板区分“预计/来源数据”和“系统服务行为数据”。
- 后续如果新增签到链接字段，必须经过审核后才展示。

Partner 后续可做但不进入首期：

- 机构上传签到入口或预约入口。
- 机构维护展区和资料。
- 这些都必须走 Admin 审核，不允许 Partner 直接发布到 Kiosk。

## 8. 实施分期

### P0：合规与真实数据门禁

- [ ] 明确三个入口不做大改版，不新增入口。
- [ ] 文案替换：
  - “AI 匹配三档”改为“契合度参考，仅本人查看”。
  - “服务凭证 / 服务单”改为“材料清单 / 打印准备单”。
  - “扫码签到页”页面标题改为“到场服务 / 来源签到入口”。
- [ ] 文档写死禁止能力：参会者管理、名单、1 on 1 预约、企业筛选、胸卡身份打印、平台内签到结果。
- [ ] 增加 verify：生产构建不得把 `VITE_API_MODE=mock` 作为招聘会商用验收模式。
- [ ] 增加 verify：`FairLiveStatsDTO.isMockData=true` 在商用验收中直接失败；前端遇到 `isMockData=true` 只能展示空态。
- [ ] 增加 verify：Kiosk 招聘会页面不得渲染 `FairCompanyDTO.aiMatchScore`，也不得展示任何“AI 匹配度 0-100 分”。
- [ ] 增加静态防回退：禁止招聘会页面出现“一键投递 / 立即投递 / 平台投递 / 投递简历 / 候选人管理”等文案。
- [ ] 增加静态防回退：`external_apply` 相关按钮只能使用“去来源平台投递 / 扫码投递”，并且只能打开服务端快照里的 `sourceUrl`。

### P1：社会招聘会真实 AI 准备单

- [ ] 新增后端 `fair_visit_plan` AI 服务。
- [ ] 同步共享类型和后端本地副本：`MemberAiRecordKind`、AI payload DTO、`FilePurpose='fair_visit_plan'`、文件校验/对象 key 配置。
- [ ] 如新增 Prisma 字段、表或索引，先写 additive migration；预生产和生产只允许 `prisma migrate deploy`，不得靠本地 schema 演示。
- [ ] 新增本人 AI 记录类型和 `/me/ai-records` 列表展示标签，未知 kind 必须安全降级，不展示 payload。
- [ ] 新增 PDF 生成和 `FileObject(purpose='fair_visit_plan')`，文件必须走签名 URL、本人归属和留存策略。
- [ ] `/job-fairs/:id` 增加“AI 参会准备单”入口。
- [ ] 生成结果可进入 `/me/documents` 和 `/print/confirm`。
- [ ] 前端针对活动资料及 AI 参会准备 PDF 的预览 / 打印操作，引入签名 URL 失效前的自动或按需刷新逻辑，防止用户长时间停留页面后创建打印任务失败。
- [ ] AI 不可用空态必须提供真实替代动作：打印活动资料、进入求职材料、查看历史 AI 记录、返回招聘会详情。
- [ ] 验证真实 PostgreSQL + COS + AI provider + 打印确认链路。

### P2：校园招聘会筛选与 AI 求职 Tab 增强

- [ ] 参展企业 Tab 接真实行业、岗位类型、学历、城市筛选。
- [ ] AI 求职 Tab 接 `fair_visit_plan`，不使用静态假建议。
- [ ] 打印服务 Tab 汇总真实 `FairMaterial`、求职材料、AI 参会准备单。
- [ ] 导览图支持手机扫码带走，二维码仅指向只读导览页面；预生产必须验证公网/校网域名、HTTPS 和手机弱网加载。
- [ ] 二维码内的手机访问域名必须来自后端公开配置或显式环境变量，例如 `KIOSK_PUBLIC_MOBILE_BASE_URL`；严禁用当前前端 `location.host` 直接拼接，避免一体机局域网 HTTP 地址导致手机扫码不可访问。

### P3：来源签到入口

- [ ] 后端新增真实签到入口字段或子资源，例如 `checkinUrl` / `FairExternalEntry`。
- [ ] Admin 审核签到入口。
- [ ] Kiosk 启用首页“扫码签到”卡片。
- [ ] 新增 `external_checkin_open` 事件类型，服务端只记录打开入口。
- [ ] 页面无真实签到入口时展示空态，不生成二维码。
- [ ] 若来源签到入口需要新表或字段，必须由 Admin 审核发布；Partner 不得绕过审核直接展示。

## 9. 验证计划

每个实现分支必须执行：

- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `pnpm --filter @ai-job-print/api typecheck`
- 招聘会相关 verify：`verify:jobfair-review`、`verify:jobfair-ui`、`verify:activity-logs`
- 新增 verify：`verify:fair-visit-plan`、`verify:jobfair-no-mock-commercial`
- 新增 verify 必须覆盖：`isMockData=true` 失败、`aiMatchScore` 不渲染、`external_apply` 文案和目标 URL 合规、AI 不可用不返回假报告。
- 生产构建：`VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`

预生产验收必须覆盖：

- PostgreSQL 中有真实已审核已发布招聘会。
- 至少一场招聘会有真实参展企业、岗位、展区、活动资料。
- `GET /job-fairs/:id/stats` 返回 `isMockData=false` 后才展示统计；`isMockData=true` 场景必须展示空态并且验收失败。
- `FairCompanyDTO.aiMatchScore` 即使存在于响应中，Kiosk 也不得展示为 AI 匹配或参与排序。
- `FairMaterial.previewUrl` 能访问且过期后失效。
- 长时间停留页面后，点击查看/打印资料必须能重新获取或刷新签名 URL，不能使用已过期 URL 创建打印任务。
- AI provider 真实调用成功。
- AI 参会准备单落 `AiResumeResult(kind='fair_visit_plan')`。
- PDF 落 `FileObject(purpose='fair_visit_plan')`。
- `/me/documents` 可看到该 PDF，进入 `/print/confirm`。
- Windows 真机能完成真实出纸，打印订单状态回传。
- 打开来源预约 / 签到入口只产生 `ExternalJumpLog`，无结果字段。

## 10. 商用完成标准

达到商用级别必须同时满足：

- 数据真实：无 mock、无静态假数据、无前端伪造统计。
- 合规真实：所有投递、预约、签到均在来源平台完成，本系统只做入口和记录。
- AI 真实：调用真实 provider，失败不降级为假结果。
- 文件真实：PDF 落库、签名 URL、留存策略和本人权限都有效。
- 打印真实：从 Kiosk 到 API 到 Terminal Agent 到奔图打印机真实出纸。
- 记录真实：本人可在对应业务页面回看 AI 记录、文档、打印订单、浏览和外部入口记录。
- 空态真实：数据缺失时明确说明来源未提供，不展示假功能。
