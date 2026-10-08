// 稿 24：从零生成简历。填写态走 ?state=&capture=1；预览态仍交给 planOf，避免盖掉已配对的导出屏。
import type { ResumePageFixture } from './types'

const FILL = new Set([
  'entry',
  'input-basic',
  'input-intention',
  'input-history',
  'input-strengths',
  'review',
])

export const page24: ResumePageFixture = {
  prefix: '24-',
  plan(_screen, state) {
    if (!FILL.has(state)) return null
    return {
      plan: { kind: 'url' },
      reason: null,
      marker: `[data-generate-state="${state}"]`,
      runtimePath: '/resume/generate',
    }
  },
}
