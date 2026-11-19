/**
 * 出站与落库先遮盖再截断。
 *
 * 证件号跨在字数上限上时，先截断会把前 10 位明文送进模型或写进库。
 * 每条用例都用「上限减 10 个乙 + 固定 18 位号」，断言出站正文或落库摘要里
 * 既没有整号，也没有前 10 位，并且出现了遮盖占位符（证明号就在截断窗口里）。
 * 排版这条的截断、粘连号码和种子往返在 verify-layout-mask-truncate.ts。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:mask-before-truncate
 */
import 'dotenv/config'
import { AssistantSummaryService } from '../src/advisor/assistant-summary.service'
import { LlmAdvisorService } from '../src/advisor/llm-advisor.service'
import { LlmCareerPlanService } from '../src/ai/resume/llm-career-plan.service'
import { LlmFairVisitPlanService } from '../src/ai/resume/llm-fair-visit-plan.service'
import { LlmJobFitService } from '../src/ai/resume/llm-job-fit.service'
import { LlmResumeService } from '../src/ai/resume/llm-resume.service'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import type { ResumeReport } from '../src/ai/interfaces/ai-provider.interface'
import { JobAiLlmService } from '../src/job-ai/job-ai-llm.service'
import { MockInterviewLlmService } from '../src/mock-interview/mock-interview-llm.service'
import { MockInterviewService } from '../src/mock-interview/mock-interview.service'
import { assertClean, cross, llmConfig, outbound, passed, realFetch } from './verify-mask-outbound-harness'

process.env['AI_ENDPOINT_ALLOWLIST_EXTRA'] = [process.env['AI_ENDPOINT_ALLOWLIST_EXTRA'], 'llm.invalid']
  .filter(Boolean)
  .join(',')

async function main(): Promise<void> {
  const summary = new AssistantSummaryService(
    {} as never,
    {} as never,
    llmConfig,
    {} as never,
    {} as never,
    {} as never,
  )
  await outbound('小青摘要用户轮 800', () =>
    (summary as unknown as {
      condense: (turns: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<unknown>
    }).condense([{ role: 'user', content: cross(800) }]))

  const jobs = new JobAiLlmService(llmConfig)
  await outbound('岗位推荐简历 6000', () => jobs.recommend(cross(6000), [{
    jobId: 'job-1',
    title: '测试岗位',
    company: '来源企业',
    sourceName: '来源平台',
    sourceUrl: 'https://example.invalid/job',
    externalId: 'ext-1',
    skills: [],
    city: '上海',
  }]))

  const advisor = new LlmAdvisorService(llmConfig)
  await outbound('比对材料 8000', () => advisor.compare(cross(8000), '岗位要求：能独立完成工作'))
  await outbound('比对要求 4000', () => advisor.compare('材料里写了项目经历', cross(4000)))

  const interviewLlm = new MockInterviewLlmService(llmConfig)
  const questionBase = {
    interviewerType: 'hr',
    industry: '软件',
    position: '测试岗位',
    experience: 'y1_3',
    difficulty: 'standard',
    questionTarget: 4,
    askedCount: 1,
  }
  await outbound('面试出题摘要 3000', () => interviewLlm.nextQuestion({
    ...questionBase,
    resumeDigest: cross(3000),
    transcript: [],
  }))
  await outbound('面试出题回答 500', () => interviewLlm.nextQuestion({
    ...questionBase,
    resumeDigest: null,
    transcript: [{ role: 'candidate', content: cross(500) }],
  }))
  await outbound('面试报告摘要 3000', () => interviewLlm.buildReport({
    ...questionBase,
    resumeDigest: cross(3000),
    transcript: [{ role: 'candidate', content: '做过一个内部工具' }],
  }))
  await outbound('面试报告回答 800', () => interviewLlm.buildReport({
    ...questionBase,
    resumeDigest: null,
    transcript: [{ role: 'candidate', content: cross(800) }],
  }))

  let storedDigest = ''
  const interviews = new MockInterviewService(
    {
      fileObject: { findUnique: async () => ({ endUserId: 'member-1' }) },
      mockInterviewSession: {
        create: async ({ data }: { data: { resumeDigest?: string | null; interviewerType: string; durationMin: number; questionTarget: number } }) => {
          storedDigest = data.resumeDigest ?? ''
          return { id: 'iv-1', interviewerType: data.interviewerType, durationMin: data.durationMin, questionTarget: data.questionTarget }
        },
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { extractResumeText: async () => ({ ok: true, text: cross(6000) }) } as never,
    { write: async () => undefined } as never,
    {} as never,
    {} as never,
  )
  await interviews.createSession({
    interviewerType: 'hr',
    industry: '软件',
    position: '测试岗位',
    experience: 'y1_3',
    difficulty: 'standard',
    durationMin: 5,
    resumeFileId: 'file-1',
  }, { endUserId: 'member-1', accessToken: null })
  assertClean('面试摘要落库 6000', storedDigest)

  const fair = new LlmFairVisitPlanService(llmConfig)
  await outbound('参会准备简历 8000', () => fair.build({
    resumeText: cross(8000),
    mode: 'preparation',
    fair: {
      id: 'fair-1',
      title: '春季招聘会',
      sourceName: '来源机构',
      sourceUrl: 'https://example.invalid/fair',
      startAt: '2026-04-01T01:00:00.000Z', // time-bomb-ok: 招聘会时间只拼进提示词正文，LlmFairVisitPlanService 不拿它和当前时间比较（mode 由调用方传入）
      endAt: '2026-04-01T09:00:00.000Z', // time-bomb-ok: 同上，只进提示词正文
      venue: '来源场馆',
      city: '上海',
    },
    fairCompanies: [],
  }))

  const diagnosis = new LlmResumeService(llmConfig)
  await outbound('简历诊断 12000', () => diagnosis.diagnose(cross(12000)))

  const fit = new LlmJobFitService(llmConfig)
  await outbound('岗位对照简历 8000', () => fit.analyze(cross(8000), { title: '测试岗位' }))

  const career = new LlmCareerPlanService(llmConfig)
  await outbound('职业规划简历 8000', () => career.build({ resumeText: cross(8000) }))

  const optimize = new LlmResumeOptimizeService(llmConfig)
  const report = { sections: [], suggestions: [] } as ResumeReport
  await outbound('简历优化 12000', () => optimize.optimize(cross(12000), report))

  console.log(`verify:mask-before-truncate ${passed()} PASS`)
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    global.fetch = realFetch
  })
