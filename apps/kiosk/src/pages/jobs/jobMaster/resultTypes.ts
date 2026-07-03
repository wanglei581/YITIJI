// ============================================================
// 岗位大师结果视图类型（M1.5）。
// 全部从 @ai-job-print/shared 契约「派生」，不在前端本地重定义业务字段
// （契约源：packages/shared/src/types/ai.ts JobMasterResponse）。
// Task 7 各结果子组件从本文件引入切片类型，随 shared 契约演进自动对齐。
// ============================================================

import type { JobMasterResponse } from '@ai-job-print/shared'

/** 整份岗位大师结果（结果视图数据来源）。 */
export type JobMasterResult = JobMasterResponse

/** 各结果卡所需的数据切片（派生自 shared）。 */
export type JobMasterJobView = NonNullable<JobMasterResponse['job']>
export type JobMasterSalaryView = NonNullable<JobMasterResponse['salary']>
export type JobMasterFitView = NonNullable<JobMasterResponse['fit']>
export type JobMasterMatchedSkillView = JobMasterFitView['matchedSkills'][number]
export type JobMasterGapSkillView = JobMasterFitView['gapSkills'][number]
export type JobMasterKeywordCoverageView = NonNullable<JobMasterFitView['keywordCoverage']>
export type JobMasterCareerPathView = NonNullable<JobMasterResponse['careerPath']>
export type JobMasterRiskView = NonNullable<JobMasterResponse['risks']>[number]
export type JobMasterInterviewPrepView = NonNullable<JobMasterResponse['interviewPrep']>[number]
export type JobMasterResumeRewriteView = NonNullable<JobMasterResponse['resumeRewrite']>[number]

/** 结果卡内 CTA 跳转所需的会话上下文（带 taskId 去优化简历 / 练面试等）。 */
export interface JobMasterResultContext {
  taskId: string
  accessToken?: string
}
