export const INTERVIEW_STAGES = ['setup', 'session', 'report', 'tips', 'reports'] as const

export type InterviewStage = (typeof INTERVIEW_STAGES)[number]

export function parseInterviewStage(raw: string | null): InterviewStage | null {
  if (raw === 'setup' || raw === 'session' || raw === 'report' || raw === 'tips' || raw === 'reports') {
    return raw
  }
  return null
}

export function isInterviewStageAuthorized(
  stage: InterviewStage,
  hasLiveSession: boolean,
  hasReportSession: boolean,
): boolean {
  if (stage === 'setup' || stage === 'tips' || stage === 'reports') return true
  if (stage === 'session') return hasLiveSession
  if (stage === 'report') return hasReportSession
  return false
}

/**
 * URL `?stage=` 是意图，不是授权。
 * 请求 session / report 时仍渲染对应阶段：阶段页自己的空态负责拦下跳过前置条件。
 * 没有 stage 时从 sessionStorage 复水。
 */
export function resolveInterviewView(args: {
  requested: InterviewStage | null
  storedStage: InterviewStage | null
}): InterviewStage {
  if (args.requested) return args.requested
  if (args.storedStage) return args.storedStage
  return 'setup'
}

export const INTERVIEW_STAGE_COPY: Record<InterviewStage, { title: string; titleEm: string; subtitle: string }> = {
  setup: {
    title: '面试前，先设置一场练习。',
    titleEm: '先设置一场练习',
    subtitle: '选定岗位、面试官和时长后才开始这场练习；语音能否使用，进入后按麦克风实际情况确认。',
  },
  session: {
    title: '用真实经历回答。',
    titleEm: '用真实经历回答',
    subtitle: '文字输入始终可用；题目、剩余时间与下一题只按这场练习返回，不用固定内容冒充进度。',
  },
  report: {
    title: '报告用来复盘练习。',
    titleEm: '复盘练习',
    subtitle: '报告只按这场练习读取。没有真实报告时，不展示评分、打印成功或可下载文件。',
  },
  tips: {
    title: '先把准备方法练熟。',
    titleEm: '准备方法',
    subtitle: '这是公开的面试准备说明，不会把固定技巧说成根据你的简历生成的建议。',
  },
  reports: {
    title: '只查看自己的报告。',
    titleEm: '自己的报告',
    subtitle: '未登录时，报告只在这次使用期间可看；登录后才能回看自己的历史列表。',
  },
}

export function emphasizedTitle(copy: { title: string; titleEm: string }): { before: string; em: string; after: string } {
  const index = copy.title.indexOf(copy.titleEm)
  if (index < 0) return { before: copy.title, em: '', after: '' }
  return {
    before: copy.title.slice(0, index),
    em: copy.titleEm,
    after: copy.title.slice(index + copy.titleEm.length),
  }
}
