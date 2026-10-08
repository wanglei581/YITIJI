// 稿 22：简历诊断报告。这九态用地址直接打开，示例数据仍走页面里的 capture 夹具。
import type { ResumePageFixture } from './types'

const REPORT_URL_STATES = new Set([
  'no-context',
  'loading',
  'report',
  'report-minimal',
  'report-empty',
  'read-error',
  'diagnose-failed',
  'unavailable',
  'illegal',
])

export const page22: ResumePageFixture = {
  prefix: '22-',
  plan(_screen, state) {
    if (!REPORT_URL_STATES.has(state)) return null
    return {
      plan: { kind: 'url' },
      reason: null,
      marker: `[data-testid="resume-report-state-${state}"]`,
      runtimePath: '/resume/report',
    }
  },
}
