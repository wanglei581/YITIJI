/**
 * 模拟面试开场探针的纯判定。
 * 只有明确 available === false 才是不能用；探不到、读不懂都是没确认。
 * 句子来自 docs/design/kiosk-touch-2026-10/fix-interview.js 核对页。
 */
export const INTERVIEW_DOWN_NOTE =
  'AI 服务暂停中，打印、扫描照常可用。创建并开始练习（AI 面试官）这次不可用。题目单不经模型，不含点评、评分或通过率。'

export type InterviewProbe = 'checking' | 'unconfirmed' | 'down' | 'up'

export function interviewProbeFromBody(body: unknown): Exclude<InterviewProbe, 'checking'> {
  const row = (body && typeof body === 'object' && 'data' in body
    ? (body as { data: unknown }).data
    : body) as { available?: unknown } | null
  if (!row || typeof row !== 'object' || typeof row.available !== 'boolean') return 'unconfirmed'
  return row.available ? 'up' : 'down'
}

export type InterviewStartMode = 'start' | 'sheet' | 'wait'

/** down：主按钮改成题目单；up：可以开场；其余：开始键不亮，也不说成不能用。 */
export function interviewStartControl(probe: InterviewProbe): {
  mode: InterviewStartMode
  pill: 'available' | 'off' | 'checking' | 'unconfirmed'
} {
  if (probe === 'down') return { mode: 'sheet', pill: 'off' }
  if (probe === 'up') return { mode: 'start', pill: 'available' }
  if (probe === 'checking') return { mode: 'wait', pill: 'checking' }
  return { mode: 'wait', pill: 'unconfirmed' }
}
