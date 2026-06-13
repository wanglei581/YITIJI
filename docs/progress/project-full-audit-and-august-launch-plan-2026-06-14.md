# AI求职打印服务终端 · 全面盘点与 8 月落地规划

> 生成日期：2026-06-14　分支：`feature/policy-service-redesign`
> 方法：多智能体审计（23 个子智能体 / 4 阶段：11 分片精读 → 4 交叉透镜 → 7 条高影响缺口源码级对抗复核 → 路线图），结论均以真实代码 `file:line` 为据，文档声称状态一律视为「待核实」另列。
> 覆盖：apps/{kiosk,admin,partner,terminal-agent} + services/{api,worker} + packages + docs 全量。

---

## 一、执行摘要（先读这一节）

### 1.1 一句话结论

**代码工程质量高、合规边界守得很干净，真正的阻塞不在"功能没写"，而在三件事：① 大量"前台有展示区、后台没有增改入口"的断点（本次重点）；② C 端登录的短信真发没接通 + 生产构建默认 mock 的"上线即假数据"单点；③ 服务器/PostgreSQL/Windows 真机/短信审核等"采购与审批类"外部阻塞全部 0% 执行。** 这些都可控，8 月落地现实可行，但部署资源和短信审核必须现在就并行启动。

### 1.2 项目是什么 / 面向谁 / 解决什么问题

| 端 | 面向谁 | 解决什么 | 形态 |
|---|---|---|---|
| **一体机前台 Kiosk**（竖屏 21.5"） | 到店求职者本人（匿名+手机号会员） | AI 简历（上传/扫描/诊断/优化/生成/导出打印）、打印扫描、岗位/招聘会/政策**信息展示 + 外链跳转**、AI 助手/模拟面试/职业规划、我的记录 | 大按钮、短路径、触控友好 |
| **管理员后台 Admin** | 平台统一运营人员 | 终端/打印机/订单/文件/告警/审计监管 + 招聘会·企业·岗位源·招聘会源·政策源·合作机构·AI 内容审核与运营 | 专业运营系统 |
| **合作机构后台 Partner** | 高校就业中心/人力公司/招聘会主办方/公共就业机构 | 自助录入·导入岗位/招聘会/企业/政策，配置 API·Webhook·Excel 数据源，看同步日志 | 纯数据与运营管理后台 |

**合规红线（全程已核验通过）**：不做招聘闭环——无平台内投递、不收求职者简历、无候选人筛选/面试/Offer。岗位与招聘会只做第三方来源展示，按钮文案全部「查看岗位 / 去来源平台投递 / 扫码投递 / 去来源平台预约」。23 个智能体全量扫描**未发现任何违禁功能**；唯一触红线的是青岛专区一处硬编码假补贴金额（见下，且该页不可达）。

### 1.3 总体完成度评分（已逐项核验，非文档自报）

| 模块 | 完成度 | 关键说明 |
|---|---|---|
| 打印链路（提交→Agent→真机出纸） | **85%** | 全仓最成熟，参数/份数/双面/彩色真机已验；默认 mock、生产需切 http |
| AI 简历服务（诊断/优化/生成/职业规划/岗位匹配） | **80–90%** | 后端真实 LLM+百度 OCR；**默认演示态**，生产须切 `AI_PROVIDER=llm`+`OCR_PROVIDER=baidu` |
| 招聘会 / 校园招聘 / 企业 | **75%** | 后端真表完整；但**岗位明细/数据大屏字段/地图字段/展位缺录入口**（本报告重点） |
| AI 助手 / 模拟面试 / 待机屏 | **85–90%** | TRTC 真人顾问+语音面试，设计稳健 |
| 我的 / 会员资产 | **70%** | 后端 `/me/*` 六组全就绪，**前端明细页没接**；短信登录未通=最大功能阻塞 |
| Admin 运营核心 | 文件 95% / 工作台·订单·终端 85% / 告警 70% / **用户·权限·外设 5%** | 有端点的页是真数据；用户/权限/外设是纯空壳骨架 |
| Admin 内容与数据源 | **75–90%** | 招聘会/企业/政策/数据源 CRUD 真实；少量死按钮 |
| Partner 合作机构后台 | 岗位·招聘会·政策 100% / 企业·数据源 90% / **统计·终端·账号 10%** | 三个导航页是空壳占位 |
| 基础设施 | DB 75 / 远程打印 85 / 打印机 80 / 密钥 85 / Provider 60 / 部署 **35** / 支付 N/A | 应用与安全层就绪，**没有任何东西在真实生产跑过** |

### 1.4 测试现状

- **后端**：37 个 `verify:*` 端到端验证脚本（真后端真库），覆盖 AI/OCR/会员/招聘会/企业/政策/数据源/COS 等核心域，进双 CI（SQLite 主 + `postgres-readiness`）。**没有标准单元测试**。
- **未被守门的上线核心链路（建议补 verify）**：`POST /print/jobs` 打印提交、待机屏 Content 主链路、Audit、AI 配置、岗位审核状态机——目前仅靠历史跨机 E2E 覆盖，无回归网。
- **前端**：三端**无任何自动化测试**（0 个 spec/test 文件）。
- **真机/线上**：生产服务器、PostgreSQL 生产实例、Windows 换机、线上浏览器闭环——**全部 0% 执行**（无资源）。

### 1.5 关于你那张图（招聘会详情「各市区创新特色展区」）的直接回答

好消息 + 需要修的，都在这张图里：

- ✅ **「各市区创新特色展区」本身其实已经有后台增改入口**——Admin「招聘会管理 → 展区」里可以增删改，类别下拉就含「创新展区」，还能填城市/说明/排序（`apps/admin/src/routes/fairs/index.tsx`，后端 `admin-fairs.controller.ts` 有 zones 全套 CRUD）。这一项**对照确认通过，不用改**。同页的「活动资料」「场馆导览」「待机宣传屏」也都已有完整 Admin 入口。
- ⚠️ **但就在同一个招聘会详情页里，确实有几处"前台有区、后台没法改"**：① 参展企业卡下的**「招聘岗位」明细**（薪资/学历/经验/人数）——只有种子能写，Admin 加企业只能填个"岗位数"数字，加不了具体岗位；② **数据大屏的「预计参会人数 / 求职意向分布饼图」**——库里有列、前台会显示，但后台没有任何录入表单，生产新建的招聘会这两块永远是"—/暂无"；③ **概览页的封面图/地图底图/经纬度/交通指引**——抽屉里连输入框都没渲染，没经纬度地图就退化成占位、导航二维码出不来；④ **展位网格/现场签到**是 mock 专属，后端根本没建 FairBooth 模型。
- 📋 **这正是你要的那类断点**。我把全站这类"前台有展示位 → 后台缺增删改入口"的缺口**逐条排查并源码核验**，整理成一张 **23 行的整改矩阵**（第四节），每条都标了：数据现在是真/假、后台到底有没有入口、该放 Admin 还是 Partner、要补什么写接口和字段、优先级和工作量。其中 7 条高影响缺口做了**对抗性复核**（默认怀疑"其实已存在"去证伪），结果：5 条确认缺失、1 条其实已存在（企业下架）、1 条部分（青岛专区）——避免误报。

### 1.6 六个"必须知道"的硬结论

1. **「上线即假数据」单点风险（P0）**：Kiosk 默认 `VITE_API_MODE=mock`，生产构建若没强制注入 `=http`，整机会渲染 `fairData.ts`/`externalSources.ts` 里的**静态假招聘会/岗位/补贴**。必须用构建期断言卡死，不能只靠文档约定。
2. **C 端登录走不通（P0）**：`TencentSmsSender.sendCode()` 还是 `throw NOT_IMPLEMENTED`——短信真发没写。审核通过 ≠ 能发，还要补一步代码。短信模板外部审核周期最长，**必须 6/30 前提交**。
3. **唯一触合规红线项（P0）**：青岛专区 `QingdaoPage` 硬编码具体补贴金额（2000元/人、安家500万、租房6000元/月）且无"演示"标注，同时这页是**不可达孤儿页**。上线前必须下线或接真。
4. **后端就绪、前端没接（P0，纯前端工作量）**：`/me/打印订单·文档·收藏·浏览/跳转记录` 六组接口全就绪，但「我的」页还在用"本次记录/建设中"标签、刷新即丢，"我的收藏"还错指到 `/jobs`。补几个明细页即可闭环。
5. **空壳占位页要收口**：Admin 用户/权限/外设、Partner 统计/终端/账号 共 6 个页是侧边栏有入口、点进去全空（后端无端点）。上线前隐藏或标"建设中"，避免"有菜单全是灰条"的假完整感。
6. **最大外部阻塞是采购，不是代码**：服务器/域名/证书/生产 PG16/Redis7/COS 桶、Windows 真机、短信审核——全 0%。**P1 阶段必须并行启动采购**，否则等待期会吃掉 8 月窗口。

### 1.7 8 月落地路线（详见第九节）

| 阶段 | 窗口 | 目标 |
|---|---|---|
| **P1 红线 + 真数据收口** | 6/14–6/30 | 处置青岛专区、构建期强制 http、补 SMS 真发代码并提交审核、「我的」接真 |
| **P2 后台增改入口补齐** | 7/1–7/15 | 招聘会大屏/地图/岗位明细可录入、死按钮接线、明文测试账号移除、空壳页收口 |
| **P3 部署 + 真机验证** | 7/16–7/31 | 采购资源、按 runbook 部署预生产、奔图真机复验、线上浏览器闭环 |
| **P4 上线收尾 + 灰度** | 8/1–8/15 | 切生产、SMS 真号 E2E、回填验收清单、灰度观察 |

> **支付**：全仓确认无任何支付代码，当前业务模型（AI/打印/信息入口）不依赖支付即可上线。若决定打印/AI 现场收费，**线下现金/扫码收款（不入系统）是规避支付域的最快合规路径**；真要做线上支付是独立的 C-5 域（订单/退款/对账/回调验签），不应塞进 8 月窗口。

---
## 二、各端各模块现状与完成度

### Kiosk · 招聘会 / 校园招聘 / 企业 / 展区

**这一块面向谁、解决什么**：面向一体机前的求职者（竖屏 9:16），把第三方/官方来源的招聘会、参展企业、岗位、活动资料、场馆导览作为**信息展示 + 外链跳转 + 自助打印**入口。全程不收简历、不在平台内投递，按钮文案严格走「扫码预约 / 去来源平台投递 / 扫码投递」（已核验合规，见下）。涉及三条路由域：`/job-fairs/*`（招聘会主线，本次样板区）、`/campus`（校园招聘沉浸式 5-Tab，复用同一批 fair 端点）、`/companies/*`（找企业，独立的真实企业库）。

**数据真伪的关键事实（务必区分两种模式）**：Kiosk 默认 `VITE_API_MODE=mock`，招聘会全线走 `mockJobFairAdapter`（`apps/kiosk/src/services/api/mockAdapter.ts`）+ 静态数据 `apps/kiosk/src/data/fairData.ts` / `externalSources.ts`，**只有 f1/f2 两场有完整企业/岗位/展位/资料/大屏，f3 连子数据都没有**。切到 `VITE_API_MODE=http` 才走 `httpAdapter.ts` → NestJS `JobsController` 真实 Prisma。两套形状不同，http 适配层做了字段对齐与安全占位（见 `httpAdapter.ts:178` `mapWireCompany`：`checkinStatus` 恒为 `'pending'`、缺签到/展位模型）。

**逐 Tab / 逐区块数据来源与可运营性**（招聘会详情 `JobFairDetailPage.tsx`）：

| Tab / 区块 | Kiosk 数据来源（mock / http） | 后端真库是否支持 | 运营增删改入口 |
|---|---|---|---|
| Tab① 概览 + 地图 | mock: fairData/externalSources;http: `JobFair` 真列 | ✅ 真列 | Admin 基本信息抽屉 + Partner 编辑，但**经纬度/交通/tagline/入场方式/现场服务/封面均无表单**（地图 `latitude/longitude/trafficInfo` 仅 seed） |
| Tab① 各市区创新特色展区 `featuredZones` | mock: `FAIR_*_ZONES` 中 `category:'innovation'`;http: `getFairZones` 过滤 innovation | ✅ `FairZone.category='innovation'` | ✅ Admin「展区管理」可增删改（类别下拉含「创新展区」+ 城市/说明/排序），`apps/admin/src/routes/fairs/index.tsx:594`。**Partner 无此入口** |
| Tab① 现场服务（展馆导览/活动资料入口）| 由 `fair.hasManagedData` 派生（managedCompanyCount>0）| 派生值 | 间接随企业/资料增删变化，无独立配置 |
| Tab① 数据来源（来源机构/同步时间/外部编号）| `ExternalJobFair` 来源字段 | ✅ 真列且**不可改**（合规可溯源） | 故意只读，正确 |
| Tab② 参展企业与岗位 | mock: `FAIR_*_COMPANIES`;http: `FairCompany`+`positions` | ✅ `FairCompany` / `FairCompanyPosition` 真表 | ⚠️ Admin 可增删改企业**卡片**(`SaveFairCompanyDto`)，但**该企业下的「招聘岗位」`FairCompanyPosition` 没有任何运营写入口**——Admin DTO 无 positions 字段，Partner 导入 DTO 也无 positions，**只有 `prisma/seed-fairs.ts` 种子能写**。岗位分类（研发/产品/设计类）是前端按标题正则现派生(`categoryOf`)，非真实字段 |
| Tab③ 场馆导览（轻 3D 展厅）`VenueGuideTab` | mock: 诚实返回 `null`（`mockAdapter.ts:251`）→ 永远空态;http: `getFairVenueGuide` 真实 | ✅ `FairVenueGuide/Hall/Facility/HallCompany` 全套真表 | ✅ Admin「场馆导览」Tab 整体 PUT 保存（`admin-fairs.controller.ts:235`，`VenueGuideTab.tsx`）。**Partner 无入口** |
| Tab④ 数据大屏 `FairDataScreen` | mock: `toStatsDTO` 聚合 + `seekerIntent/expectedAttendance` 来自 `externalSources.ts`;http: `getFairStats` 真实聚合 | ⚠️ 部分真实：企业/岗位/行业分布按已录企业实时聚合(`jobs.service.ts:847`)、`browseCount=viewCount` 真实；但 `expectedAttendance`/`seekerIntent` 是 `seekerIntentJson` seed 列、`scanCount/printCount/checkinCount/zoneBreakdown` 在 http 模式**恒为 0/空**（无计数模型，已诚实标注） | ❌ `expectedAttendance` / `seekerIntent`（求职意向分布）**无任何 Admin/Partner 表单**，仅 seed。`UpdateFairInfoDto` 不含这两字段。大屏「预计参会人数」「求职意向饼图」在 http 模式只会显示 seed 值或「—/暂无」 |

**其它页面**：参会企业列表 `FairCompaniesPage`（签到徽章/展位号 http 模式恒为 pending/无，因无签到模型）、企业详情 `FairCompanyDetailPage`（海报/列表双视图、打印企业资料/岗位清单走 `/print/preview` 构造的虚拟 PrintFile）、展馆导览图 `FairMapPage`（**展位 booth 网格 mock-only，http 模式 `getFairMap` 恒返回 `booths:[]`**，`jobs.service.ts:835`）、活动资料 `FairMaterialsPage`（http 真实 HMAC 签名 URL 可打印，mock 演示数据按钮降级禁用，已正确）、`FairStatsPage`（独立统计页，未见路由引用，疑似遗留）。`/campus` 复用同批端点选一场 campus 主题会，AI/打印 Tab 跳已有链路。`/companies` 是**另一套真实企业库**（`companies.ts`，mock 模式诚实失败抛 `COMPANIES_REQUIRES_BACKEND`，无假数据），有完整 Admin/Partner 后台（不在本切片证据范围，按提示标注）。

**合规核验（通过）**：全线按钮均为「扫码预约 / 去来源平台预约 / 扫码投递 / 去来源平台投递 / 查看岗位」，多处合规说明「不接收简历、不参与招聘闭环」；`aiMatchScore` 仅展示且标注「不参与招聘闭环」；签到字段在 http 端被合规占位为不签到。未发现一键/立即投递、平台收简历、候选人筛选等红线功能。

**主要问题与可优化点**：
1. ⭐**FairCompanyPosition 岗位明细无运营写入口**——前台 Tab②/企业详情/校园专区岗位卡全靠它，但只能改种子；Admin 加企业只能填「岗位数(jobsCount)」数字，加不了具体岗位。建议在 Admin 企业编辑抽屉内增加岗位子表 CRUD。
2. **数据大屏「预计参会人数 / 求职意向分布」无运营入口**（`expectedAttendance`/`seekerIntentJson` 仅 seed）。建议在 Admin 基本信息或大屏配置里补这两项表单。
3. **地图相关字段（经纬度/交通指引/封面/tagline/入场方式/现场服务）无运营入口**，http 模式新建/编辑的会无法出地图与导航。
4. **展位级数据（FairBooth）无模型**：`FairMapPage` 的展位网格、`FairCompaniesPage` 的展位号/签到，在 http 模式全为空，是 mock 专属的「假完整」。需明确产品是否要展位模型，否则前端应隐藏展位网格。
5. **Partner 后台只能管招聘会主记录**，企业/展区/资料/导览/大屏全部只能 Admin 配——若希望合作机构自助维护参展企业，存在能力缺口。
6. mock 模式下 f3 等多数会缺子数据，演示时只有 f1/f2 完整，易被误读为「功能不全」。

---

### Kiosk · AI简历服务

**用途 / 面向谁 / 解决什么问题**
本块面向到店求职者本人（一体机竖屏 9:16，也兼容手机/桌面），围绕「一份能打印带走的好简历」提供完整 AI 服务链路：上传/扫描已有简历 → AI 诊断 → 优化（新旧 diff + 可编辑优化版）→ 导出真实 PDF → 进打印链路；以及无电子简历者的「引导式表单 AI 生成」；并衍生 2D 岗位匹配参考、2E 职业规划、简历素材库。合规定位严格：所有 AI 结果仅服务本人、不推送企业、不做投递闭环，文案与免责声明到位（按钮只引导「去来源平台投递」，见 `JobFitPage.tsx:200-214`）。

**真后端 vs Mock（关键结论）**
后端是真的：`services/api/src/ai/ai.controller.ts` 提供 `POST resume/parse`、`GET resume/records/:taskId`、`GET resume/records/:taskId/optimize`、`POST resume/generate`、`GET resume/generate/:taskId`、`POST resume/generate/export`；`career-plan.controller.ts`（`POST/GET :taskId`、`POST :taskId/print`）、`job-fit.controller.ts`（`POST` / `GET :taskId`）。OCR 走真实百度智能云（`ocr/baidu-ocr.provider.ts`），LLM 有 `providers/llm.provider.ts` 真实实现。**但默认全是演示态**：Kiosk `apps/kiosk/.env.example:9 VITE_API_MODE=mock`、后端 `services/api/.env.example:140 AI_PROVIDER=mock`、`:154 OCR_PROVIDER=disabled`。因此开箱即用时：诊断/优化返回写死样例（`aiMockAdapter.ts:27-64` MOCK_REPORT / MOCK_OPTIMIZE_MODULES），生成走确定性模板润色（`aiMockAdapter.ts:143-176`，事实字段逐字复制不编造），导出 PDF 返回空 `signedUrl`（`:186-197`，页面诚实提示「演示模式未生成真实文件」），career-plan/job-fit 在 mock 模式**直接拒绝**（`careerPlan.ts:58`、`jobFit.ts:60`，页面引导切真实服务）。诚实度高：mock 处处打「演示」标记（`providerName==='mock'` → `ResumeReportPage.tsx:178`、`ResumeOptimizePage.tsx:226`、`ResumeGeneratePreviewPage.tsx:157`），不伪造后端成功。

**各页面完成度与数据真伪**

| 页面 | 路由 | 完成度 | 数据 | 备注 |
|---|---|---|---|---|
| 上传/来源 | /resume/source | 高 | 真实上传 | `kioskUploadFile` 真传文件；intent=diagnose/optimize 分流 |
| 解析进度 | /resume/parse | 中 | 真后端调用 + **假进度动画** | STEPS（reading/ocr/extracting/diagnosing）是固定时长动画，与真实处理无关；`submitResumeParse` 在动画走完后才调（`ResumeParsePage.tsx:17-22,90-117`） |
| 诊断报告 | /resume/report | 高 | mock默认/真后端 | 雷达图、分项、优先级、风险表述、OCR 置信度提示均派生自报告，不编造 |
| 优化建议 | /resume/optimize | 高 | mock默认/真后端 | ReactDiffViewer 字符级 diff（before 摘自原文，服务端校验）+ 可编辑优化版 + 真实导出 PDF → 打印 |
| AI 生成 | /resume/generate(+/preview) | 高 | mock默认/真后端 | 6 步引导表单，仅润色不编造；导出走真实 pdfkit 链路 |
| 导出/打印汇总 | /resume/export | 低 | 占位 | 打印按钮全部 `disabled`（`ResumeExportPage.tsx:147`），无真实文件渲染链路；页面基本被优化页/预览页的「导出 PDF→打印」取代 |
| 素材库 | /resume/templates | 中(UI) / 低(数据) | **硬编码** | 8 条本地 `MATERIALS` 写死（`ResumeTemplateLibraryPage.tsx:45-54`），打印按钮 `disabled`；**首页入口被禁用** `disabled:true`（`HomePage.tsx:294`），实际不可达 |
| 岗位匹配参考(2D) | /resume/job-fit | 高 | 真后端(mock拒绝) | 选系统内岗位(`getJobs` 真) 或手填 → 参考等级，无百分比/录用承诺；合规跳转去来源平台 |
| 职业规划(2E) | /resume/career-plan | 高 | 真后端(mock拒绝) | 现状画像含原文依据、方向/技能/行动清单、可打印 PDF；首页入口已接真 |

**问题与可优化点**
1. **`/resume/parse` 假进度条**：四步「读取/OCR/提取结构/诊断」是写死时长的纯动画（`STEPS` 数组），真实 `submitResumeParse` 在动画结束后一次性调用，进度与真实阶段不对应。真实化时建议改为反映后端实际阶段或至少在慢响应时不误导。
2. **素材库不可达且数据硬编码**：页面已建好但 `HomePage.tsx:294` 入口 `disabled:true`，且素材为前端写死。无任何后台维护入口——admin/partner 均无简历模板管理（`grep` 无 resume template 后台模型）。若要上线需补：后台模板 CRUD + 真实文件渲染链路；否则应明确标注「二期」。
3. **`/resume/export` 半废弃**：保存可用但打印全禁用，与优化页/预览页功能重叠，存在「入口冗余」。建议下线或合并，避免假页面观感。
4. **演示态默认值**：上线前必须确认生产环境切 `VITE_API_MODE=http` + `AI_PROVIDER`（真实模型）+ `OCR_PROVIDER=baidu`，否则用户看到的是样例报告。百度 OCR 密钥上线前需轮换（曾在聊天暴露，AppID 7841387）。
5. **合规**：本块未发现任何招聘闭环违规；无平台内投递、无简历转企业、无候选人管理；文案与免责到位。岗位匹配仅「去来源平台投递」。无支付代码（仅 LoginPage 有微信/支付宝**扫码登录** UI 占位，非支付）。

---

### Kiosk · 打印扫描 + 终端硬件

**这个块解决什么 / 面向谁**：一体机前台（竖屏 21.5"，面向到店求职者匿名使用）的「打印扫描」核心业务，加上 Windows 本地 `terminal-agent` 的真机硬件链路。覆盖三条主流程：① 文档/照片打印（上传→材料检查→参数→确认→进度→完成）；② 材料扫描（选类型→设置→进度→结果）；③ 打印扫描服务中心（6 个能力卡片，3 个为「即将上线」说明页）。

**整体结论**：打印链路是本仓库**完成度最高、最接近真链路**的部分——前端 6 步流程 + 后端 NestJS 端点 + Windows Agent claim→下载→校验→打印→回传，端到端都有真实代码，参数（份数/黑白/双面/方向/缩放/页范围）真正映射到 SumatraPDF。但默认 `VITE_API_MODE=mock`，所以**开箱即用看到的是前端模拟**，真链路只在 `http` 模式 + 真机 Agent 下生效。**扫描完全是前端模拟**（无任何扫描硬件代码），**扫码上传 / U盘导入 / 证件照 / 格式转换 / 签名盖章 5 个能力是占位**。代码本身对这些边界标注得相当诚实（banner / 「即将上线」徽章 / disabled）。本切片**无任何支付代码**，价格仅展示，统一标注「实际以机器计费为准」。

**链路真伪一览**

| 子流程 | 数据/链路 | 完成度 | 说明（file:line 佐证） |
|---|---|---|---|
| 文档打印·上传 | http=真后端，mock=模拟 | 高 | `PrintUploadPage` 调 `kioskUploadFile`→`POST /files/kiosk-upload`（`filesHttpAdapter.ts:17`）；返回 signedUrl(5min)+sha256+fileId |
| 材料检查（体检/A4/隐私） | http=真后端任务，mock=演示 | 中高 | `PrintMaterialCheckPage` 串行调 `/materials/tasks`（`materials.ts:222`）；后端材料模块真实存在(`materials.controller.ts`)；**但隐私遮挡当前不生成新文件**，redaction `resultFileCreated:false`，打印仍用原文件（`PrintMaterialCheckPage.tsx:686`），UI 已明确提示 |
| 打印参数 | 真实下传 | 高 | 份数/色彩/双面/方向/缩放/页范围 → SumatraPDF PrintOptions（`print-with-pdf-to-printer.ts:21-58`）；`quality`/`pagesPerSheet` 收口为固定值不暴露 UI（`PrintPreviewPage.tsx:283-286`），Agent 也无 DEVMODE 支持 |
| 打印机状态 | 真后端心跳 | 中高 | `usePrinterStatus` 调 `GET /terminals/:id/printer-status`（`PrintPreviewPage.tsx:73`），需配 `VITE_TERMINAL_ID`；未配/失败=离线兜底 |
| 提交打印任务 | http+真 fileUrl=真，否则模拟 | 高 | `PrintConfirmPage.tsx:91` 仅在 `API_MODE==='http' && file.fileUrl` 走 `createPrintJob`→`POST /print/jobs`（`print-jobs.controller.ts:30`，绑定 endUser、IP 限流 10/min、强校验签名 fileUrl 防 SSRF、全量审计） |
| 打印进度 | 真轮询 / 模拟动画 双模 | 高 | `PrintProgressPage`：有 taskId→每 2s 轮询 `GET /print/jobs/:taskId`，5min 超时兜底；无 taskId→setTimeout 动画（`PrintProgressPage.tsx:90-101,166-174`）；直达守卫禁止伪造成功 |
| Windows Agent 真机打印 | 真实实现 | 高 | `task-runner.ts`：claim→下载→SHA-256 校验→打印前 WMI 预检→`print()`→spooler 监控(缺纸/卡纸/Retained)→PATCH 回传；本地 SQLite 幂等防重打、离线队列重试、单实例锁、可装 Windows 服务自启 |
| **扫描全流程** | **纯前端模拟** | **低** | `ScanProgressPage` 全部 setTimeout 动画，`mockFile()` 随机造文件名/页数/大小（`ScanProgressPage.tsx:38-57`）；Agent 端**无任何扫描代码**（无 TWAIN/WIA/目录监听/SMB/FTP）；ScanStartPage 已挂「流程演示」banner，http 模式下「直接打印」按钮 disabled（`ScanResultPage.tsx:126`）防假文件进打印链路 |
| 扫码上传 / U盘导入 | 占位 | 低 | `PrintUploadPage.tsx:57-58` tab `disabled`，标注「待接入」「待接入 Agent」；Agent 无 U盘监听代码 |
| 证件照/格式转换/签名盖章 | 占位说明页 | 低 | `PrintScanHomePage.tsx:75-103` `available:false`「即将上线」→ `PrintScanFeatureInfoPage` 静态说明 + 合规声明 + 回退到通用打印 |

**合规检查**：本切片**未发现招聘闭环违规**（打印/扫描业务天然与招聘无关）。合规要点反而处理得好：敏感文件清理提示（`COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE`）、签名盖章明确声明非 CA 电子签、文件名在 sessionStorage 落盘前对邮箱/手机/身份证做脱敏（`printMaterialSession.ts:117-125`）、隐私片段只展示掩码 snippet 不展示原文。`appSecret`/奔图签名相关代码不在本切片（也未见前端泄漏）。

**主要问题与可优化点**
1. **扫描是 demo 但入口在首页二级随时可点**：扫描成功后造出随机 mock PDF，虽 http 模式禁了「直接打印」，但 mock 模式（默认）下仍能把假扫描文件喂进 `/print/confirm`（`ScanResultPage.tsx:50-58`），且能「保存文档」「AI 简历识别」——演示无害，但上线前需明确这是 demo 数据。
2. **隐私遮挡未真正生成遮挡文件**：用户做了「遮挡」选择但打印的仍是原文件（后端 `pii_redact` 返回 `resultFileCreated:false`）。UI 诚实提示了，但功能上「遮挡」目前只记录决策、不改文件——属已知未完成项。
3. **`fileMd5` 字段名实为 SHA-256**：wire 字段名 `fileMd5` 存的是 sha256，前后端+Agent 三处靠注释约定（`printJobsApi.ts:18-25`、`task-runner.ts:86-89`），历史上踩过 md5/sha256 比对必失败的坑；命名清理是技术债。
4. **`quality`/`pagesPerSheet` 是死参数**：UI 不暴露、固定默认值上送，Agent 也不支持（需 DEVMODE）。彩色打印 mode 真机未验证（CLAUDE.md 已记 TODO）。
5. **页数「待识别」体验**：上传后 `pages:null`，依赖材料检查 inspection 任务回填；mock inspection 直接返回 `pageCount:null`（`materials.ts:169`），所以 mock 模式下全程「页数待识别」，费用按 1 面估算。
6. **打印进度无「我的订单」实时入口**：后端持久化已就绪，CLAUDE.md 列为 P1「打印任务状态实时追踪 UI」尚未做。
7. **U盘/扫码/证件照等占位**需在上线说明里和真实能力区分，避免现场用户点了「材料扫描」以为是真机扫描。

---

### Kiosk「我的 / 会员资产 / 收藏 / 订单 / 记录」分片审计

**这一块是什么 / 面向谁 / 解决什么问题**
一体机前台 C 端求职者的「我的」中心 + 会员账号体系。面向到店使用一体机的求职者本人，提供：手机号登录、个人服务概览、本次会话记录回看、跨业务页（岗位/招聘会/政策）的收藏与浏览/外部跳转记录归属。合规定位为「本人服务记录」，严格不触碰招聘闭环——收藏/浏览/跳转只记录"本人行为本身"，绝不记录投递/预约结果或候选人数据（`memberFavorites.ts:9`、`activity.ts:10-12`、`memberPrintOrders.ts:9`）。

**关键结论：真后端是真的，但默认 mock + 真实短信未接入。**
- 后端是真的：`services/api/src` 下 `member-assets` / `member-favorites` / `member-benefits` / `member-print-orders` / `activity/me-activity` 五个控制器均存在，统一挂 `@Controller('me')` + `@UseGuards(EndUserAuthGuard)`，service 走真实 Prisma（`member-assets.service.ts:45-153` 用 `aiResumeResult.count/findMany`、`fileObject.findMany`、`deleteMany`），且有约 10 个 `verify-*` 脚本覆盖（`verify-member-assets(-c2d)`、`verify-member-favorites-benefits`、`verify-member-print-orders`、`verify-member-auth`、`verify-activity-logs`、`verify-end-user-asset-ownership` 等）。
- 前端默认 mock：`client.ts:16-17` 默认 `API_MODE='mock'`；每个会员 API（`memberAssets.ts:83/92/101`、`memberFavorites.ts:81/119/129/141`、`memberPrintOrders.ts:63`、`activity.ts:81/92/118/127`）首行都是 `if (API_MODE !== 'http' || !token) return 空页/no-op`。**默认演示态下「我的」三项统计恒为「—」、收藏/订单/记录全空**，只有 `VITE_API_MODE=http` 才连真后端。这是诚实化设计（不伪造数量），但审计/验收时务必区分。
- **上线阻塞（最严重）：真实短信发送未实现。** `sms-sender.ts:101-105` `TencentSmsSender.sendCode()` 直接 `throw new Error('SMS_PROVIDER_TENCENT_NOT_IMPLEMENTED')`；生产强制 `SMS_PROVIDER=tencent`（`sms-sender.ts:46-48`）、禁止 `log`，因此**一旦切生产，会员手机号登录拿不到验证码、整条会员链路（登录→所有 /me/* 资产）无法使用**。dev 用 `LogSmsSender` 把验证码打日志（`sms-sender.ts:84-86`）。

**会话/安全（实现良好，符合公共一体机要求）**
- 纯内存会话：token/user 只存 React state，不写任何浏览器存储，刷新即回游客（`AuthContext.tsx:8-15`、`context.ts:5-11`）；展示名永远用后端脱敏 `phoneMasked`（`context.ts:78-80`）。
- 空闲重置守卫覆盖登录 + 匿名，忙碌态豁免，与屏保互斥（`useIdleLogout.ts:43-67`）。
- 浏览/跳转上报 fire-and-forget、失败静默、匿名不上报（`activity.ts:63-83`）——共享终端不泄露上一位用户历史。

**信息架构整改已落地（2026-06-14）**
ProfilePage 不再聚合「账号资产」明细分区，旧 7 个 Group 组件 + `AccountAssetsPanel` + `useMemberAssetGroups` 已删（git status 显示 D），全仓零残留引用（grep 验证）。现仅保留 `useMemberProfileOverview.ts` 拉顶部 3 项 total（pageSize=1 只取 total），明细归位到业务页。

**各页面 / 入口完成度与数据真伪**

| 入口 | 数据 | 真伪 | 备注 |
|---|---|---|---|
| 手机号登录 + 验证码 | 真后端 `/member/auth/*` | 真（但生产短信未接入→阻塞） | 内嵌虚拟数字键盘，readOnly 输入框，适配公共终端无软键盘 |
| 邮箱登录 / 扫码登录(微信/支付宝) | 无 | 占位（诚实） | `EmailReservedPanel` / `ScanLoginPanel` 明确标"待接入"，不伪造成功；二维码是本地 nonce 占位 |
| 顶部概览统计(AI记录/收藏/文档) | `/me/ai-records`,`/me/favorites`,`/me/documents` 的 total | 真（http 模式）/ 空（mock） | 未加载/失败显「—」不显 0；不叠加会话记录避免双算 |
| 我的简历 | 路由跳 `/resume/source` | 真功能页 | — |
| 我的文档 / 打印订单 | tag「本次记录」 | 仅本次会话 | 来自 `location.state`，不伪造数量；可打印/删除（删仅清内存） |
| AI服务记录 | 路由跳 `/assistant` | 跳转入口 | 真明细在 `/me/ai-records`，此处只做入口 |
| 我的收藏 | `/jobs` + FavoritesProvider | 真 | 登录走服务端 SSOT，匿名走本机 localStorage，登录后显式 merge（幂等不覆盖） |
| 我的权益 / 套餐 / 活动 / 政策补贴 / 账户设置等 | tag「建设中」 | 占位 | 点击 toast「建设中」，无假数据、不接支付 |
| 招聘会浏览/预约跳转/扫码凭证记录 | tag「建设中」 | 占位 | 真后端 `browse-logs`/`external-jump-logs` 已存在，但「我的」页此入口仍是建设中标签（明细归位到招聘会业务页） |

**收藏体系（C-2D，实现完整）**：登录态以 `/me/favorites` 为 SSOT，乐观更新+失败回滚（`FavoritesProvider.tsx:101-131`）；匿名态本机 localStorage 三类 key（job/job_fair/policy，`localFavorites.ts:16-20`），登录后服务端不可达时不回退本机（避免误把他人收藏当本人，`FavoritesProvider.tsx:73-76`）；`getAllMyFavorites` 硬上限 10 页/500 条防失控（`memberFavorites.ts:98-112`）。

**合规复核：通过。** 全分片无招聘闭环语义；按钮文案合规；收藏/记录均"只记行为不记结果"。**无任何支付/payment 代码**——print 页 `PRICE_BW/PRICE_COLOR`（`PrintPreviewPage.tsx:93-94`）仅本地计算「¥/面」展示，无支付网关、无下单扣款、无 paySign；登录页 `'wechat'|'alipay'` 仅指扫码登录 provider 非支付。

**可优化 / 待核实**
1. **P0 阻塞**：接入腾讯云 SMS 真实 `SendSms`（仅需补 `TencentSmsSender.sendCode`，前端/Service 无需改）——否则生产登录不可用。
2. 文档「我的文档/打印订单」打 tag「本次记录」只读 `location.state`，**未消费已存在的真后端 `/me/documents`、`/me/print-orders`**（`memberPrintOrders.ts` 在 kiosk 仅 service 层定义、grep 未见页面消费）；整改后这两个明细的"归位业务页"是否已建，需进一步核实（unknown）。
3. 招聘会浏览/跳转记录在「我的」仍是「建设中」标签，但后端 `getMyBrowseLogs/getMyJumpLogs` 已就绪——前端归位页面是否已落地需核实（unknown）。
4. 验收时必须显式用 `VITE_API_MODE=http` 才能验真，默认 mock 下整块为空属预期、非缺陷。

---

### Kiosk · AI助手 / 模拟面试 / 职业规划 / 岗位匹配 / 待机屏 / 政策

**面向谁 / 解决什么问题**：均是一体机前台(竖屏)模块，服务到店求职者本人——AI 答疑导航、面试练习、职业方向参考、政策办事指引、待机宣传。全部围绕"信息服务 + 材料打印 + 外链跳转"，无任何招聘闭环。本分片代码合规整体良好：未发现任何违禁按钮文案(`一键投递/立即投递/收简历/候选人管理`)，未发现任何支付代码；面试/规划/匹配页均带 `ComplianceBanner` 明示"仅供本人练习参考、不代表录用承诺"，政策页明示"仅信息指引·不代办·不保存身份证/银行卡"。

**真伪与完成度(关键)**：这条分片真伪高度依赖 `VITE_API_MODE`。默认 `mock`(client.ts:16-17)下：AI 助手只回固定欢迎语(aiMockAdapter.ts:125-136)、模拟面试走本地 4 题演示脚本+演示报告(interview.ts:69-97，明确标注"演示模式")、职业规划/岗位匹配/打印**直接诚实拒绝**(careerPlan.ts:58、jobFit.ts:60、interview.ts:144-148 返回 `MOCK_MODE`)、屏保返回 `enabled:false`(screensaverMockAdapter.ts)、政策返回 3 条"演示数据"(policies.ts:39-55)。只有 `http` 模式才接真后端——而后端端点全部真实存在并经我核对：`/assistant/chat`(真 LLM DeepSeek/通义/MiniMax，未配置时降级，ai.service.ts:520-549)、`/mock-interviews/*`(含 `transcribe` ASR、`turns/:idx/audio` 腾讯 TTS、`capabilities/voice`、`report/print`，mock-interview.controller.ts)、`/resume/career-plan`、`/resume/job-fit`、`/policies`、`/terminals/:id/screensaver` 均有 controller。

**逐页结论**：
- **AI 助手(/assistant)**：双模 TRTC 真人顾问"小青"语音通话(`VITE_USE_TRTC_CALL=true` 时懒加载 `AiAdvisorCall.tsx`，组件存在) + 文字对话兜底。文字模式默认开启；路由白名单 `isAllowedRoute` + AI 动作过滤防越权跳转(AssistantPage.tsx:46-52,180)，每次进入新 sessionId 防上一用户上下文泄露(:93-95)，AI 回复标"内容仅供参考"。完成度高。
- **模拟面试(/interview/*)**：5 页齐全。Setup→Session(语音回合制:数字人TTS播问题→录音→服务端转写→可编辑确认→提交，麦克风/ASR/TTS 任一失败回退文字，原始音频不持久化)→Report(真实 PDF→既有打印链路)→Reports(会员真列表 `/me/mock-interviews` 游标分页+两步删除；游客诚实空态)→Tips(纯静态准备工具，无承诺文案)。完成度最高的子模块。
- **职业规划(/resume/career-plan)·岗位匹配(/resume/job-fit)**：service 层薄但真，依赖已诊断简历 taskId，结果进 AI 记录/我的文档/打印订单，等级制无百分比/录用承诺。mock 下诚实拒绝(非假数据)。
- **待机宣传屏(/screensaver)**：全屏路由，进入即清登录态+AI/打印会话(为下一用户重置)，任意输入退出，缓存优先防断网黑屏，只预加载下一个素材。设计稳健。mock 下不启用。
- **政策服务(/renshi)**：4 Tab。"就业政策"= 后端发布(审核为准)+5 条内置办事指引模板(合规标注"综合整理"、官方 URL 真实、扫码记 external_open)；"政策公告"= 后端真实数据；"社保指南/就业登记"= **纯内置静态模板**(SOCIAL_GUIDES/REGISTER_ITEMS)，扫码/预约按钮多为 `onComingSoon`(即将上线 stub)。
- **青岛专区(/qingdao "AI在青岛")**：⚠️ 见下，大量硬编码 mock 政策金额/高校/园区/资讯，且**该页未被首页或底部导航链接，实际不可达(疑似 orphan)**。

| 页面 | 数据 | 完成度 | 关键问题 |
|---|---|---|---|
| AssistantPage | http 真 LLM / mock 固定语 | 0.85 | TRTC 需 flag+凭证；mock 下只一句话 |
| Interview 全链 | http 真(ASR/TTS/LLM) / mock 演示脚本 | 0.9 | 真伪取决于后端模型/语音配置 |
| CareerPlan/JobFit service | http 真 / mock 拒绝 | 0.8 | 仅 service，页面在他人分片 |
| Screensaver | http 真 / mock disabled | 0.85 | 需 Admin 上传素材+绑定终端 |
| Renshi 政策 | 混合(后端真+内置模板) | 0.8 | 社保/登记 Tab 全静态，扫码多 stub |
| Qingdao 专区 | 几乎全 hardcoded mock | 0.45 | 硬编码补贴金额无演示标记 + 页面不可达 |

**可优化点**：1) **QingdaoPage 是最大隐患**——`QINGDAO_POLICIES` 写死"一次性就业补贴2000元/人""安家补贴500万元""博士后租房6000元/月"等具体金额，`UNIVERSITIES/PARKS/NEWS_ITEMS` 全为虚构静态数据且无"演示数据"标记，违反项目"不允许静态假数字"红线(其内部 EmploymentPanel 已部分接真招聘会，但其余 4 Tab 未整改)。又因该页无任何前台入口(首页政策入口走 `/renshi`，底部导航无)，建议明确"接真后再上线"或直接下线，避免上线后被扫到假数据。2) Renshi 的"社保指南/就业登记"扫码/预约按钮仍是 `onComingSoon` stub，建议接真官方 URL 二维码(同政策 Tab 已有的 `OfficialEntryQrOverlay` 能力)。3) LegalDoc 协议为试运营草稿，上线前需法务定稿。

---

### Admin · 运营核心(终端/打印机/订单/文件/告警/审计/权限/用户)

**这块是干什么的 / 面向谁 / 解决什么问题**
这是管理员后台的运营核心区,面向**线下一体机的统一运营人员/平台管理员**(全部端点 `@Roles('admin')` 守门)。它解决的是「一体机集群 + 用户文件 + 打印任务」的集中监管:看哪台终端在线、打印机是否缺纸/故障、打印任务流水、用户敏感文件(简历/身份证)的生命周期与清理、实时告警、以及全平台操作审计。完全不碰招聘闭环,合规边界保持得很干净——订单页只展示打印任务的**安全元数据**(份数/黑白彩色/纸张/归属 member/anonymous),刻意不展示金额/支付/文件链接/个人身份信息。

**关键事实:本分片在当前 dev 环境实际跑的是真后端,不是 mock。** `apps/admin/.env.local`(`apps/admin/.env.local:1-2`)设了 `VITE_API_MODE=http` 指向 `http://192.168.0.153:3010/api/v1`,虽然 `.env.example` 默认 `mock`(`apps/admin/.env.example:2`)。所有 service 都是「编译期按 `API_MODE` 二选一」结构(`apps/admin/src/services/api/client.ts:7-8`),http adapter 调真实 NestJS 端点,mock adapter 是内存演示数据。审计结论:**有真后端端点的页面在 http 模式下是真数据**;无后端端点的页面(用户/权限/外设)即使切 http 也是死的占位骨架。

**各页面完成度与数据真伪**

| 页面 | 路由文件 | 数据绑定 | 真实后端端点 | 完成度 | 关键问题 |
|------|---------|---------|-------------|--------|---------|
| 工作台 Dashboard | `routes/dashboard/index.tsx` | real-api(并发聚合6个真端点) | terminals/job-sources/fair-sources/files/ai-usage/audit-logs | 0.9 | KPI/待办/最近操作全部由真数据派生;自注释承认「订单/收入/告警统计无真实统计端点暂不接入」(`dashboard/index.tsx:418-419`) |
| 设备-终端 Terminals | `routes/terminals/index.tsx` | real-api(http)/mock-adapter | GET `/admin/terminals` | 0.85 | 有列表/搜索/在线离线筛选/分页;**纯只读,无详情抽屉、无远程重启/解绑/配置下发**;数据来自 Agent 心跳 |
| 设备-打印机 Printers | `routes/printers/index.tsx` | real-api/mock-adapter | GET `/admin/printers` | 0.8 | 表头列了型号/SN/碳粉/纸盒/当前任务,但**后端这些字段硬编码 null**(`terminals.service.ts:674-680`,Agent 只报 printerStatus),页面诚实显示「未上报」;纯只读无操作 |
| 设备-外设 Peripherals | `routes/peripherals/index.tsx` | empty-stub | 无 | 0.05 | 整页就是一个 EmptyState,12 行,无任何数据/接口 |
| 订单管理 Orders | `routes/orders/index.tsx` | real-api(http)/mock-adapter | GET `/admin/print-tasks` | 0.85 | 真打印任务流水 + 状态筛选 + 服务端分页;**无详情抽屉、无重打/取消任务操作**;主动声明支付域(Phase C-5)未上线不展示金额(`orders/index.tsx:73-76`) |
| 文件管理 Files | `routes/files/index.tsx` | real-api/mock-adapter | GET/DELETE `/files`、`/files/cleanup-expired`、`/files/:id/url` | 0.95 | **本块最完整**:三维筛选+搜索+分页,且有真实写操作——查看(临时签名URL)/手动删除/清理过期,均 window.confirm 二次确认且后端写审计;合规说明到位 |
| 待机宣传屏 Screensaver | `routes/screensaver/index.tsx` | real-api/mock-adapter | `/admin/ad-assets`、`/admin/ad-playlists`、`/admin/screensaver-config` 等 | 0.9 | 素材上传/外链视频/启停/删除 + 播放方案 CRUD + 终端配置,写操作齐全;AI 文生图 stub(二期) |
| 告警中心 Alerts | `routes/alerts/index.tsx` | real-api(http)/mock-adapter | GET `/admin/alerts` | 0.7 | 实时派生告警(离线/打印机异常/24h失败)+ 类型筛选;**无 Alert 模型 → 不支持确认/指派/处理记录**,页面如实说明(`alerts/index.tsx:70-73`) |
| 日志审计 Audit | `routes/audit/index.tsx` | real-api/mock-adapter | GET `/admin/audit-logs` | 0.85 | 动作下拉+时间范围筛选+分页;纯只读(审计本就该只读),无导出 |
| 权限管理 Permissions | `routes/permissions/index.tsx` | empty-stub | **无后端端点** | 0.05 | 41 行,表格里渲染 3 行灰色占位 div,底部「角色权限模型设计中」;**完全是假页面,无 RBAC 数据/接口** |
| 用户管理 Users | `routes/users/index.tsx` | empty-stub | **无后端端点** | 0.05 | 41 行,5 行灰色占位 div,底部「用户数据接入中」;**完全是假页面,有 EndUser 数据但无 admin 查询端点** |

**最关键的「展示了但没有增删改/操作」缺口(CRUD gaps)**
1. **用户管理 / 权限管理是纯占位骨架**——表头都列好了(用户:手机号/昵称/终端/订单数/操作;权限:角色/成员数/权限范围/操作),但没有任何后端端点(`grep admin/users|admin/permissions` 全空),也没有新增/编辑/删除入口。这是本分片最大的「有展示位无实现」黑洞。注意 CLAUDE.md 把「用户管理/权限管理」列在管理员后台范围内,当前是设计欠账。
2. **打印机的耗材/SN/型号列是空架子**——表头承诺型号/SN/碳粉余量/纸盒余量/当前任务,但后端永远返回 null(Agent 心跳不上报这些),不是 mock 问题而是协议没覆盖。属「展示位 > 实际能力」,需要 Agent 侧扩展上报或砍掉这些列。
3. **终端/打印机/订单全部只读,缺运营操作闭环**——终端无解绑/重启/远程配置;打印任务无重打/取消;告警无确认/指派。对「真实运营系统」而言这些是常见的运维动作缺口,但部分(告警处理)受限于无独立模型,属合理的诚实欠账。
4. **外设页彻底空**。

**可优化点**
- 用户/权限两页要么接真(EndUser 已有数据,加 `@Roles('admin')` 的只读查询端点即可让用户页真实化),要么明确降级隐藏入口,避免「有菜单点进去全是灰条」的假完整感。
- Dashboard 已诚实标注暂无订单/告警统计端点;后续若补 `/admin/stats` 可让 KPI 更全。
- 终端/订单可加详情抽屉(CLAUDE.md §8 要求后台「有详情抽屉」),目前全是扁平表格无抽屉。
- 合规与诚实度评价:**优秀**。订单页不编金额、告警页不假装能处理、打印机页如实标未上报、文件页删除/清理都写审计并二次确认,完全符合「不做假页面、不编 mock」的项目铁律。无任何招聘闭环违规按钮。

**支付/payment 复核结论**:在本分片范围(admin 运营核心 + 相关后端)未发现任何支付/退款/对账实现代码。所有命中(`orders/index.tsx`、`adminOps.ts`、`member-print-orders.controller.ts`、`admin-ops.service.ts`)都是**注释说明「支付域 Phase C-5 未建/不新增支付逻辑」**,以及迁移脚本里「行数对账」的无关词义。确认本分片无支付代码。

---

### Admin · 内容与数据源(招聘会/企业/岗位源/招聘会源/政策源/导入批次/合作机构/AI)

**这一块面向谁、解决什么问题**：管理员后台的"内容与数据源"中枢,面向**平台运营管理员**(非合作机构)。它解决三件事:(1) 把合作机构通过 API/Webhook/Excel 导入的第三方岗位/招聘会/政策数据**审核 + 发布**到一体机;(2) 对已审核的招聘会做**内容运营**(参展企业、展区、场馆导览、活动资料);(3) 管理企业展示档案、合作机构账号、AI 大模型与 AI 服务可观测性。全程严守红线:只做"来源信息展示 + 外链跳转",不收简历、不做招聘闭环。本分片所有页面均已发现明确的合规说明文案,按钮文案合规(未出现"一键投递/立即投递")。

**数据真伪(关键)**:Admin 端各 service 都是 `API_MODE === 'http' ? httpAdapter : mockAdapter` 双轨。`apps/admin` 默认 `API_MODE` 由 `client.ts` 决定;HTTP 模式下后端 `admin-fairs.controller.ts:69-242` 的 18 条招聘会子资源端点(企业/展区/资料/导览 CRUD + stats)**全部真实存在并落 Prisma**,companies/policies/orgs/aiUsage/aiConfig 也都有真实 httpAdapter(`aiConfig.ts` 甚至是 HTTP-only 无 mock)。所以 Admin 这一侧的写入能力是**真实**的,不是假页面。

**⭐ 核心结论:Admin 能改招聘会的哪些字段 / CRUD 缺口**(对照前台 Kiosk 招聘会详情 4 个 Tab:`详情与特色` / `参展企业与岗位` / `场馆导览` / `数据大屏`):

| Kiosk 展示区 | Admin 是否可增删改 | 佐证 | 缺口 |
|---|---|---|---|
| 基本信息(标题/时间/场馆/城市/地址/简介/主题) | ✅ 可改(来源字段不可改,保可溯源) | `fairs/index.tsx:230` updateFairInfo;后端 `PATCH admin/fairs/:id` | 无 |
| 参展企业(名称/行业/规模/标签/岗位数/来源链接) | ✅ 增删改全有 | `fairs/index.tsx:343-357` create/update/deleteCompany;后端 99/106/118 行 | 无 |
| 普通展区 + **创新特色展区(category=innovation)** | ✅ 增删改全有,下拉含 `innovation` | `fairs/index.tsx:512-526` Zone CRUD;`ZONE_CATEGORY_LABELS` 含 innovation(L50-54);Kiosk 渲染 `featuredZones = zones.filter(category==='innovation')`(`JobFairDetailPage.tsx:205,453-458`) | 无功能缺口,但前台静态 `fairData.ts` 里创新展区**带 city 分组**;Admin Zone 表单有 city 字段,可对齐 |
| **展位(booth:展位号/状态/面积/企业绑定)** | ⚠️ 部分:仅"场馆导览"里给企业绑展位号(boothNo)+ 展厅 boothRange 文本 | `VenueGuideTab.tsx:376` boothNo 输入;后端 `PUT admin/fairs/:id/venue-guide` | **真缺口**:无独立 booth 数据模型/坐标/状态/面积/平面图坐标。`fairData.ts` 有 b1-1…b1-13 富展位数据(occupied/available/areaSqm),HTTP 模式后端 `booths` 端点诚实返回 `[]`、`boothCount:0`(`httpAdapter.ts:212`、`jobs.service.ts:889`) |
| 活动资料(上传/编辑/发布/删除/页数/允许打印) | ✅ 全有(PDF/PNG/JPEG ≤20MB,签名链接) | `fairs/index.tsx:659-720` upload/update/publish/delete | 无 |
| **数据大屏(预计到会人数 expectedAttendance / 求职意向 seekerIntent)** | ❌ Admin **无任何写入入口** | Kiosk `FairDataScreen` 读 `stats.expectedAttendance/seekerIntent`;后端 `jobs.service.ts:891-892` 从 DB 列 `fair.expectedAttendance`/`seekerIntentJson` 读出;但全 admin 仓 grep `expectedAttendance/seekerIntent` **0 命中** | **真缺口**:DB 有列、Kiosk 会展示,但运营无法在后台录入/修改这两项;只能靠导入或直改库。industryDistribution 由已录企业聚合(真实,无需录入) |
| 招聘会**审核/发布**(approve/publish/unpublish) | ✅ 但**不在本页**,在「招聘会信息源」 | `fairs/index.tsx:1031` 副标题明示"审核/发布请到招聘会信息源";`fair-sources/index.tsx:93-108` | 设计如此(职责分离),非缺口 |

**各页面完成度与数据**:
- **招聘会管理 `fairs/`**:完成度高(~0.9),5 Tab(企业/展区/场馆导览/资料/统计)CRUD 齐全,空态/错误态/两步删除完备。缺口=booth 模型 + 数据大屏字段录入。
- **企业展示管理 `companies/`**:完成度高(~0.9),审核/发布/拒绝、展示信息编辑(含 4 个"详情页指标开关")、同来源机构岗位关联(linkJobs 带"须同来源+已发布"硬校验),合规红线明确。
- **岗位信息源 `job-sources/` / 招聘会信息源 `fair-sources/`**:完成度中(~0.8)。审核通过/发布/下架真实接线;但行内**「查看」按钮是死按钮**(无 onClick,`job-sources:201`、`fair-sources:216`);"打印活动资料"按钮(`fair-sources:241`)也无 onClick。客户端分页/搜索/筛选可用。
- **政策信息源 `policy-sources/`**:完成度高(~0.85),审核(含拒绝原因)/发布/下架全接真 `policiesAdmin`;info-only 合规文案到位。
- **API 同步数据源 `sync-sources/`**:完成度中(~0.8),列出 accessMode=api 源、手动触发同步、配置 response 字段映射(PUT response-config);mock 模式触发仅模拟(页面有明示)。内含 `MOCK_SOURCES` 兜底。
- **Excel 导入记录 `import-batches/`**:完成度中(~0.75),只读列表 + 筛选 + 跳转到岗位/招聘会信息源;无"确认导入"动作按钮(确认在合作机构端)。
- **合作机构管理 `partners/`**:完成度高(~0.9),机构增删改、启停(两步确认)、后台账号开通/停用/重置密码,密码不回显,启用模块多选(招聘闭环模块不在选项),合规说明完整。
- **AI 服务管理 `ai-services/`**:完成度高(~0.85),只读可观测面板(调用数/成功率/延迟/成本/Provider/失败分布/元数据日志),严格只展示 metadata 不展示简历/聊天原文。
- **AI 大模型 `ai-config/`**:完成度高(~0.85),按功能配 vendor/model/baseURL/systemPrompt/禁用词/温度/启用 + 连通测试;API Key 只存服务端不回显(HTTP-only adapter)。

**问题与可优化点**:(1) 招聘会/岗位信息源行内「查看」「打印活动资料」为无 onClick 死按钮,应补详情抽屉或移除;(2) **booth 展位数据模型缺失**——前台 `fairData.ts` 富展位数据 + 数据大屏 zoneBreakdown 在 HTTP 模式无后端来源,若产品要展示展位需补 booth 模型与 Admin 录入,否则一体机这块永远空;(3) **数据大屏 expectedAttendance/seekerIntent 无 Admin 录入入口**,建议在 EditFairDrawer 加这两个字段;(4) sync-sources 抽屉文案为英文(Configure response mapping / Save / Cancel),与全站中文不一致;(5) 全分片未发现任何支付/payment 代码(grep 0 命中),与"无支付"事实一致。

---

### Partner · 合作机构后台审计

**用途 / 面向谁 / 解决什么问题**：合作机构后台 (`apps/partner`) 面向高校就业中心、人力资源公司、招聘会主办方、政府公共就业服务机构、第三方数据聚合方等"来源机构"。它是一个纯**数据与运营管理后台**——让机构自助把岗位、招聘会、企业展示资料、政策公告录入/导入到平台，配置 API/Webhook/Excel 三种数据源接入方式，查看同步日志和本机构数据概览。所有内容统一走"机构提交 → 回 `pending+draft` → 管理员审核发布 → Kiosk 展示"的链路。**合规定位严守红线**：全程无求职者简历接收、无候选人/面试/Offer，岗位与招聘会只做第三方来源链接展示，求职者一律"去来源平台投递/预约"跳转。我在 `apps/partner/src` 全量 grep 未发现任何 payment/支付/收款/价格代码（与"全仓无支付"一致）。

**数据真伪（关键事实）**：默认 `VITE_API_MODE=mock`（`apps/partner/src/services/api/client.ts:3-4`），各 service 用 `API_MODE === 'http' ? httpAdapter : mockAdapter` 选适配器。**HTTP 模式下 11 个业务页的端点后端全部真实存在**，我逐一核对了后端路由（`jobs.controller.ts`、`companies.controller.ts`、`policies.controller.ts`、`partner-org.controller.ts`）——没有空挂的前端端点。`Page.tsx:16-20` 在 mock 模式会渲染醒目的"当前为 mock 模式…不会写入数据库"横幅，审计友好。

**各页面完成度与数据绑定**：

| 页面 | 路径 | 数据绑定 | 完成度 | 可自助 CRUD | 备注 |
|------|------|---------|--------|-------------|------|
| 工作台 Dashboard | `/` | real-api（mock 兜底） | 0.95 | 只读 | 指标全部来自 `GET /partner/dashboard` 真实计数；注释明确删了旧硬编码 METRICS/RECENT_SYNCS |
| 机构资料 Profile | `/profile` | real-api | 0.9 | 仅改 联系人/电话 | 名称/类型/场景模板/启用模块由 Admin 管（运营边界，后端 DTO 白名单 `partner-org.controller.ts:10-16`）；展示 PROHIBITED_MODULES 永久禁用红线 |
| 岗位信息管理 Jobs | `/jobs` | real-api | 1.0 | 新增/编辑/下架 | 新增走 import 端点 + `MANUAL-` 前缀；编辑回 pending+draft；文案合规 |
| 企业资料管理 Companies | `/companies` | real-api | 0.95 | 新增/编辑 | 来源企业展示资料；字段白名单与后端 CompanyFieldsDto 对齐；无下架按钮（仅 Admin 可下架，见 crudGap） |
| 招聘会信息管理 Fairs | `/fairs` | real-api | 1.0 | 新增/编辑/下架 | datetime-local ↔ ISO 转换；文案合规 |
| 政策公告管理 Policy | `/policy` | real-api | 1.0 | 新增/编辑/下架/删除 | info-only 提示完善；唯一带"删除"的页 |
| 数据源管理 Sources | `/sources` | real-api | 0.9 | 新增/启用停用 | API/Webhook/Excel 三轨；webhookSecret 仅创建时一次性下发；凭证 password 字段不回显 |
| Excel 导入 Modal | `/sources` 内 | real-api | 0.9 | 4 步导入向导 | parse→mapping→preview→confirm；T1 字段映射规则自动回填；导入完默认待审核 |
| 同步日志 Sync-logs | `/sync-logs` | real-api | 0.9 | 只读 + 详情抽屉 | 字段已与后端 SyncLogEntry 对齐；"重试"死按钮已删 |
| 数据统计 Stats | `/stats` | empty-stub | 0.1 | 无 | 纯 EmptyState 占位，无任何数据 |
| 终端数据 Terminals | `/terminals` | empty-stub | 0.1 | 无 | 纯 EmptyState 占位 |
| 账号权限 Account | `/account` | empty-stub | 0.1 | 无 | 纯 EmptyState 占位；后端无 `/partner/accounts*` 端点 |

**问题与可优化点**：
1. **3 个导航页是空壳**（数据统计/终端数据/账号权限）——侧边栏给了入口但点进去只有 EmptyState，后端无对应端点。上线前应么隐藏入口、要么明确标"建设中"，否则机构点进去会觉得功能缺失。
2. **场馆导览无 Partner 配置入口**（核心 crudGap）：Kiosk 招聘会详情读 `GET /job-fairs/:id/venue-guide`，但写入只有 `PUT /admin/fairs/:id/venue-guide`（Admin）。招聘会本是 Partner 维护的数据，导览却只能 Admin 配——与 CLAUDE.md §16 P1"场馆导览 Partner 配置入口/展厅平面图"待办一致。
3. **企业资料无 Partner 下架入口**：Companies 页只有"编辑"，无"下架"；Jobs/Fairs/Policy 都有下架。企业发布后若要临时撤下，Partner 只能改一个字段触发回 pending（迂回），或依赖 Admin。建议补 `unpublish` 一致性。
4. **数据源"测试连接"已主动移除**（`sources/index.tsx:397` 注释）——因后端无连通性测试端点，避免死按钮，处理得当；但这意味着机构配完 API 数据源无法自验，体验上可加一个轻量 ping。
5. Excel 导入 `onImported` 回调里 Jobs 列表不自动刷新（`sources/index.tsx:444-448` 仅 `console.info` + TODO），导入后需手动去 Jobs 页刷新。
6. Mock 适配器里 DATA_SOURCES/PARTNER_JOBS/SYNC_LOGS 等是写死的演示数据（`partnerMockAdapter.ts:30-74`），仅 mock 模式可见，http 模式不会混入，定位干净。

---

## 三、后端 API 与数据接口现状（含测试覆盖）

### 后端 services/api · 端点目录与真伪 + 测试覆盖

精读了 `services/api/src/**` 全部 33 个 `*.controller.ts` 与对应 service。整体结论：**后端不是 mock 层，是真实的 NestJS + Prisma 实现**。前台默认 `VITE_API_MODE=mock` 走的是 Kiosk 自己的 MockAdapter（与本后端无关）；后端这一侧几乎所有读写端点都真实落 Prisma 库，写端点齐备、合规边界守得很死（webhook 白名单拒收候选人字段、Partner 强制 `orgId` 取自 JWT、AI 输出双层拦截录用率/百分比、按钮文案全部「去来源平台投递/预约」）。全仓**确认无任何支付代码**——只在 3 处注释里明确写「不接支付/退款/核销」(`member-print-orders.controller.ts:19`、`member-benefits.controller.ts:16`、`member-benefits.module.ts:13`)，无 stripe/alipay/wechatpay/refund 逻辑。

**唯二的真 stub / 诚实留空：**
1. AI 文生图海报 `AiPosterController`（`content/ai-poster.controller.ts`）—— 一期 `AI_IMAGE_PROVIDER=disabled`，`status` 返回 `enabled:false`，生成/确认一律 400 `AI_POSTER_NOT_ENABLED`，不假装成功（`ai-poster.service.ts:73`）。属设计内二期能力。
2. 招聘会子资源里 **stats / map.booths / zoneBreakdown 诚实置空**：schema 无 `FairBooth` 模型，展位坐标未落库 → `getFairMap` 的 `booths:[]`、`getFairStats` 的 `scanCount/printCount/checkinCount/zoneBreakdown` 诚实置 0 并标 `dataSourceLabel:'预计 / 来源数据 · 非实时'`、`isMockData:false`（`jobs/jobs.service.ts:819-898`）。其余 companies/zones/materials/venue-guide 全部真实 Prisma 查询。

**写端点（POST/PUT/PATCH/DELETE）覆盖评估——前台需要的写入基本齐全：**

| 业务域 | Admin 写 | Partner 写 | 缺口 |
|---|---|---|---|
| 岗位 Job | 审核/发布 PATCH | import / 编辑 / 下架 | 无 |
| 招聘会 Fair（整场） | 审核/发布走 `/admin/fair-sources` | import/编辑/下架 | 无 |
| 招聘会子资源（企业/展区/资料/导览） | **全 CRUD**（`admin-fairs.controller.ts`：companies/zones/materials POST+PATCH+DELETE，venue-guide GET/PUT/DELETE） | **无任何写端点** | ⚠️ **Partner 不能维护本机构招聘会的参展企业/展区/资料/场馆导览**，全靠 Admin 代录。CLAUDE.md 也把「场馆导览 Partner 配置入口」列为 P1 待办，吻合 |
| 企业展示 CompanyProfile | 全 CRUD + 关联岗位 link/unlink | import / 编辑 | 无 |
| 政策 Policy | 审核/发布 PATCH | 新增/编辑/下架/删除 | 无 |
| 待机宣传屏 ad-assets/playlists/config | **全 CRUD**（`content.controller.ts`） | **无**（设计上待机屏由 Admin 统管） | 中性：当前无 Partner 待机屏诉求 |
| 数据源 DataSource | 审核相关 | 新增/启停 + Excel 三步导入 + webhook | 无 |
| 文件 File | list/cleanup | kiosk-upload/intent/complete/delete | 无 |
| 打印任务 | 流水只读 + Agent 回写状态 | — | 无（Kiosk 匿名 POST `/print/jobs`） |

**核心写端点缺口（CRUD-gap）：仅 1 处**——招聘会子资源（参展企业/展区/活动资料/场馆导览）前台 Kiosk 有完整展示（`GET /job-fairs/:id/companies|zones|map|materials|venue-guide`），Admin 后台有完整增改删，但 **Partner（来源机构）后台没有对应写入口**，只能由 Admin 代为录入。

**测试覆盖（37 个 `verify:*` npm 脚本 / 36 个 `scripts/verify-*.ts`，端到端真后端验证，无标准单测）：**

覆盖较好的核心流程：companies、policies、admin-fairs（含 venue-guide）、admin-orgs、partner-edit、member-auth、member-assets(含 c2d)、member-favorites/benefits/print-orders、ai-result-ownership、end-user-asset-ownership、mock-interview、job-fit、career-plan、resume-generate/optimize/extraction、real-resume-diagnosis、ocr-baidu(含 live)、materials-processing、activity-logs、trtc-ownership、llm-guard、job-sync、field-mapping、external-video、cos(files/live/storage)、sms-provider。

**未被任何 verify 脚本直接覆盖的端点 / 流程（建议补测）：**
- **`PrintJobsController`（`POST /print/jobs`、`GET /print/jobs/:taskId`）** —— Kiosk 匿名打印提交链路（fileUrl 验签 + SSRF 防护 + IP 限流），无专属 verify 脚本，属上线核心却未端到端验证。
- **`TerminalsController`** 终端注册/心跳/claim/patch-status/printer-status —— 靠 Phase 8 跨机 E2E（已封板）覆盖，但仓内无 `verify-terminals.ts`。
- **`ContentController` / 待机宣传屏**（ad-assets/playlists/screensaver-config/kiosk 拉取）—— 只有 `verify-external-video*`（外部视频登记），素材上传/播放方案/终端配置主链路无独立 verify。
- **`AuditController`（`GET /admin/audit-logs`）**、**`AiConfigController`（`/admin/ai-config*`）**、**`AiPosterController`**、**`admin/ai/usage|logs`** —— 无专属 verify 脚本。
- **Jobs/Fairs 的 Kiosk 公开读 + Admin 审核/发布状态机**（`jobs.controller.ts` 大量端点）—— 无 `verify-jobs.ts`/`verify-fairs.ts`（招聘会读取部分散落在 admin-fairs/venue-guide verify 内，但岗位审核状态机转换未见专测）。
- **Job-Sync 的 `GET/PUT response-config` 字段映射端点**（`job-sync.controller.ts:64-105`）—— `verify-job-sync` 主要测 trigger/enqueue，responseConfig 读写未必覆盖。

**安全/合规观察（均为正向，无违规）：** webhook(`sync.controller.ts`) 走 HMAC+时间窗+nonce、body 超白名单字段 400 拒收；Partner import 端点 `forbidNonWhitelisted` 拒候选人字段并强制 `sourceOrgId` 取自 JWT（`jobs.controller.ts:324`）；文件 `/content`、ad-asset、fair-material 均 HMAC 签名 URL + TTL，管理员访问用户文件写审计（`files.controller.ts:226`）；AI 结果归属用一次性 `x-resume-access-token`（不进 URL/日志）。`apiKey/apiSecret/webhookSecret` 创建后 GET 不回显，只回 `configured` 布尔。

**可优化点：** (1) 补 `PrintJobsController` 与待机屏 ContentController 的 verify 脚本，二者都是上线核心却无端到端守门；(2) 评估是否给 Partner 开放本机构招聘会子资源（企业/展区/资料/导览）的写入口，或在产品文档明确「招聘会子资源由 Admin 统一录入」以闭合该 CRUD-gap；(3) `job-sync.controller.ts` 多处用 `this.service['prisma']` 私有属性穿透访问 Prisma（`:73/:98/:100/:123`），属代码味道，建议下沉到 JobSyncService 方法。

---

## 四、⭐ 前台展示区 ↔ 后台增改入口 缺口矩阵（核心）

### 前台可见 / 后台不可改 — CRUD 缺口整改矩阵(已逐条核验源码)

核验方法: 去重合并 Phase1 全部 crudGaps, 逐条到 `apps/admin/src/routes/**`、`apps/partner/src/routes/**`、`services/api/src/**`(controller + DTO + service + prisma/schema.prisma)对照真实写端点。所有"MISSING"均为 grep 全仓 0 命中确认, 不只信 Phase1。合规口径: 仅整改"展示信息/现场服务/来源信息"录入入口, 不引入任何招聘闭环字段。

### 关键已核验事实(file:line)
- **招聘会基本信息表单严重缩水**: `EditFairDrawer`(`apps/admin/src/routes/fairs/index.tsx:250-296`)只编辑 title/theme/startAt/endAt/venue/city/address/description。`UpdateFairInfoDto`(`services/api/src/jobs/dto/admin-fair.dto.ts:24-55`)虽含 `mapImageUrl/coverImageUrl`, **但抽屉里连这两项输入框都没渲染**; 而 `latitude/longitude/trafficInfo/expectedAttendance/seekerIntentJson`(`prisma/schema.prisma:604-610`真实存在)在 DTO 和表单**双重缺失**。
- **参展企业岗位明细(FairCompanyPosition)无任何写入口**: 模型存在(`schema.prisma:685`), Kiosk 全程展示(`jobs.service.ts:777/793/856`), 但 `admin-fairs.service.ts` 只有 company/zone/material/venueGuide 的 create/update/delete, **没有任何 position 写方法**; 唯一写入在 `prisma/seed-fairs.ts:204-205`。Admin 加企业只能填 `jobsCount` 数字。
- **企业卡片富字段 seed-only**: `headquarters/registeredCapital/honorTags/foundedYear`(`schema.prisma:661-663`)前台展示, 但 `SaveFairCompanyDto` 只覆盖 name/industry/scale/description/sourceUrl/logoUrl/hiringTags/jobsCount。
- **FairBooth 模型不存在**(grep `model FairBooth` 0 命中): 展位网格/展位号/签到为 Kiosk mock 专属, HTTP 模式诚实空。
- **各市区创新特色展区(category=innovation)闭环完整**: `SaveFairZoneDto` 含 `category IN (innovation/service/campus_corp_topic)` + city + sortOrder(`admin-fair.dto.ts`), Admin 展区 Tab 可增删改 → **对照确认 PASS, 无缺口**。
- **活动资料/场馆导览闭环完整**(Admin): `admin-fairs.controller.ts:159-247` 全套 CRUD + HMAC 签名打印。但 Partner 无入口; 且 `fair-sources/index.tsx:241`「打印活动资料」、`job-sources/index.tsx:201` 与 `fair-sources/index.tsx:216`「查看」三个按钮**无 onClick(死按钮)**。
- **现场服务 / tagline / 入场方式 字段无任何后端落点**(grep `onsiteService/admission/tagline` 在 DTO 与 schema 0 命中) — 属前台展示位但后端无列, 需先定模型再谈入口。
- **Partner 招聘会子资源全缺**: 全仓无 `partner/fairs/:id/(companies|zones|materials|venue-guide)` 写端点; Partner 只能管招聘会主记录 + import/publish。
- **Partner 企业资料缺下架**: 有 `PATCH /partner/companies/:id`(编辑)+import, 无 publish 切换; Jobs/Fairs/Policy 都有下架。
- **Admin 用户/权限、Partner 账号/统计/终端**: 后端 `admin/users`、`admin/permissions`、`partner/accounts`、`partner/stats`、`partner/terminals` 端点 grep 全 0 命中 — 纯空壳占位。
- **简历素材库**: 无任何后端模型/路由(grep 0 命中), 前台硬编码且首页入口 `disabled:true`(`HomePage.tsx:294`)。
- **政策**: 后端 `POLICY_KINDS=['policy_guide','notice']`(`dto/policy.dto.ts:18`), Kiosk「就业政策/政策公告」Tab 可经 Partner 政策 CRUD 维护; 但「社保指南/就业登记」(`RenshiPage.tsx:189/245`)是硬编码办事模板, 现有 kind 枚举不覆盖, 无后台入口。
- **青岛专区 orphan**: `/qingdao` 已注册(`routes/index.tsx:72`)但无任何 HomePage 磁贴/底部导航链接(只在 AssistantPage 白名单出现路径串), 硬编码具体补贴金额(`QingdaoPage.tsx:51-94`)且不可达。
- **支付域确认完全不存在**: 仅 2 处注释明示"无支付域/不新增退款"(`member-print-orders.controller.ts:19`、`admin-ops.service.ts:10`), 无任何 payment/refund 实现。

### 整改优先级判定原则
- **P0(8月上线前必须能编辑)**: 生产新建数据后, 前台会出现"空区/占位/假数据"且属核心展示路径 → 招聘会基本信息字段(封面/地图/经纬度/交通)、参展企业岗位明细、青岛专区硬编码假补贴(合规风险, 建议直接下线入口)。
- **P1(上线后近期)**: 数据大屏录入、Partner 子资源/下架、死按钮详情抽屉、社保/就业登记内容化。
- **P2(择期)**: 展位模型、用户/权限/账号管理、统计报表、素材库后台。

### 整改矩阵(见下方结构化 matrix; whereNow=MISSING 表示后台无入口)

| 前台位置 | 内容区块 | 当前数据 | 后台有入口? | 写端点 | 建议归属 | 优先级 | 工作量 | 需复核 |
|---|---|---|---|---|---|---|---|---|
| 招聘会详情 概览/地图 | 封面图/地图底图/经纬度/交通指引 | real(库有列) | partial(DTO 有 map/coverImageUrl 但抽屉未渲染; 经纬度/交通 DTO缺) | 部分缺 | admin | P0 | M | 是 |
| 招聘会 参展企业卡下 | 岗位明细 FairCompanyPosition | real | MISSING | missing | admin | P0 | M | 是 |
| 青岛专区(orphan) | 政策/补贴金额/高校/园区/资讯 | hardcoded | MISSING | unknown | admin | P0(下线入口) | S | 是 |
| 招聘会 数据大屏 | 预计参会人数/求职意向分布 | real(库有列) | MISSING | missing | admin | P1 | M | 是 |
| 招聘会 参展企业卡 | 荣誉/成立年/总部/注册资本 | real(seed) | MISSING | missing | admin | P1 | S | 否 |
| 招聘会(Partner维护) | 参展企业/展区/资料/导览写入 | real | Partner MISSING | Admin有/Partner缺 | either | P1 | L | 否 |
| 企业资料(Partner) | 已发布企业下架 | real | MISSING(仅编辑) | missing | partner | P1 | S | 是 |
| Admin 岗位源/招聘会源 | 「查看」详情/「打印活动资料」死按钮 | real | partial(死按钮) | unknown | admin | P1 | S | 否 |
| 政策服务 社保指南/就业登记 | 办事指引模板 | hardcoded | MISSING | partial(kind枚举不覆盖) | partner | P1 | M | 是 |
| 政策服务 就业政策内置指引 | BUILTIN_GUIDES 5条 | hardcoded | partial(/policies可建) | yes | partner | P2 | S | 否 |
| 招聘会 展位网格/签到 | FairBooth/现场签到 | mock | MISSING(无模型) | missing | admin | P2(或下线) | L | 是 |
| 招聘会 现场服务/tagline/入场 | 现场服务/标语/入场方式 | (前台展示位) | MISSING(无库列) | missing | admin | P2 | M | 是 |
| Admin 用户管理 | 终端注册用户列表 | empty | MISSING | missing | admin | P2 | M | 否 |
| Admin 权限管理 | RBAC 角色 | empty | MISSING | missing | admin | P2 | L | 否 |
| Admin 外设管理 | 外设设备 | empty | MISSING | missing | admin | P2 | M | 否 |
| Admin 打印机 | 型号/SN/碳粉/纸盒列 | hardcoded(null) | MISSING(Agent未上报) | n/a | admin | P2 | M | 否 |
| Partner 数据统计 | 报表 | empty | MISSING | missing | partner | P2 | M | 否 |
| Partner 终端数据 | 关联终端统计 | empty | MISSING | missing | partner | P2 | M | 否 |
| Partner 账号权限 | 机构子账号 | empty | MISSING | missing | partner | P2 | L | 否 |
| 简历素材库 | 模板/求职信/作品集 | hardcoded | MISSING(首页入口disabled) | missing | admin | P2 | L | 否 |

注: "各市区创新特色展区""活动资料"经核验**已有完整 Admin 闭环, 非缺口**(已在事实段落标 PASS), 故未列入待整改行, 仅在下方 matrix 以 backendHasEntry=yes 记录对照。建议产品先就 P0 三项给出决策: (1)招聘会信息抽屉补字段; (2)企业岗位子表 CRUD; (3)青岛专区下线或接真(当前硬编码假补贴金额有合规风险)。

### 4.1 高影响缺口对抗复核结果

| 区块 | 复核结论 | 证据/更正 |
|---|---|---|
| FairCompanyPosition(岗位标题/薪资/学历/经验/招聘人数/分类) | confirmed-missing | 无需更正。全部企业/招聘会写端点已逐一核验，确无 FairCompanyPosition 的增删改入口。需补充的是：Admin admin-fairs 模块下应新增 positions 的 CRUD 端点(如 POST/PATCH/DELETE admin/fairs/:id/companies/:companyId/ |
| QINGDAO_POLICIES 硬编码补贴金额 / UNIVERSITIES / PARKS / NEWS_ITEMS | partial | orphan: /qingdao 注册于 apps/kiosk/src/routes/index.tsx:72；全仓唯一非路由引用是 apps/kiosk/src/pages/assistant/AssistantPage.tsx:47 的 ALLOWED_ROUTE_PREFIXES 字符串白名单（前缀守卫，非可点击 |
| 预计参会人数 expectedAttendance + 求职意向分布饼图 seekerIntentJson | confirmed-missing | 无需更正：断言成立。这两个字段当前没有任何 Admin/Partner UI 入口、没有任何写 DTO 字段、没有任何写端点，仅由 seed 脚本以硬编码值（8600/3200/5400 及对应意向分布）一次性灌入数据库。前台数据大屏展示的「预计参会人数 + 求职意向分布饼图」目前实质是 seed 静态数据，运营上线后 |
| 企业荣誉标签 honorTags / 成立年份 foundedYear / 总部 headquarters / 注册资本 registeredCapital | partial | 断言「没有增删改入口」对参展企业整体不成立——已存在 POST/PATCH/DELETE /admin/fairs/:id/companies(admin-fairs.controller.ts:99/106/118 + admin-fairs.service.ts:247/266/285)。但断言对所点名的 4 个字 |
| 本机构招聘会的 参展企业 / 展区 / 活动资料 / 场馆导览 写入口 | confirmed-missing | 无需更正断言本身——Partner 后台确实没有招聘会参展企业/展区/活动资料/场馆导览的增删改入口。需澄清的是:这些写入口并非整体缺失,而是按设计归属管理员后台(admin/fairs/* 全套 CRUD,admin-fairs.controller.ts),Partner 角色被有意排除。另注意 services/ |
| 已发布企业『下架』(unpublish) | actually-exists | 运营增删改与下架入口均已存在: (1) 已发布企业『下架』= Admin 后台企业详情抽屉的「下架」按钮 → PATCH /admin/companies/:id/publish {publish:false} → publishStatus 置 'unpublished' (companies.service.ts: |
| SOCIAL_GUIDES / REGISTER_ITEMS 办事指引模板 | confirmed-missing | 部分相邻能力已后端化，避免误读为「整个政策服务都缺入口」: (1) 政策扶持条目(policy_guide)与政策公告(notice)两个 Tab 的内容运营是可在 Partner 后台增删改、Admin 审核发布的——Partner 入口 apps/partner/src/routes/policy/index.ts |

---

## 五、Mock / 假数据与未打通接口 全量清单

### 仍是 mock / 假数据 / 接口未打通 — 全量清单（已逐项核验代码）

### 0. 最关键的全局事实：Kiosk「默认 mock」对上线的影响

- **`apps/kiosk/src/services/api/client.ts:17`** 默认 `API_MODE='mock'`，仅当 `VITE_API_MODE==='http'` 才走真后端。`.env.example` 默认 `VITE_API_MODE=mock`。
- **但当前所有三端 `.env.local` 都已切 http**：kiosk `.env.local` = `VITE_API_MODE=http / VITE_API_BASE_URL=/api/v1`；admin/partner `.env.local` = `http://192.168.0.153:3010/api/v1`。
- **上线影响（载荷性结论）**：生产构建时数据真伪完全取决于注入的 `VITE_API_MODE`。若 CI/CD 未显式注入 `=http`，则 Vite 内联默认值 `mock`，**整机展示 `apps/kiosk/src/data/fairData.ts` + `externalSources.ts` 的静态假招聘会/岗位/展位/补贴**——这是「上线即假数据」的单点失误风险。**P0 部署门禁**：生产构建必须强制 `VITE_API_MODE=http` 且 `VITE_API_BASE_URL` 指生产 API，并加构建期断言（mock 模式禁止进生产产物）。即使切 http，下面标注「http 模式诚实返回空/置 0」的区块仍会空（属诚实欠账，非假数据），标注「无后端端点」的才是真接口缺口。

### 1. Kiosk（一体机前台）

| 位置 | 现在是什么假数据 | 真实化要接的端点 | 优先级 | 阻塞依赖 |
|---|---|---|---|---|
| `data/fairData.ts` 全文 + `externalSources.ts` | f1/f2 招聘会展区/企业/岗位/**展位**/资料/大屏静态；MOCK_FAIRS 含假经纬度/预计人数/求职意向 | http 模式 `GET /job-fairs/:id/{companies,zones,materials,stats}`（真实 Prisma 已存在）；展位**无对应端点** | P0(构建门禁) | 生产 `VITE_API_MODE=http` |
| `FairMapPage` 展位网格 + `FairCompaniesPage` 签到徽章 | 展位号/状态/面积/企业签到全靠 mock；http 模式 `jobs.service.ts:835` booths 恒 `[]`、签到恒 `pending` | **后端无 FairBooth 模型**（需新建 or http 隐藏展位/签到 UI） | P1(产品决策) | 合规上不做现场签到 → 倾向隐藏 |
| `FairDataScreen` 预计参会人数/求职意向饼图 | `expectedAttendance/seekerIntentJson` 真库列但**仅 seed 写入**，`jobs.service.ts:891-892` 读它 | DB 列已在，但 **Admin EditFairDrawer 无录入入口**（grep admin 0 命中）→ 需补 `UpdateFairInfoDto` 字段 | P1 | Admin 无写表单 |
| `FairCompanyDetailPage` QrOverlay + handlePrint | 扫码弹层用占位 `QrCodeIcon` 非真二维码；打印按企业字段估算虚拟 PrintFile（无真实文件） | 改用 `SourceUrlQr`；打印应由后端生成企业资料 PDF 走签名 URL | P1 | — |
| `ScanProgressPage.tsx:38-50` | `mockFile()` 用 `Math.random()` 造文件名/页数/大小；整条扫描 = `setTimeout` 动画，不产生真实 FileObject | **Terminal Agent 无任何扫描代码**（无 TWAIN/WIA/chokidar/SMB/FTP），需真机扫描链路 | P1(真机) | Windows Agent 扫描模块未开发 |
| `materials.ts:135-220`（mock 模式） | inspection 恒 `pageCount:null`、pii_scan 恒 0 findings、pii_redact `resultFileCreated:false`（打印仍用原文件） | http 模式 `POST /materials/tasks` 真实（端点已就绪）；隐私遮挡产物真实生成需后端补 | P1 | 切 http；遮挡产物 P2 |
| `filesMockAdapter.ts:37-38` | mock 上传返回 `/mock/files/...` signedUrl + `mock-sha256`，预览不可用、无法提真实打印任务 | http 模式 `POST /files/kiosk-upload` 真实 | P0(构建门禁) | 切 http |
| `ResumeParsePage.tsx:17-21` | 四步进度（reading/ocr/extracting/diagnosing）是写死 800/1500/1200/1800ms 纯动画，与后端真实阶段无关 | 后端阶段事件/轮询，或弱化为不带误导阶段的 loading | P2 | 体验欠账非阻塞 |
| `aiMockAdapter.ts:27-116` | MOCK_REPORT/MOCK_OPTIMIZE_MODULES + 「演示用户」优化版简历 + chat 仅固定欢迎语 | http 模式 `POST /resume/parse|optimize`、`/assistant/chat` 真 LLM（`AI_PROVIDER=llm` 生产已接真） | P0(构建门禁) | 切 http |
| `ResumeTemplateLibraryPage.tsx:45-54` | 8 条素材库模板硬编码，打印按钮全 disabled；**首页入口 `HomePage.tsx:294` disabled:true 不可达** | **无任何后端模板模型/路由**（grep 0 命中）→ 需新建 admin/partner 模板 CRUD + 真实文件 | P2(产品决策) | 上线前建议下线或标建设中 |
| `ResumeExportPage.tsx:43` | 导出汇总页 file 占位「我的简历.pdf 248KB」，打印按钮全 disabled；与优化/预览页导出重叠 | 接真实导出文件，或下线合并 | P2 | 半废弃页，建议合并 |
| `LoginPage.tsx:511-551` | 微信/支付宝扫码登录二维码为本地 `ai-job-print://...?nonce=` 占位（已诚实标注待接入） | 微信/支付宝开放平台 OAuth 回调（手机验证码为主路径，但依赖 SMS 真发） | P1 | 第三方授权未接 |
| `QingdaoPage.tsx:51-230` | **QINGDAO_POLICIES 硬编码具体补贴金额（2000元/人、500万元安家、6000元/月租）无「演示」标记** → 触红线；UNIVERSITIES/PARKS/NEWS_ITEMS 全虚构 | **该页 orphan：`routes/index.tsx:72` 已注册但 HomePage/底部导航无入口**，仅 AssistantPage 路由白名单含 `/qingdao` | **P0(合规)** | 产品决策：下线，或接真 `/policies` + 加显著「演示/以官方为准」标注 |
| `RenshiPage.tsx:189-276` | SOCIAL_GUIDES/REGISTER_ITEMS 纯前端办事模板；社保/登记的扫码按钮多为 `onComingSoon` stub | 接真官方 URL 二维码（复用 OfficialEntryQrOverlay）；或纳入政策内容管理（Partner 录入→Admin 审核） | P2 | — |
| `RenshiPage.tsx:82-153` BUILTIN_GUIDES | 5 条内置补贴指引模板硬编码（官方 URL 真实），与后端 `/policies` 真实数据合并展示 | 后端已有 `/policies` 写链路（Partner→Admin 审核），建议逐步迁后端可维护 | P2 | — |
| `ProfilePage.tsx:135-150,408-428` | 「本次服务记录」仅来自 `location.state`，刷新即丢；未消费已就绪的 `/me/documents`、`/me/print-orders` | 后端 `/me/documents|print-orders|ai-records` 已就绪，需「我的」页接真明细 | P1 | 后端已就绪，前端未接 |
| `PrintUploadPage` qr/usb tab | 扫码上传/U盘导入 tab disabled 标注「待接入 Agent」，仅静态二维码图标 | **Agent 无 U盘监听/扫码接收代码** | P1(真机) | Windows Agent 未开发 |
| HomePage 8 个 disabled tile | 简历素材库/求职材料/岗位大师/扫码签到/证件复印/云打印/格式转换/证件照打印 均 `disabled:true` | 各依赖未实现的硬件能力/后端 | P2 | 诚实占位，非假数据 |

### 2. Admin（管理员后台）

| 位置 | 现在是什么假数据 | 真实化要接的端点 | 优先级 | 阻塞依赖 |
|---|---|---|---|---|
| `routes/users/index.tsx` | 整页 EmptyState +「用户数据接入中」，无数据无接口 | **后端无 `admin/users` 端点**（grep 0），EndUser 有数据 → 需补只读查询端点 | P1 | 端点缺失 |
| `routes/permissions/index.tsx` | EmptyState +「角色权限模型设计中」 | **后端无 RBAC 端点**，权限仅靠 `@Roles('admin')` 硬编码 | P2 | 模型未建 |
| `routes/peripherals/index.tsx` | 仅一个 EmptyState | 无数据源/接口 | P2 | 模型未建 |
| `routes/printers/index.tsx` 列 | 型号/SN/碳粉/纸盒列：后端 `terminals.service.ts:674-680` 硬编码 null（Agent 只报 printerStatus），页面显「未上报」 | **Agent 心跳需补耗材/SN 上报**，或砍列 | P2 | Agent 上报能力 |
| `routes/orders/index.tsx` | 打印任务真实可读但纯只读，无重打/取消/详情抽屉 | `GET /admin/print-tasks` 真实；运维写操作端点缺失 | P1 | 运维动作端点缺失 |
| `routes/alerts/index.tsx` | 实时派生告警，无独立 Alert 模型，不支持确认/指派/处理记录，条件恢复即消失（已诚实说明） | 需建 Alert 模型 + 处理流转端点 | P2 | 模型未建 |
| `routes/terminals/index.tsx` | 真实可读但纯只读，无解绑/远程重启/配置下发 | 需核实 Agent 是否支持远程指令下发（unknown） | P2 | 需核实 Agent |
| `routes/ai-config/index.tsx` | HTTP-only 无 mock 分支：无后端时直接报错（与其余 admin 页 mock 兜底口径不一致） | `GET/PUT /admin/ai-config` 真实，仅需后端在线 | P2 | — |
| `job-sources/index.tsx:201`、`fair-sources/index.tsx:216,241` | 行内「查看」「打印活动资料」按钮**无 onClick（死按钮）** | 审核/发布已真实接线，需补详情抽屉或移除按钮 | P1 | — |
| `adminMockAdapter.ts` / `files.ts:137-200` / `adminOps.ts:94-127` / `fairsAdmin.ts:298-509` | KSK-001~010 终端、12 条审计、8 条文件、pt-mock 任务、2 个演示招聘会等 inline mock | **仅 `API_MODE=mock` 生效；http 模式已被真实端点替代**（admin `.env.local` 已 http） | P0(构建门禁) | 生产须 `VITE_API_MODE=http` |
| `ai-poster.service.ts:24-80` | AI 文生图为 `DisabledAiPosterProvider`，生成/确认返回 400（一期诚实 stub） | 二期接真实文生图供应商 | P2 | 设计内二期，不阻塞 |

### 3. Partner（合作机构后台）

| 位置 | 现在是什么假数据 | 真实化要接的端点 | 优先级 | 阻塞依赖 |
|---|---|---|---|---|
| `routes/stats/index.tsx` | 纯 EmptyState「暂无统计数据」 | **无 partner stats 后端端点** → 上线前隐藏或标建设中 | P1 | 端点缺失 |
| `routes/terminals/index.tsx` | 纯 EmptyState「暂无终端数据」 | 无 partner terminals 端点 | P2 | 端点缺失 |
| `routes/account/index.tsx` | 纯 EmptyState「暂无账号配置」 | **无 `/partner/accounts*` 端点**，无法增删子账号（CLAUDE.md 第6阶段列了「账号权限」但未建） | P1 | 端点缺失 |
| `routes/companies/index.tsx:398-405` | 企业资料只有「编辑」无「下架」（Jobs/Fairs/Policy 都有下架） | 需确认/补 `partner/companies` 下架端点 | P1 | 后端下架端点待确认 |
| Partner 招聘会子资源（参展企业/展区/资料/场馆导览） | 这些写端点**仅 Admin 有**（`admin-fairs.controller.ts:99-247`），Partner 无入口，本机构招聘会内容只能 Admin 代录 | 产品决策：给 Partner 开放子资源写端点，或文档明确「Admin 统一录入」 | P1 | CLAUDE.md P1 待办（场馆导览 Partner 配置） |
| `login/index.tsx:96-97` | 页面底部明文写 dev 账号 `partner1/partner1` | 上线前移除明文测试账号提示 | P1 | — |
| `sources/index.tsx:444-448` | Excel 导入完成仅 `console.info + TODO`，未刷新岗位列表 | 补真实刷新/Toast | P2 | — |
| `sources` 测试连接 / `sync-logs` 重试 | 按钮已主动移除（后端无端点） | 连通性测试/日志重放端点缺失 | P2 | 端点缺失 |
| `partnerMockAdapter.ts:30-74` 等 inline mock | DATA_SOURCES/PARTNER_JOBS/FAIRS/SYNC_LOGS 演示数据 | 仅 `API_MODE=mock` 生效；http 模式走真实端点（partner `.env.local` 已 http） | P0(构建门禁) | 生产须 `VITE_API_MODE=http` |

### 4. 后端 / 基础设施（接口未打通，阻塞 C 端真实可用）

| 位置 | 现状 | 真实化 | 优先级 | 阻塞依赖 |
|---|---|---|---|---|
| `sms-sender.ts:101-105` | **TencentSmsSender.sendCode 直接 `throw SMS_PROVIDER_TENCENT_NOT_IMPLEMENTED`**，不发真实短信 | 补 SendSms API 调用（tc3.ts 签名可复用） | **P0** | 短信签名/模板审核通过 + 代码接入；否则 C 端手机验证码登录生产走不通 |
| `jobs.service.ts:819-898` | map.booths/zoneBreakdown/scan-print-checkin 计数因无 FairBooth 模型**诚实置空/置 0**（`isMockData:false`，非伪造） | 如做展位导览(P2)需新建 FairBooth 模型 + Admin 录入 | P2 | 模型未建 |
| `claude/openai/qwen/zhipu/local.provider.stub.ts` | 5 个 AI provider stub = NotImplementedException | 生产用 `AI_PROVIDER=llm`（真实），stub 不在生产路径 | — | 保留扩展位，无需处理 |
| `tencent-ocr.provider.stub.ts` | 腾讯 OCR 占位未接真 | 生产用 `OCR_PROVIDER=baidu`（已接真） | — | 不阻塞 |
| PrintJobs / Content 主链路 / Audit / AiConfig / jobs 状态机 | 端点真实但**无专属 verify-*.ts 守门** | 补 verify 脚本（端到端守门） | P1 | 上线核心打印链路无回归网 |
| 生产服务器 / PostgreSQL / COS 真机部署 | runbook+清单齐全但**全未执行**（无服务器/域名/证书/云账号） | 按 checklist 逐项验收 | **P0** | 上线最大阻塞集 |
| 文件自动清理 cron | 字段（expiresAt/软删）就绪，清理骨架具备 | 生产确认 cron 真实挂载 | P1 | — |
| **支付域** | **全仓确认无任何 payment/refund 实现代码**（grep src 仅 2 处注释/UI 按钮文案） | 当前业务模型不依赖支付即可上线 | — | 若 8 月打印收费才需新建 C-5，勿臆造 |

### 合规红线提示（审计中发现，建议本批处理）
- **`QingdaoPage.tsx:51-94` 硬编码具体补贴金额无演示标记**，且该页是 orphan（HomePage/导航无入口，仅 AssistantPage 路由白名单可达）。属「静态假数字」红线 + 不可达孤儿页双重问题，**建议上线前下线或加显著标注**。这是本次审计里唯一明确触碰「不允许静态假补贴数字」红线且无诚实标注的项。
- 各「投递/预约/扫码」按钮文案抽查均合规（未见「一键投递/立即投递/平台投递」）。

---

## 六、有功能无入口/页面 与补全设计

### 审计结论：有后端能力/数据模型，但前台缺实质入口、入口是死链或「建设中」的功能

聚焦"后端已 ready / 数据模型已存在，但前台拿不到"的缺口，按可落地的补全方案排列。所有方案严守合规红线（不投递、不收简历、不做招聘闭环；岗位/招聘会只做来源展示+外链）。已对每条用 file:line 复核。

---

### P0 — 后端完全就绪，前台明细页缺位（用户拿不到自己的数据）

**1. 「我的打印订单」明细列表（后端就绪，前台无消费页）**
- 现状：后端 `GET /me/print-orders` 已就绪（`services/api/src/member-print-orders/member-print-orders.controller.ts:21,27` `@Controller('me/print-orders')`），kiosk 已有 `getMyPrintOrders`（`apps/kiosk/src/services/api/memberPrintOrders.ts`）。但 ProfilePage 的「打印订单」入口仅 `tag:'本次记录'`（`ProfilePage.tsx:83`），只读 `location.state`，刷新即丢；全仓无任何页面真正列出历史打印订单。
- 设计方案：新建 `apps/kiosk/src/pages/profile/MyPrintOrdersPage.tsx`，路由 `/me/print-orders`；竖屏 2 列纵向卡片列表（文件名/份数/单双面/彩黑/状态/时间），消费 `getMyPrintOrders`（游标分页）。ProfilePage「打印订单」入口去掉 `本次记录` tag、改 `route:'/me/print-orders'`。无数据走 EmptyState（不造假数字）。同时承接「打印任务状态实时追踪 UI」(CLAUDE.md P1)：进行中任务轮询 `GET /print/jobs/:taskId`。前端为主，后端零改动。

**2. 「我的文档」明细列表（后端就绪，前台仅 location.state）**
- 现状：`GET /me/documents` 就绪（`member-assets.controller.ts:58`），kiosk 有 `getMyDocuments`（`memberAssets.ts`）。ProfilePage「我的文档」入口同样 `tag:'本次记录'`（`ProfilePage.tsx:81`），不消费真后端。
- 设计方案：新建 `MyDocumentsPage.tsx`，路由 `/me/documents`；列出用户上传/生成的文档（名称/类型/大小/有效期/状态），文件用临时签名 URL 打开（复用 `GET /files/:id/url`），过期文件诚实置灰。ProfilePage 入口改 `route:'/me/documents'`。合规：短 TTL、不长期留存、管理员访问留日志（后端已有）。

**3. 「我的收藏」明细列表（后端就绪，入口错指到 /jobs）**
- 现状：`GET /me/favorites` 就绪（`member-favorites.controller.ts:21`）。但 ProfilePage「我的收藏」入口直接 `route:'/jobs'`（`ProfilePage.tsx:84`），点进去是岗位列表不是收藏夹；`getMyFavorites` 目前只被 HomePage/overview 用于取 total 计数。inline `useFavorites` 仅在 jobs/fairs/policy 页做加/取消收藏。
- 设计方案：新建 `MyFavoritesPage.tsx`，路由 `/me/favorites`，按 `targetType`（job/fair/policy/company）分 Tab，消费 `getMyFavorites`，点击跳到对应来源详情。ProfilePage 入口改指 `/me/favorites`。纯前端 + 已有后端。

**4. 招聘会「浏览记录 / 预约跳转记录 / 扫码凭证」明细（后端就绪，三入口全是「建设中」）**
- 现状：`GET /me/browse-logs`、`GET /me/external-jump-logs`（含 DELETE）已就绪（`services/api/src/activity/me-activity.controller.ts:41,53,65,86`）。但 ProfilePage 三个对应入口全部 `tag:'建设中'`（`ProfilePage.tsx:104-106`），点击仅 toast「建设中」。CLAUDE.md 已宣称"浏览/外部跳转记录已接真"，与前台入口状态自相矛盾。
- 设计方案：按 2026-06-14 信息架构整改（明细归位业务页），在岗位/招聘会业务页内补「我浏览过的 / 我打开过的来源入口」抽屉或子页，消费上述两端点；ProfilePage 把这三项从「建设中」改为真实跳转或直接收口移除占位。合规关键：文案只记录"浏览/打开来源平台"，绝不出现投递/预约结果（后端模型已是这个口径）。「招聘会扫码凭证」若无对应模型则明确下线该入口，不留空壳。

---

### P1 — 数据模型/后端就绪，但运营侧（Admin/Partner）缺写入口，导致前台展示永远空

**5. 招聘会数据大屏「预计到会人数 / 求职意向分布」无 Admin 录入口**
- 现状：`expectedAttendance` / `seekerIntentJson` 是真库列，Kiosk 数据大屏读取展示（`jobs.service.ts:891-892`），但 `UpdateFairInfoDto`（`admin-fair.dto.ts:24`）与 Admin 招聘会编辑抽屉（`apps/admin/src/routes/fairs/index.tsx`）全仓 grep 这两字段 0 命中——只能靠 seed 写入，生产新建招聘会大屏永远显示「—/暂无意向分布」。
- 设计方案：①后端 `UpdateFairInfoDto` 补 `expectedAttendance?:number`、`seekerIntent?:{label,value}[]`（service 序列化为 `seekerIntentJson`）；②Admin EditFairDrawer 补两个输入区（数字 + 意向分布键值对编辑器）。合规：这是会务运营数据，非候选人数据，合规无虞。改动：后端 DTO/service + Admin 表单。

**6. 招聘会子资源（参展企业岗位明细/展区/资料/场馆导览）Partner 侧无写入口**
- 现状：写端点仅 `@Roles('admin')`（`admin-fairs.controller.ts:99-247`），Partner 全仓无 venue-guide / 参展企业 / 展区 写入口（`grep venue-guide apps/partner` 0 命中）。招聘会本是 Partner 维护的数据，但其内容只能 Admin 代录。CLAUDE.md 已把"场馆导览 Partner 配置入口"列 P1。
- 设计方案（二选一，需产品决策）：A. 给 Partner 开放招聘会子资源写端点（仍走 `pending` 重审），在 Partner 招聘会编辑抽屉补"参展企业/展区/场馆导览"子页；B. 在产品文档明确"招聘会子资源由 Admin 统一录入"以闭合 gap，并在 Partner 招聘会页加说明文案。推荐先做 A 的"场馆导览"最小入口（已有 PUT 端点，复用即可）。

**7. 参展企业「招聘岗位明细」(FairCompanyPosition) Admin 无录入口**
- 现状：前台逐岗位展示（薪资/学历/经验/招聘人数/分类）全靠 `FairCompanyPosition`，但 `SaveFairCompanyDto`（`admin-fair.dto.ts:57`）无 positions 字段，唯一写入在 `prisma/seed-fairs.ts:204`。生产新建招聘会企业卡下的岗位区永远为空。
- 设计方案：`SaveFairCompanyDto` 补 `positions[]` 子数组（title/salary/education/experience/headcount/category），service 做 upsert；Admin 参展企业抽屉补岗位子表编辑器。合规：这是招聘会现场岗位的"来源展示信息"，非平台内投递，文案沿用"查看岗位/去来源平台投递"。

**8. Admin「岗位信息源 / 招聘会信息源」行内「查看」「打印活动资料」是死按钮**
- 现状：`apps/admin/src/routes/job-sources/index.tsx:201` `<button>查看</button>` 无 onClick；`fair-sources/index.tsx:216` 「查看」、`:241` 「打印活动资料」均无 onClick。审核/发布/下架已真实接线，唯独详情查看是死链——管理员看不到单条完整详情。
- 设计方案：补详情抽屉（复用已有 `GET /jobs/:id`、`GET /job-fairs/:id`、`GET /admin/fairs/:id/materials`）；「打印活动资料」接已就绪的 `GET /job-fairs/materials/:id/content`（HMAC 签名链路）。若短期不做，至少移除死按钮避免误导。

**9. Partner「企业资料」缺「下架」入口（其他三类内容都有）**
- 现状：Partner companies 页只有「编辑」（`apps/partner/src/routes/companies/index.tsx:403`），无下架；而 jobs/fairs/policy 三页都有「下架」。后端也只有 `POST /partner/companies/import` + `PATCH /partner/companies/:id`（`companies.controller.ts:175,182`），无 unpublish 端点。机构要临时撤下已发布企业只能靠"编辑触发回 pending"迂回。
- 设计方案：①后端补 `PATCH /partner/companies/:id/publish`（toggle publishStatus，下架走 unpublished）；②Partner companies 行内补「下架」按钮，与 jobs/fairs/policy 一致。合规无影响（仅控制展示开关）。

---

### P1 — 前台页面已建但首页入口被禁用 / 页面 orphan（不可达）

**10. 简历素材库页已建，但首页入口 disabled 不可达 + 无后台维护**
- 现状：`ResumeTemplateLibraryPage.tsx` 已实现，但 HomePage「简历素材库」磁贴 `disabled:true`（`HomePage.tsx:294`），点不进去；素材是 8 条硬编码 `MATERIALS`，无 admin/partner 维护后台，打印按钮全 disabled。（注：ProfilePage「简历模板」`route:'/resume/templates'` 可达此页，但页内素材仍假、打印不可用。）
- 设计方案：分两步。短期：明确该页定位为"模板预览"，把硬编码 MATERIALS 标注"示例模板"，打印按钮保持诚实禁用，HomePage 入口暂保持 disabled。中期：新建后端 `ResumeTemplate` 模型 + Admin 模板管理 CRUD + 真实文件渲染，再放开首页入口。不要在无后台前提下放开入口展示假素材。

**11. 青岛专区页 orphan + 硬编码假补贴金额（合规风险）**
- 现状：`/qingdao` 已注册路由（`apps/kiosk/src/routes/index.tsx:72`），但 HomePage SERVICE_GROUPS 与底部导航均无链接，仅 AssistantPage 白名单提及（`AssistantPage.tsx:47`）——实际不可达 orphan。且 `QINGDAO_POLICIES` 硬编码具体补贴金额（`QingdaoPage.tsx:51-94`，2000元/人、安家500万、租房6000元/月）无"演示"标记，UNIVERSITIES/PARKS/NEWS 全虚构。
- 设计方案（需产品决策）：A. 下线该页（删路由 + 删文件 + 从 AssistantPage 白名单移除），最干净；B. 若要保留则接真后端（政策走 `GET /policies`，资讯走 `kind=notice`），高校/园区接真实数据源，并给所有 onComingSoon stub 接真官方 URL 二维码或移除。在接真前不要保留可达入口展示硬编码假金额（违反"不允许静态假数字"红线）。

---

### P1 — Admin 运营后台空占位页（侧边栏有入口，后端无端点）

**12. Admin 用户管理 / 权限管理 / 外设管理为纯占位（无后端端点）**
- 现状：`apps/admin/src/routes/users/index.tsx`（5 行灰条占位）、`permissions/index.tsx`（3 行灰条，标"角色权限模型设计中"）、`peripherals/index.tsx`（仅 EmptyState）。后端 grep `admin/users`、`admin/permissions` 0 命中；EndUser 模型存在（`schema.prisma:201`）但无 admin 查询端点。权限仅靠后端 `@Roles('admin')` 硬编码。
- 设计方案：①用户管理（先行）：后端补只读 `GET /admin/users`（列 EndUser：手机号脱敏/昵称/注册时间/最近活跃/订单数），Admin 页接真，不做停用写操作（先只读）。②权限/外设：上线前从侧边栏隐藏或统一标"建设中"，避免空入口误导；RBAC 角色模型为择期项，当前 `@Roles` 硬编码可上线。合规：用户管理只读、手机号脱敏、访问留审计日志。

---

### 已复核为"诚实欠账，非缺口"（不建议补，仅记录）

- 扫描/扫码上传/U盘导入（`PrintUploadPage` qr/usb tab disabled、ScanProgressPage setTimeout 动画）：依赖 Terminal Agent 真机硬件链路，前端已诚实标注"待接入 Agent"，属硬件未到位而非入口缺失。
- 告警中心无处理流转、订单无重打/取消：后端无独立 Alert 模型、告警为实时派生，页面已诚实说明；属运营闭环欠账，可择期。
- 支付域：全仓复核确认无任何 payment 代码，当前业务模型不依赖支付即可上线，不要臆造。
- AI provider stub / 腾讯 OCR stub / SMS 未实现：前两者非生产路径（生产用 `AI_PROVIDER=llm` + `OCR_PROVIDER=baidu`）；SMS 真发是独立 P0 阻塞项（`sms-sender.ts` 抛 NOT_IMPLEMENTED），属"接口齐全差真实调用"，不在本次"入口缺失"范畴。

---

## 七、基础设施：数据库 / 支付 / 部署 / 远程打印 / 打印机 / 密钥 / Provider

### 基础设施成熟度评估 — 面向 2026-08 上线

整体判断：**应用层与安全层已工程化就绪，但没有任何东西在真实生产环境跑过**。7 块里 4 块（数据库/部署/Provider真发/打印机能力）的成熟度上限被同一组外部资源阻塞卡住——服务器、域名+证书、生产 PG/Redis、云账号、Windows 真机、短信审核——这些都是**采购/审批类**而非编码类阻塞，需要立刻并行启动采购与审核流程，否则 8 月时间窗会被等待期吃掉。支付块是例外：**全仓确认无任何支付代码**（`grep payment/支付/alipay/stripe/refund` 仅命中登录页的微信/支付宝扫码登录 UI 占位与一条「不返回支付字段」的注释），当前业务模型不依赖支付即可上线。

### 关键纠正（基于真实代码，与输入分片不一致处）
1. **文件自动清理 cron 已真实挂载**，不是"仅骨架"：`services/api/src/app.module.ts:55` `ScheduleModule.forRoot()` + 4 个 `@Cron(EVERY_HOUR)` 任务（`files/files.cleanup.task.ts`、`ai/ai-result.cleanup.task.ts`、`materials/materials.cleanup.task.ts`、`activity/activity.service.ts:244`）。生产只需确认进程常驻即生效。
2. **打印参数 W7 已真机验证**：`apps/terminal-agent/src/printer/print-with-pdf-to-printer.ts:21` `mapParams()` 已把 copies/colorMode/duplex/orientation/scale/pageRange 映射到 SumatraPDF，并在 2026-06-03 Windows 11 + Pantum CM2800ADN 真机逐项验证（`docs/device/print-real-capability-hardening-checklist.md` §7）。**彩色 P10 已确认"真彩可用"**（§7 line 292），不是"未验证"。仅 `pagesPerSheet`/`quality` 无 SumatraPDF 支持（已在 UI 收口为固定值，诚实降级）。
3. **存储驱动静默回落风险确属真实**：`storage.service.ts:39` `FILE_STORAGE_DRIVER` 未设时默认 `local`（不报错），生产若漏配 `=cos` 文件只落本机磁盘——这是上线事故级隐患，runbook 已显著标注，但保护是"文档级"非"代码级"（设 `cos` 但缺 COS 凭证才会启动报错）。

### 安全基线（已坐实，质量高）
- COS 预签名 URL 严格复刻腾讯官方 SHA1 算法（`cos-signing.ts`），SecretId/Key 仅服务端、TTL 硬夹紧 ≤30min（`storage.service.ts:28`）。
- Webhook：HMAC-SHA256 + ±5min 时间窗 + nonce 防重放 + `timingSafeEqual`（`sync/sync.service.ts`、`replay-guard.ts`）。
- 凭证/手机号 AES-256-GCM 加密（`common/crypto/secret-cipher.ts`，keyed `SECRET_ENCRYPTION_KEY`）。
- 打印任务终态幂等（`terminals.service.ts:416` 终态早返回，不重写 DB）。
- OCR/百度密钥与 COS 密钥已于 2026-06-13 轮换并 live 复验（OCR `accurate_basic`/`pdf_ocr`、COS 真桶 put→get→delete 全过）。

### 必须在 8 月前完成的硬阻塞（按关键路径排序）
1. **采购生产资源**（服务器+部署权限、域名+HTTPS、PG16、Redis7、COS 生产桶）——一切部署/验收的前置，0% 完成。
2. **腾讯短信：外部审核 + 一步代码接入**。`member-auth/sms/sms-sender.ts:105` `TencentSmsSender.sendCode()` 仍 `throw SMS_PROVIDER_TENCENT_NOT_IMPLEMENTED`，**未引入腾讯云 SDK**。审核通过 ≠ 可发短信，还需在该方法内实现真实 SendSms。这阻塞 C 端手机验证码登录——若无替代登录则阻塞全部会员功能。
3. **法务审定隐私政策/用户协议**（`LegalDocPage.tsx` 现为"试运营"草稿，输入包已备齐 `launch-review-submissions.md` B 节）。
4. **生产 PG 实例实测**：本地+CI 已全绿（空库 deploy/seed/迁移演练/备份恢复/双 job 守门），但 Windows/云 PG 实例零实测。
5. **Windows 真机换机重验**：Phase 8 封板时跨机 E2E 通过，但生产 API 对接/新主机须按 checklist §五重走。

不臆造：奔图开放云打印 API 仅设计文档（彩色 mode 待厂家确认），**非上线必需**——本地驱动主方案已真机出纸。扫描/U盘/扫码上传 Agent 端**无任何代码**（无 TWAIN/WIA/chokidar），若 8 月承诺扫描闭环则为重大缺口，否则页面须保持"待接入"诚实标注。

---

## 八、文档与代码对账（声称状态 vs 实际）

### 文档对账 · 声称状态 vs 已知缺口 + 代码不一致

本节对账范围: `docs/progress/{current-progress.md,next-tasks.md,api-connectivity-audit-2026-06-05.md,project-state-audit-2026-06-06.md,mock-to-api-replacement-plan.md}`、`docs/product/{feature-scope.md,user-data-flow-matrix.md}`、`docs/compliance/compliance-boundary.md`。目的: 给整份审计报告校准——哪些是文档真实记录的已完成、哪些是文档自己承认的待办/阻塞、哪些是「文档说已接真但需后续阶段用代码核实」的疑似不一致项。

#### A. 文档声称「已完成 / 已接真」的功能清单 (文档自报状态, 非本节亲验)

| 功能 | 文档声称状态 | 关键佐证 (文档/代码) | 验证脚本 |
|---|---|---|---|
| AI简历诊断 (parse, 真实 LLM + 提取) | 已接真 | current-progress.md:50-52; Phase 1A/1B `LlmResumeService` + `AI_PROVIDER=llm` | verify-real-resume-diagnosis 18 PASS |
| 真实 OCR (百度 accurate_basic) | 已接真 (Stage 3, 2026-06-11) | next-tasks.md:196; `OCR_PROVIDER=baidu` | verify:ocr-baidu 12 + live |
| AI简历优化 / 生成 / 岗位匹配(2D) / 职业规划(2E) | 已接真 | current-progress.md:50-52,161-169; next-tasks.md:120-125 | verify:resume-optimize / job-fit 11 / career-plan 11 |
| 模拟面试 + 语音(ASR/TTS/数字人) | 已接真 | next-tasks.md:122 | verify:mock-interview 17 PASS |
| 企业展示/找企业 (CompanyProfile) | 已接真 (2026-06-12) | current-progress.md:134-145 | verify:companies 11 PASS |
| 浏览/外部跳转记录 (BrowseLog/ExternalJumpLog) | 已接真 (P1, 2026-06-12) | current-progress.md:149-159 | verify:activity-logs 12 PASS |
| 会员资产中心 C-2D (`/me/*` 六组) | 已接真 (2026-06-11) | next-tasks.md:223 | verify:member-assets-c2d 9 PASS |
| 政策服务页 `/renshi` 重设计 | 已接真 (2026-06-14) | current-progress.md:19-28 | tsc+eslint, 无独立 verify |
| Admin 招聘会/合作机构/订单告警接真 (1A/1B/1E) | 已接真 | next-tasks.md:102-106 | verify:admin-fairs 21/admin-orgs 14/admin-ops 3 |
| Partner 编辑能力/政策公告 (1C/1D) | 已接真 | next-tasks.md:104-105 | verify:partner-edit 9/policies 11 |
| 岗位/招聘会公开 API 切真 Prisma | 已接真 | api-connectivity-audit:52-63 (67端点实测) | — |
| COS 对象存储 + live 冒烟 | 已接真 + 密钥已轮换 | next-tasks.md:378-398 | verify:cos 37/cos:files 30/cos:live |
| PostgreSQL 生产底座 (代码/schema/CI) | 已完成代码层 | current-progress.md:99 | postgres-readiness CI |
| Windows Terminal Agent (Phase 8 封板) | 已完成代码 | CLAUDE.md §15 | Mac 跨机 E2E |
| 待机宣传屏一期 | 已完成 | next-tasks.md:517 | verify:external-video |

> 注意: 上述「已接真」均为**文档自报 + verify 脚本声称通过**。本节已抽样核实「无支付域」「SMS 未真实接入」「Kiosk 默认 mock」三点 (见 D 节), 其余 AI/业务链路的真伪需 mock 分片与后端分片对 C 节逐一坐实。

#### B. 文档自己记录的待办 / 阻塞 (无需怀疑, 是文档明示的缺口)

**上线前 5 项 P0 外部阻塞 (next-tasks.md:13-21, current-progress.md:118-127):**
1. 生产服务器/域名/HTTPS/生产 PostgreSQL/Redis/COS 桶 — 待用户提供资源
2. 线上浏览器闭环 35 链路 — 依赖生产域名
3. Windows 真机 + Terminal Agent + 奔图打印机真机验收 — 待硬件
4. 腾讯 SMS 签名/模板审核 **+ `TencentSmsSender.sendCode` 真实 SendSms 接入 + 真号 E2E** (文档反复强调「审核过 ≠ 可上线, 代码仍 throw NOT_IMPLEMENTED」)
5. 用户协议/隐私政策法务审定

**功能性已知缺口 (文档明示未实现, 不可宣称已上线):**
- 纸质扫描 `/scan/start`: 整条链路为前端流程演示 (定时器+假文件元数据), 不产生真实 FileObject (matrix 3.4:109)
- 证件复印/云打印/格式转换/证件照打印: 占位, 依赖硬件 (matrix 3.4)
- AI 助手会话不落库: schema 无 `AssistantConversation` 模型, 「我的」无问答记录 (matrix 3.7:134, 列 P2)
- 异常反馈 `FeedbackTicket`: 未实现 (matrix 3.8:140, 列 P2)
- 政策材料打印: 「参保证明打印」等仍为 info 卡, 无真实打印能力 (matrix 3.6:126)
- 简历素材库 / 求职材料 / 岗位大师 / 扫码签到: 首页占位入口未接线 (matrix 3.1/3.2/3.3)
- 真实订单/支付域 (Order/PaymentAttempt/Refund): 未建, 全线后置 (Phase C-5/E)
- 扫码登录 (微信/支付宝): 仅 UI 占位, 无真实授权回调 (next-tasks.md:225)
- 打印状态实时追踪 UI: 后端持久化就绪, 前端只能刷新查看 (P1)

#### C. 待核实不一致项 (文档说「已接真/已完成」但需后续阶段用代码坐实, 给出怀疑依据, 本节不亲跑)

| 项 | 文档声称 | 怀疑依据 / 需核实什么 |
|---|---|---|
| Kiosk 页面默认数据源 | 多处「Kiosk XX 页已接真」 | **关键校准点**: `client.ts:16-17` 默认 `API_MODE=mock`; `.env.example` 也是 mock。只有 `.env.local` (本机) 设 http。所以「已接真」指**后端端点存在且 http 模式下走真后端**, 但仓库默认构建/演示态仍渲染 mock 静态数据 (`data/fairData.ts`/`externalSources.ts` + `*MockAdapter`)。审计报告必须区分「端点已接真」vs「默认渲染 mock」, 不能把前者当成「用户看到的就是真数据」 |
| Admin orders/files/alerts/printers/partners 等页面 | next-tasks.md:106 称 1E「订单/告警接真」; 但 api-connectivity-audit §5 列 admin 9 页为 100% 前端 mock | **时间线冲突**: 审计 (06-05) 说这些是前端 mock 无 controller; 1A-1F (06-10) 之后部分声称接真。需核实 1E 实际新增了哪些 admin controller, 哪些页面 (orders/alerts/printers) 真切到了 http adapter, 哪些仍是 inline `MOCK_*`。mock-to-api-replacement-plan.md 列的 12 个 admin inline mock 是否已清除待核 |
| Partner dashboard/stats/policy 页面 | feature-scope 列 Partner 各模块; 1D 称政策公告 CRUD 完整 | api-connectivity-audit §5 (06-05) 称 partner dashboard/stats/policy 无端点保持 mock。1D 之后 policy 已建 `PolicyPost`; 但 partner **dashboard/stats** 是否仍 mock 需核实 |
| 招聘会 materials/stats/zones 子资源 | matrix 称 1A FairMaterial 接真; 但 audit §2.2:62-63 标「诚实空 (无模型)」 | 时间线: audit (06-05) 早于 1A (06-10)。1A 称建 `FairMaterial` 模型 + materials 端点接真。需核实 `/job-fairs/:id/materials` 是否已返回真实数据 (非诚实空), `/stats` 是否仍空 |
| 「AI 简历诊断由 MockAiProvider 产生」 | audit §2.8:145 (06-05) 称 parse 内容由 MockAiProvider 产生, 接真需凭证 | 与 Phase 1B (06-10, `AI_PROVIDER=llm` 真实化) 冲突。需核实当前默认 `AI_PROVIDER` 取值: 若 `.env` 未设 llm, 运行期仍可能走 mock provider。文档承认「待生产启用: `.env` 设 AI_PROVIDER=llm + Admin 配置中心启用」(next-tasks.md:121), 即**默认未必真**, 需核实 .env 实际值与 provider 选择逻辑 |
| 政策服务页 `/renshi` 真实数据 | current-progress.md:24 称「就业政策=后端审核发布政策在前 + 内置 BUILTIN_GUIDES 在后」 | 混合数据源: 后端政策 + 前端硬编码 `BUILTIN_GUIDES` 模板。需核实 `BUILTIN_GUIDES` 是否含具体补贴金额/办事步骤等可能过时或越界的硬编码内容; 且 mock 模式下 `policies.ts:58` 走内存演示数据 |
| CLAUDE.md §16/§18 自相矛盾的待办 | §18 仍把「Excel 导入+字段映射 UI」「字段映射引擎」「管理员审核页面」标 `[ ]` 未完成 | next-tasks.md:487,493 明确「实际已由 W4 完成, CLAUDE.md §16/§18 过时描述待校正」。即 CLAUDE.md 这两节是**已知陈旧文档**, 不能作为待办事实来源, 审计时以 next-tasks/current-progress 为准 |
| 「67 端点 0 bug 全联通」 | api-connectivity-audit:12 结论 | 该审计为 06-05 单次只读冒烟, 且多个端点标 🛡️「未实跑 (有副作用)」而非实测 2xx (import/publish/confirm 等)。结论「0 bug」覆盖面有限, 不能外推到 06-05 之后新增的所有端点 (companies/activity/career-plan/policies 等均在审计之后新增) |

#### D. 本节已抽样坐实的点 (可作为报告硬事实)

- **无支付域 确认**: 全仓 `services/api/src` + `apps/*/src` 仅 2 处命中 payment/支付/refund, 均为**注释与 UI 占位** (`admin-ops.service.ts:10` 注释「无支付域不编造金额」; `LoginPage.tsx` 微信/支付宝**扫码登录** UI 占位, 非支付)。与文档「支付后置、无 payment 代码」一致。
- **SMS 真实发送未实现 确认**: `services/api/src/member-auth/sms/sms-sender.ts:105` `TencentSmsSender.sendCode` 仍 `throw new Error('SMS_PROVIDER_TENCENT_NOT_IMPLEMENTED')`; 且 :39-47 有生产环境强制校验 (禁 log/mock)。文档对此口径诚实准确 (反复强调审核过≠可上线)。
- **Kiosk 默认 mock 确认**: `client.ts:16-17` 仅当 `VITE_API_MODE==='http'` 才用 http, 否则一律 mock; `.env.example` 默认 mock, `.env.local` (本机) 才是 http。

**校准结论**: 文档整体诚实度较高——P0 阻塞、SMS 未接入、扫描/助手会话/政策打印等缺口均如实标注, 未发现「明知未做却宣称已上线」的硬造假。最大风险是 **时间线错位**: `api-connectivity-audit (06-05)` 与 `project-state-audit (06-06)` 早于 1A-1F (06-10) 及之后大量接真工作, 其「mock 页面清单/MockAiProvider」结论已被部分推翻, 不能当作当前事实; 应以 current-progress / next-tasks 顶部最新条目为准, 并由 mock 分片与后端分片对 C 节逐项坐实。

---

## 九、8 月落地路线图

### 到 2026-08 上线路线图 — AI求职打印服务终端

**定位铁律**：信息展示+外链跳转，非招聘平台。本路线图不新增招聘闭环功能，只做「真数据打通 / 后台增改入口补齐 / 部署与真机验证」。

### 现状判定（已逐项核验代码）
- **代码成熟度高，阻塞集中在运维/部署与少量真数据断点**。云打印链路真机已通过(85%)、安全工程达生产标准(85%)、PG 底座本地+CI 全绿(75%)、AI/OCR 已真发(60%)。
- **唯一明确触红线项**：`/qingdao` 页硬编码具体补贴金额(2000元/人、500万安家、6000元/月租)无演示标注，且为不可达孤儿页(`routes/index.tsx:72` 注册，但 HomePage/底部导航无入口)。**上线前必处理**。
- **「上线即假数据」单点风险**：`client.ts` 仅认 `VITE_API_MODE==='http'`，否则默认 mock；生产构建若未注入 env 则整机渲染 `data/fairData.ts`/`externalSources.ts` 静态假数据。
- **C 端登录硬缺口**：`sms-sender.ts:105` `TencentSmsSender.sendCode()` 直接 throw `SMS_PROVIDER_TENCENT_NOT_IMPLEMENTED`，短信真发未实现+模板审核未过(周期最长)。
- **后端就绪但前端未接**：`/me/print-orders`、`/me/documents`、`/me/favorites`、`/me/ai-records`、`/me/browse-logs`、`/me/external-jump-logs` 全部存在；但 `ProfilePage.tsx` 入口用 `tag:'本次记录'`/`tag:'建设中'`，且「我的收藏」错指 `route:'/jobs'`。
- **无支付域**（已复核：grep 仅命中 `admin-ops` 审计串与 `LoginPage` 扫码登录占位）。8 月上线不依赖支付；线下现金/扫码收款(不入系统)是规避支付域的合规最快路径。

### 阶段甘特总览

| 阶段 | 窗口 | 目标 | 退出标准(关键) |
|------|------|------|------|
| **P1 红线+真数据收口** | 6/14–6/30 | 清合规红线、消「上线即假数据」单点、补 SMS 真发代码、提交短信审核、接通「我的」真后端 | Qingdao 处置完;构建期强制 http 断言;SMS 代码就位待审核;`/me/*` 明细接真 |
| **P2 后台增改入口** | 7/1–7/15 | 补齐 Admin/Partner 增改入口与死按钮,让 http 模式新建数据不空 | 招聘会大屏/封面/经纬度可录;参展企业岗位可录;死按钮接线;明文测试账号移除 |
| **P3 部署+真机** | 7/16–7/31 | 采购资源,按 runbook 全程部署预生产,真机复验打印/扫描决策 | 预生产域名跑通线上浏览器闭环;PG 实测;生产密钥签发;奔图真机复验彩色+双面 |
| **P4 上线收尾** | 8/1–8/15 | 切生产、SMS 真号 E2E、回填验收清单、灰度观察 | 全 checklist §三/四/五打勾;SMS 真号通;health=postgres;灰度无 P0 |

### 甘特式任务清单(倒排)

```
6/14 ──────────────── 6/30 ──────────────── 7/15 ──────────────── 7/31 ──────────────── 8/15
[P1 红线+真数据]
  ▓▓ Qingdao 处置(下线 or 接真+演示标注)        S/P0
  ▓▓ 构建期强制 VITE_API_MODE=http 断言(三端)    S/P0
  ▓▓▓▓ SMS 真发代码(复用 tc3.ts)+提交模板审核    M/P0  ←审核周期跨到 P3
  ▓▓▓▓ 「我的」/me/* 明细页接真(订单/文档/收藏/记录) M/P0
       [P2 后台增改入口]
         ▓▓▓ 招聘会大屏字段+封面/经纬度 Admin 录入  M/P1
         ▓▓▓ 参展企业岗位明细(SaveFairCompanyDto)   M/P1
         ▓▓ Admin 信息源死按钮接线/移除             S/P1
         ▓ Partner 明文测试账号移除 partner1/partner1 S/P1
         ▓▓ FairBooth/Partner 子资源 产品决策(隐藏 or 建模) L/P1
                [P3 部署+真机]
                  ▓▓▓▓▓ 采购+部署预生产(API/PG/Redis/nginx) L/P0
                  ▓▓ FILE_STORAGE_DRIVER 生产强制显式(代码护栏) S/P0
                  ▓▓▓ 生产密钥签发+最小权限(5服务端key+云Provider) M/P0
                  ▓▓▓ 奔图真机复验 彩色/双面/份数/断网恢复     L/P0
                  ▓▓ 线上浏览器 35 项闭环                       M/P0
                       [P4 上线收尾]
                         ▓▓ SMS 真号 E2E(审核通过后)            
                         ▓▓ 切生产+回填 checklist+灰度观察      
```

**关键依赖链**：短信模板审核(6/30 提交→最长周期)是 SMS 上线的长线;若 8 月前走不通,须启用 C 端登录降级方案(否则会员闭环阻塞)。部署(P3)依赖采购到服务器/域名/证书/云账号——是当前最大外部阻塞。

