// 临时（不提交）：把 18 稿推到指定状态再截图。稿的状态要点按钮才会走到，并排工具原本只截起点。
import type { Page } from '@playwright/test'

const PLAN18: Record<string, { fx: string; acts: string[]; force?: string }> = {
  'create-loading': { fx: '', acts: ['pick'], force: 'create-loading' },
  'create-failed': { fx: 'create-busy', acts: ['pick', 'create'] },
  'panel-instruction': { fx: 'create-ok', acts: ['pick', 'create'] },
  'waiting-delivery': { fx: 'create-ok,poll-waiting', acts: ['pick', 'create', 'wait'] },
  polling: { fx: 'create-ok,poll-waiting', acts: ['pick', 'create', 'wait'], force: 'polling' },
  'poll-failed': { fx: 'create-ok,poll-error', acts: ['pick', 'create', 'wait'] },
  cancelling: { fx: 'create-ok,poll-waiting', acts: ['pick', 'create', 'wait'], force: 'cancelling' },
  failed: { fx: 'create-ok,poll-scan-failed', acts: ['pick', 'create', 'wait'] },
  expired: { fx: 'create-ok,poll-expired', acts: ['pick', 'create', 'wait'] },
  completed: { fx: 'create-ok,poll-completed', acts: ['pick', 'create', 'wait'] },
  'preview-ready': { fx: 'create-ok,poll-completed,preview-ok', acts: ['pick', 'create', 'wait', 'preview'] },
  'completed-no-file': { fx: 'create-ok,poll-completed-nofile', acts: ['pick', 'create', 'wait'] },
}

export function protoQueryOverride(file: string, state: string, query: string): string {
  if (!file.startsWith('18-')) return query
  const plan = PLAN18[state]
  if (!plan) return query
  return plan.fx ? `?capture=1&flat=1&fx=${encodeURIComponent(plan.fx)}` : '?capture=1&flat=1'
}

export async function driveProto(page: Page, file: string, state: string): Promise<void> {
  if (!file.startsWith('18-')) return
  const plan = PLAN18[state]
  if (!plan) return
  for (const act of plan.acts) {
    const sel = act === 'pick' ? '[data-act="pick"][data-type="resume"]' : `[data-act="${act}"]`
    await page.locator(sel).first().click({ timeout: 5_000 })
    await page.waitForFunction(() => {
      const root = document.getElementById('body-root')
      return root && !/loading|polling|cancelling/.test(root.getAttribute('data-state') ?? '')
    }, undefined, { timeout: 8_000 }).catch(() => undefined)
    await page.waitForTimeout(150)
  }
  if (plan.force) {
    await page.evaluate((step) => {
      const w = window as unknown as { S: Record<string, unknown>; render: () => void; pollClear?: () => void }
      w.pollClear?.()
      w.S.step = step
      w.S.busy = true
      w.render()
    }, plan.force)
  } else {
    await page.locator(`#body-root[data-state="${state}"]`).waitFor({ timeout: 8_000 }).catch(() => undefined)
  }
  await page.waitForTimeout(200)
}
