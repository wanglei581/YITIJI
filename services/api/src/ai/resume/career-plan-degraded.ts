// ============================================================
// 职业规划「降级态」可打印内容（S3-DEGRADE-PRINT）。
//
// 为什么有这个文件：
//   用户对 AI 定的规则是「AI 是支撑功能使用，不是必要条件」。职业规划在 AI 挂掉时
//   属于降级规则①（有确定性替代路径 → 退化成用户自己完成）：页面照常给通用自检项 +
//   岗位要求计数表。但这是一台**打印终端** —— 在此之前 `printPlan` 强制要求已落库的
//   AI plan，AI 挂掉时用户在页面上看得到东西却**一张纸也拿不走**，这条降级路径只做了一半。
//
// 本文件只放「不依赖任何模型」的素材与端口定义，渲染在 career-plan-degraded-pdf.service.ts。
//
// 三条硬约束（对应红线）：
//   1. 降级版必须一眼看出是降级版 —— 标题与页眉如实写「未含 AI 规划」，不得让用户
//      拿到一份看起来像完整 AI 规划、实际没有 AI 内容的纸。
//   2. 不得编造 AI 内容 —— 没有的部分就不印，或如实印一句「本次未生成 AI 规划建议」。
//   3. 证据分级要对 —— 用户自己填的是 E1；岗位要求计数是确定性聚合，恒 E2，**不得标 E3**。
// ============================================================

/**
 * AI 挂掉时的通用求职自检项。
 *
 * 口径来源：`docs/design/kiosk-ai-os-v3-2026-08/22-career-plan.html:437-455` 的 ai-down 支线，
 * 前端副本在 `apps/kiosk/src/pages/resume/CareerPlanPage.tsx`（降级区「不靠 AI 也能自己看的三件事」）。
 * 三处措辞必须保持一致；改一处要同时改另外两处。
 *
 * ⚠️ 这是**通用建议**，不是针对用户这份简历的判断。原型自己就写着这一点，
 * 打印件必须原样保留这句限定，否则等于把通用清单冒充成个性化规划。
 */
export const DEGRADED_SELF_CHECKLIST: readonly string[] = [
  '技能栏里没有事例撑着的词，先删掉 ——「团队协作」「项目管理」这类，正文里找不到对应的事就是虚的。这个判断不用 AI，你自己对着简历看一遍就知道。',
  '每段经历问自己一句「结果是什么」—— 写了做什么、没写做成什么，是最常见的一处。有数字写数字，没数字写变化。',
  '会做但简历里没写的，去简历工作台补上 —— 本机读不到的能力不是你不会，是简历没写。',
]

/** 通用自检项的限定语。必须与清单同时出现，不允许只印清单。 */
export const DEGRADED_SELF_CHECKLIST_CAVEAT =
  '以上三条是通用建议，不是针对你这份简历的 —— 本机这次读不到 AI 判断。AI 恢复后重新生成，能给出按你简历原文逐条对应的版本。'

// ─── 自我探索记分（E1：用户自己填的） ───────────────────────────────────────

/**
 * 降级版只取**确定性记分**（key / label / strength）。
 *
 * `self-assessment-scoring.ts` 的 `scoreSelfAssessment` 是固定权重累加的纯函数，
 * 不经过模型，所以 AI 挂掉时这一段照常拿得到，标 E1（用户自己填的答案算出来的）。
 *
 * 刻意**不取** `note` / `summary`：那两个字段是 LLM 生成的自然语言解读
 * （`self-assessment.service.ts` 里由 `llmResult` 覆盖）。即使库里存着上一次 AI 正常时
 * 写下的解读，把它印进一份自称「未含 AI 规划」的纸里也会让这张纸的自我标识失真。
 */
export interface DegradedSelfAssessmentDimension {
  readonly key: string
  readonly label: string
  /** 0..5，固定权重累加后归一化。 */
  readonly strength: number
}

// ─── 岗位要求计数（E2：确定性聚合） ─────────────────────────────────────────

/**
 * 岗位要求计数的**最小结构契约**。
 *
 * ⚠️ 这不是 PR #636 的类型副本，是它的结构化超集（supertype）：
 * 只声明本 PDF 真正要印的字段，让 #636 的 `JobRequirementStatsData` 能直接结构化赋值。
 * 之所以不 import #636 的 `packages/shared` 类型 —— 那个 PR 尚未合入 main，
 * 直接依赖会让本分支编不过；把它的代码拷过来又会产生两份会漂移的统计口径。
 *
 * 字段语义以 #636 的契约为准（`packages/shared/src/types/jobRequirementStats.ts`）。
 */
export interface DegradedJobRequirementStats {
  /** 统计口径版本。 */
  readonly rulesVersion: string
  /**
   * 证据分级，恒为 'E2'。计数是数出来的，不是判断出来的 —— 不得标 E3。
   * 这里写死成字面量类型，让任何标错分级的实现在编译期就过不去。
   */
  readonly evidenceLevel: 'E2'
  readonly sample: {
    readonly matchedTotal: number
    readonly countedTotal: number
    readonly titleOnlyTotal: number
    readonly truncated: boolean
    readonly scanLimit: number
    readonly sourceOrgCount: number
    readonly latestSyncTime: string | null
    readonly sufficient: boolean
    readonly minSampleSize: number
    readonly issue: string | null
  }
  readonly dimensions: ReadonlyArray<{
    readonly dimension: string
    readonly label: string
    readonly statedCount: number
    readonly sampleSize: number
    readonly sufficient: boolean
    readonly minStatedCount: number
    readonly items: ReadonlyArray<{ readonly key: string; readonly label: string; readonly count: number }>
    readonly note: string
  }>
  readonly boundaryNotes: readonly string[]
}

/**
 * 岗位要求计数的注入端口。
 *
 * 方法签名照着 PR #636 的 `JobRequirementStatsService.getStats` 定，
 * 所以那个 PR 合入后接线就是 ai.module.ts 里一行 `useExisting`，不需要适配层：
 *
 *   { provide: CAREER_PLAN_JOB_REQUIREMENT_STATS, useExisting: JobRequirementStatsService }
 *
 * 在它合入之前，本 token 故意**不注册**：`printPlan` 走 `@Optional()` 注入拿到 undefined，
 * 降级 PDF 如实印「本次未取到岗位要求计数」，而不是留白或编一张空表。
 */
export interface CareerPlanJobRequirementStatsPort {
  getStats(params: {
    keyword?: string
    city?: string
    industry?: string
    category?: string
    sourceOrgId?: string
  }): Promise<{ data: DegradedJobRequirementStats }>
}

/** Nest 注入 token。 */
export const CAREER_PLAN_JOB_REQUIREMENT_STATS = 'CAREER_PLAN_JOB_REQUIREMENT_STATS'

/** 样本量不足的机读原因 → 打印件上的人话。未知码走兜底，不猜。 */
export function describeSampleIssue(issue: string | null): string {
  switch (issue) {
    case 'no_matching_jobs':
      return '本机当前没有符合条件的在架岗位'
    case 'no_readable_jobs':
      return '有在架岗位，但本机一条都读不到正文（只有标题的不计入）'
    case 'below_min_sample':
      return '读得到正文的岗位条数低于最低样本量门槛'
    default:
      return '样本量不足'
  }
}

// ─── 降级 PDF 的输入 ────────────────────────────────────────────────────────

/** 为什么这次是降级版。如实写在纸上，不含推测。 */
export interface DegradedReason {
  /** 一句话原因，直接印在说明区。 */
  readonly text: string
}

export interface DegradedCareerPlanContent {
  /** 生成日期（YYYY-MM-DD）。 */
  readonly date: string
  readonly reason: DegradedReason
  /** E1：用户自己填的自我探索记分；空数组表示本次没有（如实说，不补零）。 */
  readonly selfAssessment: readonly DegradedSelfAssessmentDimension[]
  /** E2：岗位要求计数；null 表示本次没取到（如实说，不编空表）。 */
  readonly jobRequirementStats: DegradedJobRequirementStats | null
}
