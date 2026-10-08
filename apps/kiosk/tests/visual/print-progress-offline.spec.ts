/**
 * N-2：打印中途断网留在进度页。
 * 查询请求连续失败不是打印失败，不跳 /print/done，也不给重新打印。
 * 协调方用 W2 配置跑：cd apps/kiosk && pnpm exec playwright test --config playwright.w2.config.ts tests/visual/print-progress-offline.spec.ts
 */
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { setReactRouterState, W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

const JOB_PATH = `/api/v1/print/jobs/${W2_ORDER.taskId}`
const BANNED = ['重新打印', '再印一份', '重新下单', '打印失败', '打印没有完成'] as const

const flowState = {
  file: W2_FILE,
  params: W2_PRINT_PARAMS,
  source: 'document' as const,
  ...W2_ORDER,
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('POST', `${JOB_PATH}/takeaway-url`, {
    status: 404,
    json: { error: { code: 'PRINT_TASK_NOT_FOUND', message: '打印任务不存在或无权访问' } },
  })
}

async function openProgress(page: Page): Promise<void> {
  await page.clock.install()
  await page.goto('/print/progress')
  await setReactRouterState(page, '/print/progress', flowState)
}

async function expectStillOnProgress(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/print\/progress/)
  expect(page.url()).not.toContain('/print/done')
  const text = await page.locator('[data-w2-page="print-progress"]').innerText()
  for (const banned of BANNED) {
    expect(text, `断网页不得出现「${banned}」`).not.toContain(banned)
  }
  await expect(page.getByRole('button', { name: '重新查询状态' })).toBeVisible()
}

test('six network failures stay on the progress page @w2', async ({ page, api }) => {
  const errors = collectPageErrors(page)
  registerShell(api)
  let polls = 0
  api.respondWith('GET', JOB_PATH, async () => {
    polls += 1
    return { abort: 'internetdisconnected' }
  })

  await openProgress(page)
  await page.clock.runFor(16_000)

  await expectStillOnProgress(page)
  await expect(page.getByText('网络中断，打印可能仍在进行').first()).toBeVisible()
  await expect(page.getByText('网络恢复后会自动更新这里的状态').first()).toBeVisible()
  await expect(page.locator('[data-print-link="offline"]')).toBeVisible()
  expect(polls).toBeGreaterThanOrEqual(6)
  expect(errors).toEqual([])
})

test('network recovery to printing clears the offline notice, then completed opens the success page @w2', async ({ page, api }) => {
  const errors = collectPageErrors(page)
  registerShell(api)
  let mode: 'offline' | 'printing' | 'completed' = 'offline'
  api.respondWith('GET', JOB_PATH, async () => {
    if (mode === 'offline') return { abort: 'internetdisconnected' }
    return { status: 200, json: { taskId: W2_ORDER.taskId, status: mode } }
  })

  await openProgress(page)
  await page.clock.runFor(6_000)
  await expect(page.getByText('网络中断，打印可能仍在进行').first()).toBeVisible()

  mode = 'printing'
  await page.clock.runFor(3_000)
  await expect(page.getByText('网络中断，打印可能仍在进行')).toHaveCount(0)
  await expect(page.locator('[data-print-link="live"]')).toBeVisible()
  await expect(page.getByText('正在出纸').first()).toBeVisible()
  await expect(page).toHaveURL(/\/print\/progress/)

  mode = 'completed'
  await page.clock.runFor(3_000)
  await expect(page).toHaveURL(/\/print\/done/)
  await expect(page.getByTestId('print-fulfill-state-completed')).toBeVisible()
  await expect(page.getByText('已在本机出纸', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('network recovery to failed is the path that opens the failure page @w2', async ({ page, api }) => {
  const errors = collectPageErrors(page)
  registerShell(api)
  let mode: 'offline' | 'failed' = 'offline'
  api.respondWith('GET', JOB_PATH, async () => {
    if (mode === 'offline') return { abort: 'internetdisconnected' }
    return {
      status: 200,
      json: {
        taskId: W2_ORDER.taskId,
        status: 'failed',
        failureReasonForUser: '打印任务未能完成，请联系现场工作人员',
      },
    }
  })

  await openProgress(page)
  await page.clock.runFor(6_000)
  await expectStillOnProgress(page)

  mode = 'failed'
  await page.clock.runFor(4_000)
  await page.clock.runFor(1_000)
  await expect(page).toHaveURL(/\/print\/done/)
  await expect(page.getByTestId('print-fulfill-state-failed')).toBeVisible()
  expect(errors).toEqual([])
})

test('more than ten minutes unread shows the unconfirmed copy and still no reprint @w2', async ({ page, api }) => {
  const errors = collectPageErrors(page)
  registerShell(api)
  api.respondWith('GET', JOB_PATH, async () => ({ abort: 'internetdisconnected' }))

  await openProgress(page)
  await page.clock.runFor(10 * 60 * 1000 + 4_000)

  await expectStillOnProgress(page)
  await expect(page.getByTestId('print-progress-unconfirmed')).toBeVisible()
  await expect(page.getByText('这台机器暂时连不上网络，没法确认这单打完了没有').first()).toBeVisible()
  await expect(page.locator('[data-print-link="unconfirmed"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新打印' })).toHaveCount(0)
  expect(errors).toEqual([])
})
