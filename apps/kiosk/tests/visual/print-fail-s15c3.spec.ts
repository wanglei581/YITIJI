import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { setReactRouterState, W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
}

const flowState = {
  file: W2_FILE,
  params: W2_PRINT_PARAMS,
  source: 'document',
  ...W2_ORDER,
}

const FREE_JAM_PILL = '打印机出了故障（可能卡纸）'

async function lineCount(locator: ReturnType<Page['locator']>): Promise<number> {
  return locator.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getClientRects().length
  })
}

test('free paper-jam header keeps brand and clock on one line while the long pill stays whole @w2', async ({ page, api }) => {
  registerShell(api)
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

  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', { ...flowState, amountCents: 0 })
  await expect(page.locator('[data-testid="print-fulfill-state-paper-jam"]')).toBeVisible()

  const brand = page.locator('[data-qx-page="print-done"] .qxt-brand b')
  await expect(brand).toHaveText('职易达')
  expect(await lineCount(brand)).toBe(1)
  const brandBox = await brand.evaluate((el) => {
    const box = el.getBoundingClientRect()
    return {
      height: box.height,
      width: box.width,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      fontSize: getComputedStyle(el).fontSize,
    }
  })
  expect(brandBox.height).toBeLessThan(40)
  expect(brandBox.width).toBeGreaterThanOrEqual(72)
  expect(brandBox.scrollWidth).toBeLessThanOrEqual(brandBox.clientWidth + 1)
  expect(brandBox.fontSize).toBe('28px')

  const date = page.locator('[data-qx-page="print-done"] .qxt-clock small')
  const dateText = (await date.innerText()).replace(/\s+/g, ' ').trim()
  expect(dateText).toMatch(/^\d+月\d+日 周.$/)
  expect(await lineCount(date)).toBe(1)
  const dateBox = await date.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    whiteSpace: getComputedStyle(el).whiteSpace,
  }))
  expect(dateBox.whiteSpace).toBe('nowrap')
  expect(dateBox.scrollWidth).toBeLessThanOrEqual(dateBox.clientWidth + 1)

  const pill = page.locator('[data-qx-page="print-done"] .qxt-status')
  await expect(pill).toContainText(FREE_JAM_PILL)
  const pillFit = await pill.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }))
  expect(pillFit.scrollWidth).toBeLessThanOrEqual(pillFit.clientWidth + 1)
  expect(pillFit.scrollHeight).toBeLessThanOrEqual(pillFit.clientHeight + 1)
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
      data: { token: 's15c3-member-token', user: { id: 'member-s15c3', phoneMasked: '138****8000', nickname: '打印会员' } },
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

test('pending pickup without a print task opens my documents instead of a second claim entry @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: {
      success: true,
      data: {
        servicePhone: '18369161921',
        serviceHours: '工作日 9:00–18:00',
        otherOnlineTerminalNearby: false,
        miniappPublished: true,
      },
    },
  })
  api.respond('GET', '/api/v1/me/print-orders', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  api.respond('GET', '/api/v1/me/print-orders/timeline', {
    status: 200,
    json: {
      success: true,
      data: {
        items: [{
          kind: 'cloud_single',
          orderId: 'ord-pending-1',
          title: '简历.pdf',
          itemCount: 1,
          claimableHere: true,
          createdAt: '2026-11-19T06:20:00.000Z',
          billablePages: 2,
          terminal: { displayName: 'KSK-001', locationLabel: '就业服务大厅' },
        }],
        nextCursor: null,
        total: 1,
      },
    },
  })
  api.respond('GET', '/api/v1/me/documents', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  api.respond('GET', '/api/v1/me/documents/deleted', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })

  await loginThroughVisibleUi(page, '/me/print-orders')
  await expect(page.getByTestId('pending-pickup-list')).toBeVisible()
  await expect(page.getByText('还没有归入账号的打印任务')).toBeVisible()
  await expect(page.getByText('进度和到机码')).toHaveCount(0)
  await expect(page.getByText('手机上下的到店单，到机器上输到机码取件')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '输到机码取件' })).toHaveCount(0)
  const docs = page.getByRole('button', { name: '去我的文档，从已保存的文件里再选一份' })
  await expect(docs).toBeVisible()
  await docs.click()
  await page.waitForURL('**/me/documents')
})

test('paper-jam takeaway HTTP 500 keeps the order line and does not ask to retry later @w2', async ({ page, api }) => {
  registerShell(api)
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
    status: 500,
    json: { error: { code: 'INTERNAL', message: 'boom' } },
  })

  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', { ...flowState, amountCents: 0 })
  const jam = page.locator('[data-testid="print-fulfill-state-paper-jam"]')
  await expect(jam).toBeVisible()
  const status = jam.getByRole('status')
  await expect(status).toContainText('手机带走链接这次没取到，不影响这笔订单')
  await expect(jam).not.toContainText('请稍后重试')
  await expect(jam).not.toContainText('服务暂时不可用')
  await expect(jam).toContainText('服务电话')
  const phoneHits = await jam.evaluate((el) => (el.innerText.match(/服务电话/g) ?? []).length)
  expect(phoneHits).toBe(1)
})
