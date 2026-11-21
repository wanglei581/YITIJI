import type { Dispatch, SetStateAction } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import type {
  CreateInterviewResponse,
  InterviewDifficulty,
  InterviewDuration,
  InterviewExperience,
  InterviewPracticeSheetResponse,
  InterviewerType,
} from '@ai-job-print/shared'
import { aiErrorCodeOf, aiErrorMessageOf, isAiOutage } from '../../ai'
import { aiDeclarationDeclineMessage } from '../../ai/aiDeclarationErrors'
import { createInterview, startInterview } from '../../services/api/interview'
import { AI_QUOTA_EXHAUSTED_INTERVIEW_COPY } from '../../services/api/userErrorMessage'
import { openedInterviewDeadline } from './session/interviewDeadline'
import type { InterviewStage } from './interviewWorkbenchModel'
import { patchInterviewWorkbenchSession } from './interviewWorkbenchSession'
import { isAiGateDown } from './useInterviewAiCapabilities'

export const INTERVIEWER_AI_DRAFT =
  '我正在选择面试官。请先问我想练什么，再解释各类面试官的侧重点，由我自己选择。'
export const SETUP_AI_DRAFT =
  '我想开始一场模拟面试。请先问我的目标岗位，再说明岗位、面试官和时长怎么选。不要替我创建练习。'

export const INTERVIEW_EXPERIENCES: Array<{ key: InterviewExperience; label: string }> = [
  { key: 'fresh', label: '应届生' },
  { key: 'lt1', label: '1 年以内' },
  { key: 'y1_3', label: '1-3 年' },
  { key: 'y3_5', label: '3-5 年' },
  { key: 'gt5', label: '5 年以上' },
  { key: 'switch', label: '转行求职' },
]

export const INTERVIEW_DIFFICULTIES: Array<{ key: InterviewDifficulty; label: string; desc: string }> = [
  { key: 'easy', label: '轻松练习', desc: '适合第一次练习，问题更基础' },
  { key: 'standard', label: '标准面试', desc: '接近真实面试节奏' },
  { key: 'pressure', label: '压力面试', desc: '更多追问与细节验证' },
]

export const INTERVIEW_DURATIONS: Array<{ key: InterviewDuration; label: string; desc: string }> = [
  { key: 3, label: '3 分钟 / 4 题', desc: '到点自动结束' },
  { key: 5, label: '5 分钟 / 6 题', desc: '到点自动结束' },
  { key: 8, label: '8 分钟 / 8 题', desc: '到点自动结束' },
]

export const INTERVIEW_POSITION_EXAMPLES = ['前端开发工程师', '行政专员', '市场运营', '机械工程师', '会计', '销售代表']

/** 开场被每人每天的模拟面试次数拦住：页面知道自己是面试，不靠服务端是否带回 bucket。 */
export function interviewStartMessage(err: unknown): string {
  if (aiErrorCodeOf(err) === 'AI_QUOTA_EXHAUSTED') return AI_QUOTA_EXHAUSTED_INTERVIEW_COPY
  return aiErrorMessageOf(err, '创建练习失败，请稍后重试')
}

export function validateInterviewBasics(input: {
  position: string
  industry: string
  experience: InterviewExperience | ''
}): string | null {
  if (!input.position.trim()) return '请先填写目标岗位，例如：前端开发工程师、行政专员'
  if (!input.industry.trim()) return '请先选择本次练习的行业，不会替你预选'
  if (!input.experience) return '请先选择你的经验情况，不会替你预选'
  return null
}

export function interviewSetupStepCopy(step: 1 | 2 | 3): { eyebrow: string; title: string; sub: string } {
  if (step === 1) {
    return {
      eyebrow: '练面试 · 岗位与经验',
      title: '这次练哪个岗位？',
      sub: '选定岗位、面试官和时长后才开始这场练习；语音能否使用，进入后按麦克风实际情况确认。',
    }
  }
  if (step === 2) {
    return {
      eyebrow: '练面试 · 面试官与时长',
      title: '选一位面试官',
      sub: '难度和时长有默认值。到点自动结束。',
    }
  }
  return {
    eyebrow: '练面试 · 核对开始',
    title: '核对一下，就开始',
    sub: '面试前，先设置一场练习。',
  }
}

export function interviewSetupEcho(input: {
  interviewerType: InterviewerType
  difficulty: InterviewDifficulty
  duration: InterviewDuration
  interviewerLabel?: string
  difficultyLabel?: string
  durationLabel?: string
}): string {
  const defaults = input.interviewerType === 'hr' && input.difficulty === 'standard' && input.duration === 5
  const prefix = defaults ? '默认已填' : '已选'
  return `${prefix}：${input.interviewerLabel}、${input.difficultyLabel}、${input.durationLabel}、文字回答。`
}

export function formatPracticeSheetSize(sizeBytes: number): string {
  return sizeBytes >= 1024 * 1024
    ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
}

export function practiceSheetFileMeta(file: InterviewPracticeSheetResponse): {
  name: string
  size: string
  pages: number
  fileId: string
  mimeType: 'application/pdf'
} {
  return {
    name: file.filename,
    size: formatPracticeSheetSize(file.sizeBytes),
    pages: file.pageCount,
    fileId: file.fileId,
    mimeType: 'application/pdf',
  }
}

export interface InterviewStartTrip {
  orderId: string
  kioskSessionId: string
  headers: Record<string, string>
}

/** 授权后重试刚才那场带简历的 start，不再新建一场。 */
export async function continueInterviewWithResume(ctx: {
  created: CreateInterviewResponse
  pos: string
  duration: InterviewDuration
  interviewerType: InterviewerType
  trip?: InterviewStartTrip
  onStartError?: (err: unknown, trip?: InterviewStartTrip) => Promise<boolean>
  getToken: () => string | null
  onGoStage?: (stage: InterviewStage) => void
  navigate: NavigateFunction
  promptConsent: (err: unknown, loggedIn: boolean, retry: () => void) => boolean
  setCreating: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setAiOutage: Dispatch<SetStateAction<string | null>>
  setAssistantDown: Dispatch<SetStateAction<boolean>>
  setStartFailed: Dispatch<SetStateAction<boolean>>
  setOfferStartWithoutResume: Dispatch<SetStateAction<boolean>>
  setProbed: Dispatch<SetStateAction<boolean>>
}): Promise<void> {
  const { created, pos, duration, interviewerType, trip } = ctx
  ctx.setCreating(true)
  ctx.setError(null)
  ctx.setAiOutage(null)
  ctx.setAssistantDown(false)
  ctx.setStartFailed(false)
  ctx.setOfferStartWithoutResume(false)
  try {
    const token = ctx.getToken()
    const first = await startInterview(
      created.sessionId,
      { token, accessToken: created.accessToken },
      trip ? { headers: trip.headers } : undefined,
    )
    const opened = openedInterviewDeadline(first, duration)
    ctx.setProbed(true)
    const paidFields = trip ? { paidOrderId: trip.orderId, paidKioskSessionId: trip.kioskSessionId } : {}
    patchInterviewWorkbenchSession({
      stage: 'session',
      live: {
        sessionId: created.sessionId,
        accessToken: created.accessToken,
        questionTarget: created.questionTarget,
        durationMin: duration,
        interviewerType,
        position: pos,
        firstQuestion: first.question ?? '',
        messages: [{ role: 'interviewer', content: first.question ?? '' }],
        questionIndex: 1,
        remainingSec: opened.remainingSec,
        deadlineAtLocalMs: opened.deadlineAtLocalMs,
        deadlineSource: opened.deadlineSource,
        omitPrintAnswers: false,
        ...paidFields,
      },
    })
    if (ctx.onGoStage) {
      ctx.onGoStage('session')
    } else {
      ctx.navigate('/interview/session', {
        replace: true,
        state: {
          sessionId: created.sessionId,
          accessToken: created.accessToken,
          questionTarget: created.questionTarget,
          durationMin: duration,
          interviewerType,
          position: pos,
          firstQuestion: first.question ?? '',
          deadlineAtLocalMs: opened.deadlineAtLocalMs,
          deadlineSource: opened.deadlineSource,
          ...paidFields,
        },
      })
    }
  } catch (err) {
    const declined = aiDeclarationDeclineMessage(err)
    if (declined) {
      ctx.setError(declined)
      return
    }
    if (ctx.onStartError && await ctx.onStartError(err, trip)) return
    if (ctx.promptConsent(err, Boolean(ctx.getToken()), () => { void continueInterviewWithResume(ctx) })) return
    const message = interviewStartMessage(err)
    ctx.setError(message)
    ctx.setStartFailed(true)
    ctx.setAssistantDown(isAiGateDown(err))
    if (isAiOutage(err)) ctx.setAiOutage(message)
    else ctx.setProbed(true)
  } finally {
    ctx.setCreating(false)
  }
}

/** 探针说开不了场：建一场配置（不调模型、不 start），再印通用题目单。 */
export async function openPracticeSheetSession(ctx: {
  pendingSession: { sessionId: string; accessToken?: string } | null
  interviewerType: InterviewerType
  industry: string
  position: string
  experience: InterviewExperience | ''
  difficulty: InterviewDifficulty
  duration: InterviewDuration
  getToken: () => string | null
  setError: Dispatch<SetStateAction<string | null>>
  setPendingSession: Dispatch<SetStateAction<{ sessionId: string; accessToken?: string } | null>>
  onPracticeSheet: (session?: { sessionId: string; accessToken?: string }) => Promise<void>
}): Promise<void> {
  if (ctx.pendingSession) {
    await ctx.onPracticeSheet()
    return
  }
  const invalid = validateInterviewBasics({ position: ctx.position, industry: ctx.industry, experience: ctx.experience })
  if (invalid || !ctx.experience) {
    ctx.setError(invalid ?? '请先选择你的经验情况，不会替你预选')
    return
  }
  ctx.setError(null)
  try {
    const token = ctx.getToken()
    const created = await createInterview({
      interviewerType: ctx.interviewerType,
      industry: ctx.industry.trim(),
      position: ctx.position.trim(),
      experience: ctx.experience,
      difficulty: ctx.difficulty,
      durationMin: ctx.duration,
    }, { token })
    const session = { sessionId: created.sessionId, accessToken: created.accessToken }
    ctx.setPendingSession(session)
    await ctx.onPracticeSheet(session)
  } catch (err) {
    ctx.setError(aiErrorMessageOf(err, '题目单生成失败，请稍后重试'))
  }
}
