import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { setReactRouterState, W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'
import { HELP_NEEDED_LINE, containsStaffHandoff } from '../fixtures/unattended-lines'

const LATER = '2099-07-24T00:10:00.000Z'
const CASHIER_STATE = {
  ...W2_ORDER,
  source: 'document',
  priceLines: [{
    serviceKey: 'print_bw_page',
    description: '黑白打印',
    unitCents: 100,
    quantity: 2,
    subtotalCents: 200,
  }],
}

function registerShell(api: ApiRouter) {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
}

function payStatus(payStatus: string, attempt: null | Record<string, unknown> = null) {
  return {
    orderId: W2_ORDER.orderId,
    orderNo: W2_ORDER.orderNo,
    payStatus,
    paymentSource: payStatus === 'paid' ? 'wechat' : null,
    payChannel: payStatus === 'paid' ? 'wechat' : null,
    amountCents: W2_ORDER.amountCents,
    paidAt: payStatus === 'paid' ? '2026-09-07T00:00:00.000Z' : null,
    pickupCode: null,
    attempt,
  }
}

async function routeExactJson(
  page: Page,
  method: string,
  path: string,
  handler: (route: Route) => Promise<void>,
) {
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== method || new URL(route.request().url()).pathname !== path) {
      await route.fallback()
      return
    }
    await handler(route)
  })
}

test('cashier renders real channels and sends the selected channel in the pay payload @w2', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat', 'alipay'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })
  let payPayload: unknown = null
  await routeExactJson(page, 'POST', `/api/v1/orders/${W2_ORDER.orderId}/pay`, async (route) => {
    payPayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        attemptId: 'qx-alipay-attempt',
        orderId: W2_ORDER.orderId,
        orderNo: W2_ORDER.orderNo,
        channel: 'alipay',
        amountCents: W2_ORDER.amountCents,
        status: 'pending',
        qrCodeContent: 'alipay://qx-cashier-test',
        expiresAt: LATER,
        orderPayStatus: 'paying',
        orderExpiresAt: LATER,
      }),
    })
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
  await expect(page.locator('[data-qx-state="pending"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '微信支付' })).not.toHaveAttribute('data-active', 'true')
  await expect(page.getByRole('button', { name: '支付宝' })).not.toHaveAttribute('data-active', 'true')

  await page.getByRole('button', { name: '支付宝' }).click()
  await page.getByRole('button', { name: '手机扫屏幕上的码' }).click()
  await expect(page.locator('[data-qx-state="pending-qr"]')).toBeVisible()
  await expect(page.getByText('请使用支付宝扫码支付', { exact: true })).toBeVisible()
  expect(payPayload).toEqual({ channel: 'alipay' })
})

test('cashier pending-qr first screen: payment card, exit and dock labels all sit above the fold and stay whole @w2', async ({ page, api }) => {
  // 稿 cashier：通道说明行 + 方式分段 + 订单摘要（三行）+ 收款码卡（含标题与两行说明）+「退出支付」整块落在底栏之上，不靠滚动；
  // 出过码之后返回键是很长的「改参数需重新下单」，底栏三个键的字都不得被省略号截掉。
  // 「支付通道」「支付状态」「参数」在顶栏胶囊和收款码标题里已经说过，收进页底「更多订单信息」，一个事实不删。
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })
  await routeExactJson(page, 'POST', `/api/v1/orders/${W2_ORDER.orderId}/pay`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        attemptId: 'qx-wechat-attempt',
        orderId: W2_ORDER.orderId,
        orderNo: W2_ORDER.orderNo,
        channel: 'wechat',
        amountCents: W2_ORDER.amountCents,
        status: 'pending',
        qrCodeContent: 'weixin://qx-cashier-test',
        expiresAt: LATER,
        orderPayStatus: 'paying',
        orderExpiresAt: LATER,
      }),
    })
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', { ...CASHIER_STATE, file: W2_FILE, params: W2_PRINT_PARAMS })
  await expect(page.locator('[data-qx-state="channel-selected"]')).toBeVisible()
  await page.getByRole('button', { name: '手机扫屏幕上的码' }).click()
  await expect(page.locator('[data-qx-state="pending-qr"]')).toBeVisible()
  await expect(page.locator('.cashier-qr-title')).toHaveText('请使用微信支付扫码支付')

  // 订单摘要首屏只有三行：订单号、内容（文件名 · 页数 · 颜色）、应付。
  const summary = page.locator('.pct-sum')
  await expect(summary.locator('dt')).toHaveText(['订单号', '内容', '应付'])
  await expect(summary.locator('dd').nth(1)).toContainText(W2_FILE.name)
  await expect(summary.getByText('支付状态')).toHaveCount(0)
  await expect(summary.getByText('支付通道')).toHaveCount(0)
  // 折叠里的事实一个不少（展开前文字不可见，但在 DOM 里）。
  const more = page.locator('.cashier-qx-moreinfo')
  await expect(more.locator('summary')).toHaveText('更多订单信息')
  await expect(more.locator('dt')).toContainText(['参数', '份数', '支付通道', '支付状态'])
  await expect(more.locator('dd')).toContainText(['微信支付', '等待付款'])
  // 关着的折叠不占版面：Chromium 对关着的 <details> 内容只跳过绘制，仍给它一份几何，页底会冒出一行看不见的字压在屏幕下沿
  // （去掉苹方的字体栈下，「支付通道」那一行的字体内容区正好骑在 1920 线上，版式体检把它报成被裁）。关着时这些行不该有任何盒子，展开后才有。
  const rects = () => more.locator('dt').evaluateAll((rows) => rows.map((row) => row.getClientRects().length))
  expect((await rects()).every((count) => count === 0), '关着的「更多订单信息」不该给内容排版').toBe(true)
  await more.locator('summary').click()
  expect((await rects()).every((count) => count > 0), '展开后每一行都要排上版').toBe(true)
  await more.locator('summary').click()

  // 整块落在底栏之上。
  const dockTop = (await page.locator('.qxt-dock').boundingBox())!.y
  const mustSitAboveDock: Array<[string, ReturnType<typeof page.locator>]> = [
    ['通道说明行', page.locator('.pct-chline')],
    ['方式分段', page.locator('.cashier-qx-picker[data-kind="methods"]')],
    ['订单摘要', summary],
    ['收款码', page.locator('.cashier-qr-frame')],
    ['收款码标题', page.locator('.cashier-qr-title')],
    ['说明第一行', page.locator('.cashier-qr-sub')],
    ['说明第二行', page.locator('.cashier-qr-badge')],
    ['退出支付', page.locator('[data-cashier-exit]')],
  ]
  for (const [label, locator] of mustSitAboveDock) {
    const box = await locator.boundingBox()
    expect(box, `${label} 必须在页面上`).not.toBeNull()
    expect(box!.y + box!.height, `${label} 要整块落在底栏之上，不靠滚动`).toBeLessThanOrEqual(dockTop)
  }

  // 底栏三个键的字都不被省略号截掉（问小青曾被截成「问小青：这笔账看…」）。
  const clipped = await page.locator('.qxt-dock').evaluate((dock) =>
    [...dock.querySelectorAll('button, button *')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => (el.textContent ?? '').trim()),
  )
  expect(clipped, '底栏的字不得被省略号截断').toEqual([])
  await expect(page.locator('.qxt-dock').getByRole('button', { name: /改参数需重新下单/ })).toBeVisible()
  await expect(page.locator('.qxt-dock').getByRole('button', { name: /问小青/ })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('cashier-pending-qr-first-screen.png') })
})

test('channel outcome unconfirmed must say do-not-repay, never claim acceptance or plain retry @w2', async ({ page, api }) => {
  // 资金安全回归：POST /orders/:id/pay 回 503 + PAY_CHANNEL_ACCEPTANCE_UNCONFIRMED。
  // 该码含受理未知/回填失败两支，可能已扣款也可能没受理。屏上必须说结果未确认 + 请勿重复
  // 支付 + 怎么核实；落 5xx 兜底「请稍后重试」等于在可能已扣款时教用户再付一次。
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })
  await routeExactJson(page, 'POST', `/api/v1/orders/${W2_ORDER.orderId}/pay`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: {
          code: 'PAY_CHANNEL_ACCEPTANCE_UNCONFIRMED',
          message: '支付通道已受理，本地确认未完成。请勿重新支付，请联系工作人员核对渠道订单。',
        },
      }),
    })
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
  // 单通道会被服务端唯一事实直接采用，页面落在 channel-selected 而不是 pending
  // （多通道才需要用户先选通道）。
  await expect(page.locator('[data-qx-state="channel-selected"]')).toBeVisible()
  await page.getByRole('button', { name: '手机扫屏幕上的码' }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible()
  const alertText = (await alert.innerText()).replace(/\s+/g, '')
  // ① 说出请勿重复/重新支付并指向核实路径 —— 资金安全的全部要点
  expect(alertText, '结果未确认时必须明说不要再付一次').toMatch(/请勿(重复|重新)支付/)
  // 现场不安排人：核实路径 = 自查支付账单 + 标准句 1（服务电话），不叫人找现场的人。
  expect(alertText, '必须给出核实路径（自查支付账单）').toContain('支付账单')
  expect(alertText, '必须给出求助出路（标准句 1）').toMatch(new RegExp(HELP_NEEDED_LINE.source.replace(/\s/g, '')))
  expect(containsStaffHandoff(alertText), '不得叫用户去找现场的人').toBe(false)
  // ② 不得出现「请稍后重试」类措辞
  expect(alertText, '结果未确认时不得出现通用重试话术').not.toContain('请稍后重试')
  // ③ 不得断言「已受理」：本例 503 body 里正写着这句，页面照抄即红（固定文案不得漂移成透传）
  expect(alertText, '结果未知时不得声称渠道已受理/已支付').not.toMatch(/已受理|已支付/)
  // ④ 如实说出「未确认」这个状态，而不是只给动作
  expect(alertText, '必须说清支付结果尚未确认').toMatch(/未确认|无法确认|结果未知/)
  // ⑤ 整页同口径：任何位置都不得诱导重试（含通用 5xx 兜底句）
  const pageText = (await page.locator('[data-w2-page="print-cashier"]').innerText()).replace(/\s+/g, '')
  expect(pageText, '收银页任何位置都不得出现「请稍后重试」').not.toContain('请稍后重试')
})

test('cashier exposes a failed channel request and retries the real endpoint @w2', async ({ page, api }) => {
  registerShell(api)
  api.respondWith('GET', '/api/v1/payment/channels', (requestNumber: number) => requestNumber === 1
    ? { status: 503, json: { error: { code: 'CHANNELS_UNAVAILABLE', message: '支付通道服务暂不可用' } } }
    : { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
  await expect(page.locator('[data-qx-state="channel-failed"]')).toBeVisible()
  // 原先逐字钉「支付通道服务暂不可用」。文案已改成
  // 「服务暂时不可用，请稍后重试。」+ 标准句 1（服务电话）—— 更好（多给了下一步动作）。
  // 改成钉**不变量**而不是句子：必须说了不可用，且必须给出可执行的下一步。
  // 逐字钉整句会让每次文案打磨都变成一次假红，作者就会去改断言而不是看页面。
  {
    const alertText = (await page.getByRole('alert').innerText()).replace(/\s+/g, '')
    expect(alertText, '通道拉取失败时必须明说不可用').toMatch(/不可用|失败/)
    expect(alertText, '必须给出可执行的下一步，而不是只报故障').toMatch(/重试|稍后|服务电话|隐私政策/)
    expect(containsStaffHandoff(alertText), '不得叫用户去找现场的人').toBe(false)
  }
  await page.getByRole('button', { name: '重新读取支付通道' }).click()
  await expect(page.locator('[data-qx-state="channel-selected"]')).toBeVisible()
  expect(api.requestCount('GET', '/api/v1/payment/channels')).toBe(2)
})

test('code-pay success cannot release print before pay-status reaches paid @w2', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respondWith('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, (requestNumber: number) => requestNumber === 1
    ? { status: 200, json: payStatus('unpaid') }
    : { status: 200, json: payStatus('paying', {
        attemptId: 'qx-code-attempt', channel: 'wechat', status: 'pending', qrCodeContent: null, expiresAt: null,
      }) })
  // 付款码链路现在多一步**对账**（先 reconcile 再决定能否放行），
  // 这是付款安全上的加强，不是回归。缺这条 mock 时 ApiRouter 会以
  // 「Unhandled API requests: POST /api/v1/orders/:id/pay/reconcile」失败。
  api.respond('POST', `/api/v1/orders/${W2_ORDER.orderId}/pay/reconcile`, {
    status: 200,
    json: { success: true, data: { status: 'pending' } },
  })
  let codePayPayload: unknown = null
  let releaseRequests = 0
  await routeExactJson(page, 'POST', `/api/v1/orders/${W2_ORDER.orderId}/code-pay`, async (route) => {
    codePayPayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ attemptId: 'qx-code-attempt', status: 'success' }),
    })
  })
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1/print/jobs/${W2_ORDER.orderId}/release`) {
      releaseRequests += 1
    }
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', { ...CASHIER_STATE, taskId: undefined })
  // 按钮文案已从「出示手机付款码」改成「扫付款码 / 出示你的付款码」。
  // 用正则匹配可见文案，不逐字钉整块（那块是两行文案拼的）。
  await page.getByRole('button', { name: /出示你的付款码/ }).click()
  await page.getByLabel('付款码输入区（内容不显示）').pressSequentially('123456789012345678')

  await expect(page.locator('[data-qx-state="awaiting-code-confirmation"]')).toBeVisible()
  await expect(page).toHaveURL(/\/print\/cashier$/)
  expect(codePayPayload).toEqual({ channel: 'wechat', authCode: '123456789012345678' })
  expect(releaseRequests).toBe(0)
})

test('cashier keeps a server terminal state visible when channel loading fails @w2', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', {
    status: 503,
    json: { error: { code: 'CHANNELS_UNAVAILABLE', message: '支付通道服务暂不可用' } },
  })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, {
    status: 200,
    json: payStatus('refunded', {
      attemptId: 'qx-refunded-attempt', channel: 'wechat', status: 'success', qrCodeContent: null, expiresAt: null,
    }),
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
  await expect(page.locator('[data-qx-state="refunded"]')).toBeVisible()
  await expect(page.getByText('这一单已经退款', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始打印' })).toHaveCount(0)
})

test('cashier 1080x1920 controls satisfy scaled hit targets and dispatch pointer events @w2', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat', 'alipay'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
  await expect(page.locator('[data-qx-state="pending"]')).toBeVisible()
  // 原先写的是 toHaveCount(6)。那个 6 是在**「退出支付」还缺失时**数出来的 ——
  // 等于把一个缺陷写成了期望值；后来按钮补回来（人工走查发现的），本该当场变红，
  // 可这个 spec 那时哪个 playwright config 都没匹配到，一条都没跑过。
  //
  // 改成钉**必须存在的出口**：数量可以随产品增减，「能选通道」和「能退出去」不能少。
  for (const required of ['微信支付', '支付宝', '返回确认页', '退出支付']) {
    await expect(
      page.getByRole('button', { name: required }),
      `收银台必须保留「${required}」—— 少了它用户会被困在付款页`,
    ).toHaveCount(1)
  }
  await page.getByRole('button', { name: '微信支付' }).click()
  await expect(page.locator('[data-qx-state="channel-selected"]')).toBeVisible()

  const measurements = await page.locator('.cashier-qx-route').evaluate((routeRoot) => {
    const stage = routeRoot.closest<HTMLElement>('[data-kiosk-stage]') ?? routeRoot.closest<HTMLElement>('.kiosk-stage')
    const stageRect = stage?.getBoundingClientRect() ?? routeRoot.getBoundingClientRect()
    const scale = stageRect.width / 1080 || 1
    const controls = [...routeRoot.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')]
    return controls.map((control) => {
      const rect = control.getBoundingClientRect()
      // 角点必须落在**圆角之内**。原先固定 inset = 2px，而按钮 border-radius 是 8px ——
      // 距角 2px 的点在圆角外面，elementFromPoint 必然返回父容器
      // （实测 blocker 是 .cashier-qx-picker-options 与 .qx-ctabar，都是按钮自己的父元素，
      //  不是任何遮挡层）。于是这条断言恒假：它测的是圆角，不是可触达性。
      // 按半径取内缩，探点才真正落在控件上。
      const radius = Number.parseFloat(getComputedStyle(control).borderTopLeftRadius) || 0
      const inset = Math.min(Math.max(2, radius), rect.width / 4, rect.height / 4)
      const points = [
        [rect.left + inset, rect.top + inset],
        [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset],
        [rect.right - inset, rect.bottom - inset],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
      ] as const
      const hits = points.map(([x, y]) => document.elementFromPoint(x, y))
      let pointerEvents = 0
      const onPointerDown = () => { pointerEvents += 1 }
      control.addEventListener('pointerdown', onPointerDown)
      for (const hit of hits) hit?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      control.removeEventListener('pointerdown', onPointerDown)
      return {
        label: control.innerText.trim(),
        cssWidth: rect.width / scale,
        cssHeight: rect.height / scale,
        allPointsHit: hits.every((hit) => hit === control || Boolean(hit && control.contains(hit))),
        pointerEvents,
      }
    })
  })
  // 原先写死 5。收银台补回「退出支付」后变成 6 —— 又一个把当时状态当期望的魔法数字。
  // 改成钉「每一个可点控件都要满足触控要求」，数量交给上面按名字的存在性断言去管。
  expect(measurements.length, '收银台必须至少有通道选择 + 两个出口').toBeGreaterThanOrEqual(4)
  for (const control of measurements) {
    expect(control.cssWidth, `${control.label} width`).toBeGreaterThanOrEqual(48)
    expect(control.cssHeight, `${control.label} height`).toBeGreaterThanOrEqual(48)
    expect(control.allPointsHit, `${control.label} full target hit`).toBe(true)
    expect(control.pointerEvents, `${control.label} pointer dispatch`).toBe(5)
  }

  await page.screenshot({ path: '../../test-results/cashier-qx/runtime-channel-selected-1080x1920.png', fullPage: true })
})

test('cashier keeps channel, scan method and exit reachable at 390x844 @w2', async ({ page, api }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat', 'alipay'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
  await expect(page.locator('[data-qx-state="pending"]')).toBeVisible()
  await page.getByRole('button', { name: '微信支付' }).click()
  await expect(page.locator('[data-qx-state="channel-selected"]')).toBeVisible()
  for (const name of ['手机扫屏幕上的码', '出示你的付款码', '退出支付']) {
    const button = page.getByRole('button', { name: new RegExp(name) })
    await button.scrollIntoViewIfNeeded()
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box, `${name} must have a hit area`).not.toBeNull()
    expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44)
    expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44)
  }
  expect(await page.locator('.cashier-qx-route').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: '../../test-results/cashier-qx/runtime-channel-selected-390x844.png', fullPage: true })
})

/** 金额卡里每个带字的元素：字色叠在它实际落在的底色上的对比度（字色带透明度时先按底色合成）。 */
async function amountCardContrast(page: Page) {
  return page.locator('.cashier-qx-amount').evaluate((card) => {
    const channels = (css: string): [number, number, number, number] => {
      const body = css.slice(css.indexOf('(') + 1, css.lastIndexOf(')')).replace('/', ' ')
      const nums = body.split(/[\s,]+/).filter((token) => /^[-+.\d]/.test(token)).map(Number)
      // color(srgb 0.9 0.9 0.9 / 0.58) 的分量是 0-1；rgb(…) / rgba(…) 的分量是 0-255。
      const unit = css.startsWith('color(') ? 255 : 1
      return [nums[0] * unit, nums[1] * unit, nums[2] * unit, nums.length > 3 ? nums[3] : 1]
    }
    const over = (fg: number[], bg: number[]): [number, number, number] => {
      const a = fg[3]
      return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)]
    }
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const backdrop = (el: Element): number[] => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const bg = channels(getComputedStyle(node).backgroundColor)
        if (bg[3] > 0) return [bg[0], bg[1], bg[2], 1]
      }
      return [255, 255, 255, 1]
    }
    const rows: Array<{ text: string; selector: string; ratio: number }> = []
    for (const el of [card, ...Array.from(card.querySelectorAll<HTMLElement>('*'))]) {
      const own = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim())
      if (!own) continue
      const fg = channels(getComputedStyle(el).color)
      const bg = backdrop(el)
      const mixed = over(fg, bg)
      const hi = Math.max(lum(mixed), lum(bg))
      const lo = Math.min(lum(mixed), lum(bg))
      rows.push({ text: (el.textContent ?? '').trim().slice(0, 16), selector: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`, ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 })
    }
    return rows
  })
}

test('cashier amount card: label, amount, note and ledger are readable on the card background @w2', async ({ page, api }) => {
  // 触屏版把金额卡改成浅底（--qxt-teal-wash），可「本次应付」标签沿用旧样式里按深底写的浅字色（纸色 58%），
  // 叠在浅底上对比度只有 1.02:1，肉眼几乎看不见。这里逐个量金额卡里每个带字元素的字色对底色。
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
  await expect(page.locator('[data-qx-state="channel-selected"]')).toBeVisible()
  await expect(page.locator('.cashier-qx-amount-lb')).toHaveText('本次应付')

  const rows = await amountCardContrast(page)
  expect(rows.map((row) => row.selector), '金额卡里的标签、金额、说明都要量到').toEqual(
    expect.arrayContaining(['div.cashier-qx-amount-lb', 'strong.cashier-qx-amount-num', 'p.cashier-qx-amount-src']),
  )
  for (const row of rows) {
    expect(row.ratio, `金额卡「${row.text}」（${row.selector}）字色对底色的对比度`).toBeGreaterThanOrEqual(4.5)
  }
})

/** 金额卡里的标签、金额、说明句、价目明细的每一行，上下沿都要落在卡内（卡是 overflow:hidden，落在外面的就是被切掉的）。 */
async function amountCardOverflow(page: Page) {
  return page.locator('.cashier-qx-amount').evaluate((card) => {
    const box = card.getBoundingClientRect()
    const parts: Array<[string, string]> = [
      ['标签', '.cashier-qx-amount-lb'], ['金额', '.cashier-qx-amount-num'], ['说明句', '.cashier-qx-amount-src'], ['价目明细', '.cashier-qx-ledger > div'],
    ]
    return {
      cardHeight: Math.round(box.height),
      rows: parts.flatMap(([name, selector]) => Array.from(card.querySelectorAll(selector)).map((el, index) => {
        const rect = el.getBoundingClientRect()
        return { name: `${name}${index > 0 ? ` 第 ${index + 1} 行` : ''}`, out: Math.round(Math.max(rect.bottom - box.bottom, box.top - rect.top) * 10) / 10 }
      })),
    }
  })
}

for (const scene of [
  { name: 'pending', channels: ['wechat', 'alipay'], payStatus: 'unpaid' as const },
  { name: 'channel-selected', channels: ['wechat'], payStatus: 'unpaid' as const },
  { name: 'closed', channels: ['wechat'], payStatus: 'closed' as const },
]) {
  test(`cashier amount card keeps its note and price ledger whole in the ${scene.name} state @w2`, async ({ page, api }) => {
    // 旧样式 cashier-qx.css 为两列版写的「没有支付工具的状态：付款区 max-height: 620px、金额卡 flex: 1（基线 0）」，在触屏版的单列里
    // 把金额卡压到 75–110 高：说明句与价目明细被卡的 overflow:hidden 切掉，Mac 字体也一样。这里量金额卡里每一行的上下沿都在卡内。
    registerShell(api)
    api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: scene.channels } })
    api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus(scene.payStatus) })

    await page.goto('/print/cashier')
    await setReactRouterState(page, '/print/cashier', CASHIER_STATE)
    await expect(page.locator(`[data-qx-state="${scene.name}"]`)).toBeVisible()

    const report = await amountCardOverflow(page)
    expect(report.rows.map((row) => row.name), '标签、金额、说明句、价目明细都要在卡里量到').toEqual(
      expect.arrayContaining(['标签', '金额', '说明句', '价目明细']),
    )
    for (const row of report.rows) {
      expect(row.out, `${scene.name} 态金额卡（卡高 ${report.cardHeight}px）的「${row.name}」不得落在卡外`).toBeLessThanOrEqual(0.5)
    }
  })
}
