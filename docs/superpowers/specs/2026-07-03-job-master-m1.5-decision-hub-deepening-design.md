# 岗位大师 M1.5「决策台深化」设计文档

> 定稿日期：2026-07-03
> 分支：`feature/job-master`（PR #117，Draft，基线 `origin/main@0001fe28`）。分支 tip 随提交推进，本文不固定引用具体 tip 以免漂移；以基线 `0001fe28` 为稳定锚点。
> 上位设计：[2026-07-02-job-master-design.md](./2026-07-02-job-master-design.md)、[2026-07-02-job-master-m1-mvp.md](../plans/2026-07-02-job-master-m1-mvp.md)
> 约束依据：CLAUDE.md §2/§9/§16、[.ccg/spec/guides/index.md](../../../.ccg/spec/guides/index.md)、[feature-scope.md](../../product/feature-scope.md)、[user-data-flow-matrix.md](../../product/user-data-flow-matrix.md)、[compliance-boundary.md](../../compliance/compliance-boundary.md)
> 状态：设计待用户确认；**未实现**。确认后按本文「实施顺序」推进。

---

## 一、目标与原则

**一句话**：把岗位大师从「四段静态结果卡」升级为「一次会话产出的**厚决策报告** + **决策台观感** + **轻交互**」，**加深不加面**。

**核心原则（硬约束）**：

- **加深，不加面**：不新增首页磁贴 / 业务入口 / 路由；不新增数据模型；不新增平行 AI 记录类型（仍 `AiResumeResult(kind='job_master')`）。
- **不做 M2 的横向能力**：多岗对比、站内薪资统计、找企业 / 企业调研中枢——本轮**不做**，留 M2。
- **合规红线不破**（见 §五）：无平台内投递 / 候选人推荐 / 录用概率 / 通过率 / 任何百分比；适配度继续三档参考等级；报告页脚免责必须保留。
- **不伪造能力**：新 evidence 必须来自简历原文；没有依据就**留空或诚实提示**，不允许编造。手填岗位薪资继续显示「来源平台未提供」。
- **非破坏性扩展**：所有新字段为 `JobMasterPayload` **可选字段**，M1 旧结构（无新字段）仍合法，前端缺失时优雅降级。
- **文件预算受控**（§六）：`JobMasterPage.tsx` 会变大，按 `.ccg/spec/guides` 阈值**先拆结果子组件**再加内容。

---

## 二、要增强哪些结果字段（`JobMasterPayload` 扩展，全部可选、非破坏）

现有（M1，保持不变）：`fit{ level, summary, matchedSkills[{skill,evidence}], gapSkills[{skill,suggestion}] }` / `careerPath{ current, next, target }` / `risks[{level,title,reason,basis}]`。

新增可选字段（缺失即降级，旧 payload 仍合法）：

| 字段 | 结构 | 说明 / 合规 |
|---|---|---|
| `fit.gapSkills[].learningDirection?` | `string` | 差距的「学习/补强方向」。**只谈方向，不点名具体付费课程 / 机构 / 品牌**（避带货）。 |
| `fit.gapSkills[].firstStep?` | `string` | 补这条差距的「第一步行动」（可执行、非编造）。 |
| `fit.keywordCoverage?` | `{ matched: string[]; missing: string[] }` | 岗位要求关键词的**命中 / 缺失清单**。`matched` 每个词**必须在简历原文中出现**（服务端归一化子串校验，防编造）；`missing` 为岗位要求出现、简历未命中的词。**只展示命中状态，绝不算百分比 / 匹配率**。 |
| `interviewPrep?` | `Array<{ question, whyAsked, prepHint }>`（0–4 条） | 该岗位可能被追问的点：问题 + 为什么问（基于简历弱项 / 岗位要求）+ 准备提示。**只做练习准备，不承诺通过率**，导流已有「模拟面试」。 |
| `resumeRewrite?` | `Array<{ area, suggestion }>`（0–5 条） | 针对该岗位的简历**表达改写要点**（复用 job-fit 防编造与安全兜底）。导流已有「简历优化」。 |
| `careerPath.next.rationale?` / `careerPath.target.rationale?` | `string` | 强化路径「依据」（为什么这样走，基于现状延伸）。 |
| `careerPath.target.firstStep?` | `string` | 强化目标节点的「行动」。 |

> `matchedSkills` / `careerPath.current.evidence` 的防编造校验维持 M1 口径不放松。所有新字段一并进入现有全局防线（禁词 / 百分比 / 薪资承诺 / 学历自相矛盾重试）与建议级过滤（诱导编造 / 无依据示例数字 → 安全兜底）。

**LLM 调用 token 策略（设计上位文档 §十一 已预警）**：字段变厚后单次调用可能超 token / 超时。实现时先试**单次结构化调用**；若校验发现截断 / 失败率高，**拆为 2 次**（调用 A：fit + keywordCoverage + resumeRewrite；调用 B：careerPath + risks + interviewPrep），由编排层合并。此为实现期决策点，不改对外契约。

---

## 三、Kiosk 1080×1920 竖屏结果页怎么组织

竖屏纵向滚动，结果视图分区（自上而下）：

1. **决策摘要条**（顶部）：目标岗位标题 + 适配度徽章（三档参考等级，无百分比）+ 一句话关键结论 + 分区锚点（可跳转到下方各卡）。
2. **岗位适配度卡**：三档等级 + summary + **技能命中/缺口标签墙**（`matchedSkills` ✓ 绿标签 / `gapSkills` ✗ 橙标签）+ **关键词覆盖 chips**（`keywordCoverage.matched` 命中 / `missing` 缺失，纯状态标签，无比率）。
3. **差距行动卡**（`gapSkills`）：每条 = 差距 + 建议 + `learningDirection`（方向）+ `firstStep`（第一步），**可展开/收起**。
4. **面试预判卡**（`interviewPrep`）：每条 = 问题 + 为什么问 + 准备提示；底部 CTA「去练模拟面试」。
5. **简历改写卡**（`resumeRewrite`）：每条 = area + suggestion；底部 CTA「去优化简历」。
6. **晋升路径时间轴**（`careerPath`）：当前 → 1-3 年 → 3-5 年 竖屏时间轴，每节点含依据（`evidence`/`rationale`）+ 行动（`firstStep`）+ 待补技能。
7. **薪资参考卡**（M1 不变）：来源方文本，或手填 / 缺失显示「来源平台未提供」。
8. **风险与建议卡**（`risks`，M1 不变）：三档 + reason + basis。
9. **底部固定操作栏**：主按钮「**打印决策报告**」；次按钮「**换个岗位再分析**」（回选岗、保留简历上下文重算）；CTA 联动区：去优化简历 / 去练模拟面试 / 去职业规划 / 查看岗位 / 去来源平台投递。

> **合规按钮口径（硬约束）**：「查看岗位」与「去来源平台投递」是**两个独立动作/按钮**，不合并成组合文案。「查看岗位」跳站内岗位详情 `/jobs/:id`（仅 jobId 模式有来源岗位时出现）；「去来源平台投递」为标准白名单外部跳转文案。**若某处只保留一个外部跳转动作，文案必须用标准白名单「去来源平台投递」**，不得写成「查看岗位·去来源平台投递」这类易被合规扫描误判或语义混淆的组合。手填岗位无站内来源时，不出现「查看岗位」。

**交互**：分区展开/收起（控制信息密度）、结果内锚点跳转、一键换岗重算、打印。
**触控/可读**：主按钮 ≥56px、可点区域 ≥48px；标签墙 / chips 触控友好；长内容默认收起、可展开。
**降级**：任一新字段缺失（旧 payload / LLM 未产出）→ 对应卡片隐藏或退回 M1 呈现，不空卡、不报错。

---

## 四、PDF 报告同步哪些区块

`JobMasterPdfService` 在现有五区块基础上同步新内容（A4 优先，允许至多 2 页）：

- **适配度区**：追加**关键词覆盖**（命中 / 缺失清单）。
- **差距区**：每条差距追加 `learningDirection` + `firstStep`。
- **新增「面试准备」区**：`interviewPrep`（问题 + 为什么问 + 准备提示）。
- **新增「简历改写要点」区**：`resumeRewrite`。
- **晋升路径区**：追加 `rationale` / `target.firstStep`。
- **页脚免责固定不变**（数据来源 + 生成时间 + 「仅供求职参考，不构成录用或薪酬承诺」）。
- 所有新字段缺失时该子区**跳过**，不留空标题。

---

## 五、verify:job-master 要新增哪些断言（先红后绿）

在现有 15 项基础上扩展（stub LLM 受控，进双 CI）：

1. **新字段贯通**：mock 输出含 `learningDirection/firstStep/keywordCoverage/interviewPrep/resumeRewrite/rationale` → analyze 返回并落库、getLatest 回读一致。
2. **非破坏兼容**：喂**M1 旧形状**（无新字段）的 mock → 仍 `completed`、不报错、旧字段完好（backward-compat 断言）。
3. **关键词防编造**：`keywordCoverage.matched` 含简历原文没有的词 → 该词被丢弃 / 归入 missing；断言 matched 全部可在原文找到。
4. **无百分比**：整个输出（含新字段）扫描无 `\d%`、无「匹配率 / 录用概率 / 通过率」。
5. **面试预判合规**：`interviewPrep` 命中「通过率 / 保过 / 录用概率」→ 全局重试 / 诚实失败；正常输出无承诺词。
6. **简历改写安全**：`resumeRewrite` 命中诱导编造 / 无依据示例数字 → 建议级过滤 + 安全兜底（`completed` 不失败）。
7. **PDF 扩区**：渲染含面试准备 / 简历改写 / 关键词区仍 `%PDF`、页数 ≥1。
8. 既有 15 项（防编造、禁词、薪资承诺、越权、手填「来源平台未提供」、upsert 单行、文件清理诚实失败、日志脱敏等）全部保留通过。

---

## 六、文件预算与允许修改范围（§8 反堆砌）

**功能归位声明**

- 功能闭环：岗位大师 M1.5 决策台深化（深度报告 + 竖屏结果页可视化 + 轻交互 + PDF 同步）。
- 涉及层：
  - 共享类型：`packages/shared/src/types/ai.ts`（`JobMaster*` 可选字段扩展）。
  - 后端：`services/api`（LLM service + 编排透传 + PDF + verify），**不改 controller 端点、不改 Prisma、不改 member-assets**。
  - 前端：`apps/kiosk`（`JobMasterPage` 结果视图重构为子组件；service 适配器不变）。
  - 终端 / 共享 UI / worker：**不涉及**。
  - 文档：`docs/superpowers/specs`（本文）、完成后同步 `docs/progress/*`。
- 复用确认：复用现有 `job_master` 端点 / 记录类型 / 打印链路 / 防护栏，**不新增**入口、模型、FilePurpose、AI 记录类型。

**允许修改 / 新增**

- `packages/shared/src/types/ai.ts` —— 扩展 `JobMasterFit` / `JobMasterCareerPath` 可选字段 + 新增 `JobMasterKeywordCoverage` / `JobMasterInterviewPrepItem` / `JobMasterResumeRewriteItem`。
- `services/api/src/ai/resume/llm-job-master.service.ts` —— payload 扩展 + prompt + validate + 防护栏（可能拆 2 次调用）。
- `services/api/src/ai/resume/job-master.service.ts` —— 仅透传新字段（payload 已整体存取，改动最小）。
- `services/api/src/ai/resume/job-master-pdf.service.ts` —— 新区块渲染。
- `services/api/scripts/verify-job-master.ts` —— 新断言。
- `apps/kiosk/src/pages/jobs/JobMasterPage.tsx` —— 结果视图改为**编排 + 选岗**，结果各卡拆到子组件。
- **新增** `apps/kiosk/src/pages/jobs/jobMaster/`：`DecisionSummaryBar.tsx`、`FitSkillMap.tsx`、`GapActionCards.tsx`、`InterviewPrepCard.tsx`、`ResumeRewriteCard.tsx`、`CareerTimeline.tsx`、`RiskCard.tsx`（各文件单一职责、目标 <300 行）。
- 完成后：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`、`docs/product/user-data-flow-matrix.md`（M1.5 补登记）。

**禁止修改**

- `job-master.controller.ts` 端点契约（API 表面不变）、Prisma schema、`member-assets.*`（`job_master` kind 已在）、`file-validation` / FilePurpose、首页磁贴 / 路由、`job-fit` / `career-plan` / `fair-visit-plan` 语义、合规文案白名单。
- 任何 M2 能力（多岗对比 / 薪资统计 / 找企业）。
- 其他分支 / worktree（尤其 `codex/terminal-device-profile-closure` 脏改动）。

**文件预算提示**：`JobMasterPage.tsx` 现约 400 行，加结果内容会破 500 阈值 → **本轮先拆子组件**（上表 `jobMaster/`），`JobMasterPage.tsx` 只留选岗 + 结果编排；每个子组件保持 <300 行。

---

## 七、合规红线与明确不做（重申）

**红线（必须守）**：无百分比 / 录用概率 / 通过率 / 「精准命中」；适配度仅三档参考等级；关键词只做命中/缺失状态、不算率；面试预判不承诺通过；学习方向不带货（不点名机构/课程）；简历改写不诱导编造；新 evidence 出自简历原文，无依据留空；手填薪资「来源平台未提供」；报告页脚免责保留；CTA 仅跳已有能力（去优化简历 / 去练模拟面试 / 去职业规划 / 查看岗位 / 去来源平台投递）。**「查看岗位」与「去来源平台投递」为两个独立按钮，不合并；仅一个外部跳转动作时用标准白名单「去来源平台投递」，不写组合文案**（详见 §三-9）。

**明确不做（本轮）**：新增首页磁贴 / 业务入口 / 路由；新增数据模型 / AI 记录类型 / FilePurpose；多岗对比；站内薪资统计区间；找企业 / 企业调研中枢；平台内投递 / 收简历 / 候选人推荐 / 面试邀约 / Offer；改 controller 端点契约；碰其他分支。

---

## 八、实施顺序（确认设计后执行，先红后绿）

1. **先扩共享类型 + `verify:job-master` 门禁**（先让新断言红）。
2. **再改 LLM schema / prompt / 编排层**（含防护栏；必要时拆 2 次调用）→ verify 转绿。
3. **再改 PDF**（新区块）。
4. **最后改 Kiosk 竖屏 UI**（拆子组件 + 新卡 + 轻交互）。
5. **全量验证**：shared/api/kiosk typecheck、kiosk 生产构建、`verify:job-master`、改动文件 lint、真实 DeepSeek API 层验证、PDF 下载校验、getLatest 回读、会员 `/me/ai-records` 与 `/me/documents` 回看、1080×1920 竖屏截图。
6. **双模型审查**（Claude + Antigravity/Gemini）；Critical 修完后再考虑 PR 从 Draft 转 Ready。

**当前不合并 PR、不转 Ready、不删除 backup ref。**

---

## 九、开放问题（实现期定稿）

- 单次 vs 2 次 LLM 调用：先单次，token/截断实测后再定是否拆。
- `keywordCoverage` 关键词抽取：由 LLM 产出 + 服务端 matched 防编造校验;是否再叠加确定性子串兜底，实现期看效果。
- 结果页子组件是否需要 `jobMaster/types.ts` 收敛本地视图类型，视拆分后体积决定。
