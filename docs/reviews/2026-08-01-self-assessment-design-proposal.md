# 自我探索测评（非临床、用户可控）设计方案

> 阅读对象：产品 / 设计 / 后续接手开发的模型
> 编写时间：2026-08-01
> 状态：**只读探索结论 + 设计建议（非落地，本文档不产生代码、不改文件、不触发 schema 变化）**
> 涉及流程入口：AI 简历服务（首页）、AI 助手（底部 Tab）、「我的」页面（信息架构整改后不再承载明细聚合区，明细归位到对应业务页面）
> 引用基线：
> - `CLAUDE.md` § 2 不能做的功能、§ 14 每次开发要求
> - `docs/compliance/compliance-boundary.md` § 2 绝对禁止的功能、§ 4 数据边界、§ 8 营销权益边界
> - `docs/product/feature-scope.md` § 2.6 AI 助手、§ 六 §6.7 Phase C-2~C-6 商业化路线
> - `docs/product/user-data-flow-matrix.md` 顶部信息架构整改（2026-06-14）+ § 三 AI 简历服务 / 岗位信息表 + § 五 2E 落点
> - `docs/superpowers/specs/...` 中既定执行口径

---

## 0. 一句话结论

**自我探索测评可以作为"AI 简历服务"既有「职业规划」旁系结果的**附加结果**，以"可选附加报告"形式附加到简历 PDF 附加段，并复用既有的 `AiResumeResult(kind='career_plan')` →「AI 服务记录」→「我的文档」→ 打印链路承载；首页、AI 助手、「我的」**不新增一级入口**，只在既有 `职业规划` / 岗位匹配 结果页内通过"附加模块"按钮唤起，AI 助手仅作为问答引导和入口讲解。**

理由：

1. 「测评」与「诊断 / 优化 / 岗位匹配 / 职业规划」既有 4 条 AI 能力语义相近但维度不同。把它做成"独立新一级入口"会立刻违反 `user-data-flow-matrix.md §二入口稳定规则`（不新增重复卡片 / 同义入口）和 `docs/product/feature-scope.md § 2.1`（底部 Tab 固定三项，首页入口不再扩）。
2. 「测评」结果适合作为**附加报告 / PDF 附加段**呈现：用户在简历末尾追加一段「自我探索摘要」，便于打印、扫描、发给第三方；而「测评」本身有自己的主视图（按维度分页），也可单独导出。
3. 它天然适配"信息架构整改后的『我的』页"承载方式：明细不进「我的」聚合区，而是和「职业规划」「岗位匹配参考」并列落到 `MyAiRecordsPage`（即 AI 服务记录页）的"AI 服务记录"明细中，并由 `ResumeDetailPage` 在简历附录列出可打印的附加段。
4. 合规上守住三条："非临床、非诊断、不分类型、不判定人格"（避免误用 MBTI 性格号 / 心理状态 / 神经多样性标签） + "不向企业推送、不记录测评画像" + "用户可控：可中断、可重答、可撤回、可删除、本地展示不发给企业"。

---

## 1. 边界与差异化（不与既有 AI 服务同义重复）

### 1.1 五条现有 AI 能力的事实清单（基线）

| 既有能力 | 入向材料 | 输出形态 | 落到"我的"哪个分类 | 已接通的派生链路 |
|---|---|---|---|---|
| **AI 简历诊断**（`AiResumeResult(kind='parse')`）| 用户上传简历 | 6 维评分 + 风险表述 + 修改优先级 | AI 服务记录（"简历诊断"）+ 我的简历 | `ResumeReportPage`、`CareerPlanPage` 与其连接 |
| **AI 简历优化**（`AiResumeResult(kind='optimize')`）| 诊断后简历 + 目标岗位 | 优化表达模块，可导出 PDF | AI 服务记录 + 我的文档 + 打印订单 | `ResumeOptimizePage` / `ResumeReportPage` |
| **AI 简历生成**（`AiResumeResult(kind='generate')`）| 用户填写表单 | 生成的简历 | AI 服务记录 + 我的简历 + 我的文档 | `ResumeGeneratePage` |
| **岗位匹配参考**（`AiResumeResult(kind='job_fit')`）| 简历 + 系统岗位 / 手填岗位 | 三档参考等级（无百分比）+ 匹配点 + 差距 + 重写建议 | AI 服务记录 + 我的文档 + 打印订单 | `JobFitPage`，并展示来源平台投递引导 |
| **职业规划建议**（`AiResumeResult(kind='career_plan')`）| 简历 (+ 可选 job_fit + 模拟面试) | 现状画像 + 发展方向 + 技能计划 + 行动清单 | AI 服务记录 + 我的文档 + 打印订单 | `CareerPlanPage`，CTA 串到优化/匹配/面试 |
| 招聘会 AI 准备单（`AiResumeResult(kind='fair_visit_plan')`）| 简历 + 招聘会 | 参会建议 + 重点企业 + 现场提示 | AI 服务记录 + 我的文档 | `FairVisitPlanPage` |

### 1.2 「自我探索测评」的差异化定位

把它放在**"对内的本人参考"维度**，与"对岗位的对外参考"（岗位匹配参考 / 职业规划发展建议）平级，但**与对简历文本表达层面的诊断 / 优化 / 生成严格隔离**。具体差异化边界：

| 维度 | 简历诊断 | 简历优化 | 岗位匹配参考 | 职业规划 | **自我探索测评（拟）** |
|---|---|---|---|---|---|
| 核心问题 | 这份简历文本写得怎样？ | 怎么把简历表达改得更好？ | 这份简历匹不匹配某个岗位？ | 这个人未来可以往哪走？ | **我是什么样的人？我看重什么？我怎么工作？** |
| 输入材料 | 简历原文 | 简历 + 目标岗位 | 简历 + 目标岗位 | 简历 + 可选 job_fit + 模拟面试 | **本人问卷作答**（自愿，不依赖简历） |
| 输出形态 | 6 维评分 + 优先级 | 优化前后对比 + 重写表达 | 三档匹配 + 匹配/差距/重写 | 4 节规划文本 | **多维度画像 + 弱解释 + 行动建议（可选）** |
| 是否依赖简历 | 是 | 是 | 是 | 是 | **否；可独立进行** |
| 是否触发企业 | 否 | 否 | 引导去来源平台 | 否 | **绝对不触发；不传给企业、不与岗位匹配融合展示** |
| 是否给分数 | 是（维度分数） | 否 | 是（三档参考） | 否 | **否；只给维度强弱不评分，不贴性格标签** |
| 是否承诺结果 | 否 | 否 | 否 | 否 | **否；不就职业选择 / 人格 / 心理下结论** |
| 储存位置 | AI 服务记录 | AI 服务记录 + 我的文档 + 打印订单 | AI 服务记录 + 我的文档 + 打印订单 | AI 服务记录 + 我的文档 + 打印订单 | **AI 服务记录（不挂载简历 taskId）；可单独导出 PDF；可"附加到简历下方"作为 PDF 附录段** |

**与"职业规划"的关系**：测评与职业规划都看"我是谁 / 我能往哪走"，但：
- **职业规划 = 操作 / 行动维度**：依赖简历原文 + 既定岗位，给阶段行动；
- **测评 = 偏好的自我认知维度**：不依赖简历，**先于 / 平行于**简历准备。

因此，**测评结果可以作为"职业规划"的输入上下文（用户在职业规划页选择'我的自我探索测评'作为附加依据，注明基于哪些维度，并按 `career_plan.basedOn` 现有的 `{ resume, jobFit, interview }` 模型扩展为 `{ resume, jobFit, interview, selfAssessment }` 字符串数组）**，但**不是职业规划的子集**，也不是前置必选。

**与"岗位匹配参考"的关系**：测评并不参与岗位匹配的计算；岗位匹配以简历事实和岗位职责为依据。测评如果出现，必须明确声明："测评结果**不参与**岗位匹配参考的计算，也不作为匹配依据回传企业。"

**与"AI 助手"的关系**：AI 助手只作为"讲解测评方法 / 解读维度 / 引导入口"的入口通道；助手本身（`/assistant`）是会话类能力（`AssistantConversation` 当前未落库），不存测评数据。

### 1.3 合规边界（直接引用）

> ⚠️ **红线**：本项目绝非心理 / 临床 / 测评公司；公司暂无人力资源服务许可证。
> 下列条目与 `docs/compliance/compliance-boundary.md § 2 + § 4` 一致，并新增"测评"专属项。

| 允许做 | 禁止做 |
|---|---|
| 给出维度强弱（标签化名字如「倾向探索型 / 倾向结构型」）且**仅供本人参考** | 给出 MBTI / 大五人格 / Holland 代码 / 心理 / 神经多样性 / 临床 / 障碍 / 风险标签 |
| 给出志愿维度的本人书写建议（如"你写到的志愿行动更关注 X、Y"） | 给出薪资预测、岗位推荐成功概率、Offer 概率 |
| 用户可随时中断、重答、撤回、删除本人记录 | 把测评结果回传给企业、合作机构、来源平台、第三方 |
| 结果仅展示给本人，并可作为**简历 PDF 附加段**附加到末尾 | 把画像回流到任何已对接的岗位匹配 / 招聘闭环流程 |
| 输出文案含"仅供参考、本工具不构成职业 / 心理建议" | 出现"测评推荐岗位 / 投递 / 候选人筛选 / 匹配企业" |
| 与岗位匹配参考独立建模、独立接口、独立清单 | 在测评结果中引用岗位匹配 API / 把测评结论注入到 `JobAiSession` |
| 用户可控开关：是否参与"附加到简历下方" | 默认强制附加、不得"附加到简历下方且不可关闭" |

**与 § 2 不能做的功能的对齐**（不能再加一遍，防止越界）：
- 不新增平台内投递；
- 不发简历给企业；
- 不做企业筛选；
- 不做面试邀约；
- 不做 Offer；
- 不做候选人推荐；
- 不形成自营招聘闭环；
- 不让企业发岗直收简历。

测评结果若被企业要求获取，**应直接拒绝**；不得为"测评结果"另开后门。

---

## 2. 入口接入方式（不新增一级入口）

### 2.1 三条入口通道（既有 / 不新增）

按 `docs/product/user-data-flow-matrix.md § 二 入口稳定规则` 与 `docs/product/feature-scope.md § 2.1`：

> 底部 Tab 固定为：首页 / AI 助手 / 我的。
> 当前首页与各业务板块里的功能入口已经定版；后续只做已有入口真实化、页面接真、按钮接线、状态补齐和「我的」数据闭环，不新增重复入口 / 同义卡片。

**因此测评不新增一级入口，只能挂在以下三处既有页面**：

| 接入位置 | 用户路径 | 形态 | 是否新增路由 |
|---|---|---|---|
| ① AI 简历服务 → 职业规划 结果页 | `/resume/career-plan` 结果页"继续下一步"区追加「附加自我探索测评」按钮 | 二级 / 三级 CTA，**复用既有 `KioskActionBar` 按钮组** | 否，**复用** `/resume/career-plan` 与 `AiResumeResult(kind='career_plan')` 链路 |
| ② 诊断报告 → 职业规划 → 测评 | `/resume/report` 结果页"继续下一步"区追加「先做一次自我探索测评，再规划」引导 | 弱引导文案 + 二级 CTA | 否，**复用** `ResumeReportPage` |
| ③ AI 助手 `/assistant` | 对话中识别意图 `"自我探索"` / `"测评"` / `"职业兴趣"` 时，推荐「去职业规划页附加测评」 | 助手回复 + `AssistantAction[]` 跳转按钮 | 否，**复用** `/assistant` 与 `AssistantIntent` 类型 |

**不新增**：
- ❌ 不新增"测评中心" / "性格测试" / "职业兴趣测评" 等**首页新磁贴 / 同义卡片**；
- ❌ 不在"AI 助手"底部 Tab 上新增第二个 Skill 入口；
- ❌ 不在"我的"页新建"测评"分组（违反信息架构整改：`AccountAssetsPanel` 已删除，明细归位业务页）。

### 2.2 入口 SKU 推荐

- **AI 简历服务首页磁贴保持不变**：
  - 6 个保留磁贴（参见 `apps/kiosk/src/pages/home/serviceGroups.ts`:30-48）：AI 简历诊断 / AI 简历优化 / 简历素材库 / 职业规划 / 简历打印 / 求职材料。
- **测评只在「职业规划」流程里出现**：
  - `CareerPlanPage` 首页"生成前说明"页：增加一行说明"如需把『自我探索』画像作为规划的依据之一，可先完成一份简短的自我测评（≤ 5 分钟）"。
  - `CareerPlanPage` 结果页：在"继续下一步"区追加「附加自我探索测评」按钮；点击后**先引导去 `/resume/self-assessment?from=career-plan&taskId=...`**（**新增的"内部子路由"**，不新增底部 Tab，不新增首页磁贴，不修改 `serviceGroups`）。
  - `CareerPlanPage` 不再有「附加职业规划测评」按钮的硬展示：当用户完成测评后，结果页 CTA 区才显示对应"查看测评结果 / 把测评结果纳入下次规划"。
- **AI 助手 `/assistant`**：
  - 增加 `AssistantIntent` 子分支识别能力，但**不修改 `AssistantIntent` 枚举值**，仍为 `'resume' | 'print' | 'job' | 'fair' | 'policy' | 'general'`；识别为"测评"语义的查询归到 `'resume'` 即可，助手只产出 `AssistantAction.label='了解自我探索测评'`、`.route='/resume/career-plan?next=self-assessment'` 的跳转按钮。
  - **不要**让助手"先做题，再告诉你未来岗位"——这是禁止的红线，文案必须使用"自我探索仅供本人参考；本平台不承诺职业建议或岗位推荐"。

### 2.3 新增的路由（仅作"既有分类下的子页面"，不构成新入口）

| 路由 | 文件级入口 | 归属 | 备注 |
|---|---|---|---|
| `/resume/self-assessment?from=<career-plan\|report>&taskId=<...>` | `apps/kiosk/src/pages/resume/SelfAssessmentPage.tsx`（建议） | AI 简历服务域 | 题面作答（分多步）+ 中断恢复 + 结果预览 |
| `/resume/self-assessment/result?resultId=<aid>` | `apps/kiosk/src/pages/resume/SelfAssessmentResultPage.tsx`（建议） | AI 简历服务域 | 结果详情 / 打印附加段 / 删除 / 重新作答 |

**挂接到 `apps/kiosk/src/routes/index.tsx`** 时，仍属 `/resume/*` 命名空间，与 `JobFitPage`、`CareerPlanPage` 并列，**不算底部 Tab 增量**。

### 2.4 AI 助手（`/assistant`）现状摘要

- 入口：底部 Tab 第 2 项，Kiosk `/assistant` 路由 (`apps/kiosk/src/routes/index.tsx`)。
- 数据：`AssistantConversation` 当前**未落库**（schema 无该模型，见 `docs/product/user-data-flow-matrix.md §3.7`）；会话只存内存。
- 助手技能：`AssistantSkill = 'offer_compare' | 'salary_negotiation' | 'hr_qa'`（百宝箱场景），与本提案的"测评讲解"无重叠。
- 因此：测评讲解**不增加新 Skill**，沿用 `AssistantIntent='resume'`，通过既有 `AssistantAction[]` 链跳到 `/resume/career-plan?next=self-assessment`。

---

## 3. "附加到简历下方"是否设计为 PDF 附加段

### 3.1 结论：是，但作为**可选附加段**，默认不勾选

**默认行为**：
- 完成测评后（`AiResumeResult(kind='career_plan')` 已存在或单独 `AiResumeResult(kind='self_assessment')`），用户首次进入"打印我的简历 / 打印建议单"页时，**不自动**附加测评摘要。
- 由用户在 `/print/confirm` 之前的"附加报告"列表里勾选"附加自我探索测评摘要"，打印时与简历同包成一份 PDF（与现有"格式转换 + 签名盖章"组合 PDF 类似：`pdf-lib` 多页合并）。

### 3.2 多套报告可选

测评结果有两个独立维度，**都允许同时存在（最多一份）**，打印与下载时由用户在结果页切换勾选：

| 套件名 | 内容 | 文件形态 | 上游权限 |
|---|---|---|---|
| **简短摘要**（默认打印 / 默认文档） | 4 项维度强弱 + 1 行自我提示语 + 依据材料 + 生成时间 | 1~2 页 PDF 摘要 | 一键生成 |
| **完整画像** | 5~8 维度细项 + 每项"依据我的作答"原文 + 不评分结论 | 3~5 页 PDF 画像 | 用户主动下载 |
| **附加到简历下方**（额外勾选） | 在用户简历 PDF 末尾追加「自我探索摘要（可选）」段，仅打印；**不进 AI 服务记录独立的 PDF 上下文** | 合并后简历 PDF | 用户勾选 |

> "附加到简历下方"必须**仅作为可勾选打印选项存在**，并且**不能反向被企业 / 来源平台看到**——它只进用户打印的合并 PDF，不进 AI 服务记录额外项。

### 3.3 落地动作（文件级接入点）

- **数据模型**：`packages/shared/src/types/ai.ts` 新增 `SelfAssessmentResult` / `SelfAssessmentRequest` / `SelfAssessmentResponse`，新增 `AiKind` 字面量 `'self_assessment'`；同步 `packages/shared/src/types/memberAssets.ts` `MemberAiRecordKind` 加入 `'self_assessment'`；同步 `services/api/src/member-assets/member-assets.service.ts` 的 `listAiRecords` 与 `KIND_META` (kiosk `apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx:20-27`)。
- **Prisma**：`services/api/prisma/schema.prisma` `AiResumeResult.kind` 当前为 `String`（已支持多枚举值），**不需要 schema 变更**；但需要在 SQLite/PostgreSQL 双 schema 中确认迁移脚本不要清理历史。`AiResumeResult.taskId` 必填，本次若允许"无简历上下文"作答，需将 `taskId` 设计为"虚拟 / 显式 `sa_<taskId>` 前缀"，而非新增必填列。
- **服务层**：`services/api/src/ai/resume/self-assessment.service.ts`（新文件，仿 `career-plan.service.ts`）：
  - 入参 `{ taskId?: string; endUserId: | null; accessToken?: | null; assessmentVersion: 'sa_v1' }`
  - 服务端把问卷答案一次性计算维度强弱，**不调 LLM**，全部由前端题面 + 后端规则计算；LLM 仅在用户点击"基于画像写一句自我提示语"时触发（且需明确告知）。
  - 写入 `AiResumeResult(kind='self_assessment', payloadJson=...)`，`endUserId` 可空（匿名同样支持），`accessTokenHash` 同样一次性。
  - **不在 cron 自动清理以外**增加长期保存；`expiresAt` 与现有 `RESULT_TTL_HOURS = 24` 持平（或者单独 `SELF_ASSESSMENT_TTL_HOURS`）。
- **PDF 服务**：`services/api/src/ai/resume/self-assessment-pdf.service.ts`，参照 `career-plan-pdf.service.ts` 的 pdfkit 字体策略。
- **打印合并**：`apps/kiosk/src/pages/resume/SelfAssessmentResultPage.tsx` 上"附加到简历下方"按钮链到 `/print/confirm`，传入组合 PDF 任务；现有 `/print/confirm` 接收 `composite=true` 字段，使用 `pdf-lib` 合并（同 `signature-stamp` 与 `convert-images` 的合并链路）。
- **审计**：`audit.write({ action:'resume.self_assessment_generate', targetType:'ai_task', targetId:..., payload:{ hasResumeCtx: !!parse?.endUserId, dimensions: number } })`，**不含个人答案原文与画像细节**（与现有 `career_plan` / `job_fit` 一致）。

### 3.4 与"AI 服务记录 / 我的文档"如何归位

按信息架构整改（2026-06-14，`docs/product/user-data-flow-matrix.md` 顶部）：
- **明细不进"我的"聚合区**：`AccountAssetsPanel` 已删除；
- 测评归属如下：

| 数据分类 | 承载位置 | 入口 |
|---|---|---|
| 测评记录元数据（taskId、kind、状态、时间）| **AI 服务记录**（`apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx`） | `/me/ai-records`，新增 kind 标识 `自我探索` |
| 测评结果 PDF（完整画像）| **我的文档**（`apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx`，与现有 career_plan / job_fit PDF 文件同级） | `/me/documents` |
| 测评打印任务 | **打印订单**（`MyPrintOrdersPage`，同既有的"职业规划建议单打印"路径） | `/me/print-orders` |
| 附加到简历下方的合并 PDF | **打印订单**，归并为一次合并打印任务的明细项；不进独立 AI 服务记录 | `/me/print-orders` |
| 会话讲解（助手对话） | **不在此归档**——助手会话不落库（与现状一致） | — |

### 3.5 视图层按钮与页面操作

| 页面 | 元素 | 行为 |
|---|---|---|
| `/resume/self-assessment` | `开始作答` | 第 1 题；进度条 / 剩余题数 |
| `/resume/self-assessment` | `暂停并保存` | 写入 `AiResumeResult(kind='self_assessment', status='pending', payloadJson=...)，下次凭 taskId + accessToken 读回 |
| `/resume/self-assessment` | `删除已作答进度` | 硬删 AiResumeResult 同 taskId 行（同 `deleteAiRecord` 级联策略） |
| `/resume/self-assessment/result` | `完整画像（PDF）` | 生成并下载 PDF → 我的文档 |
| `/resume/self-assessment/result` | `附加到简历下方（合并打印）` | 跳 `/print/confirm?composite=1&type=self-assessment` |
| `/resume/self-assessment/result` | `重新作答` | 标记旧记录 `deleted` → 新建 taskId |
| `/resume/self-assessment/result` | `删除本次记录` | 硬删 + 审计 |
| `/resume/career-plan` | `附加自我探索测评`（结果页 CTA）| 跳 `/resume/self-assessment?from=career-plan&taskId=<careerPlanTaskId>` |

---

## 4. 测评与既有 AI 服务的归位汇总

### 4.1 数据表

| 模型 / 表 | 用途 | 行为 |
|---|---|---|
| `AiResumeResult(kind='self_assessment')` | 保存测评结果（任务态 / 完成态）| 接入 `expiresAt`；可被 `deleteAiRecord` 硬删；级联同 taskId 的会话（MVP 不增加 JobAiSession） |
| `AiResumeResult(kind='career_plan')` 改造 | 在 `basedOn.basedOn` 增加 `selfAssessment: string | null` 字段（仿 `jobFit`、`interview`）| 不新增 schema 字段；只新增 `payloadJson` 业务键（与现有 `CareerPlanPayload` 同源） |
| **不新增** Prisma 模型 | — | 业务保持轻量 |

### 4.2 已写好的"附加到简历下方"打印合并的范围限定（合规）

- **只允许**：单次合并在用户本人的打印任务里；
- **不允许**：合并 PDF 自动同步到任何"分享 / 转发 / 投递给来源平台"功能；
- **不允许**：把测评画像自动写入 `JobAiSession`；
- **不允许**：把测评画像写入 `FileObject.purpose='print_doc'` 以外的类别（例如 `share_link` / `external_share`）。

### 4.3 Kiosk / Admin / Partner 三端承载

| 端 | 承载 |
|---|---|
| **Kiosk 前台** | 作答页 / 结果页 / 附加到简历下方 / AI 服务记录明细 / 我的文档 / 打印订单 |
| **Admin 后台** | **不新增**测评页面；`/admin/ai-services` 现有 `AiServiceController` 控制台仅增加 `self_assessment` 的调用计数行（与 `job_fit` / `career_plan` 同级）——这属于"页面级新增 1 行表格条目"，**不等于新建菜单 / 新页** |
| **Partner 后台** | **不新增**页面、不读取画像、不分享画像 |

---

## 5. 管理员后台是否需要新页面

### 5.1 结论：不需要新页面，但需要"现有页面加一行条目"

参照 `docs/product/feature-scope.md §三 管理员后台功能清单`，现有 `AI服务管理` 模块（`AiServiceController`，P1）已含 `job_fit` / `career_plan` / `fair_visit_plan` 等 kind 的调用计数与 TTL 治理。

**最小补齐方式**（**不**新增菜单 / 不**新增二级页面**）：
- 在 `AiServiceController` / Admin `/ai-services` 现有表格的 kind 列表里**补一行**「自我探索测评（self_assessment）」，行为与既有 `career_plan` 一致：
  - 显示调用次数、TTL 是否到期、Provider、是否进 mock；
  - 仅展示**计数与留存元数据**，**不含**测评答案与画像细节（与服务端 SELECT 列表对 `payloadJson` 保持显式黑名单一致）。
- **不**提供"内容预览"按钮给 Admin；与现有 `CareerPlan` 列表项一致（保持只统计、不读 PII 原则）。
- **不**提供"删除用户测评"按钮给 Admin，除非走数据权利工单的 Admin `/member-privacy` 通道；与现有 `deleteAiRecord` 同语义（用户本人删除 / 数据权利工单处理）。

如未来确实需要"风险预警 / 流量异常"，复用既有 `Admin /alerts`（告警中心）通道，不重建子页面。

### 5.2 "新页面"明确禁止

- ❌ 不新增"测评审核中心"（测评非内容、非岗位、不是合作机构发布，无需审核）；
- ❌ 不新增"测评画像浏览"页（与 PII 隔离原则冲突）；
- ❌ 不新增"测评推送配置"页（合规边界：测评结果不向企业 / 合作机构 / 来源平台推送）。

---

## 6. 既有模式 / 文件级接入候选清单（不改代码，先选点）

> 仅列文件级接入点；真正落地须走完整任务审查与文件预算评估（CLAUDE.md § 8 / `.ccg/spec/guides/index.md`）。

### 6.1 必须新增（按预算上限控制行数）

| 文件路径（候选）| 新增内容 | 行数预算 |
|---|---|---|
| `services/api/src/ai/resume/self-assessment.service.ts` | 问卷答题 / 维度强弱计算 / 写库 / 审计 | ≤ 220 行 |
| `services/api/src/ai/resume/self-assessment-pdf.service.ts` | 简短摘要 + 完整画像 PDF | ≤ 200 行 |
| `services/api/src/ai/resume/self-assessment.controller.ts` | `POST /ai/self-assessment/start` / `submit` / `result` / `print` | ≤ 150 行 |
| `services/api/src/ai/ai.module.ts` | 注入 `SelfAssessmentService` | 现有 ≤ 5 行增量 |
| `apps/kiosk/src/pages/resume/SelfAssessmentPage.tsx` | 作答页面 | ≤ 350 行 |
| `apps/kiosk/src/pages/resume/SelfAssessmentResultPage.tsx` | 结果 / 附加 / 删除 | ≤ 350 行 |
| `apps/kiosk/src/services/api/selfAssessment.ts` | API 客户端 | ≤ 100 行 |
| `apps/kiosk/src/pages/resume/selfAssessment.css` 与扩展 | 触屏样式（≥ 48px 触控 / 27 寸竖屏） | ≤ 200 行 |
| `apps/kiosk/src/routes/index.tsx` | 注册两条路由（`/resume/self-assessment` 与 `/resume/self-assessment/result`） | ≤ 8 行增量 |
| `packages/shared/src/types/ai.ts` / `memberAssets.ts` | `SelfAssessmentResult`、`MemberAiRecordKind += 'self_assessment'` | ≤ 80 行 |

### 6.2 必须改动（既有文件，局部）

| 文件路径 | 改动 |
|---|---|
| `apps/kiosk/src/pages/home/serviceGroups.ts` | **不改**（不新增磁贴） |
| `apps/kiosk/src/pages/resume/CareerPlanPage.tsx` | 结果页 CTA 区追加「附加自我探索测评」按钮；门导入 `from=career-plan` |
| `apps/kiosk/src/pages/resume/ResumeReportPage.tsx` | 弱引导文案 1 行 |
| `apps/kiosk/src/pages/resume/JobFitPage.tsx` | **不改**（测评不进 job_fit） |
| `apps/kiosk/src/pages/assistant/AssistantPage.tsx` | 加入"测评"intent 跳转 `AssistantAction` |
| `apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx` | `KIND_META` 增加 `self_assessment` |
| `services/api/src/member-assets/member-assets.service.ts` | `listAiRecords` 与级联删除支持 `kind='self_assessment'` |
| `apps/kiosk/src/pages/profile/me/MyResumesPage.tsx` | **不改**（个人简历不展示测评） |
| `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx` | 文档类型标签新增 `self_assessment` |

### 6.3 必须不改（合规 / 信息架构 / 入口稳定）

- ❌ `apps/kiosk/src/pages/home/serviceGroups.ts`：不增加磁贴；
- ❌ `apps/kiosk/src/pages/profile/ProfilePage.tsx`：不再渲染"账号资产"聚合区（整改已落地）；
- ❌ Partner 后台：全部不接入测评；
- ❌ `services/api/src/job-ai/`：不接入测评，不让测评答案回流到 `JobAiSession`；
- ❌ `services/api/src/ai/resume/career-plan.service.ts`：`career_plan` 业务接口不改造 schema，**只在 `payloadJson` 的 `basedOn` 增加可空 `'selfAssessment'` 字符串字段**；
- ❌ `docs/compliance/compliance-boundary.md § 8 营销 / 权益 / 套餐 / 补贴 / 支付合规边界`：测评**不作为权益发放**，不被套餐售卖（详见第 7 节）。

---

## 7. 与"会员中心"的关系

### 7.1 测评**不**是会员权益、不进套餐、不进支付

按 `docs/compliance/compliance-boundary.md § 8.4 服务套餐边界`：
> 服务套餐只卖工具服务和打印服务，不卖"录用结果"。

测评本身就**不是套餐商品**：
- 不应被"VIP 解锁全部测评维度"包装（维度由题面计算，**不**是后端付费解锁的隐藏内容）；
- 不应被"专属测评师分析"包装；
- 不应被"测评报告打印优惠"包装成另一种售卖（除非走既有"打印订单"价格，受 `price.updated` 审计与现行 FREE_MODE 治理，不需要新增条目）。

测评可走的付费链路只有：
1. **打印测评结果 PDF**：进入现有 `/print/upload` → `/print/confirm` → `/print/progress`；与"职业规划建议单打印"完全同价、同计费、同审计。
2. **打印"附加到简历下方"合并 PDF**：同上，计费按合并后的页数；与既有"格式转换"合并 PDF 复用 `countPagesInRange` + `POST /orders/quote`。

### 7.2 测评**不**进"我的权益"

`docs/product/user-data-flow-matrix.md § 四 我的权益` 列出"优惠券 / 免费次数 / 套餐权益 / 补贴资格提示"，**不**包含"测评"。信息架构整改后，"我的权益"的明细归位 `权益活动 · 套餐页`，**不**归位到"测评"。

### 7.3 测评**不**进"通知中心"

- 不在 `MemberNotification` / `SystemBroadcast` 中发送；
- `BroadcastReadState` 与本提案无关；
- 不做 WebSocket / 短信推送；
- 用户主动行为（如"完成测评第二天再看一次"）由用户在 `/me/ai-records` 自助完成。

### 7.4 测评**不**进"数据权利"特殊通路

- 删除本人测评记录走既有 `deleteAiRecord`（与 `parse` / `optimize` / `job_fit` / `career_plan` 同源）；
- 一并走 `UserDataRequest.export / revoke_consent`（Wave 1-B 已合入 `origin/main`，测评记录进导出元数据白名单，但**不含个人答案原文细节**，与现有 `MemberDataExportMapper` 同源）。

---

## 8. 风险与边界确认（必须写在这里）

1. **不能伪造 LLM**：`LlmConfigService` 当前支持 `mock`/`local` 模式（见 `packages/shared/src/types/ai.ts`），必须确保测评维度计算**不依赖 LLM**，否则会出现"离线时出不了画像"的连锁故障。建议：**全部维度计算为纯函数 + 单元测试；用户点击"AI 写一句自我提示语"才允许调 LLM，且必须明示由 LLM 生成**。
2. **不能反向影响职业规划 / 岗位匹配**：测评答案**绝不写**到 `career_plan` 的 `basedOn.resume` 之外的参数中，`job_fit` 不接受测评结果作为输入。
3. **不能二次打包成"为企业服务"**：用户完成测评后**不能**看到任何"分享到来源平台 / 把我的画像告诉企业 / 把我的志愿偏向告诉合作机构"按钮，连隐藏路由都不能保留。
4. **不能默认开启"附加到简历下方"**：`/print/confirm` 上的"附加自我探索测评摘要"选项**默认未勾选**；必须由用户主动勾选。
5. **不能默认长期保存**：测评结果与现有 AI 服务记录共用 `RESULT_TTL_HOURS` 治理，**不单独延长**保存期；到期即按 `ai-result.cleanup.task.ts` 现有清理链路清理，列表不再返回。
6. **不能在盲文 / 视障模式下误用**：测评题面与维度强弱**不**贴性格 / 心理标签；朗读也只读"自我探索仅供本人参考" + 题面与用户答案原文，不解读结论。
7. **不能与现有 `MyAiRecordsPage` 的"未知 kind 兜底"重复**：必须在 `KIND_META` 显式声明。
8. **不能新增 LLM 凭证**：测评维度计算用规则；自我提示语**走 `LlmCareerPlanService` 已有的 `LlmConfigService`**，**不**新开 API key、**不**改后端环境变量。

---

## 9. 实施顺序与门禁（不改代码，只列出）

1. **撰写规格 + 计划**（前置）：`docs/superpowers/specs/2026-08-01-self-assessment-design.md`、`docs/superpowers/plans/2026-08-01-self-assessment.md`。
2. **数据库迁移**（不需要新表，仅确认 `AiResumeResult.kind` 仍是 `String` 而非枚举，且 `expiresAt` 索引已就绪）。
3. **本地实现**（按本文件 §6.3 / §6.2 / §6.1 顺序）：先服务后端 → 再 Kiosk 前台 → 再 Admin 列表加 1 行；**不在 Kiosk 多任务脏工作区直接写运行时**。
4. **门禁**：`pnpm --filter @ai-job-print/api verify:self-assessment`、`pnpm --filter @ai-job-print/kiosk verify:self-assessment-ui`、`pnpm --filter @ai-job-print/api build`、`git diff --check`、PostgreSQL schema 同步检查；CI `build-and-verify`、`postgres-readiness` 与 `kiosk-browser-smoke` 三项通过。
5. **法务 / 合规复查**：双模型（Antigravity / Claude）终审。
6. **真机验收前不动**：保留 P0 验收为前置门，不与"上线前 P0 真机验收"并发。
7. **同步正式进度**：`docs/progress/current-progress.md`（按既有"日期 - 状态"格式）；`docs/progress/next-tasks.md` 加 P1 / P2 候选；`docs/product/user-data-flow-matrix.md §3.1 AI 简历服务` 加一行测评；`docs/compliance/compliance-boundary.md § 8.8`（如需新章）追加测评合规条款。

---

## 10. 一句话决策表

| 决策 | 取值 |
|---|---|
| 是否新增首页磁贴 | ❌ 否 |
| 是否新增底部 Tab | ❌ 否（固定三项） |
| 是否新增「我的」分组 | ❌ 否（整改后明细归位业务页） |
| 是否新增独立路由 | ⚠ 是，仅 `apps/kiosk/src/pages/resume/self-assessment/*` 子页面（与 `JobFitPage` / `CareerPlanPage` 同域） |
| 是否进 AI 服务记录 | ✅ 是（`kind='self_assessment'`，仅元数据） |
| 是否可"附加到简历下方" | ⚠ 是，作为**可勾选打印选项**，默认未勾选 |
| 是否多套报告可选 | ✅ 是（简短摘要 / 完整画像 / 附加到简历） |
| 是否进"我的权益" | ❌ 否 |
| 是否进"通知中心" | ❌ 否 |
| 是否进"数据权利"特殊通路 | ❌ 否（走既有 `/me/data-requests` 元数据导出 + `deleteAiRecord` 硬删） |
| 管理员后台是否新页面 | ❌ 否（现有 `Admin /ai-services` 表格加 1 行） |
| 是否给维度打分 / 贴性格标签 | ❌ 否（仅"强弱"与"个人志愿偏向"） |
| 是否约束"非临床、非人格判定" | ✅ 是（首段免责 + 模型禁词 + UI 颜色仅强弱不评鉴） |
| 是否引入第三方 MBTI / 大五 API | ❌ 否（全部维度计算用纯函数） |
| 是否走 LLM | ⚠ 仅在用户点"AI 写一句自我提示语"时调，明示生成 |

---

## 11. 仍未解决 / 待后续 Phase

- **可访问性细节**：本题面在 27 寸竖屏 + 大字号模式下排版细节（行高、按钮区高度）须 P1 阶段再核对一次，与原型 `kiosk-proto-2026-07-fusion/8177/WAVE-P2-FLOWS.md` 对齐。
- **与"求职材料"的关系**：当前 `求职材料` 入口（`/resume/materials`）只支持"求职信 / 感谢信 / 作品集封面 / 材料清单"，**不**自动生成"含测评摘要的求职信"——这属于同义风险，必须显式禁止。
- **多语言**：当前 `LlmCareerPlanService` 与 `CareerPlanPdfService` 均未做多语；测评 PDF 与助手讲解均沿用 `zh-CN`，不破坏既有体验。
- **运营后台运营话术**：运营话术与按钮白名单由 `compliance-boundary.md § 三 按钮文案规范` 约束；测评页面 CTA 限于"开始作答 / 暂停 / 继续 / 查看结果 / 附加到简历下方 / 删除本次记录 / 重新作答"，**不使用**"立即测试" / "推荐你测一测" 等暗示性话术。

---

文档结束。本文件为只读探索结论与设计建议，**未改任何代码 / schema / 文档 / 进度记录**，未申请新分支或触发 CI / 部署。
