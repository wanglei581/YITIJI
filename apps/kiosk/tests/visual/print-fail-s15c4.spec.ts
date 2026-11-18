import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { setReactRouterState, W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

const PRINTER_STATUS_PATH = '/api/v1/terminals/KSK-001/printer-status'

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
}

const flowState = {
  file: W2_FILE,
  params: W2_PRINT_PARAMS,
  source: 'document',
  ...W2_ORDER,
  amountCents: 0,
}

function registerFailedJam(api: ApiRouter): void {
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'failed',
      errorCode: 'PRINTER_ERROR',
      failureReasonForUser: '打印机可能卡纸或发生设备故障，当前暂时无法继续使用。',
    },
  })
  api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.taskId}/takeaway-url`, {
    status: 200,
    json: {
      signedUrl: '/api/v1/files/signed/takeaway-demo',
      expiresAt: '2099-01-01T00:00:00.000Z',
      filename: W2_FILE.name,
      mimeType: 'application/pdf',
      sizeBytes: 128,
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      payStatus: 'paid',
      amountCents: 0,
      canRetry: false,
    },
  })
}

function registerPrinterStatus(api: ApiRouter, current: { value: string }): void {
  api.respondWith('GET', PRINTER_STATUS_PATH, () => ({
    status: 200,
    json: { printerStatus: current.value, paperLevel: 'sufficient', isOnline: true },
  }))
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.S15C4_SBS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: `${dir}/${name}.png` })
  const scrolls = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.qxt-body, .qx-scroll')]
    return nodes.some((el) => el.scrollHeight > el.clientHeight + 1)
  })
  const notePath = `${dir}/scroll.json`
  const current = existsSync(notePath) ? JSON.parse(readFileSync(notePath, 'utf8')) as Record<string, boolean> : {}
  current[name] = scrolls
  writeFileSync(notePath, JSON.stringify(current, null, 2))
}

async function openFailedJam(page: Page): Promise<void> {
  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', flowState)
  await expect(page.locator('[data-testid="print-fulfill-state-paper-jam"]')).toBeVisible()
}

async function advancePrinterPoll(page: Page): Promise<void> {
  const seen = page.waitForResponse((res) => res.url().includes(PRINTER_STATUS_PATH) && res.request().method() === 'GET' && res.ok())
  await page.clock.runFor(21_000)
  await seen
}

test('confirmed paper jam keeps the title after the printer reports ready @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await page.clock.install({ time: new Date('2026-11-19T08:00:00+08:00') })
  registerShell(api)
  registerFailedJam(api)
  const printer = { value: 'paper_jam' }
  registerPrinterStatus(api, printer)

  await openFailedJam(page)
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveText('打印机卡纸')
  await expect(page.getByText('可能卡纸')).toHaveCount(0)
  await expect(page.getByText('打印机卡纸，当前无法打印。')).toBeVisible()
  await shot(page, '真卡纸')

  printer.value = 'ready'
  await advancePrinterPoll(page)
  await expect(heading).toHaveText('打印机卡纸')
  await expect(page.getByText('可能卡纸')).toHaveCount(0)
  await expect(page.getByText('工作人员')).toHaveCount(0)
  await shot(page, '真卡纸-确认后仍保持')
})

test('a fault that was never paper jam stays the unconfirmed title after the printer is ready @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await page.clock.install({ time: new Date('2026-11-19T08:00:00+08:00') })
  registerShell(api)
  registerFailedJam(api)
  const printer = { value: 'error' }
  registerPrinterStatus(api, printer)

  await openFailedJam(page)
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveText('打印机出了故障（可能卡纸）')
  await expect(page.getByText('打印机可能卡纸或发生设备故障，当前暂时无法继续使用。')).toBeVisible()

  printer.value = 'ready'
  await advancePrinterPoll(page)
  await expect(heading).toHaveText('打印机出了故障（可能卡纸）')
  await expect(page.getByRole('heading', { level: 1, name: '打印机卡纸', exact: true })).toHaveCount(0)
  await expect(page.getByText('工作人员')).toHaveCount(0)
})

test('out-of-paper takeaway expiry does not add a second service phone @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await page.clock.install({ time: new Date('2026-11-19T08:00:00+08:00') })
  registerShell(api)
  api.respondWith('GET', PRINTER_STATUS_PATH, () => ({
    status: 200,
    json: { printerStatus: 'paper_empty', paperLevel: 'empty', isOnline: true },
  }))
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'failed',
      errorCode: 'PAPER_EMPTY',
      failureReasonForUser: '打印机缺纸，当前无法打印。',
    },
  })
  api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.taskId}/takeaway-url`, {
    status: 200,
    json: {
      signedUrl: '/api/v1/files/signed/takeaway-demo',
      expiresAt: '2026-11-19T08:00:03+08:00',
      filename: W2_FILE.name,
      mimeType: 'application/pdf',
      sizeBytes: 128,
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      payStatus: 'paid',
      amountCents: 0,
      canRetry: true,
    },
  })

  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', flowState)
  const paper = page.locator('[data-testid="print-fulfill-state-out-of-paper"]')
  await expect(paper).toBeVisible()
  await expect(paper.getByText('文件带走')).toBeVisible()
  await expect(paper.getByRole('button', { name: '重新提交打印' })).toBeVisible()
  const phoneHits = () => paper.evaluate((el) => (el.innerText.match(/服务电话/g) ?? []).length)
  expect(await phoneHits()).toBe(1)

  await page.clock.runFor(4_000)
  await expect(paper.getByText('手机带走链接已过期，不影响这笔订单。')).toBeVisible()
  await expect(paper.getByText('文件带走')).toHaveCount(0)
  expect(await phoneHits()).toBe(1)
  await expect(paper.getByText('工作人员')).toHaveCount(0)
})

function registerMemberLogin(api: ApiRouter): void {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: {
      success: true,
      data: { token: 's15c4-member-token', user: { id: 'member-s15c4', phoneMasked: '138****8000', nickname: '打印会员' } },
    },
  })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [] } })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

const PENDING_ROW = {
  kind: 'cloud_single',
  orderId: 'ord-pending-1',
  title: '简历.pdf',
  itemCount: 1,
  claimableHere: true,
  createdAt: '2026-11-19T06:20:00.000Z',
  billablePages: 2,
  terminal: { displayName: 'KSK-001', locationLabel: '就业服务大厅' },
}

function timelineOf(items: unknown[]): { status: number; json: unknown } {
  return { status: 200, json: { success: true, data: { items, nextCursor: null, total: items.length } } }
}

function ordersOf(items: unknown[]): { status: number; json: unknown } {
  return { status: 200, json: { success: true, data: { items, nextCursor: null, total: items.length } } }
}

function oneOrder(id: string, fileName: string): Record<string, unknown> {
  return {
    id,
    status: 'completed',
    fileName,
    createdAt: '2026-11-18T02:40:00.000Z',
    completedAt: '2026-11-18T02:40:00.000Z',
    copies: 1,
    colorMode: 'black_white',
    duplex: 'simplex',
    paperSize: 'A4',
    amountCents: 0,
    payStatus: 'paid',
    paymentSource: 'free',
    billablePages: 1,
    discountCents: 0,
    refundedAmountCents: 0,
  }
}

async function exitCardGeometry(page: Page): Promise<Array<{ x: number; h: number }>> {
  const cards = page.locator('.me-orders-exits .me-exit')
  await expect(cards).toHaveCount(2)
  return cards.evaluateAll((nodes) => nodes.map((card) => {
    const title = card.querySelector('b')
    if (!title) throw new Error('出路卡没有标题')
    const cardBox = card.getBoundingClientRect()
    const titleBox = title.getBoundingClientRect()
    return { x: titleBox.x, h: cardBox.height }
  }))
}

function expectCardsAligned(boxes: Array<{ x: number; h: number }>, name: string): void {
  expect(Math.abs(boxes[0].x - boxes[1].x)).toBeLessThanOrEqual(4)
  expect(Math.abs(boxes[0].h - boxes[1].h)).toBeLessThanOrEqual(4)
  const dir = process.env.S15C4_SBS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const notePath = `${dir}/geometry.json`
  const current = existsSync(notePath) ? JSON.parse(readFileSync(notePath, 'utf8')) as Record<string, unknown> : {}
  current[name] = {
    x: boxes.map((box) => box.x),
    h: boxes.map((box) => box.h),
    dx: Math.abs(boxes[0].x - boxes[1].x),
    dh: Math.abs(boxes[0].h - boxes[1].h),
  }
  writeFileSync(notePath, JSON.stringify(current, null, 2))
}

test('print order exit cards share title inset and height across the four states @w2', async ({ page, api }) => {
  test.setTimeout(90_000)
  registerShell(api)
  registerMemberLogin(api)
  registerPrinterStatus(api, { value: 'ready' })
  api.respond('GET', '/api/v1/me/print-orders', ordersOf([]))
  api.respond('GET', '/api/v1/me/print-orders/timeline', timelineOf([PENDING_ROW]))

  await loginThroughVisibleUi(page, '/me/print-orders')
  await expect(page.getByTestId('pending-pickup-exits')).toBeVisible()
  expectCardsAligned(await exitCardGeometry(page), '有待取单-无任务')
  await expect(page.getByText('工作人员')).toHaveCount(0)
  await shot(page, '有待取单-无任务')

  api.respond('GET', '/api/v1/me/print-orders/timeline', timelineOf([{
    ...PENDING_ROW,
    claimableHere: false,
    terminal: { displayName: 'KSK-001', locationLabel: '就业服务大厅' },
  }]))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('去哪台取')).toBeVisible()
  expectCardsAligned(await exitCardGeometry(page), '走错机器')
  await shot(page, '走错机器')

  api.respond('GET', '/api/v1/me/print-orders', ordersOf([oneOrder('order-1', '求职简历.pdf')]))
  api.respond('GET', '/api/v1/me/print-orders/timeline', timelineOf([]))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('求职简历.pdf')).toBeVisible()
  expectCardsAligned(await exitCardGeometry(page), '有任务')
  await shot(page, '有任务')

  api.respond('GET', '/api/v1/me/print-orders', ordersOf([
    oneOrder('order-1', '求职简历.pdf'),
    oneOrder('order-2', '作品集.pdf'),
    oneOrder('order-3', '成绩单.pdf'),
  ]))
  api.respond('GET', '/api/v1/me/print-orders/timeline', { status: 500, json: { error: { code: 'INTERNAL', message: 'boom' } } })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('pending-pickup-error')).toBeVisible()
  expectCardsAligned(await exitCardGeometry(page), '读失败')
  await expect(page.getByText('工作人员')).toHaveCount(0)
  await shot(page, '读失败')
})

test('failure screens keep one service phone and can be shot for the blank-band check @w2', async ({ page, api }) => {
  test.setTimeout(120_000)
  const scenes: Array<{
    name: string
    errorCode: 'PAPER_EMPTY' | 'PRINTER_ERROR' | 'PRINTER_OFFLINE'
    reason: string
    amountCents: number
    canRetry: boolean
    printerStatus: string
    testId: string
  }> = [
    { name: '缺纸', errorCode: 'PAPER_EMPTY', reason: '打印机缺纸，当前无法打印。', amountCents: 200, canRetry: false, printerStatus: 'paper_empty', testId: 'print-fulfill-state-out-of-paper' },
    { name: '离线', errorCode: 'PRINTER_OFFLINE', reason: '打印机离线，当前无法打印。', amountCents: 200, canRetry: false, printerStatus: 'offline', testId: 'print-fulfill-state-offline' },
    { name: '卡纸免费', errorCode: 'PRINTER_ERROR', reason: '打印机可能卡纸或发生设备故障，当前暂时无法继续使用。', amountCents: 0, canRetry: false, printerStatus: 'error', testId: 'print-fulfill-state-paper-jam' },
    { name: '卡纸已付', errorCode: 'PRINTER_ERROR', reason: '打印机可能卡纸或发生设备故障，当前暂时无法继续使用。', amountCents: 200, canRetry: false, printerStatus: 'error', testId: 'print-fulfill-state-paper-jam' },
    { name: '缺纸-能重新提交', errorCode: 'PAPER_EMPTY', reason: '打印机缺纸，当前无法打印。', amountCents: 0, canRetry: true, printerStatus: 'paper_empty', testId: 'print-fulfill-state-out-of-paper' },
    { name: '卡纸-能重新提交', errorCode: 'PRINTER_ERROR', reason: '打印机可能卡纸或发生设备故障，当前暂时无法继续使用。', amountCents: 0, canRetry: true, printerStatus: 'error', testId: 'print-fulfill-state-paper-jam' },
    { name: '离线-能重新提交', errorCode: 'PRINTER_OFFLINE', reason: '打印机离线，当前无法打印。', amountCents: 0, canRetry: true, printerStatus: 'offline', testId: 'print-fulfill-state-offline' },
  ]

  for (const scene of scenes) {
    registerShell(api)
    registerPrinterStatus(api, { value: scene.printerStatus })
    api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
      status: 200,
      json: {
        taskId: W2_ORDER.taskId,
        status: 'failed',
        errorCode: scene.errorCode,
        failureReasonForUser: scene.reason,
      },
    })
    api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.taskId}/takeaway-url`, {
      status: 200,
      json: {
        signedUrl: '/api/v1/files/signed/takeaway-demo',
        expiresAt: '2099-01-01T00:00:00.000Z',
        filename: W2_FILE.name,
        mimeType: 'application/pdf',
        sizeBytes: 128,
        orderId: W2_ORDER.orderId,
        orderNo: W2_ORDER.orderNo,
        payStatus: 'paid',
        amountCents: scene.amountCents,
        canRetry: scene.canRetry,
      },
    })
    await page.goto('/print/done')
    await setReactRouterState(page, '/print/done', { ...flowState, amountCents: scene.amountCents })
    const root = page.locator(`[data-testid="${scene.testId}"]`)
    await expect(root).toBeVisible()
    await expect(root.getByText('文件带走')).toBeVisible()
    const phones = await root.evaluate((el) => (el.innerText.match(/服务电话/g) ?? []).length)
    expect(phones).toBe(1)
    const step3 = root.locator('ol li').nth(2)
    await expect(step3).toContainText('服务电话')
    if (scene.canRetry) {
      await expect(root.getByRole('button', { name: '重新提交打印' })).toBeVisible()
      await expect(step3).toContainText('重新提交打印')
    }
    await expect(page.getByText('工作人员')).toHaveCount(0)
    await shot(page, scene.name)
  }
})
