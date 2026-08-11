# Kiosk 交付物闭环矩阵（2026-08-08）

> 目的：把 105 条前台路由按**交付物**重新组织，为「AI 主动交付」重构提供依据。
> 方法：5 个只读盘点 agent 分域读页面源码，逐条核实交付物、输入依赖、AI 参与度与入口引用。
> 主干校验：`apps/kiosk/src/routes/index.tsx` 共 105 条路由，各域小计 110（含 5 条跨域重复计数），已对齐。
>
> **本文只做盘点与方案，未改任何生产代码。**

---

## 一、总览

| 域 | 路由数 | 有交付物 | AI主导 |
|---|---|---|---|
| 简历 | 18 | 8 | 7 |
| 打印扫描 | 21 | 5 | 0（1 处 AI辅助） |
| 岗位招聘会 | 21 | 9 | 1 |
| 我的 | 15 | 3 | **0** |
| 其余 | 35 | 5 | 5 |

**结论：105 条路由中，约 30 条让用户手上真正多出东西，其余 75 条是中转、导航或纯浏览。**

---

## 二、必须先修：伪造或断裂的交付

这些违反 `CLAUDE.md §9`「不伪造能力」，或按钮点了永远拿不到东西。

| # | 位置 | 问题 |
|---|---|---|
| 1 | `ResumeOptimizePage.tsx:163` | 「保存优化建议」只塞进 `ProfilePage` 内存 `useState`，刷新即丢，toast 却称"已加入本次记录" |
| 2 | `CareerPlanPage.tsx:171` | 结果卡硬编码 chip「已存入 AI服务记录」，无条件静态文案，不校验任何返回字段 |
| 3 | `FairCompanyDetailPage.tsx:80` | 构造的 `PrintFile` 无 `fileId`/`fileUrl`，页数为前端假算 `1 + Math.ceil(positions.length/8)`；`PrintPreviewPage.tsx:60` 判定 `!file.fileUrl` 即 `unavailable` → **两个打印按钮永远出不了纸** |
| 4 | `/me/benefits` | 权益券可领取，但 `pages/print/` 全域 grep 不到任何 coupon/benefit 消费代码 → **领了无处核销** |
| 5 | `/print/material-check` | 用户逐项裁决隐私片段，但默认「当前版本不生成新文件，打印仍使用原文件」→ 遮挡选择不产生产物（页面有诚实警示，非伪造，但交互等于白做） |
| 6 | `PolicyServiceHubPage.tsx:69` | `subsidy` 卡跳 `/renshi?tab=subsidy`，而 `renshi/shared.ts:14` 的 `VALID_TABS` 无 `subsidy` → 静默回落，失效链接 |

### 隐私预检可绕过（安全项）

只有 `/print/upload` 强制走 `material-check`。`print-scan/convert`、`print-scan/sign`、`scan/result` 三条路**直接空降 `/print/confirm`**，隐私预检为零——而扫描原件最可能含身份证号、手机号。

### `§10` 必展示字段缺失

- `/jobs/:id/offline`：只有「来源机构」，缺同步时间 / 外部ID / 外部链接 / 数据来源说明
- 招聘会子页 `FusionSourceMeta`：仅 3 字段，缺外部链接与来源说明

---

## 三、可删可并清单（23 条，均有证据）

按 `CLAUDE.md §8` 删除证据要求：无路由引用、无 import、无测试依赖、不被生产链路使用。

### A. 零入口孤儿（8 条）

| 路由 | 证据 |
|---|---|
| `/resume/export` | 全仓库零入口；页面无 state、无 API，两按钮硬编码 `disabled` |
| `/resume/self-assessment/history` | `useEffect` 硬编码 `setHistory([])`，永远空态 |
| `/me/activity/:id` | 全仓库无 navigate 指向；且用 O(n) 游标翻页扫日志找单条 |
| `/ai/plan` | 251 行，名为「AI方案确认」却**无任何 AI 调用**，无 state 时渲染硬编码 `DEFAULT_PLAN` |
| `/session-resume` | 能力与 `home/components/ContinuePanel.tsx` 重复，而该组件按定版原型**不渲染** → 同一能力两份实现、零可达入口 |
| `/campus/welcome` | 19 行空壳，无入口 |
| `/campus/freshman-insights` | 19 行空壳，无入口 |
| `/smart-campus/freshman-insights` | 21 行权限空态，后端开关强制 false |

### B. 重定向别名（4 条）

`/print/scan-convert`、`/print/scan-sign`、`/print/scan-feature`：三条历史路径别名，全仓库零引用，仅为旧书签兜底。
`/notifications`：6 行别名，整个文件只是 `<MyNotificationsPage loginFrom="/notifications" />`。

### C. 重复入口（3 条）

- `/resume` 与 `/resume/upload`：两条重定向指向同一目标，保留一条
- `/print/params`：零运行时导航（`PrintPreviewPage:320` 直接跳 confirm）。**但它独占唯一的真实估价能力**（单价/计费页数/预估金额三行），必须先把估价迁进 preview 再删。视觉测试仍在测它（`route-manifest.ts:16`、`fusion-w6-route-cases.ts:115`），需同步更新。

### D. Service Hub 家族（5 条）

`resume-service`、`jobs-service`、`fairs-service`、`interview-service`、`policy-service`：同一套「能力卡 + 快捷入口」模板（都 import `service-hub-editorial.css`），而首页 `serviceGroups.ts` 已把同样目标铺成磁贴，形成「磁贴直达」与「专区卡 → Hub → 目标页」两条并行路径。

先例：`routes/index.tsx:213` 已记录「服务中心中间页（ResumeHomePage）已移除，首页瓦片直达各功能」——这 5 个是同一模式的遗留。

其中 `/jobs-service` 8 张卡有 4 张是 `/jobs` 顶部分类 chip 的重复实现；`/fairs-service` 6 张卡有 3 张跳出本域；`/policy-service` 6 张卡有 4 张只是 `/renshi?tab=xxx` 换皮，且首页磁贴直接指向 `/renshi` 绕过该 Hub。

### E. 条件发布的签约风险提示（3 条）

`/contract-review` ×3：2026-08-09 已确定归入「AI简历服务 → 签约与权益」，不进入岗位信息、首页磁贴或百宝箱。入口和路由共同受 `VITE_ENABLE_CONTRACT_REVIEW` 保护，默认 false 且严格 `=== 'true'`；关闭时入口不渲染、路由回首页、页面 chunk 不打包。打开后报告打印仍诚实保持 `disabled`，真实模型、PostgreSQL、受控存储和浏览器隐私验收通过前不得在生产启用。

---

## 四、交付物清单（产品的真实产出）

| # | 交付物 | 当前路径 | 状态 |
|---|---|---|---|
| 1 | 打印好的文件 | `/print/progress` | ✅ 唯一真实出纸口 |
| 2 | 优化后简历 PDF | `/resume/optimize` | ✅ |
| 3 | AI 生成简历 PDF | `/resume/generate/preview` | ✅ |
| 4 | 求职材料 PDF（求职信/感谢信/作品集封面/材料清单） | `/resume/materials` | ✅ 需登录 |
| 5 | 岗位匹配报告 | `/resume/job-fit` | ✅ 可打印 |
| 6 | 职业规划建议单 | `/resume/career-plan` | ✅ 可打印 |
| 7 | 自我探索报告 PDF | `/resume/self-assessment/result` | ⚠️ 只给下载链接，**不能就地出纸** |
| 8 | 简历诊断报告 | `/resume/report` | ❌ **无保存/导出/打印，带不走** |
| 9 | 招聘会活动资料 | `/job-fairs/:id/materials` | ✅ 真实 HMAC 链路 |
| 10 | 招聘会 AI 参会准备单 | `/job-fairs/:id/visit-plan` | ✅ |
| 11 | 面试练习报告 | `/interview/report` | ✅ |
| 12 | 扫描件 PDF | `/scan/result` | ✅ |
| 13 | 图片合成 PDF | `/print-scan/convert` | ✅ 入我的文档 |
| 14 | 签章 PDF | `/print-scan/sign` | ✅ |
| 15 | 证件照 | `/print-scan/feature/id-photo` | ⏸ 「即将上线」说明页 |
| 16 | 取件码 | `/print/done`、`/print/pickup-claim` | ✅ |
| 17 | 二维码（去来源平台投递/预约/签到） | jobs / fairs / companies / renshi | ✅ 合规白名单文案零违规 |

**要修的两条**：#8 诊断报告带不走（缺 `printResumeReport`）、#7 自我探索只下载不出纸。

---

## 五、八种作业面型（105 页可归约到 8 型）

从盘点结果抽象，全部页面按**交互形态**只有 8 类：

| 型 | 职责 | 现有实例 | 原型状态 |
|---|---|---|---|
| **采集型** | 把一份材料弄进来 | `/print/upload`、`/resume/source`、`/scan/start`、`/upload/phone` | 四个入口做同一件事，可归一 |
| **加工型** | 文件 → AI 处理 → 新文件 | `/resume/parse`、`/resume/optimize`、`/print-scan/convert`、`/print-scan/sign` | 待设计 |
| **填槽型 B** | 收要素 → AI 生成 | `/resume/generate`、`/resume/materials` | ✅ `05-assistant-workface.html` |
| **比对型 C** | 两份材料对照 | `/resume/job-fit`、`/contract-review/result` | ✅ `06-jobfit-compare.html` |
| **问答型 A** | 对话 | `/assistant`、`/interview/session` | ⏳ 未做 |
| **浏览型** | 列表 → 详情 → 二维码外跳 | jobs / fairs / companies / renshi / offline-agencies | 待设计 |
| **履约型** | 核价 → 支付 → 出纸 → 完成 | `/print/confirm`→`cashier`→`progress`→`done` | ✅ `02-print-workbench.html` |
| **资产型** | 我的 + 继续办 | `/me/*` 12 条 | ✅ `04-profile.html`（需重做动作层） |

**采集型与履约型是所有交付物共享的头和尾**，中间换成加工/填槽/比对/问答即可。这是把 105 压到 20 以内的机制。

---

## 六、目标架构

```
                    ┌─ AI 编排层（首页调度带）─┐
                    │  判断处境 → 排出可交付路径 │
                    └───────────┬──────────────┘
                                ↓
   [采集型] ──→ [加工|填槽|比对|问答] ──→ [履约型] ──→ 交付物
      ↑              ↑ AI 主动在这里预填/预检/诊断      │
      │                                                ↓
   [浏览型] ──→ 二维码交付（外跳来源平台）        [资产型]
                                                       │
                                              「继续办」回任一环节
```

**硬原则**：AI 编排出的每条路径必须终结于一个真实交付物，不许有死路。不在任何交付路径上的页面，就是该合并或该删的。

---

## 七、推进顺序

| 批次 | 内容 | 风险 |
|---|---|---|
| **P0** | 修 §二 的 6 处伪造/断裂交付 + 隐私预检绕过 + §10 字段缺失 | 低，改文案与补字段为主；#3 #4 需补链路 |
| **P1** | 删 §三 A/B 组 12 条零入口孤儿与别名 | 低，均有零引用证据；需同步 verify 脚本与路由守卫 |
| **P2** | 迁移 `/print/params` 估价能力进 preview 后删除；合并 `/resume` 重复重定向 | 中，动主链路，须补测试 |
| **P3** | 收编 5 个 Service Hub | 中，需确认首页磁贴覆盖全部目标 |
| **P4** | 按 8 型重做作业面，功能挂型 | 高，设计工作量集中在此 |

P0–P3 完成后路由预计从 105 降至 **约 80**；P4 按型重组后目标 **20 以内**。

---

## 七A、后端审计修正（2026-08-08，两份只读审计 + Codex 复核）

> Codex 复核指出：6 处伪造交付不是 6 个 UI bug，而是「缺少可审计的交付状态机」的 6 种症状。
> 据此做了数据模型与服务层两份审计。**结论：主体是接线问题，不是缺一层。**

### 已经存在且设计正确的能力（不要重建）

| 能力 | 位置 |
|---|---|
| 文件血缘字段 | `FileObject.sourceFileId` + `assetCategory('original'/'optimized'/'derived')` + `derivedFiles` 自关联，`schema.prisma:793-796`。签章链路已证明可用（`print-sign.service.ts:344`） |
| 打印状态机防跳步 | `terminals-agent.service.ts:60-63` 白名单 + `:502-507` 校验，400 `INVALID_STATUS_TRANSITION` |
| claim 并发保护 | 事务内 CAS，`count !== 1` 不放行（`terminals-agent.service.ts:427-440`） |
| 计费不信前端 | 页数后端识别 + PriceConfig 报价（`print-jobs.service.ts:276-291`） |
| 反 SSRF | 打印文件必须本系统签名 URL（`print-jobs.service.ts:175-186`） |
| 权益核销账本 | `redeemForOrder()` 事务内 CAS 扣额度 + `RedemptionRecord` + 双份审计（`benefit-redemption.service.ts:94-200`）；一产物一核销 `@@unique([serviceType, serviceRefId])` |
| PII 扫描 | 真实服务端实现；`contentCategory=photo` 客户端可控跳过口子**已封**（`materials.service.ts:155-159` 注释有记录） |
| 出纸超时收敛 | 强制人工介入，不自动重派（`terminals-agent.service.ts:663-720`） |

### 真正缺的两处（都在链路末端）

1. **`PrintTask` 无指向 `FileObject` 的外键** —— 只有 `fileUrl String`（`schema.prisma:126`），fileId 靠解析 HMAC 签名 URL 反推、只落进 AuditLog。导致上游血缘再完整也 join 不到「实际出纸」这一跳；数据库里问不出「这个文件被打印过几次、打的是原件还是遮挡件」。
2. **全域无统一作业 ID** —— `AiResumeResult.taskId` 是不指向任何表的自造字符串，源文件 id 埋在 `payloadJson`；`ScanTask.fileId`、`ContractReviewTask.sourceFileId`、`MockInterviewSession.resumeFileId` 均为无 FK 裸列。跨域串联只能靠 `AuditLog` 的多态 JSON 事后拼。

补法不必新建统一作业表：**给 PrintTask 加一列 fileId 外键 + 在剩余 10 个产物点补传已存在的 sourceFileId + 三处裸列升为真 FK**，血缘即可从上传贯通到出纸。

### 只活在前端 / 当前未生效的「约束」

| # | 项 | 事实 |
|---|---|---|
| 1 | **隐私遮挡是空动作** | `pii_redact` 恒返回 `redactedFileId: null, resultFileCreated: false`（`materials.service.ts:629-630`），不产出新文件，**打印用的仍是含 PII 原件**。`normalize_a4` 同理（`:521-526`） |
| 2 | **「打印前必须隐私检查」纯前端流程** | 服务端建单不查 `DocumentProcessTask`（`print-jobs/` 下零引用）；DTO 无承载扫描凭证字段且 `forbidNonWhitelisted`；`FileObject` 无扫描标记。**直接调 `POST /print/jobs` 即可跳过整个 material-check** |
| 3 | **先付款后出纸当前不生效** | `PRINT_REQUIRE_PAID_BEFORE_CLAIM` 默认 false（`terminal-utils.ts:155`），仓库 `.env` 未声明 → 非生产环境未支付订单会被 Agent 正常领走出纸。生产有启动期 gate 强制显式声明（`production-runtime-gates.ts:169-180`），接真实支付通道时强制 true |
| 4 | **用券抵扣打印两端都不通** | 打印报价从不查 `BenefitGrant`（`pricing.service.ts` / `print-pricing.ts` 零命中）；`POST /orders/:id/redeem` **按设计无前端入口**（`order-redeem.controller.ts:13-14` 注释明写「本波不加」）。已接通的核销只有 AI 简历优化一条（`ai.controller.ts:174`） |
| 5 | **部分 AI 产出只回前端不落库** | 岗位解读正文（`job-ai.service.ts:128-142`）、排版调整（`ai.service.ts:448-450`）、助手对话（`ai.service.ts:746-775`，刻意的隐私设计） |
| 6 | **`persistResult` 静默吞异常** | `ai.service.ts:181-183` 为 `catch {}` 空块 → 写库失败时用户看到成功、库里没有行。这是一条**制造新伪交付的静默丢数据路径** |
| 7 | **「我的 AI 记录」覆盖不全** | `listAiRecords` 只读 `AiResumeResult` 7 种 kind（`member-assets.service.ts:150,168-176`）；面试报告落 `MockInterviewReport`、岗位推荐/解读落 `JobAiSession`，**均不在该列表** |

### 六处伪造交付的修法（无一项需要新增模型）

| # | 修法 | schema 变更 |
|---|---|---|
| (a) 简历优化「保存」 | 后端早已落库 `AiResumeResult(kind='optimize')`，端点 `GET /resume/records/:taskId/optimize` 在（`ai.controller.ts:174`）。前端 `handleSaveAdvice` 不发请求只 navigate → 删掉该按钮或改为读回服务端已有行 | 无 |
| (b) 职业规划 chip | 后端真的 upsert（`career-plan.service.ts:174-186`）。但匿名用户 `endUserId=null` 而 `listAiRecords` where 是 `{endUserId}` → **匿名场景该文案确为假**。改为读服务端返回的持久化标志 | 无 |
| (c) 招聘会企业打印 | 补一个「企业资料渲染 PDF → FileObject」service，可抄 `job-materials.service.ts:44-53` 或复用 `FairMaterialPrintBridge`（带 single-flight 锁与 TTL） | 无 |
| (d) 权益券 | 后端完备但打印侧两端不通（见上表 #4）。属产品决策：要么接通，要么在券卡注明「当前仅可用于 AI 简历优化」 | 无 |
| (e) 隐私遮挡 | 补三步：渲染遮挡 PDF → `files.upload({ assetCategory:'derived', sourceFileId })` → 回填 `resultFileId`。字段全在 | 无 |
| (f) 诊断报告带不走 | 数据已存于 `AiResumeResult(kind='parse').payloadJson.report`。`ai/resume/` 下有 career-plan-pdf / job-fit-pdf / self-assessment-pdf / fair-visit-plan-pdf，**独缺 resume-report-pdf**；controller 独缺 `@Post(':taskId/print')`。照抄 `career-plan.service.ts:212-250` | 无 |

### 修正后的 P0（按真实伤害排序）

| # | 项 | 性质 | schema |
|---|---|---|---|
| 1 | 隐私遮挡真实产出新文件 + 服务端强制校验「打印前已扫描/已决策」 | 补实现 + 加校验 | 无 |
| 2 | `PrintTask` 加 `fileId` 外键，血缘贯通到出纸 | **唯一真正缺的一层** | 加一列 |
| 3 | `PRINT_REQUIRE_PAID_BEFORE_CLAIM` 在所有环境显式声明 | 配置 | 无 |
| 4 | 六处伪造交付接线（见上表） | 接线 / 补 service | 无 |
| 5 | `persistResult` 空 catch 改为可观测失败 | 补错误处理 | 无 |

### Codex 对推进顺序的三条修正（已采纳）

1. **真实估价从 P2 提到 P0** —— 估价是支付与打印履约的前置条件，缺失直接破坏交易知情，不属于普通页面清理。
2. **「零入口」不等于「没人用」** —— 只能证明站内不可达，不能排除二维码、历史收藏、外部链接、运营印刷物料。P1 应先**停用入口 + 加访问观测**，确认无访问后再物理删除。（本仓 `/print/scan-*` 三条别名，盘点报告自己写明是「外部书签/旧二维码兜底」。）
3. **P3 收编 Service Hub 不应在 P4 架构确定前做** —— 否则会先按旧结构迁移一次、随后再重做。

---

## 七B、十个作业面型（已全部产出样张）

> 修正说明：§五 曾把 8 型列成一张平表，经复核这是**混了三个层级**——
> 采集/加工/填槽/比对是**作业步骤**，问答/浏览是**交互方式**，履约/资产是**生命周期阶段**。
> 按平表「一页一型」会造出新的重复页面。正确模型见下。

### 正确模型

```
一条交付路径 = 采集 → [作业步骤 ×N] → 履约 → 资产归档
                        ↑ 加工 | 填槽 | 比对（可串联、可重复）

问答 / 浏览 不是页面型，是交互方式，可出现在任何步骤里
编排（首页）在最上层，决定这次走哪条路径
```

**采集 与 履约 是所有交付物共享的头和尾**，中间换成加工/填槽/比对/问答即可。
这是把 105 个页面压到 20 以内的机制。

**加工 vs 填槽 的硬边界**：加工改变已有内容或文件本体；填槽是在固定结构或模板中补齐字段。
输出结构预先确定的是填槽，输出内容/版式可能被重写的是加工。两者同时发生时拆成连续步骤。
（按此边界，`/resume/generate` 是「填槽 → 加工」两步，不是单一填槽。）

### 十张样张

| # | 型 | 层级 | 样张 | 状态 |
|---|---|---|---|---|
| 1 | 编排 | 顶层 | `01-home.html` | ✅ 四态统一 |
| 2 | 履约 | 生命周期 | `02-print-workbench.html` | ✅ |
| 3 | 顾问驾驶舱 | 顶层 | `03-assistant.html` | ✅ |
| 4 | 资产 | 生命周期 | `04-profile.html` | ✅ |
| 5 | 填槽（B） | 作业步骤 | `05-assistant-workface.html` | ✅ 五态 |
| 6 | 比对（C） | 作业步骤 | `06-jobfit-compare.html` | ✅ 两态 |
| 7 | 浏览 + AI 分诊 | 交互方式 | `07-jobs-ai-triage.html` | ✅ 四态（动效待补） |
| 8 | 采集 | 作业步骤 | `08-intake.html` | ✅ 四态 |
| 9 | 加工 | 作业步骤 | `09-transform.html` | ✅ 四态 |
| 10 | 问答（A） | 交互方式 | `10-qa.html` | ✅ 四态 |

**贯穿的交互语法**：右侧逐条裁决 ↔ 左侧原文定位高亮。
06 比对岗位要求、08 裁决隐私片段、09 裁决 AI 改动、10 钉要点——用户学会一次，四处通用。

---

## 七C、功能 × 型 映射表

> **八大功能不再逐个设计页面**，而是由上表的型组合而成。本表说明每个功能由哪些型构成、
> 各自的差异点、以及 AI 该长在哪一步。

| 功能 | 组成（型） | 交付物 | AI 长在哪 | 与通用型的差异 |
|---|---|---|---|---|
| **打印扫描** | 采集 → 履约 | 打印件 · 取件码 | 采集步：格式/页数/隐私预检 | 无加工步；四个采集入口归一后隐私预检不可绕过 |
| **AI 简历服务** | 采集 → 加工 → 履约 → 资产 | 优化版 PDF · 诊断报告 · 求职材料 | 加工步：诊断/优化/生成 | 全产品唯一走完四段的功能；生成走「填槽 → 加工」两步 |
| **岗位信息** | 浏览 + AI 分诊（→ 比对） | 二维码 · 匹配报告 | 分诊：意图解析 + 跨源聚合；比对：逐条对照 | 三路来源异质，须分段切换且**不做跨源横向比较** |
| **招聘会** | 浏览 + AI 分诊 → 加工 → 履约 | 活动资料 · 参会准备单 | 加工步：`fair_visit_plan` 生成备料清单 | 浏览层多一个展位导览；资料打印走真实 HMAC 链路 |
| **AI 面试训练** | 问答（A）→ 加工 → 履约 | 练习报告 | 问答步：数字人逐题；加工步：生成报告 | 问答是**多轮有状态**的，不同于 HR 问答的单轮 |
| **政策服务** | 浏览 + AI 分诊 → 问答 | 材料清单 · 要点 | 分诊：按身份筛可办政策 | 结论必须带「以主管部门审核为准」；当前生产版**零 AI** |
| **百宝箱** | 采集 → 加工 → 履约（按工具而异） | 证件照 · 转换件 · 签章件 | 加工步 | 后台配置驱动，工具集合非固定 |
| **智慧校园** | 浏览 | 仅信息 | 暂无 | 校方开关控制；优先级最低，建议先不动 |

### 由此得出的三条结论

1. **只有「AI 简历服务」走完整四段**（采集→加工→履约→资产），其余功能都是它的子集。
   所以**端到端样张做简历流程即可**，其余不必再画。
2. **「岗位信息」「招聘会」「政策服务」共用同一个骨架**（浏览 + AI 分诊），只换数据源与文案。
   `07-jobs-ai-triage.html` 是这三者的共同模板。
3. **「智慧校园」不产出任何交付物**，按「不在任何交付路径上的页面就该合并或删除」的原则，
   它要么补上真实校园服务办理链路，要么降级为信息入口。

---

## 八、待补

- A 型问答作业面原型
- 采集型 / 加工型 / 浏览型原型
- 每个交付物的最短路径图（哪几步 AI 替你做、哪几步必须本人确认）
