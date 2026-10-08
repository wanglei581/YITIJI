// 稿 23：简历优化。总览八态都能进运行页。
// 稿把对照、编辑、草稿预览在非 ready 时收回总览，和总览那一态是同一屏，不再单独截。
import type { ResumePageFixture } from './types'
import { PAGE23_CAPTURE_MODULES, PAGE23_CAPTURE_RESUME } from '../../../../src/pages/resume/components/resume-deliver/fixtures'

const COLLAPSED = '稿把对照、编辑、草稿预览在非 ready 时收回总览，和总览那一态是同一屏，不再单独截。'
const TASK = 'paircapture01'
const OPTIMIZE_STATES = ['no-context', 'loading', 'ready', 'empty', 'read-error', 'optimize-failed', 'unavailable', 'illegal']

const OPTIMIZE_BODY = {
  taskId: TASK,
  status: 'completed',
  providerName: 'llm',
  modules: PAGE23_CAPTURE_MODULES,
  optimizedResume: PAGE23_CAPTURE_RESUME,
}

function optimizePath(state: string): string {
  return `/resume/optimize?state=${encodeURIComponent(state)}&capture=1&taskId=${TASK}`
}

export const page23: ResumePageFixture = {
  prefix: '23-',
  plan(screen, state) {
    if (screen !== 'optimize' && state !== 'ready') {
      return { plan: { kind: 'none' }, reason: COLLAPSED, marker: null, runtimePath: null }
    }
    if (screen === 'compare' && state === 'ready') {
      return {
        plan: { kind: 'resume-pages' },
        reason: null,
        marker: '[data-kiosk-screen="resume-optimize-compare"] [aria-label="改写选择统计"]',
        runtimePath: `/resume/optimize/compare?taskId=${TASK}`,
      }
    }
    if (screen === 'editor' && state === 'ready') {
      return {
        plan: { kind: 'resume-pages' },
        reason: null,
        marker: '[data-work-view="editor"] textarea',
        runtimePath: `/resume/optimize?screen=editor&state=ready&capture=1&taskId=${TASK}`,
      }
    }
    if (screen === 'final' && state === 'ready') {
      return {
        plan: { kind: 'resume-pages' },
        reason: null,
        marker: '[data-testid="resume-optimize-final"]',
        runtimePath: `/resume/optimize?screen=final&state=ready&capture=1&taskId=${TASK}`,
      }
    }
    if (screen === 'optimize' && OPTIMIZE_STATES.includes(state)) {
      return {
        plan: { kind: 'resume-pages' },
        reason: null,
        marker: state === 'ready' ? '[data-testid="resume-optimize-overview"]' : `[data-optimize-state="${state}"]`,
        runtimePath: optimizePath(state),
      }
    }
    return { plan: { kind: 'none' }, reason: COLLAPSED, marker: null, runtimePath: null }
  },
  async prepare(page, api, target) {
    api.respond('GET', `/api/v1/resume/records/${TASK}/optimize`, { status: 200, json: OPTIMIZE_BODY })
    const url = target.runtimeUrl ?? optimizePath('ready')
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    if (target.readyMarker) {
      await page.locator(target.readyMarker).first().waitFor({ state: 'visible', timeout: 15_000 })
    }
  },
}
