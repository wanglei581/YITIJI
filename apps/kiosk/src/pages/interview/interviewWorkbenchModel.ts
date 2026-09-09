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
    subtitle: '选定岗位、面试官和时长后才创建会话；语音能否使用，还要由服务与麦克风能力实际确认。',
  },
  session: {
    title: '用真实经历回答。',
    titleEm: '用真实经历回答',
    subtitle: '文字输入始终可用；题目、剩余时间与下一题只能由当前会话返回，不能用静态内容冒充真实进度。',
  },
  report: {
    title: '报告用于复盘练习。',
    titleEm: '复盘练习',
    subtitle: '报告必须由本场会话和当前凭证读取；没有真实报告时不展示评分、打印成功或可下载文件。',
  },
  tips: {
    title: '先把准备方法练熟。',
    titleEm: '准备方法',
    subtitle: '这是公开的面试准备工作台，不把静态技巧伪装成根据你的简历自动生成的建议。',
  },
  reports: {
    title: '只查看自己的报告。',
    titleEm: '自己的报告',
    subtitle: '游客报告仅按当前会话与短期凭证读取；登录后的本人历史列表是另一条受账号保护的路径。',
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
