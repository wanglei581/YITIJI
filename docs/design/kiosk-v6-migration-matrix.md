# Kiosk V6 逐页迁移矩阵

> 基准原型：`docs/design/kiosk-ai-os-v3-2026-08/`（目录名 `v3` 是历史命名，产品口径为 **V6**；首页真值 `01-home-v6.html`；交付集 50 页，见该目录 `pages.json`）
> 待替换现状：`docs/design/kiosk-proto-2026-07/`（Gen 1，只读回归基线，**不是设计口径**）
> 生产实现：`apps/kiosk/src/`
> 生成日期：2026-08-18 · 本文档为只读调研产物，未改任何源码
>
> 上位口径：闭环定义见 [`../reviews/2026-08-12-v6-commercial-product-audit.md`](../reviews/2026-08-12-v6-commercial-product-audit.md) §4 / §7；执行队列见 [`../progress/next-tasks.md`](../progress/next-tasks.md)「2026-08-12 V6 + 双后台统一施工队列」。
> **本表是那两处的可执行化，不是第三套口径。**两者冲突时以审查文档 §4/§7 为准，本表只补「哪个原型页 → 哪些实现文件 → 现在什么风格 → 拆不拆 → 谁先谁后」。

---

## 一、这张表回答什么

产品负责人的目标是全站 V6。仓库里此前**没有 V6 的逐页迁移矩阵** —— 现有的 `kiosk-proto-2026-07-migration-matrix.md` 是 Gen 1 的 75 屏矩阵，口径已经不是当前设计。结果是每个执行者对「这一页该改成什么样」的理解都不同。

这张表钉死四件事：

1. **每个 V6 原型页对应实现里的哪些文件** —— 一对多必须逐个列出，工作量按实现文件数算，不按原型页数算。
2. **每个实现文件现在是什么风格** —— 判据只认代码，不认注释（见 §二）。
3. **哪些页在实现时要拆成多页** —— 判据是「这个功能需不需要整屏」，不是「能不能塞得下」。**页数不是越少越好。**
4. **每一批要付多少门禁成本** —— 路由数变化会打穿 13 处产物（见 §六）。

### 已落定的产品裁决（2026-08-18）

| 裁决 | 内容 | 落在本表哪里 |
|---|---|---|
| 取件码形态 | **统一 4 位纯数字**。原型 `41` 的形态是对的，`06` 的 10 位、`23`/`42`/`43` 的 `P-4172` 都要改 | §七-B、批 1 相关行 |
| 取件码命名 | **「打印取件码」与「文件取回码」是两个概念，不得混称** | §七-B-2 |
| 招聘会 AI 单 | 对**已结束**场次，从「出发前逐项核对」改为**「回顾 / 资料整理」**语义 | 批 4 `FairVisitPlanPage` 行 |

> ⚠️ 取件码裁决**不是只改原型** —— 生产代码目前是 10 位字母数字，须同步修改 3 处（§七-B-1）。
> 4 位数字的键空间与枚举面**标为待补**，需产品与后端共同补方案（§七-B-3），本表不自拟。

---

## 二、判读规则：怎么判定「这一页是不是 V6」

**唯一可信判据是代码。**满足以下任一即为 V6：

- 渲染 `V6HomeView` / `V6PrintHubView`
- `import` 了 `home-v6.css` / `print-hub-v6.css`
- 路由命中 `KioskRoot.tsx:113` 的 `isV6Route`，从而挂上 `v6-runtime-shell` 类名

**注释不算判据。**反例：`apps/kiosk/src/pages/resume/CareerPlanPage.tsx` 注释写「视觉真值 22-career-plan.html」，但它实际 `import` 的是 `careerPlan-lightflow.css` + `resume-fusion-youth.css`，与 V6 无关。按注释盘点会得到假的完成度。

**当前 V6 真实覆盖面（`origin/main@15d9333d9` 取证）：**

```
apps/kiosk/src/layouts/KioskRoot.tsx:113
  const isV6Route = pathname === '/' || pathname === '/print-scan'
```

| 项 | 数量 |
|---|---|
| `*Page.tsx` 实现文件 | 102 |
| 路由条目（不含 `path: '*'` 兜底） | 106 |
| **已是 V6 的路由** | **2**（`/`、`/print-scan`） |
| 已是 V6 的实现文件 | 2（`HomePage.tsx`、`PrintScanHomePage.tsx`） |
| V6 原型交付集页数 | 50 |

---

## 三、现状风格总账（本表最重要的一张底账）

盘点前的说法是「旧风格至少 3 种」。**实测是 9 类**，且分布极不均匀：

| # | 风格家族 | 判据（页面级 css import） | 页数 | 迁移难度 |
|---|---|---|---|---|
| 1 | **V6**（目标态） | `home-v6.css` / `print-hub-v6.css` | 2 | — |
| 2 | **无页面级 CSS**（纯 `@ai-job-print/ui`） | 无任何 `.css` import | **37** | **最低** |
| 3 | inkpaper | `*-inkpaper.css` | 17 | 中 |
| 4 | lightflow | `*-lightflow.css` | 11 | 中 |
| 5 | service-desk | `*-service-desk.css` | 10 | 中 |
| 6 | fusion / fusion-youth | `*-fusion.css`、`resume-fusion-youth.css` | 9（+13 处叠加） | 中高 |
| 7 | service-hub-editorial | `service-hub-editorial.css` | 5 | 低（同一张表） |
| 8 | batch8 | `*-batch8.css` | 5 | 中 |
| 9 | **prototype-v1（Gen 1 原型样式表）** | `styles/prototype-v1.css` | 4 | 高（直接继承旧原型） |
| 10 | 自绘独立 | `contract-review.css` / `print-pickup-claim.css` / `toolbox-zone.css` | 5 | 中 |

### 由此得出的关键策略结论

**第 2 类（37 页，占实现面 36%）没有任何页面级 CSS**，它们的外观完全由 `KioskLayout` 的 `visualTheme="service-desk"` + `presentation="fusion-youth"` 决定。这 37 页包括 **全部 7 个 print 页、全部 10 个 job-fairs 页、jobs / companies / offline-agencies / smart-campus 全家**。

含义：**把 `v6-runtime-shell` 从 `KioskRoot.tsx:113` 的两路由白名单改成默认壳，一次就能推动 37 页**，因为它们没有会打架的页面级样式。反过来，第 3–9 类的 63 页每一页都要单独处理页面级 CSS。

> 这条建议只做架构判断，不在本轮实施 —— 壳层改默认会同时影响 `hideBottomNav` / `usesPageActionbar` / `brandTitle` 三条分支，须单独立任务并跑 W2/W4/W5/W6 全套。

---

## 四、迁移矩阵（按批次分组）

**列说明**

- **实现文件**：一对多逐个列出；`(批N)` 表示该文件在别的批次里结算，此处不重复计工。
- **当前风格**：见 §三 编号。
- **当前缺口**：接线/UI/伪造能力三类，闭环定义引自审查文档 §4（P 编号沿用该文档）。
- **拆页**：`保持` / `已拆` / `建议拆 N 页`。判据是「需不需要整屏」。
- **依赖**：这一页要真做完，卡在什么外部条件上。

---

### 批 0 · 止血：6 个服务域 hub 统一 V6 壳

**约 8 文件**（5 个 hub tsx + `service-hub-editorial.css` + 首页 `serviceGroups.ts` + 壳层分支）。已有同事在做。

| 原型页 | 一句话 | 实现文件 | 当前风格 | 当前缺口 | 拆页 | 依赖 |
|---|---|---|---|---|---|---|
| `39-print-hub.html` | 打印域首屏 | `pages/print-scan/PrintScanHomePage.tsx` | ① V6 | **本批基准**；能力探测失败不得误置 ok | 保持 | 无 |
| `32-resume-hub.html` | 简历域分流 | `pages/resume/ResumeServiceHubPage.tsx` | ⑦ | intent/need 只在 URL，门禁不消费 | 保持 | 身份前置 |
| `34-jobs-hub.html` | 岗位域分流 | `pages/jobs/JobsServiceHubPage.tsx` | ⑦ | 分流需真实能力与对象上下文 | 保持 | 岗位真实数据 |
| `36-fairs-hub.html` | 招聘会域分流 | `pages/job-fairs/FairsServiceHubPage.tsx` | ⑦ | 筛选只拼 URL；「免费」无报价证明 | 保持 | 招聘会真实数据 |
| `37-interview-hub.html` | 面试域分流 | `pages/interview/InterviewServiceHubPage.tsx` | ⑦ | 缺目标时移除 href（应保留可聚焦 disabled + 原因） | 保持 | 会话前置 |
| `38-policy-hub.html` | 政策域分流 | `pages/policy/PolicyServiceHubPage.tsx` | ⑦ | 资格字段不全；「官方」缺核验（页内注释已如实降级为「来源链接」） | 保持 | 官方域名白名单 |

**门禁成本**：0 条路由变更、0 张新截图（不拆页、不增路由）。

---

### 批 1 · 打印闭环

**17 文件**。这是唯一已经跑通真机出纸的域，也是 V6 基准页所在域，优先级最高。

| 原型页 | 一句话 | 实现文件 | 当前风格 | 当前缺口 | 拆页 | 依赖 |
|---|---|---|---|---|---|---|
| `06-print-workbench.html` | 打印工作台（**一页对 8 个实现页**） | `pages/print/PrintUploadPage.tsx` | ② | 文件 provenance 未闭环 | 保持 | 上传会话 |
| ↑ | | `pages/print/PrintMaterialCheckPage.tsx` | ② | 材料检查结果未落服务端 | 保持 | — |
| ↑ | | `pages/print/PrintPreviewPage.tsx`（699 行） | ② | **预览与参数挤在同一屏**（`/print/params` 已于 2026-08-18 重定向到本页） | **建议拆 2 页**（见 §五-1） | 产品裁决 |
| ↑ | | `pages/print/PrintConfirmPage.tsx`（741 行） | ② | 核价/权益/支付为原型态；**超 CLAUDE.md §8 的 500 行评估线** | 保持（但须评估拆分） | 权益核销规则 |
| ↑ | | `pages/print/PrintCashierPage.tsx` | ② | 支付、退款未闭环 | 保持 | 真实支付通道 |
| ↑ | | `pages/print/PrintProgressPage.tsx` | ② | attempt/outcome 未接 Agent 真值 | 保持 | Terminal Agent |
| ↑ | | `pages/print/PrintDonePage.tsx` | ② | 履约结果为原型态 | 保持 | 真机出纸 |
| ↑ | | `pages/print/PrintPickupClaimPage.tsx` | ⑩ | **产品裁决 4 位数字，本页现为 10 位字母数字，须改**（`:25-27`）；实现时以裁决为准，不以原型也不以现状为准。碰撞面待补，见 §七-B | 保持 | **§七-B 唯一性作用域待补** |
| `07-scan-workbench.html` | 扫描工作台 | `pages/scan/ScanStartPage.tsx` | ⑥ | 格式/DPI/ADF 超出现有 Agent 合同 | 保持 | 扫描仪真机 |
| ↑ | | `pages/scan/ScanSettingsPage.tsx` | ⑥ | 同上；参数未落 ScanTask | 保持 | Agent 参数扩展 |
| ↑ | | `pages/scan/ScanProgressPage.tsx` | ⑥ | 迟到任务 fencing 缺失 | 保持 | Agent |
| ↑ | | `pages/scan/ScanResultPage.tsx` | ⑥ | 无真实文件产物 | **建议拆 2 页**（见 §五-2） | 真实扫描产物 |
| `08-file-tools.html` | 文件加工（转换/签章） | `pages/print-scan/ConvertImagesPage.tsx` | ⑥ | **伪造能力：点一下就显示「已合成」**（纯 DOM，见 §七-A） | **建议拆 2 页**（见 §五-3） | 服务端 compose |
| ↑ | | `pages/print-scan/SignStampPage.tsx` | ⑥ | 签章参数未落后端；授权确认缺失 | 建议拆 2 页 | 服务端 compose |
| ↑ | | `pages/print-scan/PrintScanFeatureInfoPage.tsx` | ⑥ | 能力说明页；`29-id-photo` 的锁定态挂在这里 | 保持 | 保持锁定 |
| `05-phone-relay.html` | 手机接力（390×844 独立验收） | `pages/upload/PhoneUploadPage.tsx` | ⑤ | 上传/拍照/登录未接真实会话；**W1-D4 durable staging cap 未关闭前不得宣称商用 GO** | 保持 | 会话生命周期 |
| `41-fulfillment-states.html` | 履约状态样板页 | 落在 `PrintProgressPage` / `PrintDonePage` 状态层 | ② | 支付/退款/补偿/续打/领取均为原型；**取件码 4 位数字形态符合裁决，本页是该口径的正确参照** | 保持 | 订单状态机 |
| `47-arrival-code.html` | 到机码核销 | 同 `PrintPickupClaimPage.tsx` | ⑩ | 「本机不校验」的诚实标注是**正确做法**；但文案写「这 10 位码」，**与 4 位裁决不符，须改** | 保持 | 无 |

**门禁成本**：若采纳 §五-1/2/3 全部拆页 → **+4 路由**（详见 §六）。

---

### 批 2 · 简历与 AI

**22 文件**。

| 原型页 | 一句话 | 实现文件 | 当前风格 | 当前缺口 | 拆页 | 依赖 |
|---|---|---|---|---|---|---|
| `09-resume-workbench.html` | 简历工作台 | `pages/resume/ResumeSourcePage.tsx` | ④⑥ | 来源选择已接真 OCR | 保持 | — |
| ↑ | | `pages/resume/ResumeParsePage.tsx` | ④⑥ | 低置信度规则须显性 | 保持 | OCR 置信度 |
| ↑ | | `pages/resume/ResumeReportPage.tsx` | ④⑥ | 版本/导出不持久 | 保持 | 不可变版本 |
| ↑ | | `pages/resume/ResumeGeneratePage.tsx` | ④⑥ | 生成参数与结果同屏 | 建议拆 2 页 | 真实 artifact |
| ↑ | | `pages/resume/ResumeGeneratePreviewPage.tsx` | ④⑥ | 预览未接真实 export artifact | 保持 | artifact |
| `09b-resume-optimize.html` | 优化前后对比 | `pages/resume/ResumeOptimizePage.tsx`（537 行） | ④⑥ | 优化参数页 | **已拆** | — |
| ↑ | | `pages/resume/ResumeOptimizeComparePage.tsx`（366 行） | ④⑥ | **已独占一页，符合新口径**；仍须把排版/模板参数移出（见 §五-4） | **已拆，再收口** | ReactDiffViewer |
| `10-resume-interview.html` | 访谈式生成 | `pages/resume/ResumeGeneratePage.tsx`（共用） | ④⑥ | 一次生成提交、语音能力探测未接 | 保持 | ASR 能力 |
| `11-jobfit-compare.html` | 岗位匹配对比 | `pages/resume/JobFitPage.tsx` | ③⑥ | 多岗、报告、对象 ID 不完整 | **建议拆 2 页**（见 §五-5） | consent + 真实 jobId |
| ↑ | | `pages/resume/JobFitActionsPage.tsx` | ③⑥ | 差距行动项未落 artifact | 保持 | — |
| `12-material-factory.html` | 材料工厂 | `pages/resume/JobMaterialLibraryPage.tsx` | ④⑥ | tone/length/再生成/清单为样例 | 建议拆 2 页 | 登录前置 |
| `22-career-plan.html` | 职业规划 | `pages/resume/CareerPlanPage.tsx` | ④⑥ | 缺 `resumeTaskId` 前置；**注释谎报视觉真值（见 §二）** | 保持 | 简历任务校验 |
| `28-self-assessment.html` | 自我评估（25 题） | `pages/resume/SelfAssessmentFlow.tsx`（内含 4 个页面组件，4 路由） | ④⑥ | consent、历史、打印/带走仅本地 | 保持 | consent version |
| `33-resume-templates.html` | 模板库 | `pages/resume/ResumeTemplateLibraryPage.tsx` | ④⑥ | AI 目标生成、套用、打印是硬编码 | 保持 | 模板 API |
| — | 导出 | `pages/resume/ResumeExportPage.tsx` | ④⑥ | 真实 export artifact 缺失 | 保持 | artifact |
| `20-interview-pod.html` | 模拟面试 | `pages/interview/InterviewSetupPage.tsx` | ⑤ | 面试 FSM 未接 | 保持 | interviewId |
| ↑ | | `pages/interview/InterviewSessionPage.tsx` | ⑤ | ASR/TTS 能力未探测；隐私文案与上传转写冲突 | 保持 | ASR/TTS |
| ↑ | | `pages/interview/InterviewReportPage.tsx` | ⑤ | **伪造能力：原型点一下显示「已存进我的文档」**（见 §七-A）；原型的 `QJ-4423` 是**文件取回码**，**不得叫「取件码」**（见 §七-B-2） | 保持 | 报告 artifact |
| `37a-interview-tips.html` | 面试锦囊 | `pages/interview/InterviewTipsPage.tsx` | ⑤ | 内容为静态 | 保持 | — |
| `37b-interview-reports.html` | 历史报告 | `pages/interview/InterviewReportsPage.tsx` | ⑤ | **登录后回不来**（returnTo 未白名单化） | 保持 | returnTo 白名单 |
| `25-advisor.html` / `26-advisor-work.html` | AI 顾问「小青」 | `pages/assistant/AssistantPage.tsx` | ③⑧ | 输入无提交；钉住/打印/保存缺失；**`.msg-pin` 触控 ~26px（见 §七-D）** | 建议拆 2 页 | session/chat API |
| — | AI 方案确认 | `pages/ai-plan/AiPlanPage.tsx` | ⑨ **Gen 1 样式表** | 直接 import `prototype-v1.css`，是 Gen 1 残留 | 保持 | — |

---

### 批 3 · 我的

**14 文件**。V6 把「我的」拆成 `23 / 23b / 42 / 43` 四个原型页，实现里是 12 个 `me/*` 页 + 2 个 activities 页。

| 原型页 | 一句话 | 实现文件 | 当前风格 | 当前缺口 | 拆页 | 依赖 |
|---|---|---|---|---|---|---|
| `23-me.html` | 我的首屏 | `pages/profile/ProfilePage.tsx` | ③ | 退出、删除、清空只改本地 UI | 保持 | `/me/*` 真值 |
| `23b-account-privacy.html` | 账号与隐私 | `pages/profile/me/MySettingsPage.tsx` | ③ | 幂等删除、退出与匿名会话清理未接 | 保持 | 会话撤销 |
| ↑ | | `pages/profile/me/MyPrivacyRequestsPage.tsx` | ③ | **视觉证据契约标为 `NO_INDEPENDENT_PROTOTYPE`**（无独立原型，见 §六） | 保持 | 人工工单 |
| `42-my-assets.html` | 资产中心 | `pages/profile/me/MyResumesPage.tsx` | ③ | 删除确认只关弹层 | 保持 | 服务端删除 |
| ↑ | | `pages/profile/me/MyDocumentsPage.tsx` | ③ | 同上 | 保持 | — |
| ↑ | | `pages/profile/me/MyPrintOrdersPage.tsx` | ③ | **原型把静态样例写成本人真实订单**（见 §七-A）；原型的 `P-4172` **与 4 位数字裁决不符，须改**；「7 天有效」与生产 24h 冲突（见 §七-B-1） | 保持 | 订单真值 |
| ↑ | | `pages/profile/me/MyFavoritesPage.tsx` | ③ | 收藏类型未统一 | 保持 | — |
| `24-benefits.html` | 权益 | `pages/profile/me/MyBenefitsPage.tsx` | ③ | 页面硬编码 Grant；**抵扣合同不安全（一张 Grant 可抵整单）** | 保持 | **权益核销规则（W0）** |
| ↑ | | `pages/activities/BenefitActivitiesPage.tsx` | ⑧ | 活动数量为样例 | 保持 | 活动真值 |
| ↑ | | `pages/activities/BenefitActivityDetailPage.tsx` | ③ | 同上 | 保持 | — |
| `43-my-records.html` | 活动中心 | `pages/profile/me/MyAiRecordsPage.tsx` | ③ | 记录已接真（P1 已完成） | 保持 | — |
| ↑ | | `pages/profile/me/MyActivityPage.tsx` | ③ | 浏览/跳转记录已接真 | 保持 | — |
| ↑ | | `pages/profile/me/MyNotificationsPage.tsx` | ③ | 已读只改 DOM；通知未持久化 | 保持 | 通知模型 |
| ↑ | | `pages/profile/me/MyFeedbackPage.tsx` | ③ | 反馈无 ticket id | 保持 | Ticket 状态机 |

---

### 批 4 · 信息入口（**等真实数据再做 —— 当前公网岗位数为 0**）

**20 文件**。合规红线最密集的一批：只做第三方/官方来源入口，不得出现平台内投递/收简历/签到闭环。

> 🔴 **2026-08-18 生产事实（由协调方提供，非本文档取证）**：生产上原有的 5 条「腾讯招聘公开来源样本（预生产验证）」岗位**已下架**，**公网可展示岗位数现为 0**。
> 另有 3 个 `publishStatus=published` 的企业档案，名称均带「（演示）」，**尚未处置**。
>
> 对本批的含义：`13-jobs-desk` / `14-job-detail` / `15-companies` / `44-job-detail-offline` 这几行的**当前真实状态是「无数据可展示」**，不是「数据少」。
> 因此这几页现在**唯一能验收的就是空态**；任何带卡片的截图都只能来自 fixture，不能当作生产证据。
> 那 3 个「（演示）」企业档案在处置前，`15-companies` 一旦接真就会把演示数据当真实企业展示 —— **这是伪造能力（CLAUDE.md §9），须先处置再接真。**

| 原型页 | 一句话 | 实现文件 | 当前风格 | 当前缺口 | 拆页 | 依赖 |
|---|---|---|---|---|---|---|
| `13-jobs-desk.html` | 岗位台 | `pages/jobs/JobsPage.tsx` | ② | 卡片缺 jobId；筛选/收藏/异常上报不完整 | 保持 | 真分页 + facets |
| `14-job-detail.html` | 岗位详情 | `pages/jobs/JobDetailPage.tsx` | ② | 外链由页面样例提供 | 保持 | 服务端审核 sourceUrl |
| `44-job-detail-offline.html` | 线下岗位详情 | `pages/offline-agencies/OfflineJobDetailPage.tsx` | ② | 重试、收藏、网络、保存带走未接 | 保持 | — |
| `35-online-platforms.html` | 线上平台目录 | `pages/jobs/OnlinePlatformsPage.tsx` | ⑨ **Gen 1 样式表** | **QR 是不可扫示意码**；平台数据硬编码 | 保持 | 受治理的 platform API |
| `15-companies.html` | 企业导览 | `pages/companies/CompaniesPage.tsx` | ② | metrics/来源/收藏部分静态 | 保持 | Admin 指标开关 |
| ↑ | | `pages/companies/CompanyDetailPage.tsx` | ② | 同上 | 保持 | — |
| `16-offline-agencies.html` | 线下机构 | `pages/offline-agencies/OfflineAgenciesPage.tsx` | ② | **service 筛选破坏分页**；资质表述须中性 | 保持 | 修查询 |
| ↑ | | `pages/offline-agencies/OfflineAgencyDetailPage.tsx` | ② | 到店清单产物缺失 | 保持 | — |
| `17-fair-desk.html` | 招聘会作战台 | `pages/job-fairs/JobFairDetailPage.tsx` | ② | **「去来源平台预约」「扫码预约」是无落点裸按钮**（见 §七-E） | 保持 | 招聘会真值 |
| `17b-fair-checkin.html` | 招聘会签到 | `pages/job-fairs/JobFairCheckinPage.tsx` | ② | 签到须在来源平台完成，本机只做信息入口 | 保持 | **合规复核** |
| — | 招聘会列表 | `pages/job-fairs/JobFairsPage.tsx` | ② | 分页、facets | 保持 | 真实场次数据 |
| `45-fair-onsite.html` | 招聘会现场（**一页对 6 个实现页**） | `pages/job-fairs/FairMapPage.tsx` | ② | 场馆导览图已接真 | 保持 | 场馆图 |
| ↑ | | `pages/job-fairs/FairMaterialsPage.tsx` | ② | bundle artifact 缺失 | 保持 | artifact |
| ↑ | | `pages/job-fairs/FairVisitPlanPage.tsx` | ② | 计划 artifact 缺失。**产品裁决（2026-08-18）：对已结束的招聘会，AI 参会准备单不再产出「出发前逐项核对」，改为「回顾 / 资料整理」语义** —— 目标形态按此写，已有同事在做实现 | 保持 | artifact；**按场次状态分支文案** |
| ↑ | | `pages/job-fairs/FairStatsPage.tsx` | ② | **人数、次数为硬编码** | 保持 | 真实统计 |
| ↑ | | `pages/job-fairs/FairCompaniesPage.tsx` | ② | 分页 | 保持 | — |
| ↑ | | `pages/job-fairs/FairCompanyDetailPage.tsx` | ② | — | 保持 | — |
| `18-campus.html` | 校园招聘 | `pages/campus/CampusPage.tsx` | ② | 活动与计划为静态；沉浸式页（隐藏全局导航） | 保持 | 真实校园活动 |
| `21-policy.html` | 政策服务 | `pages/renshi/RenshiPage.tsx` | ⑥ | 政策、资格、清单、热线/来源为样例 | 建议拆 2 页 | **政策真实数据** |
| `02-standby.html` | 待机屏 | `pages/screensaver/ScreensaverPage.tsx` | ⑤ | **伪造能力：写死「故障已上报运维·预计 18:30 前恢复」**（见 §七-A） | 保持 | 屏保配置 |

---

### 批 5 · 受控能力（最后，或不做）

**20 文件**。默认关闭，逐项通过配置/隐私/法务/图像/硬件门禁后才开放。

| 原型页 | 一句话 | 实现文件 | 当前风格 | 当前缺口 | 拆页 | 依赖 |
|---|---|---|---|---|---|---|
| `19-smart-campus.html` | 智慧校园 | `pages/smart-campus/SmartCampusHomePage.tsx` | ② | 首页可见但 `enabled=false`；深链须 fail-closed | 保持 | 终端能力配置 |
| ↑ | | `pages/smart-campus/SmartCampusWelcomePage.tsx` | ② | 同上 | 保持 | — |
| ↑ | | `pages/smart-campus/FreshmanInsightsPage.tsx` | ② | 同上 | 保持 | — |
| `46-campus-service.html` | 校园服务 | `pages/smart-campus/SmartCampusServicePage.tsx` | ② | 「校方官方」无证据 | 保持 | 可审计来源 |
| — | 校园子页（占位） | `pages/placeholders/CampusWelcomePage.tsx` | ② | 被 `campus/welcome` 路由使用 | 保持 | — |
| — | 同上 | `pages/placeholders/FreshmanInsightsPage.tsx` | ② | 被 `campus/freshman-insights` 使用 | 保持 | — |
| `27-toolbox.html` | 百宝箱 | `pages/toolbox/ToolboxZonePage.tsx` | ⑨⑩ **Gen 1 样式表** | 配置与外链治理未接；**0 个真实服务** | 保持 | **建议不做，见 §八** |
| `31-contract-review.html` | 合同审阅 | `pages/contract-review/ContractReviewHomePage.tsx` | ⑩ | 页面未接已有异步链；默认门禁可绕过 | 保持 | **建议不做，见 §八** |
| ↑ | | `pages/contract-review/ContractReviewProcessingPage.tsx` | ⑩ | 同上 | 保持 | — |
| ↑ | | `pages/contract-review/ContractReviewResultPage.tsx` | ⑩ | 同上 | 保持 | — |
| `29-id-photo.html` | 证件照 | **无独立实现**（锁定态挂在 `PrintScanFeatureInfoPage`） | — | 整条能力未开放 | 保持锁定 | 图像质量 + 隐私 + 真机 |
| `03-identity-gate.html` | 身份门 | `pages/auth/LoginPage.tsx` | ⑧ | QR/SMS 均为本地演示 | 保持 | 短时单次 QR + SMS 限流 |
| ↑ | | `pages/auth/MobileQrLoginPage.tsx` | ⑤ | 同上 | 保持 | — |
| `04-system-states.html` | 系统态 | `pages/errors/KioskRouteErrorPage.tsx` | ② | 恢复、结束清空、帮助、法务仅本地 | 保持 | session lifecycle |
| ↑ | | `pages/placeholders/SessionTimeoutPage.tsx` | ⑧ | 同上 | 保持 | — |
| ↑ | | `pages/placeholders/ErrorOfflinePage.tsx` | ⑧ | 同上 | 保持 | — |
| `40-session-safety.html` | 会话安全 | `pages/session-resume/SessionResumePage.tsx` | ⑨ **Gen 1 样式表** | **全部主动作本地演示；站点位置虚构**；多个关键按钮无落点 | 保持 | 服务端会话/接管/清场 |
| — | 通知 | `pages/placeholders/NotificationsPage.tsx` | ② | 占位 | 保持 | 通知模型 |
| — | 活动详情 | `pages/placeholders/MeActivityDetailPage.tsx` | ③ | 占位 | 保持 | — |
| — | 帮助 / 法务 | `pages/help/HelpCenterPage.tsx`、`pages/legal/LegalDocPage.tsx` | ⑤ | **V6 原型无对应页**（见 §九-1） | 保持 | legal version |

---

## 五、拆页判断（产品负责人 2026-08-18 口径）

> **判据：「这个功能需不需要整屏」，不是「能不能塞得下」。需要整屏就给它独占一页。页数不是越少越好。**
> **推论：原型把「对比/预览」和「参数/按钮」画在同一屏时，按本条拆开，不照抄原型。**原型不是唯一真值 —— 它自身已被查出伪造能力、触控不达标、取件码口径错误（§七），布局比例不合理的同样要在实现时纠正。

### 5-1 `PrintPreviewPage` → 拆 2 页（**须产品裁决，因为它反转了一次刚做的合并**）

现状：`/print/params` 已于 **2026-08-18** 重定向到 `/print/preview`，参数区被并进预览页，该页 699 行。

按新口径应当反转：**打印预览需要整屏** —— 「原件什么效果 / 处理后什么效果 / 打印出来什么效果」是三态对照，是用户在付款前唯一能核对的东西，不该和份数/色彩/双面/页范围抢位置。

- 建议：`/print/preview`（整屏三态对照，无参数控件） + `/print/params`（参数独占，恢复为实体页）
- **路由数：净 +1**（`/print/params` 从 REDIRECT 转回实体路由 —— 注意它在 `compatibilityRedirects` 冻结清单里，须同步解冻）
- **为什么标「须裁决」**：这是对一个 5 天前刚合并的决定的反转，不能由执行者单方面推翻。

### 5-2 `ScanResultPage` → 拆 2 页

扫描结果预览（多页缩略图 + 单页放大核对）需要整屏；「重扫/保存/打印/带走」的处置动作是另一屏。**路由 +1。**

### 5-3 `ConvertImagesPage` / `SignStampPage` → 各拆 2 页

这正是产品负责人点名的「文件上传前后对比」场景：**上传前预览 / 合成后预览 / 原件保留** 三态对照需要整屏，转换参数（页序、方向、边距、签章位置）是另一屏。**路由 +2。**

### 5-4 `ResumeOptimizeComparePage` → **已拆，再收口**

好消息：原型 `09b-resume-optimize.html` 已经把对比独立成页（`.optdiff` 两栏 + `pair-act .btn { min-height:56px }`），实现里 `ResumeOptimizeComparePage.tsx`（366 行）也已经独立于 `ResumeOptimizePage.tsx`（537 行）。**这一条已经符合新口径，是全站的正面样板。**

剩余收口：把排版调整 / 模板套用的参数控件从对比页移到优化页，让对比页只做差异高亮。**路由 +0。**

### 5-5 `JobFitPage` → 拆 2 页

岗位匹配是「简历 × 最多三个岗位」的多栏对照，与 `09b` 同构，应当整屏。匹配参数（选岗位、选简历版本、consent）是另一屏。**路由 +1。**

### 其余「建议拆 2 页」行（`ResumeGeneratePage` / `JobMaterialLibraryPage` / `AssistantPage` / `RenshiPage`）

同一判据（生成参数 vs 生成结果 / 对话 vs 工作产物 / 政策列表 vs 资格核对），但优先级低于上面五条，**建议在各自批次内单独立任务再定**，本表不预先分配路由预算。

### 拆页汇总

| 批次 | 确定拆页 | 路由增量 | 新增截图对 | 额外会断的波次门禁 |
|---|---|---|---|---|
| 批 1 | 5-1、5-2、5-3 | **+4** | +4 对 = 8 张 PNG | 按所属 wave 核对 |
| 批 2 | 5-5（5-4 已完成） | **+1** | +1 对 = 2 张 PNG | **`verify-fusion-w3.mjs:97`（W3 = 19 条）** |
| 批 0 / 3 / 4 / 5 | 无 | 0 | 0 | — |

> ⚠️ 除 §6-3 那 13 处外，还有两处**波次作用域**的计数与 106 门禁离得很远、极易漏改：
> `verify-fusion-w3.mjs:97`（W3 恰好 19 条）和 `verify-fusion-w4.mjs:251`（W4 恰好 25 条）。
> **拆 resume 域会断 W3，拆 jobs 域会断 W4。**拆页前先确认目标路由属于哪个 wave。

---

## 六、门禁成本：改一条路由要动多少地方

### 6-1 视觉证据门禁的实际触发条件（**与此前假设不符，请以本节为准**）

盘点时的假设是「换一页 UI 就要重拍该页证据」。**核实结果：不是。**

`apps/kiosk/scripts/verify-visual-evidence-manifest.mjs`（306 行，CI 中由 `.github/workflows/ci.yml:136` 在每个 PR 上运行，无 paths 过滤）的实际行为：

- 它**从不读取 `src/pages/` 下任何文件**。唯一读的源码是 `src/routes/index.tsx`，且只提取 `path:` 字符串字面量。
- 它**不检查截图 PNG 是否存在**。`screenshotPair` 字段是 `assert.deepEqual` 比对一个由 `targetId`/`captureKey` 重新拼出的模板字符串，永远不落盘。
- 它**没有任何新鲜度校验** —— 无 hash、无 mtime、无 `statSync`、无拍摄时间字段。
- 清单里**根本没有 `status` 字段**（`grep -ci "status:"` = 0）。`PENDING` 只存在于 Playwright 采集产物 `test-results/.../capture-summary.json`，而该目录被 `.gitignore` 忽略，门禁从不读它。

**结论：改 `PrintConfirmPage.tsx` 的 UI 并提 PR，这道门禁不会失败。**它是一道「清单结构完整性 + 路由清点 + 文案诚实性」门禁，不是视觉回归门禁。

它**只在**以下情况失败：改了清单本身、改了 `route-manifest.ts`、改了 runbook 里的 8 个字面 token，或**增删了 `src/routes/index.tsx` 里的路由**。

### 6-2 但有一个此前没人算过的结构性问题

清单里 **83 条 `prototypePath` 全部指向 Gen 1 目录**：

```
74 条 → docs/design/kiosk-proto-2026-07/
 8 条 → docs/design/kiosk-proto-2026-07-fusion/
 0 条 → docs/design/kiosk-ai-os-v3-2026-08/
```

清单自己也写明 V6「its design baseline sits in the separate kiosk-ai-os-v3-2026-08 set, **which this contract does not own**」。

**含义：整套 82 目标 / 83 对截图的视觉证据契约是一份 Gen 1 契约。**全站转 V6 之后，拿 V6 生产页去比 Gen 1 原型截图在语义上不成立 —— 这不是「多拍几张」的问题，是**整份契约需要按批次重新指向 V6 原型**。这是本次迁移最大的一笔未计价成本，建议每批收尾时同步改写该批覆盖的 `prototypePath`，不要留到最后一次性重写。

### 6-3 增加一条路由会打穿哪些地方

实测：**9 处数字字面量 / 5 个文件 + 3 份全量路由枚举 + 1 份文档**，全部要在同一个提交里同步。

| # | 位置 | 断言 | 增一条路由的动作 |
|---|---|---|---|
| 1 | `scripts/verify-fusion-baseline.mjs:162,163,179,180` | 路由数**等式** `!== 106`（×4，无具名常量，纯魔数） | 改 4 处 |
| 2 | `scripts/verify-fusion-baseline.mjs:224-233` | **每条路由必须以反引号形式出现在 `docs/design/kiosk-proto-2026-07-migration-matrix.md` 里** | **改 Gen 1 矩阵文档**（见下方警告） |
| 3 | `tests/visual/route-manifest.ts:1-44` | 106 条路由枚举（`as const`） | 加一条 |
| 4 | `tests/visual/route-manifest.ts:46-55` | `compatibilityRedirects` 6 条 | 若涉重定向则改 |
| 5 | `scripts/verify-fusion-w6.mjs:240-243,504-509` | `106`（×6）、kiosk `104`、mobile `2` | 改 8 处 |
| 6 | `scripts/verify-fusion-w6.mjs:187-233` | `WAVE_ROUTES` —— 全量 106 条按 W0–W5 分桶，每条必须且只能属于一个 wave | 手工分桶 |
| 7 | `tests/visual/fixtures/fusion-w6-route-cases.ts:64-175` | **106 条**用例枚举（不是 104；104 是 kiosk 子集，另 2 条 mobile） | 加用例 |
| 8 | `tests/visual/fixtures/fusion-w6-route-cases.ts:187-192` | **模块级计数守卫，import 时即抛错** | 改 3 处常量 |
| 9 | `scripts/verify-visual-evidence-manifest.mjs:139-141,222-225` | `=== 106`、唯一性、106 条 disposition、集合相等 | 改 4 处 |
| 10 | `tests/visual/fixtures/kiosk-p1-visual-evidence-targets.ts:194+` | 106 条 `routeEvidenceDisposition` | 加一条 |
| 11 | `verify-visual-evidence-manifest.mjs:146-152` | targets `82` / primary `77` / id 范围 `01..77` | 若新页需独立证据目标，再改 2 处 + 扩 id 范围 |
| 12 | `scripts/verify-fusion-w3.mjs:97` | W3 波次 **19** 条 | **若拆的是 resume 域则会断** |
| 13 | `scripts/verify-fusion-w4.mjs:251` | W4 波次 **25** 条 | **若拆的是 jobs 域则会断** |

**两个最容易漏的坑：**

- **第 8 项的模块级 `throw` 对静态门禁不可见。**`verify-fusion-w6.mjs:471` 只用 `parseTsx` 把该文件当 AST 走，模块级语句根本不执行。它只在 Playwright W6 套件（`ci.yml:961`）真正 import 时才炸 —— 失败点晚得多、也贵得多。同一条不变量在仓库里存在 **3 份拷贝、2 套执行机制**。
- **第 2 项要求改的是 Gen 1 矩阵文档，不是本文档。**`verify-fusion-baseline.mjs` 硬编码了 `kiosk-proto-2026-07-migration-matrix.md` 这个路径。**本文档不在任何门禁的检查范围内**，新增路由时仍须去 Gen 1 矩阵里补一行反引号路由，否则 CI 红。这本身是个应当收敛的耦合（见 §十建议 1）。

**每拆一页 ≈ 9 处数字 + 3 份枚举 + 1 条 disposition + Gen 1 矩阵一行 + 2 张 PNG。**

**已有正确样板可直接照抄**：提交 `773b1a5df`（2026-08-17）就是拆页场景 —— 拆出 `/resume/optimize/compare` 与 `/resume/job-fit/actions`，路由 104 → 106，一个提交内同步了 baseline / w6 脚本 / w6 用例 / route-manifest / evidence targets / 迁移矩阵 / 两个页面级 verifier，提交信息写明了理由和三处相对原型的**收窄**。**拆页请照这个提交的清单做。**

---

## 七、原型本身必须先修的地方

> cursor 做过一轮独立审查。下面逐条复核 —— **确认的照改，推翻的说明理由**。总计 **确认 6 条 / 推翻 3 条 / 重定性 1 条**。

### A. 伪造能力（**确认，且比原报告更严重**）

违反 CLAUDE.md §9「不伪造能力」。照抄会把违规搬进产品。

| 原型 | 问题 | 复核 |
|---|---|---|
| `01-home-v6.html:376` | 写死「打印机在线 · 队列空闲」 | ✅ 确认 |
| `06-print-workbench.html:579` | 写死「打印机在线 · A4 78% · 碳粉 62%」 | ✅ 确认 |
| `02-standby.html:172,257-258` | 写死「打印机故障 · 已上报运维 · 预计 18:30 前恢复」 | ✅ 确认。**最严重的一条** —— 同时伪造了设备状态、工单状态和恢复时间承诺 |
| `08-file-tools.html:885,905` | 点一下就显示「已合成 1 份 PDF」（纯 JS 拼串） | ✅ 确认 |
| `20-interview-pod.html:1066` | 点一下就显示「已存进『我的文档 · 离线取件』」 | ✅ 确认 |
| `42-my-assets.html:1018,1038` | 静态样例写成本人真实订单（含单号 `O-20260809-1020`、金额、取件码） | ✅ 确认 |

**同一份原型里已有正确做法，作为改造样板**：`41-fulfillment-states.html:196` 每张卡带「示意 · 不可点」角标；`47-arrival-code.html:733` 明示「本机不校验这 10 位码，真机以服务端核销结果为准」。**改造方向是把 41/47 的诚实标注推广到上面 6 处，而不是另发明一套。**

### B. 取件码 —— **产品已裁决：4 位数字（2026-08-18）**

**裁决结论：取件码统一为 4 位纯数字。**原型三种互斥形态中，`41-fulfillment-states.html:704`（`maxlength="4"` + `inputmode="numeric"`）是**符合裁决的那一个**；`06-print-workbench.html` 的 10 位纯数字与 `23-me.html`/`42`/`43` 的 `P-4172` 都要改。

这是又一处**「不以原型为准」**的例子，与伪造能力（§七-A）、触控尺寸（§七-D）、CTA 文案（§七-C）并列。

#### B-1 ⚠️ 裁决与生产现状冲突 —— 这不是只改原型

必须说清楚：**生产代码目前实现的不是 4 位数字，而是 10 位字母数字。**执行者若只改原型不改生产，会得到三方不一致。

生产现状（`origin/main@15d9333d9` 取证）：

```js
// services/api/src/member-print-orders/member-print-order-create.service.ts:14-16
// services/api/src/payment/order-status.service.ts:14-15（同值，两处重复定义）
const PICKUP_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'   // 31 字符，排除易混的 0 1 I L O
const PICKUP_CODE_LEN = 10
const PICKUP_TTL_MS   = 24 * 60 * 60 * 1000                  // 24 小时
```

落实裁决须同步修改（**本轮不改，仅列出**）：

| 文件 | 现状 | 需改 |
|---|---|---|
| `services/api/src/member-print-orders/member-print-order-create.service.ts:14-15` | 10 位 / 31 字符集 | 4 位 / 纯数字 |
| `services/api/src/payment/order-status.service.ts:14-15` | 同上（**常量重复定义，两处都要改**） | 同上 |
| `apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx:25-27` | `CODE_LEN=10`、`VALID_CODE=/^[...]{10}$/`、`inputMode="text"` | 4 位 / `inputMode="numeric"` |
| 小程序到机码链路（M2 已本地闭环） | 按 10 位 | 需同步复验 |

另有一处**原型与生产都错、裁决未覆盖**的口径：`06`、`23-me.html:614`、`42-my-assets.html:1039` 写「取件码 7 天内有效」，生产是 **24 小时**，且还会被源文件寿命二次收窄（`member-print-order-create.service.ts:110-112`，注释：「到机码绝不能活得比源文件更久」）。**有效期口径请一并裁决。**

#### B-2 命名裁决：「打印取件码」与「文件取回码」是两个概念

`20-interview-pod.html:1060` 的 `QJ-4423` 是**面试报告的文件取回码**，不是打印订单取件码。两者混用会让求职者在机器前拿错码。**本表统一口径如下，实现时不得混称：**

| 概念 | 用途 | 形态 | 出现位置 |
|---|---|---|---|
| **打印取件码** | 到机领取已付款的打印件 | **4 位数字**（裁决） | `06` / `41` / `47` / `23` / `42` / `43`；实现 `PrintPickupClaimPage` |
| **文件取回码** | 把 AI 产物（面试报告等）从「我的文档」取回/带走 | **待定，但不得与取件码同形同名** | `20-interview-pod`；实现 `InterviewReportPage` |

#### B-3 4 位数字的碰撞面 —— **服务端有防撞，但作用域不对，标为待补**

被问到的问题：4 位纯数字（1 万种）在同一时段会不会撞？服务端有没有「同一终端未完成任务内唯一」这类机制？

**查证结论：有防撞机制，但作用域是「全表永久唯一」，不是「同一终端未完成任务内唯一」，且不回收。**

```prisma
// services/api/prisma/schema.prisma:304
pickupCode String? @unique   // 取件凭证码，paid 时生成
```

```js
// services/api/src/payment/order-status.service.ts:16,374-381
const PICKUP_MAX_ATTEMPTS = 6
// 生成时逐次 findUnique({ where: { pickupCode: code } })，6 次穷尽后抛 PICKUP_CODE_UNAVAILABLE（fail-closed）
```

由此，**4 位数字面临的不是偶发碰撞，是两个更硬的问题**：

1. **键空间耗尽。**唯一索引是全表、跨终端、跨时间的，订单完成或过期后**不释放 `pickupCode`**（行仍在，值仍被占）。10,000 个值用完之后，全网任何新订单都会 fail-closed 报 `PICKUP_CODE_UNAVAILABLE`。在此之前就会持续劣化：已用 k 个时，6 次重试全撞的概率是 `(k/10000)^6` —— k=5,000 时约 1.6% 建单失败，k=8,000 时约 26%，k=9,000 时约 53%。
2. **可枚举。**`print-jobs.controller.ts:35` 对 `claim-pickup` 的限流是 `{ ttl: 60_000, limit: 20 }`（每分钟 20 次，复合 key = 终端+IP，退化到纯 IP）。单桶跑完 10,000 种组合约 8.3 小时，而取件码有效期是 24 小时。取件码保护的是他人的简历、证件照、身份证复印件。

**按要求标为待补，不自拟方案。**需要产品/后端共同补的决策至少包括：唯一性作用域（是否改成「同一终端 × 未完成任务」内唯一）、过期回收策略、以及 4 位数字下的枚举防护（`claim-pickup` 限流是否需要收紧、是否需要配合终端在场或二维码作为第二因子）。

> 附注：`Order` 上同时存在明文 `pickupCode @unique`（:304）和 `pickupCodeHash @unique` + `pickupCodeEnc`（:278-279）两套表示，补方案时须一并确认二者关系。

### C. CTA 文案 —— **推翻 3 条中的 3 条，但发现一个真问题**

cursor 标了三处「文案偏移」。逐条复核：

1. `11-jobfit-compare.html:982` 「去来源平台 · 扫码投递」—— **推翻**。「去来源平台投递」和「扫码投递」**都在 CLAUDE.md §2 白名单里**。原型第 31-32 行的注释已说明分隔符是刻意加的。
2. `18-campus.html:348` 「③ 网申去官方平台投（本机不代投）」—— **推翻**。这不是按钮文案，是建议正文；不含违禁串「平台投递」；且「本机不代投」是合规加分项。
3. `36-fairs-hub.html:228` 「投递预约请前往来源平台」—— **推翻**。语义是把用户导向来源平台，正是合规要求的方向。

**全量扫描结果：V6 原型 50 页中，`一键投递 / 立即投递 / 平台投递` 的实际命中数为 0**（仅有的几处出现在解释违禁词的注释里）。

**但复核暴露一个真问题（本次新发现）**：CLAUDE.md §2 白名单收录「**去来源平台投递**」，而各 verify 脚本的黑名单是子串「**平台投递**」（如 `apps/kiosk/scripts/verify-job-material-library-ui.mjs:135`）。白名单短语原样写出必然命中黑名单 —— **规范和门禁互相矛盾**，原型只能靠插分隔符绕开。建议要么把黑名单改成词边界匹配，要么把白名单短语改成「去来源平台 · 扫码投递」。**本轮只提，不改。**

### D. 触控不达标（**1 条确认，1 条降级**）

- `26-advisor-work.html:94-96` `.msg-pin`：`padding:4px 11px` + `font-size:var(--fz-1)` + 无 `min-height`，实测高约 26px，却带 `cursor:pointer`。**✅ 确认**，低于 CLAUDE.md §9 的 48px 硬下限。
- `01-home-v6.html:313` `.vivid .vfoot .btn { min-height: 52px }`：**降级为「建议级」**。52px 高于 48px 硬下限，只是低于「主要按钮建议 ≥56px」。更值得注意的是该页 283-289 行的注释记录了这个按钮**反复被上层元素遮挡点不动**（`elementFromPoint` 命中 `.nb-sum`，改了 76→99→122 三轮）—— **真正的风险是命中测试，不是尺寸**。

### E. 断头按钮（**确认**）

- `17-fair-desk.html:587-591` 「去来源平台预约」「扫码预约」是 `<button class="btn btn--lg btn--quiet">`，无 `href`、无 `data-*`、不被页内两处 `document.addEventListener('click')` 委托捕获。**✅ 确认为裸按钮。**讽刺的是同文件 261 行注释特意强调「这一页最该按的键，不许收进抽屉」—— 保住了位置，没接上落点。
- `37b-interview-reports.html` 登录后回不来、`40-session-safety.html` / `41-fulfillment-states.html` 多个关键按钮无落点：**✅ 确认**（41 已自带「示意 · 不可点」标注，属可接受的原型态；37b / 40 需修）。

### F. 补充：`verify-fusion-baseline.mjs` 路由等式门禁的设计意图

见 §十的独立判断。

---

## 八、三个问题的答案

### 问题 1：哪些实现页在 V6 原型里没有对应？

**共 11 个，分三类处置：**

**(a) 该补原型 —— 2 个**

| 实现 | 路由 | 为什么必须补 |
|---|---|---|
| `pages/help/HelpCenterPage.tsx` | `/help` | V6 每页都画了「帮助」入口，却没画帮助页本身。审查文档 §7 把「帮助」列进公共底座，**没有原型就没有验收标准**。 |
| `pages/legal/LegalDocPage.tsx` | `/legal/:doc` | 法务文档展示页。§7 要求 legal version 可追溯；`03-identity-gate` 引用了法务条款却没画落地页。 |

**(b) 保持现状，不补原型 —— 4 个**

`pages/ai-plan/AiPlanPage.tsx`、`pages/session-resume/SessionResumePage.tsx`、`pages/jobs/OnlinePlatformsPage.tsx`、`pages/placeholders/NotificationsPage.tsx`。

前三个对应 Gen 1 原型 76-78，且**全部直接 import `styles/prototype-v1.css`（Gen 1 样式表）**。`35-online-platforms.html` 和 `40-session-safety.html` 其实覆盖了后两者的产品意图，只是编号没对齐。这四个跟随所属批次统一换壳即可，不需要新原型。

**(c) 建议删除 —— 5 个（零引用死代码）**

```
apps/kiosk/src/pages/placeholders/OfflineAgenciesPage.tsx
apps/kiosk/src/pages/placeholders/OfflineJobDetailPage.tsx
apps/kiosk/src/pages/placeholders/PrintScanConvertPage.tsx
apps/kiosk/src/pages/placeholders/PrintScanFeaturePage.tsx
apps/kiosk/src/pages/placeholders/PrintScanSignPage.tsx
```

取证：`grep -rn "placeholders/<name>"` 在 `src/` `tests/` `scripts/` 全域命中 **0**；同名真实页已存在于 `pages/offline-agencies/` 和 `pages/print-scan/`，路由指向的是后者。同目录另外 6 个 placeholder 各有 2-3 处引用（路由 + W4/W5 验收脚本），**不能一起删**。

> 按 CLAUDE.md §8 的删除证据规则，删除前仍须确认无生产部署/硬件链路依赖，并同步 `current-progress.md`。**本轮只提，不删。**

### 问题 2：cursor 认为「设计了但不宜在一体机做」的几页，是否同意？

逐项独立判断，**同意 3 项、部分同意 1 项、不同意 1 项**：

| 页面 | cursor 意见 | 我的判断 | 理由 |
|---|---|---|---|
| `31-contract-review` | 不宜做 | **✅ 同意，建议不做** | 高敏劳动合同上传到公共大厅终端，风险与收益不成比例。CLAUDE.md §11 要求「不长期保存敏感文件」，而合同审阅天然需要留存以出报告。且这是**法律效力**领域 —— 双后台已定「法务文档正文不得由 AI 生成或改写」，同一条纪律应约束前台。**建议：整条能力下线，不只是默认关闭。** |
| `27-toolbox` | 不宜做 | **✅ 同意，建议不做** | 0 个真实服务。一个没有内容的容器页只会制造「看起来完整」的假象，正是 CLAUDE.md §8 点名禁止的堆砌。**建议：首页移除入口，路由保留 fail-closed。** |
| `24-benefits` | 不宜做（会员全未开放） | **⚠️ 部分同意** | 不同意「不做」，同意「不能先接 CTA」。权益已经是**真实资损面** —— 审查文档 §6.2 记录「一张 Grant 可抵整单」，`main` 上已有 fail-closed 修复（提交 `385a20632`）。**结论：页面必须做，但必须排在 W0 权益核销规则之后；在那之前 Kiosk 用券 CTA 一律不接真。** |
| `19-smart-campus` / `46-campus-service` | 超出核心范围 | **✅ 同意保持锁定** | 但不同意删。CLAUDE.md §15 已定「首页可见、默认 `enabled=false`、深链 fail-closed」，且 8 条 URL 的 fail-closed 已在 A1 切片验证通过。**保持现状即可，不投入 UI 改造。** |
| 长访谈 / 25 题测评 | 占机久 + 隐私 | **❌ 不同意** | 这是本产品的**核心 AI 能力**，不是附加功能 —— 删弱它与「AI 求职操作系统」的产品定位直接冲突。占机时长是**产品设计问题，不是要不要做的问题**：真正的解法是手机接力（`05-phone-relay` 已在原型里）—— 在终端起题、扫码转手机答、回终端取报告。**建议：保留能力，把「长流程转手机」列为批 2 的设计约束。** |

### 问题 3：视觉证据门禁的成本

**核心结论已在 §6-1 给出：这道门禁不会因为你改 UI 而失败** —— 盘点时的假设不成立。它不读 `src/pages/`、不查 PNG 是否存在、无新鲜度校验、清单里没有 `status` 字段。83 条 capture 里的 PENDING 是**人工判读产物**（写在 gitignore 的 `test-results/` 里），CI 从不读取。

**真正的成本有三笔：**

| 成本 | 触发条件 | 量 |
|---|---|---|
| **① 路由清点常量** | 增删任何路由 | 6 处常量（§6-3），每拆一页都要付 |
| **② 截图重拍** | **无 CI 强制**，仅在需要人工验收证据时 | 一次全量 = 83 对 / 166 张 PNG；Playwright 单 worker 串行、超时上限 45 分钟、需同时起 production preview 与 prototype 静态服务器；支持 `P1_TARGET_IDS=65,32` 增量重拍并合并 |
| **③ Gen 1 → V6 契约改写** | 全站转 V6 | **83 条 `prototypePath` 全部要重指**（§6-2）。这是最大的一笔，此前无人计价 |

**按批分摊（②③）：**

| 批 | 覆盖实现文件 | 拆页新增截图对 | 需重指 V6 的证据目标（估） |
|---|---|---|---|
| 批 0 | 8 | 0 | ~5 |
| 批 1 | 17 | **+4** | ~18 |
| 批 2 | 22 | **+1** | ~22 |
| 批 3 | 14 | 0 | ~14 |
| 批 4 | 20 | 0 | ~20 |
| 批 5 | 20 | 0 | ~4（多数保持锁定，无需证据对） |

> 采集是人工判读制（spec 明文：`No PASS without human review`），且**未接入任何 GitHub workflow**。所以「重拍成本」是人工验收成本，不是 CI 阻塞成本 —— 排期时不要把它算成合并前置。

---

## 九、对批次划分的调整建议

原划分基本成立，提四点调整：

1. **批 0 的 6 个 hub 实为 5 个待改** —— `39-print-hub` 对应的 `PrintScanHomePage` 已经是 V6，它是本批的**基准**而非工作项。剩余 5 个共用同一张 `service-hub-editorial.css`，改造成本远低于按 5 页估算。

2. **建议在批 0 和批 1 之间插入「批 0.5 · 壳层默认化」** —— §三的数据表明，把 `v6-runtime-shell` 从两路由白名单改为默认壳，可一次覆盖 37 个无页面级 CSS 的页面（含批 1 的全部 7 个 print 页、批 4 的全部 10 个 job-fairs 页）。这会显著降低批 1 和批 4 的单页成本。**须单独立任务**（涉及 `hideBottomNav` / `usesPageActionbar` / `brandTitle` 三条分支 + W2/W4/W5/W6 全套回归）。

3. **批 4「等真实数据」的门槛不是放松了，是收紧了** —— 我最初据 `origin/main@15d9333d9` 刚合入的「上线种子内容录入清单 —— 30 条政策 + 20 场招聘会」(#707) 判断门槛已部分解除。**该判断作废**：#707 交付的是**待录入清单**，不是已录入数据；而 2026-08-18 生产上仅有的 5 条样本岗位已下架，**公网岗位数现为 0**。

   修正后的排期论证：批 4 现在的阻塞条件是「**种子内容真正录入生产库**」，而不是「清单已写好」。在此之前，这一批只能做**空态**验收 —— 这反而**提高了**批 4 的延后合理性，同时也意味着 `13/14/15/44` 四页的空态设计必须先做好，因为它是这几页当下唯一的真实形态。

   另：3 个「（演示）」企业档案须在 `15-companies` 接真之前处置，否则会把演示数据当真实企业展示（CLAUDE.md §9 伪造能力）。

4. **批 5 应拆成 5a / 5b** —— 5a（`03/04/40` 身份·会话·系统态，8 文件）是审查文档 §7 排第 2 位的公共底座，不该和「建议不做」的能力混在最后一批；5b（`19/27/29/31/46` 受控能力，12 文件）才是可延后或不做的。

---

## 十、独立判断：路由数等式门禁该不该保持等式

**问题**：`verify-fusion-baseline.mjs:162` 的路由数是**等式**（=== 106）。设计意图是 (a) 防路由悄悄增殖的绊线，还是 (b) 冻结一个已验收的路由集合？

**判断：意图是 (a)。拆页时显式改常量是正确用法，不是架空门禁。**但这道门禁的**形态**已经在把自己往 (b) 的方向拖，需要收敛。

### 支持 (a) 的证据

1. **最近一次变更就是拆页，而且做得很规范。**`773b1a5df`（2026-08-17）拆出两页、104 → 106，提交信息明写「拆页两条（矩阵 §3.3 / §3.5，路由 104 → 106）」，并在一个提交内改全了所有耦合产物。这是绊线被正常触发、承认、写明理由后清除 —— 不是冻结被绕过。
2. **三周内 9 次变更，没有一次是「悄悄加路由不改常量」**，也没有任何一次去弱化断言（无 `>=`、无环境变量开关、无豁免清单）。
3. **仓库里没有任何「路由集合已封闭」的政策。**`CLAUDE.md` / `AGENTS.md` 里唯一与路由相关的治理规则是关于**删除**的取证要求。若 106 真是已验收集合的封板，这条政策必然存在 —— 它不存在。
4. **同一文件里真正的冻结长得不一样。**`verify-fusion-baseline.mjs:113/128/144` 守的是 SHA-256 钉死的原型源文件，哈希枚举在 19-35 行。路由数没有哈希、没有钉死产物、没有不可变声明 —— **它是个计数器，不是封条。**

### 但证据并不干净

1. **措辞在说 (b)。**`route-manifest.ts:51` 写「106 路由**冻结基线**不变」，`verify-visual-evidence-manifest.mjs:225` 写 `'...the frozen 106-route manifest'`。只读注释的人会合理地得出 (b) 的结论 —— **代码在说 (a)，词汇在说 (b)**，这正是这个问题难回答的原因。
2. **9 次变更里有 3 次是合并后的救火。**`39f47eef6` 最典型：PR #499 加了三条 `/contract-review` 路由却没同步 manifest / `WAVE_ROUTES` / W6 fixture，门禁**在 main 上炸**，只能另开 `fix(ci)` 补数字。`8438700f6`、`1477d005c` 同样。当一道门禁三分之一的触发都是「我们弄红了 main，然后改了个数字」，工程师学到的就是「这数字是杂务」而不是「这是个决策点」—— 实践上正在退化成 (b)。
3. **有一次变更完全没有理由。**`e02768fa5` 一次 96 → 104（8 条路由），提交正文为空、无 PR 引用。如果「刻意编辑」是正确用法，这一次没能以任何可复核的方式体现刻意。

### 结构性问题：这个数字是冗余的，而且是所有耦合检查里最弱的一个

每一处断言数字的地方，几行之内都坐着一个**针对已入库清单的集合相等断言**（baseline 186-191 双向 set diff、`verify-fusion-w6.mjs:244` `deepEqual`、`:255-267` wave 归属、`verify-visual-evidence-manifest.mjs:141,225`、`fusion-w6-route-cases.ts:184-185`）。

**在这些之下，`length !== 106` 不提供任何额外的检出能力。**任何不一致的路由新增都已被集合差集捕获，而且错误信息好得多（「`/resume/optimize/compare` 不在 manifest 里」vs「期望 106，收到 107」）。数字只在开发者**已经把 router、manifest、w6、dispositions 全都一致地更新完**之后才触发 —— 也就是他本来就很小心的那种情况。

而它有一个集合检查没有的**盲区：数字对重命名免疫**。把 `/a` 换成 `/b`（router 和 manifest 同改），总数仍是 106，全仓没有任何门禁会拿今天的路由集合去比**此前已验收的**集合 —— 而这恰恰是真正的 (b) 式封板所必需的，这道门禁并不提供。

### 建议形态（只出建议，本轮不实施）

1. **一个数字，一个来源。**从 `route-manifest.ts` 导出 `EXPECTED_ROUTE_COUNT = productionRoutePatterns.length`，5 个消费者一律断言它，而不是各自重抄字面量。**仅此一条就能避免 `39f47eef6` 和 `8438700f6` 两次 main 事故。**同时把第 2 项对 Gen 1 迁移矩阵文档的硬编码路径一并收敛。
2. **把整数换成入库的集合基线。**维护 `route-baseline.json`（排序路由表 + 哈希），CI 做差集，任何变化都报 `route inventory changed: +2 (/resume/optimize/compare, /resume/job-fit/actions) -0 —— 请在本 PR 内更新 route-baseline.json 并写明理由`。同样是绊线，但它 (i) 给的是 diff 不是整数，(ii) 能抓到数字放行的重命名和「一进一出」，(iii) 让已验收集合在 PR diff 里可复核 —— 这是 (a) 和 (b) 唯一能诚实共存的方式。
3. **保持等式，不要软化成 `>=`。**棘轮允许静默增殖、且漏掉删除。`===` 不是缺陷；**重复和缺理由才是。**
4. **把意图写在断言处。**`verify-fusion-baseline.mjs:160-163` 应有一句注释明写：这是变更申报绊线、不是冻结；在新增路由的同一个 PR 里改这个数字就是预期工作流；该 PR 还必须同步以下清单。现在文件里一个字都没有。
5. **让失败信息本身就是清单。**既然有 13 处产物必须同步移动，断言失败时就该把它们全列出来 —— 比写文档更便宜也更耐久，也正是 PR #499 当时所缺的。
6. **消除 `fusion-w6-route-cases.ts` 的 AST/运行时割裂**（§6-3 第 8 项）：要么删掉模块级 throw（`verify-fusion-w6.mjs:504-509` 已有等价断言），要么让静态脚本按 `verify-visual-evidence-manifest.mjs:100` 的做法真正 import 转译后的模块。**一条不变量三份拷贝两套机制，正是计数漂移的成因。**

> 按任务约束，本轮**不改动任何门禁代码**，以上仅为建议。

---

## 十一、本轮未处理、需另立任务的代码问题

查证过程中发现，**均未动手**：

1. **5 个零引用 placeholder 死文件**（§八问题 1c）。
2. **合规白名单与门禁黑名单互相矛盾**：CLAUDE.md §2 白名单短语「去来源平台投递」必然命中 verify 脚本黑名单子串「平台投递」（§七-C）。
3. **`PrintConfirmPage.tsx` 741 行 / `PrintPreviewPage.tsx` 699 行**，超 CLAUDE.md §8 的 500 行评估线，新增功能前需评估拆分。
4. **`CareerPlanPage.tsx` 注释谎报视觉真值**（§二），按注释盘点会得到假完成度。
5. **视觉证据契约整体锚定 Gen 1**（§6-2），全站转 V6 后语义失效。
6. **路由计数门禁重复 9 处、跨 5 文件、2 套执行机制**（§6-3、§十），三周内已导致 3 次 main CI 事故。
9. **取件码 4 位裁决与生产代码冲突**（§七-B-1）：`PICKUP_CODE_LEN=10` 在 `member-print-order-create.service.ts:15` 和 `order-status.service.ts:15` **重复定义两份**，Kiosk `PrintPickupClaimPage.tsx:25-27` 亦按 10 位实现。落裁决要同时改 3 处 + 复验小程序到机码链路。**常量重复定义本身也应收敛为单一来源。**
10. **4 位取件码的键空间与枚举风险待补**（§七-B-3）：唯一索引是全表永久、不回收；`claim-pickup` 限流 20/分钟，单桶约 8.3 小时可枚举完 1 万种组合，而码有效期 24 小时。
11. **3 个「（演示）」企业档案仍为 `published`**，`15-companies` 接真前须处置。
7. **`verify-fusion-baseline.mjs:224-233` 硬编码依赖 Gen 1 迁移矩阵文档**，新增路由必须去那份**历史文档**里补行才能过 CI；随着全站转 V6，这个耦合方向是反的。
8. **`fusion-w6-route-cases.ts` 的模块级 `throw` 对静态门禁不可见**（§6-3 第 8 项），失败点被推迟到 Playwright 阶段。
