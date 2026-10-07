import type { MemberAiRecordItem, MemberResumeItem } from '@ai-job-print/shared'

/**
 * 与 `formatTime` 同一口径（M月D日 HH:mm）。
 * 写在这里、不 import：`scripts/tests/w3a-ai-records.test.mjs` 用 vm 加载本文件，
 * 运行时 import 会按测试文件的路径去 require。
 * 标题只用类型加日期时间区分同类记录，不拼 taskId（v2 规则 4）。
 */
function resumeWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${h}:${m}`
}

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

/**
 * 列表上的「接着打印」只跳到目标页。那些页已经有打印（导出、核价、交接都在页内）。
 * 列表没有文件地址，不在这里调打印接口，也不把人送到没有文件的 /print/confirm。
 * 招聘会准备单、模拟面试、小青作业不在这张表里，由各自页面单独判断。
 */
const PRINTABLE_AI_KINDS = new Set<MemberAiRecordItem['kind']>([
  'parse', 'optimize', 'generate', 'job_fit', 'career_plan', 'self_assessment',
])

export function aiRecordPrintPath(item: MemberAiRecordItem): string | null {
  if (!PRINTABLE_AI_KINDS.has(item.kind)) return null
  return aiRecordPath(item)
}

export function resumeLabel(item: MemberResumeItem): string {
  const kind = item.kind === 'parse' ? '上传诊断简历' : 'AI 生成简历'
  const when = resumeWhen(item.createdAt)
  return when ? `${kind} · ${when}` : kind
}

/** 简历行上置灰动作的原因。待处理 / 处理中、失败用稿上的句子；过期、缺任务、读不出仍用原来的原因。 */
export function resumeActionReason(item: Pick<MemberResumeItem, 'status' | 'expiresAt' | 'taskId'>): string {
  const base = recordUnavailableReason(item)
  if (!base) return ''
  if (item.status === 'failed') return '任务已失败，不可继续操作'
  if (item.status === 'pending' || item.status === 'processing') return '任务完成后可用'
  return base
}
