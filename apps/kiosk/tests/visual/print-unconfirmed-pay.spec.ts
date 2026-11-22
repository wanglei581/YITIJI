import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { setReactRouterState, W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

const JOB_PATH = `/api/v1/print/jobs/${W2_ORDER.taskId}`

const REFUND_TITLE = '核查之后才退'
const REFUND_DESC = '核查确认没出纸后，钱自动退回原付款账户，到账时间以支付渠道为准。'

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: {
      success: true,
      data: {
        servicePhone: '183-6916-1921',
        serviceHours: '工作日 9:00–18:00',
        otherOnlineTerminalNearby: false,
        miniappPublished: true,
      },
    },
  })
}

function registerUnconfirmedJob(
  api: ApiRouter,
  amountCents: number,
  payStatus: 'paid' | 'unpaid' = 'paid',
): void {
  api.respond('GET', JOB_PATH, {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'failed',
      errorCode: 'PRINT_JOB_UNCONFIRMED',
      failureReasonForUser: '打印作业已提交到打印队列，但未确认完成。请先看纸张、卡纸和出纸口。',
    },
  })
  api.respond('POST', `${JOB_PATH}/takeaway-url`, {
    status: 200,
    json: {
      signedUrl: '/api/v1/files/signed/takeaway-demo',
      expiresAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
      filename: W2_FILE.name,
      mimeType: 'application/pdf',
      sizeBytes: 128,
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      payStatus,
      amountCents,
      canRetry: false,
    },
  })
}

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
      data: { token: 'p2e6-member-token', user: { id: 'member-p2e6', phoneMasked: '138****8000', nickname: '打印会员' } },
    },
  })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [] } })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/print-orders', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
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

async function softNavigate(page: Page, path: string, usr: unknown): Promise<void> {
  await page.evaluate(
    ({ nextPath, state }) => {
      window.history.pushState({ usr: state, key: 'p2e6-unconfirmed', idx: 1 }, '', nextPath)
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    },
    { nextPath: path, state: usr },
  )
}

async function assertPaidRefundGeometry(page: Page): Promise<void> {
  const geo = await page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>('[data-qx-page="print-unconfirmed"]')
    const body = screen?.querySelector<HTMLElement>('.qxt-body')
    const root = screen?.querySelector<HTMLElement>('[data-testid="print-fulfill-state-result-unconfirmed"]')
    const fine = screen?.querySelector<HTMLElement>('[data-testid="print-fulfill-fallback"]')
    const bar = screen?.querySelector<HTMLElement>('[data-testid="print-unconfirmed-refund-bar"]')
    const dock = screen?.querySelector<HTMLElement>('.qxt-dock')
    if (!screen || !body || !root || !fine || !bar || !dock) {
      throw new Error('缺少未确认态关键节点')
    }
    const barTitle = bar.querySelector('b')
    const barDesc = bar.querySelector('span')
    const barBox = bar.getBoundingClientRect()
    const fineBox = fine.getBoundingClientRect()
    const dockBox = dock.getBoundingClientRect()
    const bodyBox = body.getBoundingClientRect()
    const screenBox = screen.getBoundingClientRect()
    let clipBottom = Number.POSITIVE_INFINITY
    for (let el: HTMLElement | null = root; el; el = el.parentElement) {
      const style = getComputedStyle(el)
      if (style.overflowY !== 'visible') {
        clipBottom = Math.min(clipBottom, el.getBoundingClientRect().bottom - parseFloat(style.borderBottomWidth || '0'))
      }
    }
    return {
      screenOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflowX: body.scrollWidth - body.clientWidth,
      bodyOverflowY: body.scrollHeight - body.clientHeight,
      rootOverflowY: root.scrollHeight - root.clientHeight,
      barLeft: barBox.left,
      barRight: barBox.right,
      barTop: barBox.top,
      barBottom: barBox.bottom,
      fineBottom: fineBox.bottom,
      dockTop: dockBox.top,
      bodyLeft: bodyBox.left,
      bodyRight: bodyBox.right,
      screenWidth: screenBox.width,
      screenHeight: screenBox.height,
      clipBottom,
      titleFontSize: barTitle ? parseFloat(getComputedStyle(barTitle).fontSize) : 0,
      descFontSize: barDesc ? parseFloat(getComputedStyle(barDesc).fontSize) : 0,
    }
  })

  expect(geo.screenOverflowX, '整页不得横向溢出').toBeLessThanOrEqual(1)
  expect(geo.bodyOverflowX, '正文不得横向溢出').toBeLessThanOrEqual(1)
  expect(geo.bodyOverflowY, '正文在 1080x1920 下不得纵向裁切').toBeLessThanOrEqual(1)
  expect(geo.rootOverflowY, '内容容器不得纵向裁切').toBeLessThanOrEqual(1)
  expect(geo.barTop, '提示条紧跟小字之后且不重叠').toBeGreaterThanOrEqual(geo.fineBottom - 1)
  expect(geo.barBottom, '提示条下沿不得越过滚动裁剪下沿').toBeLessThanOrEqual(geo.clipBottom + 1)
  expect(geo.barBottom, '提示条不得被底栏遮挡').toBeLessThanOrEqual(geo.dockTop + 1)
  expect(geo.barLeft, '提示条左沿不得越出视口').toBeGreaterThanOrEqual(geo.bodyLeft - 1)
  expect(geo.barRight, '提示条右沿不得越出视口').toBeLessThanOrEqual(geo.bodyRight + 1)
  expect(geo.titleFontSize, '标题字号符合触屏稿 26px').toBe(26)
  expect(geo.descFontSize, '正文字号符合触屏稿 20px').toBe(20)
}

test('paid unconfirmed print shows the verify-before-refund bar with clean copy and zero overflow @w2', async ({ page, api }) => {
  registerShell(api)
  registerUnconfirmedJob(api, 200)

  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', {
    file: W2_FILE,
    params: W2_PRINT_PARAMS,
    source: 'document',
    ...W2_ORDER,
    amountCents: 200,
  })

  const root = page.getByTestId('print-fulfill-state-result-unconfirmed')
  await expect(root).toBeVisible()

  const bar = page.getByTestId('print-unconfirmed-refund-bar')
  await expect(bar).toBeVisible()
  await expect(bar.locator('b')).toHaveText(REFUND_TITLE)
  await expect(bar.locator('span')).toHaveText(REFUND_DESC)

  const pageText = await page.locator('body').innerText()
  expect(pageText).not.toContain('¥')
  expect(pageText).not.toContain('￥')
  expect(pageText).not.toContain('工作人员')

  await assertPaidRefundGeometry(page)
})

test('logged-in paid unconfirmed print keeps orders row and verify-before-refund bar above dock without clipping @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  registerShell(api)
  registerMemberLogin(api)
  registerUnconfirmedJob(api, 200)

  await loginThroughVisibleUi(page, '/me/print-orders')
  await softNavigate(page, '/print/done', {
    file: W2_FILE,
    params: W2_PRINT_PARAMS,
    source: 'document',
    ...W2_ORDER,
    amountCents: 200,
  })

  const root = page.getByTestId('print-fulfill-state-result-unconfirmed')
  await expect(root).toBeVisible()
  await expect(root.getByRole('button', { name: '查看打印订单' })).toBeVisible()

  const bar = page.getByTestId('print-unconfirmed-refund-bar')
  await expect(bar).toBeVisible()
  await expect(bar.locator('b')).toHaveText(REFUND_TITLE)
  await expect(bar.locator('span')).toHaveText(REFUND_DESC)

  const pageText = await page.locator('body').innerText()
  expect(pageText).not.toContain('¥')
  expect(pageText).not.toContain('￥')
  expect(pageText).not.toContain('工作人员')

  await assertPaidRefundGeometry(page)
})

test('free and unknown-amount unconfirmed prints never render the refund bar @w2', async ({ page, api }) => {
  registerShell(api)
  registerUnconfirmedJob(api, 0)

  const cases: ReadonlyArray<{ label: string; state: Record<string, unknown> }> = [
    {
      label: 'free amountCents=0',
      state: {
        file: W2_FILE,
        params: W2_PRINT_PARAMS,
        source: 'document',
        ...W2_ORDER,
        amountCents: 0,
      },
    },
    {
      label: 'unknown omitted amountCents',
      state: {
        file: W2_FILE,
        params: W2_PRINT_PARAMS,
        source: 'document',
        orderId: W2_ORDER.orderId,
        orderNo: W2_ORDER.orderNo,
        paymentSessionToken: W2_ORDER.paymentSessionToken,
        taskId: W2_ORDER.taskId,
      },
    },
    {
      label: 'unknown null amountCents',
      state: {
        file: W2_FILE,
        params: W2_PRINT_PARAMS,
        source: 'document',
        ...W2_ORDER,
        amountCents: null,
      },
    },
  ]

  for (const item of cases) {
    await page.goto('/print/done')
    await setReactRouterState(page, '/print/done', item.state)
    await expect(page.getByTestId('print-fulfill-state-result-unconfirmed'), item.label).toBeVisible()
    await expect(page.getByTestId('print-unconfirmed-refund-bar'), item.label).toHaveCount(0)
    const pageText = await page.locator('body').innerText()
    expect(pageText, item.label).not.toContain(REFUND_TITLE)
    expect(pageText, item.label).not.toContain('自动退回原付款账户')
    expect(pageText, item.label).not.toContain('¥')
    expect(pageText, item.label).not.toContain('工作人员')
  }
})

test('unconfirmed print without router amountCents uses verified takeaway receipt (paid shows, free/unpaid/404 hides) @w2', async ({ page, api }) => {
  registerShell(api)
  const routeStateWithoutAmount = {
    file: W2_FILE,
    params: W2_PRINT_PARAMS,
    source: 'document',
    orderId: W2_ORDER.orderId,
    orderNo: W2_ORDER.orderNo,
    paymentSessionToken: W2_ORDER.paymentSessionToken,
    taskId: W2_ORDER.taskId,
  }

  // 1. 路由缺 amountCents，但后端取件回执确认 payStatus=paid 且 amountCents=200 → 必须渲染收费退回提示条。
  registerUnconfirmedJob(api, 200, 'paid')
  await page.goto('/print/done')
  const paidReceipt = page.waitForResponse(
    (res) => res.url().includes(`${JOB_PATH}/takeaway-url`) && res.request().method() === 'POST' && res.status() === 200,
  )
  await setReactRouterState(page, '/print/done', routeStateWithoutAmount)
  await paidReceipt
  await expect(page.getByTestId('print-fulfill-state-result-unconfirmed')).toBeVisible()
  const bar = page.getByTestId('print-unconfirmed-refund-bar')
  await expect(bar).toBeVisible()
  await expect(bar.locator('b')).toHaveText(REFUND_TITLE)
  await expect(bar.locator('span')).toHaveText(REFUND_DESC)
  const paidText = await page.locator('body').innerText()
  expect(paidText).not.toContain('¥')
  expect(paidText).not.toContain('￥')
  expect(paidText).not.toContain('工作人员')
  await assertPaidRefundGeometry(page)

  // 2. 负例：后端取件回执返回 amountCents=0（免费单），无论路由是否缺省或带脏值，均严禁渲染提示条。
  registerUnconfirmedJob(api, 0, 'paid')
  for (const [label, state] of [
    ['free receipt with omitted router amount', routeStateWithoutAmount],
    ['free receipt overrides router amount', { ...routeStateWithoutAmount, amountCents: 200 }],
  ] as const) {
    await page.goto('/print/done')
    const freeReceipt = page.waitForResponse(
      (res) => res.url().includes(`${JOB_PATH}/takeaway-url`) && res.request().method() === 'POST' && res.status() === 200,
    )
    await setReactRouterState(page, '/print/done', state)
    await freeReceipt
    await expect(page.getByTestId('print-fulfill-state-result-unconfirmed'), label).toBeVisible()
    await expect(page.getByTestId('print-unconfirmed-refund-bar'), label).toHaveCount(0)
    const bodyText = await page.locator('body').innerText()
    expect(bodyText, label).not.toContain(REFUND_TITLE)
    expect(bodyText, label).not.toContain('自动退回原付款账户')
  }

  // 3. 负例：回执非 paid（payStatus=unpaid）或取件回执 404 且路由无金额 → 严禁渲染提示条。
  registerUnconfirmedJob(api, 200, 'unpaid')
  await page.goto('/print/done')
  const unpaidReceipt = page.waitForResponse(
    (res) => res.url().includes(`${JOB_PATH}/takeaway-url`) && res.request().method() === 'POST' && res.status() === 200,
  )
  await setReactRouterState(page, '/print/done', routeStateWithoutAmount)
  await unpaidReceipt
  await expect(page.getByTestId('print-fulfill-state-result-unconfirmed')).toBeVisible()
  await expect(page.getByTestId('print-unconfirmed-refund-bar')).toHaveCount(0)

  api.respond('POST', `${JOB_PATH}/takeaway-url`, {
    status: 404,
    json: { error: { code: 'PRINT_TASK_NOT_FOUND', message: '任务不存在' } },
  })
  await page.goto('/print/done')
  const missingReceipt = page.waitForResponse(
    (res) => res.url().includes(`${JOB_PATH}/takeaway-url`) && res.request().method() === 'POST' && res.status() === 404,
  )
  await setReactRouterState(page, '/print/done', routeStateWithoutAmount)
  await missingReceipt
  await expect(page.getByTestId('print-fulfill-state-result-unconfirmed')).toBeVisible()
  await expect(page.getByTestId('print-unconfirmed-refund-bar')).toHaveCount(0)
})
