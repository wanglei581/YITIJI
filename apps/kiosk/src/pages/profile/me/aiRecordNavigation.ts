import type { MemberAiRecordItem, MemberResumeItem } from '@ai-job-print/shared'

export function recordUnavailableReason(item: Pick<MemberAiRecordItem, 'status' | 'expiresAt' | 'taskId'>): string | null {
  if (!item.expiresAt || !Number.isFinite(Date.parse(item.expiresAt))) return '这条早期记录已无法读取，请重新办理'
  if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) return '已超过保存期限，无法打开'
  if (!item.taskId) return '没有找到这条结果，请刷新列表'
  if (item.status === 'failed') return '这次处理未完成，没有可打开的结果'
  if (item.status !== 'completed') return '正在处理，完成后可打开'
  return null
}

export function aiRecordPath(item: MemberAiRecordItem): string | null {
  const paths = {
    parse: '/resume/report', optimize: '/resume/optimize', generate: '/resume/generate/preview',
    job_fit: '/resume/job-fit', career_plan: '/resume/career-plan', self_assessment: '/resume/self-assessment/result',
  }
  if (recordUnavailableReason(item) || !(item.kind in paths)) return null
  return `${paths[item.kind as keyof typeof paths]}?taskId=${encodeURIComponent(item.taskId)}${item.kind === 'optimize' ? '&saved=1' : ''}`
}

export function resumeLabel(item: MemberResumeItem): string {
  return `${item.kind === 'parse' ? '上传诊断简历' : 'AI 生成简历'} · ${item.createdAt.slice(0, 10)} · ${item.taskId.slice(-8)}`
}
