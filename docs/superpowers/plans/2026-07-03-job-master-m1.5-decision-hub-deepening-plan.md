# 岗位大师 M1.5「决策台深化」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 在不新增入口/数据模型/AI记录类型的前提下，把岗位大师结果做厚（差距学习方向+第一步、关键词命中/缺失、面试预判、简历改写、路径依据/行动）+ 竖屏结果页拆子组件并可视化 + PDF 同步 + verify 扩断言。

**Architecture:** 全部为 `JobMasterPayload` 可选字段扩展（非破坏，M1 旧结构仍合法）。先扩共享类型与 `verify:job-master` 断言（先红）→ 实现 `LlmJobMasterService`（prompt/validate/防护栏）与编排透传（转绿）→ PDF 扩区 → Kiosk `JobMasterPage` 结果视图拆 `jobMaster/` 子组件并加轻交互 → 全量验证 → 双模型审查。

**Tech Stack:** TypeScript / NestJS（services/api）/ React+Vite+Tailwind（apps/kiosk）/ pdfkit / 受控 stub-LLM verify 脚本（node -r @swc-node/register）。

**设计依据:** [2026-07-03-job-master-m1.5-decision-hub-deepening-design.md](../specs/2026-07-03-job-master-m1.5-decision-hub-deepening-design.md)（commit `e35b56ec`）。

**全程纪律:** feature/job-master worktree（`.worktrees/job-master`）；每步 typecheck 绿 + 独立 commit；禁 `git add .`；不改 controller 端点契约 / Prisma / member-assets / FilePurpose / 首页磁贴 / 其他分支；**PR 保持 Draft，不合并、不转 Ready、不删 backup ref**（`backup/job-master-prerebase`、`backup/job-master-rebase1`）。

> **命令 cwd 铁律（必须遵守）:** 当前**根工作树不是 feature/job-master**（是 `codex/terminal-device-profile-closure`，且有脏改动）。**所有命令都从仓库根执行并带 `.worktrees/job-master` 前缀**，绝不在根工作树直接跑 `pnpm --filter ...`（那会命中错误分支）。统一写法：
> - `cd .worktrees/job-master && pnpm --filter @ai-job-print/shared typecheck`
> - `cd .worktrees/job-master && pnpm --filter @ai-job-print/kiosk typecheck`
> - `cd .worktrees/job-master/services/api && pnpm typecheck`
> - `cd .worktrees/job-master/apps/kiosk && ...`
> 每个 `cd` 都从仓库根起（Bash cwd 每次调用会重置，不能依赖上一条 `cd` 残留）。

> **红测保护（Task 2 → Task 4）:** Task 2 会提交一个**预期 verify 红**的测试 commit（TDD 保留）。硬约束：**Task 2 到阶段 2 转绿之前不允许 `git push`**；不允许让 PR head / 分支 tip 停在红测 commit；**阶段 2（Task 3+4）完成后 `verify:job-master` 必须 20/20 全绿，才继续阶段 3（PDF）/阶段 4（UI）**。若中途要中断，需先补一个使 verify 绿的 commit 再停。

---

## 字段落位（全计划锚定，避免命名漂移）

在 `fit` 内新增：`keywordCoverage?: { matched: string[]; missing: string[] }`；`gapSkills[]` 每项加 `learningDirection?: string`、`firstStep?: string`。
在 `careerPath` 内新增：`next.rationale?: string`、`target.rationale?: string`、`target.firstStep?: string`。
在 payload/response **顶层**新增：`interviewPrep?: Array<{ question: string; whyAsked: string; prepHint: string }>`；`resumeRewrite?: Array<{ area: string; suggestion: string }>`。

命名固定：`learningDirection` / `firstStep` / `keywordCoverage` / `matched` / `missing` / `interviewPrep` / `question` / `whyAsked` / `prepHint` / `resumeRewrite` / `area` / `suggestion` / `rationale`。后续任务一律沿用。

---

## 文件结构（先锁定分工）

- 改：`packages/shared/src/types/ai.ts`（`JobMaster*` 可选扩展 + 新增子接口）
- 改：`services/api/src/ai/resume/llm-job-master.service.ts`（payload/prompt/validate/防护栏）
- 改：`services/api/src/ai/resume/job-master.service.ts`（仅 `toResponse` 透传新顶层字段 + `StoredJobMaster` 类型跟随）
- 改：`services/api/src/ai/resume/job-master-pdf.service.ts`（PDF 新区块）
- 改：`services/api/scripts/verify-job-master.ts`（新断言）
- 改：`apps/kiosk/src/pages/jobs/JobMasterPage.tsx`（结果视图改编排 + 选岗保留）
- 新增：`apps/kiosk/src/pages/jobs/jobMaster/`：`resultTypes.ts`、`DecisionSummaryBar.tsx`、`FitSkillMap.tsx`、`GapActionCards.tsx`、`InterviewPrepCard.tsx`、`ResumeRewriteCard.tsx`、`CareerTimeline.tsx`、`RiskCard.tsx`（各 <300 行）
- 完成后同步：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`、`docs/product/user-data-flow-matrix.md`

---

# 阶段 1 · 共享类型 + verify 先红

### Task 1: 扩展共享类型（非破坏可选字段）

**Files:** Modify `packages/shared/src/types/ai.ts`

- [ ] **Step 1: 在 `ai.ts` 的 JobMaster 段扩展类型**

在 `JobMasterFit` 内加可选字段并新增子接口；`JobMasterCareerPath` 节点加可选字段；`JobMasterResponse` 顶层加两字段：

```ts
/** 关键词覆盖：只展示命中/缺失状态，绝不算百分比/匹配率。matched 必须出自简历原文。 */
export interface JobMasterKeywordCoverage {
  matched: string[]
  missing: string[]
}

export interface JobMasterInterviewPrepItem {
  question: string
  whyAsked: string
  prepHint: string
}

export interface JobMasterResumeRewriteItem {
  area: string
  suggestion: string
}

export interface JobMasterFit {
  level: JobMasterFitLevel
  summary: string
  matchedSkills: Array<{ skill: string; evidence: string }>
  /** M1.5：可选 learningDirection（方向，不带货）+ firstStep（第一步行动）。 */
  gapSkills: Array<{ skill: string; suggestion: string; learningDirection?: string; firstStep?: string }>
  /** M1.5：关键词命中/缺失（可选）。 */
  keywordCoverage?: JobMasterKeywordCoverage
}

export interface JobMasterCareerPath {
  current: { title: string; evidence: string }
  next: { title: string; skillsToBuild: string[]; firstStep: string; rationale?: string }
  target: { title: string; skillsToBuild: string[]; rationale?: string; firstStep?: string }
}
```

并在 `JobMasterResponse` 增加两个可选顶层字段（保持其余不变）：

```ts
export interface JobMasterResponse {
  taskId: string
  status: 'completed' | 'failed'
  failReason?: string
  job?: JobMasterJobInfo
  salary?: JobMasterSalaryRef
  fit?: JobMasterFit
  careerPath?: JobMasterCareerPath
  risks?: JobMasterRiskItem[]
  /** M1.5：面试追问预判（可选）。 */
  interviewPrep?: JobMasterInterviewPrepItem[]
  /** M1.5：针对该岗位的简历改写要点（可选）。 */
  resumeRewrite?: JobMasterResumeRewriteItem[]
  providerName?: string
}
```

- [ ] **Step 2: shared typecheck**

Run: `cd .worktrees/job-master && pnpm --filter @ai-job-print/shared typecheck`
Expected: PASS（新增均为可选字段，纯附加，无破坏）。

- [ ] **Step 3: Commit**

```bash
git -C .worktrees/job-master add packages/shared/src/types/ai.ts
git -C .worktrees/job-master commit -m "feat(shared): 岗位大师 M1.5 结果字段可选扩展(SSOT)"
```

---

### Task 2: verify:job-master 加新断言（先红）

**Files:** Modify `services/api/scripts/verify-job-master.ts`

- [ ] **Step 1: 扩展 stub 的 VALID mock，加入新字段**

在 `VALID` 常量的 `fit` 中加 `keywordCoverage` 与 `gapSkills` 的 `learningDirection/firstStep`；顶层加 `interviewPrep`、`resumeRewrite`；`careerPath.next/target` 加 `rationale`/`firstStep`。关键词 `matched` 必须是简历原文里出现的词（`RESUME_TEXT` 含「React」「TypeScript」「Vite」等），`missing` 用简历没有的岗位词：

```ts
// VALID.fit.gapSkills[0] 增补
{ skill: '跨部门协调', suggestion: '补充一段协调多方资源的经历表述', learningDirection: '了解需求评审与排期协作流程', firstStep: '在简历里补一条跨团队协作的量化描述' }
// VALID.fit 增补
keywordCoverage: { matched: ['React', 'TypeScript'], missing: ['单元测试', 'CI/CD'] }
// VALID 顶层增补
interviewPrep: [{ question: '讲一个你主导的性能优化', whyAsked: '岗位强调性能优化经验', prepHint: '准备指标与前后对比' }],
resumeRewrite: [{ area: '项目描述', suggestion: '用"负责/主导/实现"开头并量化结果' }],
```

- [ ] **Step 2: 新增断言块（在既有 14/15 项后追加）**

```ts
// 16. 新字段贯通 + 非破坏兼容
responseQueue.push(v())
const r16 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
if (!r16.fit?.keywordCoverage || !Array.isArray(r16.interviewPrep) || !Array.isArray(r16.resumeRewrite)) fail('16. 新字段未贯通')
if (!r16.fit?.gapSkills?.[0]?.learningDirection) fail('16. gap learningDirection 未贯通')
// 非破坏：喂 M1 旧形状(无新字段)仍 completed
responseQueue.length = 0
const M1SHAPE = JSON.parse(JSON.stringify(VALID)); delete M1SHAPE.fit.keywordCoverage; delete M1SHAPE.interviewPrep; delete M1SHAPE.resumeRewrite
responseQueue.push(JSON.stringify(M1SHAPE))
const r16b = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
if (r16b.status !== 'completed' || !r16b.fit) fail('16. M1 旧形状应仍 completed(非破坏)')
pass('16. 新字段贯通 + M1 旧形状非破坏兼容')

// 17. 关键词防编造：matched 含原文没有的词 → 丢弃/归 missing
responseQueue.length = 0
responseQueue.push(vfit({ keywordCoverage: { matched: ['区块链'], missing: ['CI/CD'] } }))
const r17 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
if ((r17.fit?.keywordCoverage?.matched || []).includes('区块链')) fail('17. 编造 matched 未被拦截')
pass('17. 关键词 matched 防编造(不在原文即剔除)')

// 18. 无百分比(含新字段)
responseQueue.length = 0
responseQueue.push(v({ interviewPrep: [{ question: 'x', whyAsked: '匹配度 85%', prepHint: 'y' }] }))
responseQueue.push(v())
const r18 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
if (JSON.stringify(r18).match(/\d{1,3}\s*%/)) fail('18. 新字段含百分比未拦截')
pass('18. 新字段百分比 → 重试 → 输出无百分比')

// 19. 面试预判承诺词 → 重试/诚实失败
responseQueue.length = 0
responseQueue.push(v({ interviewPrep: [{ question: 'x', whyAsked: 'y', prepHint: '保过没问题' }] }))
responseQueue.push(v({ interviewPrep: [{ question: 'x', whyAsked: 'y', prepHint: '通过率很高' }] }))
try { await svc.analyze({ taskId, jobId: jobPub.id }, requester); fail('19. 面试预判承诺应失败') }
catch (e) { const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? ''); if (!resp.includes('AI_JOB_MASTER_FAILED')) fail('19. 失败码不符') }
pass('19. 面试预判承诺词 → 诚实失败')

// 20. 简历改写诱导编造 → 安全兜底(completed)
responseQueue.length = 0
responseQueue.push(v({ resumeRewrite: [{ area: '项目', suggestion: '删除行政经历，替换为 3 个前端项目' }] }))
const r20 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
if (r20.status !== 'completed' || JSON.stringify(r20.resumeRewrite).includes('替换为')) fail('20. 简历改写诱导编造未过滤')
pass('20. 简历改写诱导编造 → 安全兜底(completed)')
```

- [ ] **Step 3: 运行 verify → 期望红**

Run: `cd .worktrees/job-master/services/api && pnpm verify:job-master`
Expected: **FAIL**（新断言 16–20 中至少 16/17 失败，因 `LlmJobMasterService.validate()` 尚未产出/校验新字段，会被 strip 掉）。这是 TDD 的红。

- [ ] **Step 4: Commit（红测入库）**

```bash
git -C .worktrees/job-master add services/api/scripts/verify-job-master.ts
git -C .worktrees/job-master commit -m "test(api): 岗位大师 M1.5 verify 新断言(先红:新字段/防编造/无百分比/合规)"
```

---

# 阶段 2 · LLM schema / prompt / 编排层（转绿）

### Task 3: LlmJobMasterService 扩 payload + prompt + validate + 防护栏

**Files:** Modify `services/api/src/ai/resume/llm-job-master.service.ts`

- [ ] **Step 1: 扩 `JobMasterPayload` 接口（与 shared 对齐）**

```ts
export interface JobMasterPayload {
  fit: {
    level: (typeof FIT_LEVELS)[number]
    summary: string
    matchedSkills: Array<{ skill: string; evidence: string }>
    gapSkills: Array<{ skill: string; suggestion: string; learningDirection?: string; firstStep?: string }>
    keywordCoverage?: { matched: string[]; missing: string[] }
  }
  careerPath: {
    current: { title: string; evidence: string }
    next: { title: string; skillsToBuild: string[]; firstStep: string; rationale?: string }
    target: { title: string; skillsToBuild: string[]; rationale?: string; firstStep?: string }
  }
  risks: Array<{ level: (typeof RISK_LEVELS)[number]; title: string; reason: string; basis: string }>
  interviewPrep?: Array<{ question: string; whyAsked: string; prepHint: string }>
  resumeRewrite?: Array<{ area: string; suggestion: string }>
}
```

- [ ] **Step 2: prompt 增补新字段的产出要求 + 合规约束**

在 `sys` JSON 契约里追加（要点，措辞跟随现有风格）：`fit.gapSkills` 每条加 `learningDirection`（只谈方向，不点名机构/课程）+ `firstStep`；`fit.keywordCoverage`（matched=岗位要求且简历原文出现的关键词，missing=岗位要求出现但简历没有的；**不给任何百分比**）；顶层 `interviewPrep`（0-4，问题+为什么问+准备提示，**不承诺通过**）；`resumeRewrite`（0-5，area+suggestion，不诱导编造）；`careerPath.next.rationale`/`target.rationale`/`target.firstStep`。

- [ ] **Step 3: validate 扩展（防编造 + 安全过滤）**

在 `validate()` 内新增（沿用既有 `cleanStr`/`cleanStrArray`/`evidenceInResume`/`isRiskyAdvice`）：
```ts
// gapSkills 每项补 learningDirection/firstStep（可选，安全过滤）
.map((g) => ({ skill: cleanStr(g['skill'],200), suggestion: cleanStr(g['suggestion'],300),
  learningDirection: g['learningDirection'] ? cleanStr(g['learningDirection'],200) : undefined,
  firstStep: g['firstStep'] ? cleanStr(g['firstStep'],200) : undefined }))
// keywordCoverage：matched 必须在简历原文；missing 保留
const kcRaw = (fitRaw['keywordCoverage'] ?? {}) as Record<string, unknown>
const matched = cleanStrArray(kcRaw['matched'],40,12).filter((w)=>evidenceInResume(w))
const missing = cleanStrArray(kcRaw['missing'],40,12).filter((w)=>!matched.includes(w))
const keywordCoverage = (matched.length||missing.length) ? { matched, missing } : undefined
// interviewPrep（可选）
const interviewPrep = (Array.isArray(obj['interviewPrep'])?obj['interviewPrep']:[])
  .map((x)=> (x&&typeof x==='object')?x as Record<string,unknown>:{})
  .map((x)=>({ question: cleanStr(x['question'],200), whyAsked: cleanStr(x['whyAsked'],200), prepHint: cleanStr(x['prepHint'],300) }))
  .filter((x)=>x.question&&x.prepHint).slice(0,4)
// resumeRewrite（可选，诱导编造 → 安全兜底）
const resumeRewrite = (Array.isArray(obj['resumeRewrite'])?obj['resumeRewrite']:[])
  .map((x)=> (x&&typeof x==='object')?x as Record<string,unknown>:{})
  .map((x)=>({ area: cleanStr(x['area'],60), suggestion: (isRiskyAdvice(cleanStr(x['suggestion'],300))?SAFE_FALLBACK:cleanStr(x['suggestion'],300)) }))
  .filter((x)=>x.area&&x.suggestion).slice(0,5)
```
`careerPath` 校验里 next/target 追加可选 `rationale`（cleanStr）与 `target.firstStep`（cleanStr）。返回对象加 `interviewPrep`/`resumeRewrite`（空则 undefined）+ fit 加 `keywordCoverage`。

`sanitizeAdvice()` 追加对 `resumeRewrite[].suggestion` 与 `gapSkills[].learningDirection/firstStep` 的 `isRiskyAdvice → SAFE_FALLBACK`。全局 `findViolation(JSON.stringify(sanitized))` 天然覆盖新字段的禁词/百分比/薪资承诺（含 interviewPrep 的「保过/通过率」）。

- [ ] **Step 4: api typecheck**

Run: `cd .worktrees/job-master/services/api && pnpm typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/job-master add services/api/src/ai/resume/llm-job-master.service.ts
git -C .worktrees/job-master commit -m "feat(api): LlmJobMasterService 产出并校验 M1.5 新字段(防编造/合规)"
```

---

### Task 4: 编排层透传新顶层字段

**Files:** Modify `services/api/src/ai/resume/job-master.service.ts`

- [ ] **Step 1: `toResponse` 增补 interviewPrep/resumeRewrite**

`StoredJobMaster.payload` 为 `JobMasterPayload`（已含新字段，无需改 store）。仅在 `toResponse` 返回对象追加：
```ts
interviewPrep: stored.payload.interviewPrep,
resumeRewrite: stored.payload.resumeRewrite,
```
（`fit`/`careerPath` 已整体透传，其内新字段自动带出。）

- [ ] **Step 2: api typecheck + verify → 期望绿**

Run: `cd .worktrees/job-master/services/api && pnpm typecheck && pnpm verify:job-master`
Expected: typecheck PASS；verify **ALL PASS**（原 15 + 新 16–20 = 20 项）。若仍红，回 Task 3 修 validate。

- [ ] **Step 3: Commit**

```bash
git -C .worktrees/job-master add services/api/src/ai/resume/job-master.service.ts
git -C .worktrees/job-master commit -m "feat(api): 岗位大师编排层透传 M1.5 新顶层字段 + verify 20/20 绿"
```

---

# 阶段 3 · PDF 区块

### Task 5: JobMasterPdfService 扩区

**Files:** Modify `services/api/src/ai/resume/job-master-pdf.service.ts`

- [ ] **Step 1: 差距区追加 learningDirection/firstStep**

在现有 `payload.fit.gapSkills.forEach` 内，`g.learningDirection` / `g.firstStep` 存在时各加一行灰字（`方向：` / `第一步：`）。

- [ ] **Step 2: 适配度区追加关键词覆盖**

`payload.fit.keywordCoverage` 存在时，在适配度区后加两行：`命中关键词：{matched.join('、')}`、`待补关键词：{missing.join('、')}`（缺失数组为空则省略该行）。

- [ ] **Step 3: 新增「面试准备」「简历改写要点」区（数据存在才渲染）**

```ts
if (payload.interviewPrep?.length) {
  title('六、面试准备参考')
  payload.interviewPrep.forEach((it) => {
    doc.fontSize(10.5).fillColor('#111827').text(`· ${it.question}`, { lineGap: 1 })
    doc.fontSize(9).fillColor('#6b7280').text(`   为什么问：${it.whyAsked}`, { lineGap: 1 })
    doc.fontSize(9).fillColor('#6b7280').text(`   准备：${it.prepHint}`, { lineGap: 3 })
  })
}
if (payload.resumeRewrite?.length) {
  title('七、简历改写要点')
  payload.resumeRewrite.forEach((it) =>
    doc.fontSize(10).fillColor('#374151').text(`· ${it.area}：${it.suggestion}`, { lineGap: 3 }))
}
```
`JobMasterReportData.payload` 已是 `JobMasterPayload`（含新字段），render 入参不变。页脚免责保持不变。

- [ ] **Step 4: api typecheck + verify(PDF 断言)**

Run: `cd .worktrees/job-master/services/api && pnpm typecheck && pnpm verify:job-master`
Expected: PASS；verify 中 PDF 项仍 `%PDF`、页数 ≥1（内容变多可能 2 页，允许）。

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/job-master add services/api/src/ai/resume/job-master-pdf.service.ts
git -C .worktrees/job-master commit -m "feat(api): 决策报告 PDF 同步 M1.5 新区块(关键词/面试准备/简历改写/学习方向)"
```

---

# 阶段 4 · Kiosk 子组件拆分 + 竖屏 UI

> 说明：Kiosk 无 job-master 专属 verify；各任务"测试"= `cd .worktrees/job-master && pnpm --filter @ai-job-print/kiosk typecheck` + 改动文件 `eslint`（从仓库根带前缀）；阶段 5 再做生产构建与浏览器走查。

### Task 6: 结果卡视图类型 + 子组件目录

**Files:** Create `apps/kiosk/src/pages/jobs/jobMaster/resultTypes.ts`

- [ ] **Step 1: 收敛结果视图 props 类型（复用 shared）**

```ts
import type { JobMasterResponse } from '@ai-job-print/shared'
export type JobMasterResult = Extract<JobMasterResponse, { status: 'completed' }> | JobMasterResponse
export interface ResultCardProps { result: JobMasterResponse }
```
（子组件统一从 shared 取字段类型，不本地重定义业务类型。）

- [ ] **Step 2: kiosk typecheck** — Run: `cd .worktrees/job-master && pnpm --filter @ai-job-print/kiosk typecheck` → PASS
- [ ] **Step 3: Commit** — `git -C .worktrees/job-master commit -m "chore(kiosk): 岗位大师结果卡视图类型收敛"`

### Task 7: 结果子组件（7 个，各单一职责 <300 行）

**Files:** Create 下列文件，每个导出一个函数组件，入参来自 `JobMasterResponse` 对应字段：
- `DecisionSummaryBar.tsx`：入 `job`+`fit.level`+`fit.summary`；渲染 岗位标题 + 三档适配度徽章（复用现有 `FIT_META` 文案，无百分比）+ 一句话结论 + 锚点按钮。
- `FitSkillMap.tsx`：入 `fit`；渲染 已具备✓ 绿标签墙 + 建议补足✗ 橙标签墙 + `keywordCoverage`（命中/缺失 chips，纯状态无比率）。
- `GapActionCards.tsx`：入 `fit.gapSkills`；每条 = 差距 + 建议 +（有则）方向 + 第一步；**展开/收起**。
- `InterviewPrepCard.tsx`：入 `interviewPrep`；每条 = 问题 + 为什么问 + 准备；底部按钮「去练模拟面试」（`navigate('/interview/setup')`）。
- `ResumeRewriteCard.tsx`：入 `resumeRewrite`；每条 = area + suggestion；底部按钮「去优化简历」（`navigate('/resume/optimize',{state:{taskId,accessToken}})`）。
- `CareerTimeline.tsx`：入 `careerPath`；竖屏时间轴 当前→1-3年→3-5年，含依据/待补技能/第一步。
- `RiskCard.tsx`：入 `risks`；沿用 M1 风险卡（三档徽章 + reason + basis）。

- [ ] **Step 1..7:** 逐个创建组件（任一字段缺失即隐藏该卡/该行，不空卡不报错）。每建 1–2 个跑一次 `cd .worktrees/job-master && pnpm --filter @ai-job-print/kiosk typecheck`，Expected PASS。
- [ ] **Step 8: Commit** — `git -C .worktrees/job-master commit -m "feat(kiosk): 岗位大师结果子组件(摘要条/技能地图/差距/面试/改写/路径/风险)"`

### Task 8: JobMasterPage 结果视图重构 + 轻交互 + 合规按钮拆分

**Files:** Modify `apps/kiosk/src/pages/jobs/JobMasterPage.tsx`

- [ ] **Step 1: 结果视图改为编排子组件**

把原结果 JSX 替换为按 §三 顺序渲染：`<DecisionSummaryBar/> <FitSkillMap/> <GapActionCards/> <InterviewPrepCard/> <ResumeRewriteCard/> <CareerTimeline/>` + 薪资卡(保留) + `<RiskCard/>` + 底部操作栏。选岗视图与状态保持不变。JobMasterPage 目标降到 <300 行。

- [ ] **Step 2: 底部操作栏合规按钮拆分（硬约束）**

主按钮「打印决策报告」；「换个岗位再分析」（`setResult(null)`，保留 taskId/accessToken）；CTA 联动区**四个独立按钮**：`去优化简历` / `去练模拟面试` / `去职业规划`。外部跳转按钮**拆为两个独立动作**：
- 仅当 `result.job?.sourceUrl && selectedJob?.id` 时，出现两个按钮：`查看岗位`（`navigate('/jobs/${selectedJob.id}')`）**与** `去来源平台投递`（标准白名单文案，跳岗位详情来源区）。
- **手填岗位（无站内来源）**：不出现「查看岗位」；如需外部动作，**只用标准白名单「去来源平台投递」文案**。
- **禁止**「查看岗位·去来源平台投递」这类组合文案（易被合规扫描误判 / 语义混淆）。

- [ ] **Step 3: 轻交互** — 分区展开/收起（子组件内部状态）、结果内锚点（`id` + 摘要条按钮 scrollIntoView）、换岗重算已在 Step 2。

- [ ] **Step 4: kiosk typecheck + 改动文件 lint + 合规文案扫描**

Run:
```
cd .worktrees/job-master && pnpm --filter @ai-job-print/kiosk typecheck
cd .worktrees/job-master/apps/kiosk && npx eslint src/pages/jobs/JobMasterPage.tsx src/pages/jobs/jobMaster/*.tsx
# 白名单感知扫描：允许标准文案「去来源平台投递」，拦非来源语境「平台投递」及其它越界词
cd .worktrees/job-master/apps/kiosk && rg -n -P "(?<!来源)平台投递|一键投递|立即投递|查看岗位·|录用概率|通过率|\d{1,3}\s*%" src/pages/jobs/jobMaster src/pages/jobs/JobMasterPage.tsx || echo "OK 无越界/组合文案"
```
Expected: typecheck PASS；eslint 0 error；扫描输出 `OK 无越界/组合文案`（`去来源平台投递` 因 `(?<!来源)` 被放行，非来源语境的 `平台投递` 仍被拦）。

> 若环境无 `rg -P`（PCRE2），用 node 兜底（先剔除白名单再扫）：
> ```
> cd .worktrees/job-master/apps/kiosk && node -e "const fs=require('fs'),cp=require('child_process');const files=cp.execSync('ls src/pages/jobs/jobMaster/*.tsx src/pages/jobs/JobMasterPage.tsx').toString().split('\n').filter(Boolean);const banned=[/一键投递/,/立即投递/,/查看岗位·/,/录用概率/,/通过率/,/\d{1,3}\s*%/,/平台投递/];let hit=0;for(const f of files){const t=fs.readFileSync(f,'utf8').split('\n');t.forEach((ln,i)=>{const s=ln.replace(/去来源平台投递/g,'');if(banned.some(r=>r.test(s))){console.log(f+':'+(i+1)+': '+ln.trim());hit++}})}process.exit(hit?1:(console.log('OK 无越界/组合文案'),0))"
> ```

- [ ] **Step 5: Commit** — `git -C .worktrees/job-master commit -m "feat(kiosk): 岗位大师结果页决策台重构 + 轻交互 + 合规按钮拆分"`

---

# 阶段 5 · 全量验证

### Task 9: 全量验证 + 证据

**Files:** 无源码改动（除非修回归 bug）

- [ ] **Step 1: 三端 typecheck + 生产构建**

Run（逐条，均从仓库根起）:
```
cd .worktrees/job-master && pnpm --filter @ai-job-print/shared typecheck
cd .worktrees/job-master/services/api && pnpm typecheck
cd .worktrees/job-master && pnpm --filter @ai-job-print/kiosk typecheck
cd .worktrees/job-master/apps/kiosk && VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_ALLOW_TEXT_ONLY_ASSISTANT=true pnpm build
```
Expected: 全 PASS；kiosk `✓ built`。

- [ ] **Step 2: verify + lint**

Run:
```
cd .worktrees/job-master/services/api && pnpm verify:job-master
npx eslint src/ai/resume/llm-job-master.service.ts src/ai/resume/job-master.service.ts src/ai/resume/job-master-pdf.service.ts
```
Expected: `ALL PASS (20 checks)`；eslint 0 error。

- [ ] **Step 3: 真实 DeepSeek API 层验证（手填 + 会员双路径）**

复用既有 runbook（`services/api/.env` 的 `AI_LLM_API_KEY`，不 log/commit）：起本地 API → 上传文字层 PDF → parse → `POST /resume/job-master`（手填）→ 断言 `providerName:"llm"` 且响应含 `keywordCoverage/interviewPrep/resumeRewrite/gapSkills[].learningDirection`，无 `\d%` → `POST .../print` 下载 `%PDF` → `GET .../:taskId` getLatest 回读 → 会员 Bearer 下 `/me/ai-records`(job_master) + `/me/documents`(报告) 回看。证据落仓库外并脱敏。
Expected: 双路径 `provider=llm`、新字段齐、无百分比、PDF 有新区块、/me 可回看。

- [ ] **Step 4: 1080×1920 竖屏截图**（M1 环境摩擦已知：优先用 claude-in-chrome 扩展；否则 computer-use 截图）
Expected: 决策摘要条 / 技能地图 / 差距行动卡 / 面试预判卡 / 简历改写卡 / 路径时间轴 至少各 1 张证据。

- [ ] **Step 5: 同步进度文档 + Commit**

改 `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`、`docs/product/user-data-flow-matrix.md`（登记 M1.5 深化，不新增入口）。
`git -C .worktrees/job-master commit -m "docs: 同步岗位大师 M1.5 决策台深化验收结论"`

---

# 阶段 6 · 双模型审查

### Task 10: 双模型审查 + 定夺是否转 Ready

- [ ] **Step 1: 运行双模型审查**（Claude + Antigravity/Gemini，对本轮 diff）。
- [ ] **Step 2: 处理结论** — Critical/High 必修并回归相关 verify/typecheck/build；Warning/Info 记录或酌情修。
- [ ] **Step 3: 复跑阶段 5 全量验证**，确认修复未引回归。
- [ ] **Step 4: 汇报用户** — 附验收清单与审查结论。**是否 PR 从 Draft 转 Ready 由用户定；本计划内不自动转、不合并、不删 backup ref。**

---

## 验证命令速查

> 所有命令从**仓库根**执行，均带 `.worktrees/job-master` 前缀（见顶部「命令 cwd 铁律」）。

| 用途 | 命令 |
|---|---|
| shared typecheck | `cd .worktrees/job-master && pnpm --filter @ai-job-print/shared typecheck` |
| api typecheck | `cd .worktrees/job-master/services/api && pnpm typecheck` |
| kiosk typecheck | `cd .worktrees/job-master && pnpm --filter @ai-job-print/kiosk typecheck` |
| kiosk 生产构建 | `cd .worktrees/job-master/apps/kiosk && VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_ALLOW_TEXT_ONLY_ASSISTANT=true pnpm build` |
| verify | `cd .worktrees/job-master/services/api && pnpm verify:job-master` → `ALL PASS (20 checks)` |
| lint | `cd .worktrees/job-master/apps/kiosk && npx eslint <改动文件>`（api 同理 `cd .worktrees/job-master/services/api`） |
| 合规文案扫描（白名单感知） | `cd .worktrees/job-master/apps/kiosk && rg -n -P "(?<!来源)平台投递\|一键投递\|立即投递\|查看岗位·\|录用概率\|通过率\|\d{1,3}\s*%" <目标> \|\| echo OK`（放行「去来源平台投递」，拦非来源语境「平台投递」；无 rg -P 用 Task 8 的 node 兜底） |

## 明确不做（本计划边界）

不新增入口/路由/磁贴；不新增数据模型/AI记录类型/FilePurpose；不改 controller 端点契约/Prisma/member-assets；不做多岗对比/薪资统计/找企业（M2）；不改 job-fit/career-plan/fair-visit-plan；不碰其他分支；不合并 PR、不转 Ready、不删 backup ref。
