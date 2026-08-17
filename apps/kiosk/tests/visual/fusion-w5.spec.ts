import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'
import { FusionW5PaginationRoute } from './fixtures/fusion-w5-pagination-route'

const MEMBER_TOKEN = 'w5-browser-memory-token'
const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'

function runtimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('requestfailed', (request) => {
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()} ${request.failure()?.errorText ?? ''}`)
    }
  })
  return errors
}

async function expectTouchTargets(page: Page, options?: { allowNoTargets?: boolean }): Promise<void> {
  const targets = page.locator('button, a[href]')
  let visible = 0
  for (let index = 0; index < await targets.count(); index += 1) {
    const target = targets.nth(index)
    if (!(await target.isVisible())) continue
    visible += 1
    const box = await target.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(48)
    expect(box!.height).toBeGreaterThanOrEqual(48)
  }
  if (!options?.allowNoTargets) expect(visible).toBeGreaterThan(0)
}

async function expectFusionAcceptance(page: Page, errors: string[], options?: { allowNoTouchTargets?: boolean }): Promise<void> {
  await expect(page.locator('[data-kiosk-presentation="fusion-youth"]').first()).toBeVisible()
  await assertNoHorizontalOverflow(page)
  await expectTouchTargets(page, { allowNoTargets: options?.allowNoTouchTargets })
  expect(errors).toEqual([])
}

async function expectSharedPageShell(page: Page, title: string): Promise<void> {
  const frame = page.locator('[data-kiosk-component="page-frame"]')
  await expect(frame).toBeVisible()
  await expect(frame.locator('.ui-kiosk-page-header')).toBeVisible()
  await expect(frame.getByRole('heading', { name: title, exact: true })).toBeVisible()
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await expect(page.locator('[data-kiosk-presentation="fusion-youth"]')).toBeVisible()
  await assertNoHorizontalOverflow(page)
  await expectTouchTargets(page)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

function registerMemberLogin(api: ApiRouter): void {
  // G6: 登录前拉取当前协议版本；无激活版本时前端回落草拟哨兵，fixture 返回 null 即可。
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', {
    status: 200,
    json: { success: true, data: null },
  })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', {
    status: 200,
    json: { success: true, data: null },
  })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: {
      success: true,
      data: {
        token: MEMBER_TOKEN,
        user: { id: 'member-w5', phoneMasked: '138****8000', nickname: '融合验收用户' },
      },
    },
  })
}

function registerKioskShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
}

function homeFair(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'w5-home-fair',
    name: '2026 秋季高校毕业生招聘会',
    organizer: '市公共就业服务中心',
    startTime: '2026-10-18T01:00:00.000Z',
    endTime: '2026-10-18T08:00:00.000Z',
    venue: '市公共就业服务中心 A 馆',
    status: 'upcoming',
    sourceOrgId: 'source-w5',
    externalId: 'external-w5-home-fair',
    sourceName: '市公共就业服务网',
    sourceUrl: 'https://jobs.example.gov.cn/fairs/w5-home-fair',
    syncTime: '2026-08-12T00:00:00.000Z',
    // 不放 reviewStatus / publishStatus：FairListItemDto 不下发它们，
    // 夹具带上就会让前端看起来「本可以」二次过滤，而生产上根本拿不到。
    hasManagedData: false,
    managedCompanyCount: 0,
    managedMaterialCount: 0,
    dataSourceNote: '招聘会信息由官方来源提供。',
    ...overrides,
  }
}

function registerHomeApi(api: ApiRouter, fairs: unknown[] = [homeFair()]): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfig({ enabled: false, items: [] }),
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { success: true, data: fairs, pagination: { page: 1, pageSize: 20, total: fairs.length, totalPages: fairs.length ? 1 : 0 } },
  })
}

function registerAuthenticatedShell(api: ApiRouter): void {
  registerKioskShell(api)
  api.respond('GET', '/api/v1/me/favorites', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
}

function terminalConfig(toolbox: { enabled: boolean; items: unknown[] }): unknown {
  return {
    smartCampus: { enabled: false, modules: { welcome: false, bigdata: false, luggage: false, panorama: false }, items: [] },
    toolbox,
    configVersion: 'w5-browser-fixture',
    refreshIntervalMs: 300000,
    serverTime: '2026-07-24T00:00:00.000Z',
  }
}

test('home restores real fair and device panels with balanced 1080x1920 geometry @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  // 这里喂的必须是「服务端真会返回的响应」：/job-fairs 的 where 恒带
  // reviewStatus:'approved' + publishStatus:'published'，且列表 DTO（FairListItemDto）
  // **刻意不下发**这两个字段——所以前端结构上就没有二次审核过滤的能力。
  //
  // 早前这里喂一条 reviewStatus:'pending' 的场次并要求前端把它滤掉。那既是在断言一个
  // 真实接口不可能返回的响应，也把「首页招聘会恒为空」这个 P0 钉死在原地：
  // 前端为了通过它，就得比对两个运行时恒为 undefined 的字段，于是每一场都被判不合格。
  //
  // 「未审核 / 未发布不得展示」改由服务端门禁 verify:fair-list-integrity 验证——它用真实库
  // 造 hidden-pending（未审核）与 hidden-approved（已审核未发布）两种夹具，断言它们在含
  // keyword 检索在内的多个查询范围里都不泄漏。那是行为验证，比这里的文本断言强。
  //
  // 本用例改为验前端真正负责的那件事：同为 upcoming 时按 startTime 取更近的一场。
  registerHomeApi(api, [
    homeFair({
      id: 'w5-home-fair-later',
      name: '2026 冬季专场招聘会',
      startTime: '2026-11-20T01:00:00.000Z',
      endTime: '2026-11-20T08:00:00.000Z',
    }),
    homeFair(),
  ])

  await page.goto('/')
  const panels = page.locator('.v6-home-footer-panels')
  const fairPanel = page.locator('[data-home-job-fair-panel]')
  const devicePanel = page.locator('[data-home-device-panel]')
  const boundary = page.locator('.v6-home-boundary')
  const bottomNav = page.getByRole('navigation', { name: '主导航' })
  await expect(fairPanel).toHaveAttribute('data-panel-state', 'ready')
  await expect(fairPanel.getByRole('heading', { name: '2026 秋季高校毕业生招聘会' })).toBeVisible()
  await expect(fairPanel.getByText('2026 冬季专场招聘会')).toHaveCount(0)
  await expect(devicePanel).toHaveAttribute('data-panel-state', 'ready')
  await expect(devicePanel.getByText('未单独上报')).toHaveCount(3)
  const [panelBox, fairBox, deviceBox, boundaryBox, navBox] = await Promise.all([
    panels.boundingBox(),
    fairPanel.boundingBox(),
    devicePanel.boundingBox(),
    boundary.boundingBox(),
    bottomNav.boundingBox(),
  ])
  expect(panelBox).not.toBeNull()
  expect(fairBox).not.toBeNull()
  expect(deviceBox).not.toBeNull()
  expect(boundaryBox).not.toBeNull()
  expect(navBox).not.toBeNull()
  expect(panelBox!.height).toBeGreaterThanOrEqual(212)
  expect(panelBox!.width).toBeLessThanOrEqual(968)
  expect(Math.abs(fairBox!.y - deviceBox!.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(fairBox!.height - deviceBox!.height)).toBeLessThanOrEqual(1)
  expect(boundaryBox!.y - panelBox!.y - panelBox!.height).toBeLessThanOrEqual(24)
  expect(navBox!.y - boundaryBox!.y - boundaryBox!.height).toBeLessThanOrEqual(160)
  await expectTouchTargets(page)
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
})

test('home fair loading, empty and error states remain honest and stable @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfig({ enabled: false, items: [] }),
  })
  let releaseFair!: (result: { status: number; json: unknown }) => void
  api.respondWith('GET', '/api/v1/job-fairs', (requestNumber) => {
    if (requestNumber === 1) return new Promise((resolve) => { releaseFair = resolve })
    if (requestNumber === 2) {
      return { status: 200, json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } }
    }
    return { status: 503, json: { success: false, error: { code: 'W5_FAIRS_UNAVAILABLE', message: 'fixture unavailable' } } }
  })

  try {
    await page.goto('/')
    const fairPanel = page.locator('[data-home-job-fair-panel]')
    await expect(fairPanel).toHaveAttribute('data-panel-state', 'loading')
    const loadingHeight = (await fairPanel.boundingBox())!.height
    releaseFair({ status: 200, json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })
    await expect(fairPanel).toHaveAttribute('data-panel-state', 'empty')
    expect((await fairPanel.boundingBox())!.height).toBe(loadingHeight)
    await page.reload()
    await expect(fairPanel).toHaveAttribute('data-panel-state', 'empty')
    await page.reload()
    await expect(fairPanel).toHaveAttribute('data-panel-state', 'error')
    await expect(fairPanel.getByText('没有使用缓存或示例数据，请稍后重试。')).toBeVisible()
    expect((await fairPanel.boundingBox())!.height).toBe(loadingHeight)
  } finally {
    releaseFair?.({ status: 503, json: { success: false } })
  }
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
})

test('home device offline state does not invent paper toner or scanner telemetry @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'offline', isOnline: false },
  })
  registerHomeApi(api, [])

  await page.goto('/')
  const devicePanel = page.locator('[data-home-device-panel]')
  await expect(devicePanel).toHaveAttribute('data-panel-state', 'offline')
  await expect(devicePanel.getByRole('heading', { name: '打印机离线' })).toBeVisible()
  await expect(devicePanel.getByText('未单独上报')).toHaveCount(3)
  await expect(devicePanel.getByText(/78%|62%|碳粉充足|扫描仪就绪/)).toHaveCount(0)
  await expectFusionAcceptance(page, errors)
})

test('profile permission state uses the canonical fusion shell @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: { smartCampus: { enabled: false, modules: { welcome: false, bigdata: false, luggage: false, panorama: false }, items: [] }, toolbox: { enabled: false, items: [] }, configVersion: 'w5', refreshIntervalMs: 300000, serverTime: '2026-07-24T00:00:00.000Z' },
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })
  await page.goto('/profile')
  await expect(page.locator('[data-kiosk-screen="profile"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '手机号登录', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '我的资产' })).toBeVisible()
  await expectFusionAcceptance(page, errors)
})

test('resumes expose authenticated API error and recovered empty states through visible login @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  api.respond('GET', '/api/v1/me/resumes', {
    status: 503,
    json: { success: false, error: { code: 'W5_RESUMES_UNAVAILABLE', message: 'fixture unavailable' } },
  })

  await loginThroughVisibleUi(page, '/me/resumes')
  await expect(page.getByRole('heading', { name: '暂时无法加载' })).toBeVisible()
  api.respond('GET', '/api/v1/me/resumes', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.getByText('还没有登录后保存的简历', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '简历记录概览' })).toContainText('0')
  await expectFusionAcceptance(page, errors)
})

test('notification alias and member path render the same canonical capability @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)

  await page.goto('/me/notifications')
  await expect(page.getByRole('heading', { name: '消息通知' })).toBeVisible()
  await expect(page.getByText('登录后查看本人记录', { exact: true })).toBeVisible()
  await expect(page.locator('.me-inkdetail-notifications')).toBeVisible()
  await expectFusionAcceptance(page, errors)

  await page.goto('/notifications')
  await expect(page.getByRole('heading', { name: '消息通知' })).toBeVisible()
  await expect(page.getByText('登录后查看本人记录', { exact: true })).toBeVisible()
  await expect(page.locator('.me-inkdetail-notifications')).toBeVisible()
  await expectFusionAcceptance(page, errors)
})

test('feedback exposes the authenticated form and honest submit error through visible login @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  api.respond('GET', '/api/v1/me/feedback', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  api.respond('POST', '/api/v1/me/feedback', {
    status: 503,
    json: { success: false, error: { code: 'W5_FEEDBACK_UNAVAILABLE', message: 'fixture unavailable' } },
  })

  await loginThroughVisibleUi(page, '/me/feedback')
  await expect(page.getByRole('heading', { name: '提交反馈' })).toBeVisible()
  await page.getByLabel('标题（选填）').fill('页面使用反馈')
  await page.getByLabel('反馈内容').fill('这是用于验证真实反馈提交失败状态的合成说明。')
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()
  await expect(page.getByText('提交失败，请检查登录状态或稍后重试', { exact: true })).toBeVisible()
  await expectFusionAcceptance(page, errors)
})

test('activity detail remains permission-safe without a member token @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  await page.goto('/me/activity/browse-fixture-001')
  await expect(page.locator('[data-kiosk-screen="activity-detail"]')).toBeVisible()
  await expect(page.getByText('登录后查看本人记录', { exact: true })).toBeVisible()
  await expect(page.getByText(/投递或预约结果以来源平台为准/)).toHaveCount(0)
  await expectFusionAcceptance(page, errors)
})

test('activity detail follows the real page-2 cursor after visible login @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  const targetId = 'browse-page-two'
  registerMemberLogin(api)
  registerKioskShell(api)
  api.respond('GET', '/api/v1/me/ai-records', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/documents', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  const pagination = new FusionW5PaginationRoute(page, [
    {
      pathname: '/api/v1/me/browse-logs',
      cursor: null,
      page: {
        items: [{ id: 'browse-page-one', targetType: 'job', targetId: 'job-one', targetTitle: '第一页岗位', sourceName: '来源平台', sourceUrl: null, externalId: null, createdAt: '2026-07-24T01:00:00.000Z' }],
        nextCursor: 'browse-next-50',
        total: 51,
      },
    },
    {
      pathname: '/api/v1/me/browse-logs',
      cursor: 'browse-next-50',
      page: {
        items: [{ id: targetId, targetType: 'job', targetId: 'job-page-two', targetTitle: '第二页命中岗位', sourceName: '来源平台', sourceUrl: null, externalId: null, createdAt: '2026-07-24T02:00:00.000Z' }],
        nextCursor: null,
        total: 51,
      },
    },
    {
      pathname: '/api/v1/me/external-jump-logs',
      cursor: null,
      page: { items: [], nextCursor: null, total: 0 },
    },
  ])
  await pagination.install()

  await loginThroughVisibleUi(page, `/me/activity/${targetId}`)
  await expect(page.getByRole('heading', { name: '第二页命中岗位' })).toBeVisible()
  await expect(page.getByText('这里只记录浏览与打开来源入口动作')).toBeVisible()
  await expectFusionAcceptance(page, errors)
  pagination.assertNoUnhandledRequests()
})

test('activity detail renders an honest missing-record empty state after visible login @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  const pagination = new FusionW5PaginationRoute(page, [
    { pathname: '/api/v1/me/browse-logs', cursor: null, page: { items: [], nextCursor: null, total: 0 } },
    { pathname: '/api/v1/me/external-jump-logs', cursor: null, page: { items: [], nextCursor: null, total: 0 } },
  ])
  await pagination.install()

  await loginThroughVisibleUi(page, '/me/activity/missing-w5-record')
  await expect(page.getByRole('heading', { name: '未找到这条记录' })).toBeVisible()
  await expect(page.getByText('记录可能已清理，或不属于当前登录账号', { exact: true })).toBeVisible()
  await expectFusionAcceptance(page, errors)
  pagination.assertNoUnhandledRequests()
})

for (const scenario of [
  {
    label: 'configured',
    toolbox: {
      enabled: true,
      items: [{ key: 'w5-help', title: '使用帮助', description: '打开站内帮助能力', icon: 'help-circle', to: '/help', disabled: false, sortOrder: 1, placements: ['toolbox'], launchMode: 'internal_route' }],
    },
    text: '使用帮助',
    available: true,
  },
  { label: 'empty', toolbox: { enabled: false, items: [] }, text: '本机暂未开启百宝箱服务', available: false },
] as const) {
  test(`toolbox renders the ${scenario.label} terminal-config branch @w5-kiosk`, async ({ page, api }) => {
    const errors = runtimeErrors(page)
    registerKioskShell(api)
    api.respond('GET', '/api/v1/terminals/KSK-001/config', {
      status: 200,
      json: terminalConfig(scenario.toolbox),
    })
    api.respond('GET', '/api/v1/job-fairs', {
      status: 200,
      json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    })

    await page.goto('/toolbox')
    if (scenario.available) {
      await expect(page.locator('[data-kiosk-screen="toolbox"]')).toBeVisible()
      await expectSharedPageShell(page, '百宝箱')
      const backButton = page.getByRole('button', { name: /返回/ }).first()
      await expect(backButton).toBeVisible()
      await expect(page.getByText(scenario.text, { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: /使用帮助/ })).toBeEnabled()
      await backButton.click()
      await expect(page).toHaveURL(/\/$/)
      // 等待 V6 首页真实异步面板稳定后，再执行统一触控目标验收。
      await expect(page.locator('[data-v6-page="home"]')).toBeVisible()
      await expect(page.locator('[data-home-job-fair-panel]')).toHaveAttribute('data-panel-state', 'empty')
      await expect(page.locator('[data-home-device-panel]')).toHaveAttribute('data-panel-state', 'ready')
    } else {
      await expect(page.locator('[data-capability-state="unavailable"]')).toBeVisible()
      await expect(page.locator('[data-kiosk-screen="toolbox"]')).toHaveCount(0)
      await expect(page.getByText(scenario.text, { exact: true })).toBeVisible()
    }
    await expectFusionAcceptance(page, errors)
  })
}

test('benefit activity detail keeps the shared shell, real content and return path @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  api.respond('GET', '/api/v1/activities', {
    status: 200,
    json: { success: true, data: { items: [] } },
  })
  api.respond('GET', '/api/v1/activities/w5-benefit-detail', {
    status: 200,
    json: {
      success: true,
      data: {
        id: 'w5-benefit-detail',
        title: 'W5 打印服务体验权益',
        description: '这是来自真实活动详情接口的验收内容。',
        rulesText: '每人限领一次；仅用于现场打印服务。',
        benefitType: 'free_quota',
        sourceType: 'platform',
        quantityTotal: 1,
        stockTotal: 20,
        stockRemaining: 8,
        claimLimitPerUser: 1,
        status: 'published',
        validFrom: null,
        validUntil: null,
        grantValidDays: 30,
        claimable: true,
        claimed: false,
        soldOut: false,
        ended: false,
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
    },
  })

  await page.goto('/activities/w5-benefit-detail')
  await expect(page.locator('[data-kiosk-domain="profile"][data-kiosk-screen="activity-detail"]')).toBeVisible()
  await expectSharedPageShell(page, '权益活动详情')
  await expect(page.getByRole('heading', { name: 'W5 打印服务体验权益', exact: true })).toBeVisible()
  await expect(page.getByText('这是来自真实活动详情接口的验收内容。', { exact: true })).toBeVisible()
  const backButton = page.getByRole('button', { name: /返回活动/ }).first()
  await expect(backButton).toBeVisible()
  await expectFusionAcceptance(page, errors)
  await backButton.click()
  await expect(page).toHaveURL(/\/activities$/)
})

test('legal document keeps its standalone theme and scrollable long body @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  const paragraphs = Array.from(
    { length: 40 },
    (_, index) => `W5 隐私政策长正文第 ${index + 1} 段：公共终端仅处理完成当次服务所必需的信息，不建立企业可检索的简历库。`,
  )
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', {
    status: 200,
    json: {
      success: true,
      data: { content: paragraphs.join('\n\n'), publishedAt: '2026-07-24T00:00:00.000Z' },
    },
  })
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', {
    status: 200,
    json: { success: true, data: null },
  })

  await page.goto('/legal/privacy')
  const root = page.locator('[data-kiosk-screen="legal-doc"]')
  await expect(root).toHaveAttribute('data-kiosk-presentation', 'fusion-youth')
  await expect(root).toHaveAttribute('data-visual-theme', 'service-desk')
  await expect(root).toHaveAttribute('data-ux-density', 'touch')
  await expectSharedPageShell(page, '隐私政策')
  await expect(page.getByText(paragraphs[0], { exact: true })).toBeVisible()
  const body = root.locator('.legal-doc-body')
  await expect(body).toBeVisible()
  expect(await body.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
    await body.evaluate((element) => element.clientHeight),
  )
  await body.evaluate((element) => { element.scrollTop = element.scrollHeight })
  expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await expectFusionAcceptance(page, errors)
})

test('legal document keeps its header usable at 390x844 @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', {
    status: 200,
    json: {
      success: true,
      data: {
        content: '移动端隐私政策正文，用于验证共享页头与字号控制不会互相覆盖。',
        publishedAt: '2026-07-24T00:00:00.000Z',
      },
    },
  })
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', {
    status: 200,
    json: { success: true, data: null },
  })

  await page.goto('/legal/privacy')
  const root = page.locator('[data-kiosk-screen="legal-doc"]')
  const header = root.locator('.legal-doc-page-header')
  const title = header.locator('.ui-kiosk-page-header-title')
  const back = header.locator('.ui-kiosk-back-button')
  const tools = header.locator('.legal-doc-tools')
  await expectSharedPageShell(page, '隐私政策')

  const [headerBox, titleBox, backBox, toolsBox] = await Promise.all([
    header.boundingBox(),
    title.boundingBox(),
    back.boundingBox(),
    tools.boundingBox(),
  ])
  expect(headerBox).not.toBeNull()
  expect(titleBox).not.toBeNull()
  expect(backBox).not.toBeNull()
  expect(toolsBox).not.toBeNull()
  expect(headerBox!.height).toBeLessThan(260)
  expect(titleBox!.width).toBeGreaterThan(120)
  const controlsOverlap = !(
    backBox!.x + backBox!.width <= toolsBox!.x
    || toolsBox!.x + toolsBox!.width <= backBox!.x
    || backBox!.y + backBox!.height <= toolsBox!.y
    || toolsBox!.y + toolsBox!.height <= backBox!.y
  )
  const titleAndToolsOverlap = !(
    titleBox!.x + titleBox!.width <= toolsBox!.x
    || toolsBox!.x + toolsBox!.width <= titleBox!.x
    || titleBox!.y + titleBox!.height <= toolsBox!.y
    || toolsBox!.y + toolsBox!.height <= titleBox!.y
  )
  expect(controlsOverlap).toBe(false)
  expect(titleAndToolsOverlap).toBe(false)
  await expect(root.locator('.legal-doc-shell')).toHaveCSS('min-height', '0px')
  await expectFusionAcceptance(page, errors)
})

test('direct visit to /session-timeout without a pending warning fails closed to a clean home page @w5-kiosk', async ({
  page,
  api,
}) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  // Home page reads smartCampus + toolbox out of the terminal config; registerKioskShell
  // already covers screensaver/printer-status.
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfig({ enabled: false, items: [] }),
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })

  await page.goto('/session-timeout')

  await expect(page).toHaveURL('http://127.0.0.1:4185/', { timeout: 5_000 })
  await expect(page.locator('[data-kiosk-screen="session-timeout"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '继续使用', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '立即退出并清除本机会话', exact: true })).toHaveCount(0)
  await expect(page.getByText('秒后自动退出', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /说出你的处境/ })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
})

test('offline page retains the 8177 state after an aborted health request @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  api.abort('GET', '/api/v1/health', 'internetdisconnected')
  await page.goto('/error-offline')
  await page.getByRole('button', { name: '重试连接', exact: true }).click()
  await expect(page).toHaveURL(/\/error-offline$/)
  await expect(page.getByText(/已重试 1 次/)).toBeVisible()
  await expectFusionAcceptance(page, errors)
})

test('offline page follows a recovered health response in a fresh page @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfig({ enabled: false, items: [] }),
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  await page.goto('/error-offline')
  await expect(page.locator('[data-kiosk-screen="error-offline"]')).toBeVisible()
  await expectFusionAcceptance(page, errors)
  await page.getByRole('button', { name: '重试连接', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expectFusionAcceptance(page, errors)
})

test('mobile QR login renders a real API error and touch-safe retry @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  api.respond('GET', '/api/v1/member/auth/qr/w5-expired-ticket/status', {
    status: 410,
    json: { success: false, error: { code: 'QR_LOGIN_EXPIRED', message: '二维码已失效，请回到一体机刷新' } },
  })
  await page.goto('/member/qr-login?ticketId=w5-expired-ticket')
  const root = page.locator('main[data-kiosk-screen="member-qr-login"]')
  await expect(root).toHaveAttribute('data-kiosk-viewport', 'mobile')
  await expect(root.getByText('暂时无法确认登录', { exact: true })).toBeVisible()
  await expect(root.getByRole('button', { name: '重新检查二维码', exact: true })).toBeVisible()
  await expectFusionAcceptance(page, errors)
})

test('phone upload keeps the explicit expired-link state at 390x844 @w5-mobile', async ({ page }) => {
  const errors = runtimeErrors(page)
  await page.goto('/upload/phone')
  const root = page.locator('main[data-kiosk-screen="phone-upload"]')
  await expect(root).toHaveAttribute('data-kiosk-viewport', 'mobile')
  await expect(root.getByText('上传链接已失效', { exact: true })).toBeVisible()
  await expectFusionAcceptance(page, errors, { allowNoTouchTargets: true })
})

test('phone upload renders a real upload failure without exposing fixture credentials @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  api.abort('POST', '/api/v1/upload-sessions/w5-upload-session/files', 'internetdisconnected')
  await page.goto('/upload/phone#sessionId=w5-upload-session&token=w5-one-time-upload&purpose=print_doc')
  // 2026-08-18（PR #598）：手机页改为按 purpose 显式映射文案与文件过滤器后，
  // print_doc 的可访问名由「选择文件」变为「选择打印文件」（签名/印章、合同同理）。
  // 只更新定位到该 input 的方式，下面三条断言（失败态可见、公共安全文案、
  // 一次性令牌不外泄）保持原样，一条都没有放宽。
  await page.getByLabel('选择打印文件').setInputFiles({
    name: 'w5-sample.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-w5-browser-fixture'),
  })
  await expect(page.getByText('上传失败', { exact: true })).toBeVisible()
  await expect(page.getByText('网络连接失败，请稍后重试', { exact: true })).toBeVisible()
  await expect(page.getByText('w5-one-time-upload')).toHaveCount(0)
  await expectFusionAcceptance(page, errors)
})
