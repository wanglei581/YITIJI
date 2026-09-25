import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoElementCrossesViewport, assertNoHorizontalOverflow, assertTapTargetPointerHit } from './assert-layout'
import { FusionW5PaginationRoute } from './fixtures/fusion-w5-pagination-route'
import { registerPrintConfirm } from './fixtures/fair-workbench-api'

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

/** 稿 08-legal 迁入青序流光后的页壳：QxPageFrame + 页内文档头标题（h1「协议与隐私」只留给读屏）。 */
async function expectQingxuLegalShell(page: Page, title: string): Promise<void> {
  await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
  await expect(page.locator('.qx-topbar .qx-topbar-back')).toBeVisible()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
}

async function loginThroughVisibleUi(page: Page, returnTo: string, options?: { checkLoginPage?: boolean }): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await expect(page.locator('[data-kiosk-presentation="fusion-youth"]')).toBeVisible()
  // 登录页自身的版面验收属于登录页的用例；390 宽的用例只借它登录，不替它背书也不被它拖红。
  if (options?.checkLoginPage !== false) {
    await assertNoHorizontalOverflow(page)
    await expectTouchTargets(page)
  }
  await completeVisibleLogin(page, returnTo)
}

/** 已停在登录页（例如从页面里的「手机号登录」点进来）时，只走可见的手机号 + 验证码登录，再等回跳。 */
async function completeVisibleLogin(page: Page, returnTo: string): Promise<void> {
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
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
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
  const tiles = page.locator('.qx-home-tiles')
  const fairPanel = page.locator('[data-home-job-fair-panel]')
  const devicePanel = page.locator('[data-home-device-panel]')
  const bottomNav = page.getByRole('navigation', { name: '主导航' })
  await expect(fairPanel).toHaveAttribute('data-panel-state', 'ready')
  await expect(fairPanel.getByText('2026 秋季高校毕业生招聘会')).toBeVisible()
  await expect(fairPanel.getByText('2026 冬季专场招聘会')).toHaveCount(0)
  await expect(devicePanel).toHaveAttribute('data-panel-state', 'ready')
  // V6 首页底部有一块设备遥测栏，纸 / 碳粉 / 扫描仪各标「未单独上报」。
  // 稿 01-home 没有这块栏，青序流光把打印机状态收进打印磁贴的徽标。
  // 那条诚实性保证（不编造耗材遥测）改成更直接的表达：这些字段一个都不许出现。
  await expect(devicePanel.getByText(/纸盒|碳粉|扫描仪/)).toHaveCount(0)
  const [tilesBox, fairBox, deviceBox, navBox] = await Promise.all([
    tiles.boundingBox(),
    fairPanel.boundingBox(),
    devicePanel.boundingBox(),
    bottomNav.boundingBox(),
  ])
  expect(tilesBox).not.toBeNull()
  expect(fairBox).not.toBeNull()
  expect(deviceBox).not.toBeNull()
  expect(navBox).not.toBeNull()
  // 两块磁贴都在网格内，且不被底栏压住。
  expect(fairBox!.x).toBeGreaterThanOrEqual(tilesBox!.x - 1)
  expect(deviceBox!.x).toBeGreaterThanOrEqual(tilesBox!.x - 1)
  expect(fairBox!.x + fairBox!.width).toBeLessThanOrEqual(tilesBox!.x + tilesBox!.width + 1)
  expect(deviceBox!.x + deviceBox!.width).toBeLessThanOrEqual(tilesBox!.x + tilesBox!.width + 1)
  expect(fairBox!.y + fairBox!.height).toBeLessThanOrEqual(navBox!.y + 1)
  expect(deviceBox!.y + deviceBox!.height).toBeLessThanOrEqual(navBox!.y + 1)
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
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
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
  // 青序流光把打印机状态收进打印磁贴的徽标（稿 01-home 没有独立设备面板），
  // 不再是 V6 那种带标题的面板。文案一字未改，只是元素从 heading 变成徽标。
  await expect(devicePanel.getByText('打印机离线', { exact: true })).toBeVisible()
  // V6 用「未单独上报 ×3」表达「没有纸/碳粉/扫描仪遥测」。青序流光的做法是
  // 根本不显示这些字段，所以改成断言它们一个都不出现——比数占位符更直接。
  await expect(devicePanel.getByText(/纸盒|碳粉|扫描仪/)).toHaveCount(0)
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
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
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
  await expect(page.getByRole('heading', { name: '简历记录这次没有加载出来' })).toBeVisible()
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
  await expect(page.getByText('登录后查看本人消息', { exact: true })).toBeVisible()
  await expect(page.locator('[data-kiosk-screen="member-list"]')).toBeVisible()
  await expectFusionAcceptance(page, errors)

  await page.goto('/notifications')
  await expect(page.getByRole('heading', { name: '消息通知' })).toBeVisible()
  await expect(page.getByText('登录后查看本人消息', { exact: true })).toBeVisible()
  await expect(page.locator('[data-kiosk-screen="member-list"]')).toBeVisible()
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
  await expect(
    page.getByText('记录可能已清理，或不属于当前登录账号。本页不会拿别的记录顶替。', { exact: true }),
  ).toBeVisible()
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
    api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
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
      await expect(page.locator('[data-qx-page="home"]')).toBeVisible()
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
  await expectQingxuLegalShell(page, '隐私政策')
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

test('legal document never passes local or missing text off as the official version @w5-kiosk', async ({ page, api }) => {
  // 稿 08-legal 的三条诚实性：取不到 → error 并给重试，不静默顶替；本机留存文本只在用户点开 / 服务端尚无激活版本时出现，
  // 且一律挂「不作为正式版本」；未知文档 → not-found，不回落到任何一份。
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  api.abort('GET', '/api/v1/kiosk/legal/terms_of_service', 'internetdisconnected')
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })

  await page.goto('/legal/terms')
  await expect(page.getByRole('heading', { name: '正文没取到', exact: true })).toBeVisible()
  await expect(page.getByText('本终端为「AI求职打印服务终端」', { exact: false })).toHaveCount(0)
  await expect(page.getByTestId('legal-doc-fallback-warning')).toHaveCount(0)
  await expect(page.getByTestId('legal-primary')).toHaveText('重新取正文')

  await page.getByRole('button', { name: '看本机留存文本（非正式版本）', exact: true }).click()
  await expect(page.getByTestId('legal-doc-fallback-warning')).toContainText('不作为正式版本')
  await expect(page.getByText('本终端为「AI求职打印服务终端」', { exact: false })).toBeVisible()
  await expect(page.getByTestId('legal-ai-explain')).toBeDisabled()

  // 服务端可达但尚无激活版本（data: null）：直接给本机留存文本，同样挂标注。
  await page.getByRole('group', { name: '法律文档' }).getByRole('button', { name: '隐私政策' }).click()
  await expect(page).toHaveURL(/\/legal\/privacy$/)
  await expect(page.getByTestId('legal-doc-fallback-warning')).toContainText('不作为正式版本')
  await expect(page.getByRole('heading', { name: '一、我们收集的信息', exact: true })).toBeVisible()

  await page.goto('/legal/not-a-document')
  await expect(page.getByRole('heading', { name: '没有这份文档', exact: true })).toBeVisible()
  await expect(page.getByTestId('legal-doc-fallback-warning')).toHaveCount(0)
  await expectFusionAcceptance(page, errors)
})

test('legal document returns to the page it was opened from @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', {
    status: 200,
    json: { success: true, data: { content: '一、我们收集的信息\n\n登录用的手机号。', publishedAt: '2026-07-24T00:00:00.000Z' } },
  })
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })

  await page.goto('/help')
  await page.getByRole('group', { name: '按分类筛选常见问题' }).getByRole('button', { name: /隐私与留存/ }).click()
  await page.getByRole('button', { name: /文件会保存多久/ }).click()
  await page.getByRole('button', { name: '隐私政策', exact: true }).click()
  await expect(page).toHaveURL(/\/legal\/privacy$/)
  await expect(page.getByRole('heading', { name: '一、我们收集的信息', exact: true })).toBeVisible()
  const back = page.getByRole('button', { name: '返回上一页', exact: true }).first()
  await expect(back).toBeVisible()
  await back.click()
  await expect(page).toHaveURL(/\/help$/)
  expect(errors).toEqual([])
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
  // 2026-09-25 迁入稿 08-legal：页头由青序顶栏（返回槽）+ 页内文档头承担，字号控件落在「按章节读」一行。
  // 断言意图不变：窄屏下标题可读、返回键与字号控件互不遮挡、页头不吃掉整屏。
  const topbar = root.locator('.qx-topbar')
  const title = root.locator('.legal-doc-title')
  const back = topbar.locator('.qx-topbar-back')
  const tools = root.locator('.legal-doc-tools')
  await expectQingxuLegalShell(page, '隐私政策')
  await expect(root.locator('[data-kiosk-stage-fit="off"]')).toHaveCount(1)

  const [topbarBox, titleBox, backBox, toolsBox] = await Promise.all([
    topbar.boundingBox(),
    title.boundingBox(),
    back.boundingBox(),
    tools.boundingBox(),
  ])
  expect(topbarBox).not.toBeNull()
  expect(titleBox).not.toBeNull()
  expect(backBox).not.toBeNull()
  expect(toolsBox).not.toBeNull()
  expect(topbarBox!.height).toBeLessThan(260)
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
  await expect(root.locator('.legal-doc-scroll')).toHaveCSS('min-height', '0px')
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
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })

  await page.goto('/session-timeout')

  await expect(page).toHaveURL('http://127.0.0.1:4185/', { timeout: 5_000 })
  await expect(page.locator('[data-kiosk-screen="session-timeout"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /我还在，继续使用/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '结束并清除本机会话', exact: true })).toHaveCount(0)
  await expect(page.getByText('秒后自动退出', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /你好，我是小青/ })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
})

test('offline page retains the 8177 state after an aborted health request @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  api.abort('GET', '/api/v1/health', 'internetdisconnected')
  await page.goto('/error-offline')
  await page.getByRole('button', { name: '重新检测', exact: true }).click()
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
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  await page.goto('/error-offline')
  await expect(page.locator('[data-kiosk-screen="error-offline"]')).toBeVisible()
  await expectFusionAcceptance(page, errors)
  await page.getByRole('button', { name: '重新检测', exact: true }).click()
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
  await expect(root.getByRole('heading', { name: '二维码状态读取失败', exact: true })).toBeVisible()
  await expect(root.getByRole('button', { name: '重新检查二维码', exact: true })).toBeVisible()
  await expectFusionAcceptance(page, errors)
})

test('phone upload keeps the explicit invalid-link state at 390x844 @w5-mobile', async ({ page }) => {
  const errors = runtimeErrors(page)
  await page.goto('/upload/phone')
  const root = page.locator('main[data-kiosk-screen="phone-upload"]')
  await expect(root).toHaveAttribute('data-kiosk-viewport', 'mobile')
  await expect(root.getByRole('heading', { name: '这个链接不能用来上传', exact: true })).toBeVisible()
  await expect(root.getByText('上传链接已失效')).toHaveCount(0)
  await expectFusionAcceptance(page, errors, { allowNoTouchTargets: true })
})

test('phone upload renders a real upload failure without exposing fixture credentials @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  api.respond('GET', '/api/v1/document-conversion/capabilities', {
    status: 200, json: { data: { wordToPdf: false, engine: 'none', cjkFonts: false } },
  })
  api.abort('POST', '/api/v1/upload-sessions/w5-upload-session/files', 'internetdisconnected')
  await page.goto('/upload/phone#sessionId=w5-upload-session&token=w5-one-time-upload&purpose=print_doc')
  // 手机端不把可修改的 purpose fragment 当真源；断网没有回执，只能标结果未知。
  await page.getByLabel('选择要上传的文件').setInputFiles({
    name: 'w5-sample.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-w5-browser-fixture'),
  })
  const root = page.locator('main[data-kiosk-screen="phone-upload"]')
  await expect(root).toHaveAttribute('data-phone-upload-state', 'outcome-unknown')
  await expect(root.getByText('结果未知', { exact: true })).toBeVisible()
  await expect(root.getByText('已收到', { exact: true })).toHaveCount(0)
  await expect(root.getByLabel('选择要上传的文件')).toBeDisabled()
  await expect(page.getByText('w5-one-time-upload')).toHaveCount(0)
  await expectFusionAcceptance(page, errors)
})

test('phone upload only trusts a complete server receipt and keeps the kiosk confirmation boundary @w5-mobile', async ({ page, api }, testInfo) => {
  const errors = runtimeErrors(page)
  api.respond('GET', '/api/v1/document-conversion/capabilities', {
    status: 200, json: { data: { wordToPdf: false, engine: 'none', cjkFonts: false } },
  })
  api.respond('POST', '/api/v1/upload-sessions/w5-receipt-session/files', {
    status: 200,
    json: {
      success: true,
      data: {
        sessionId: 'w5-receipt-session', status: 'uploaded', purpose: 'resume_upload', mode: 'temporary',
        file: { fileId: 'w5-receipt-file', filename: 'my-resume.pdf', sizeBytes: 23, mimeType: 'application/pdf', sha256: 'a'.repeat(64), fileExpiresAt: null },
        requiresKioskConfirmation: false, expiresAt: '2026-09-25T01:00:00.000Z',
      },
    },
  })
  await page.goto('/upload/phone#sessionId=w5-receipt-session&token=w5-private-upload-token&purpose=print_doc')
  const root = page.locator('main[data-kiosk-screen="phone-upload"]')
  await expect(root).toHaveAttribute('data-phone-upload-state', 'idle')
  const readyScreenshot = testInfo.outputPath('phone-upload-ready-390.png')
  await page.screenshot({ path: readyScreenshot, animations: 'disabled' })
  await testInfo.attach('phone-upload-ready-390', { path: readyScreenshot, contentType: 'image/png' })
  await root.getByLabel('选择要上传的文件').setInputFiles({
    name: 'my-resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w5-browser-fixture'),
  })
  await expect(root).toHaveAttribute('data-phone-upload-state', 'success')
  await expect(root).toHaveAttribute('data-purpose', 'resume_upload')
  await expect(root).toHaveAttribute('data-purpose-confirmed', '1')
  await expect(root.getByRole('heading', { name: '已收到', exact: true })).toBeVisible()
  await expect(root.getByText('它尚未进入本次任务', { exact: false })).toBeVisible()
  await expect(root.getByLabel('选择要上传的文件')).toHaveCount(0)
  await expect(root.getByText('w5-private-upload-token')).toHaveCount(0)
  const receivedScreenshot = testInfo.outputPath('phone-upload-received-390.png')
  await page.screenshot({ path: receivedScreenshot, animations: 'disabled' })
  await testInfo.attach('phone-upload-received-390', { path: receivedScreenshot, contentType: 'image/png' })
  await expectFusionAcceptance(page, errors, { allowNoTouchTargets: true })
})

test('phone upload does not call an uploaded status without a file receipt success @w5-mobile', async ({ page, api }) => {
  api.respond('GET', '/api/v1/document-conversion/capabilities', {
    status: 200, json: { data: { wordToPdf: false, engine: 'none', cjkFonts: false } },
  })
  api.respond('POST', '/api/v1/upload-sessions/w5-incomplete-session/files', {
    status: 200,
    json: { success: true, data: { sessionId: 'w5-incomplete-session', status: 'uploaded', purpose: 'print_doc', mode: 'temporary', file: null, requiresKioskConfirmation: false, expiresAt: '2026-09-25T01:00:00.000Z' } },
  })
  await page.goto('/upload/phone#sessionId=w5-incomplete-session&token=w5-private-upload-token&purpose=print_doc')
  const root = page.locator('main[data-kiosk-screen="phone-upload"]')
  await root.getByLabel('选择要上传的文件').setInputFiles({
    name: 'my-document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w5-browser-fixture'),
  })
  await expect(root).toHaveAttribute('data-phone-upload-state', 'outcome-unknown')
  await expect(root.getByRole('heading', { name: '已收到', exact: true })).toHaveCount(0)
})

const CTA_WHITELIST = ['查看岗位', '去来源平台投递', '扫码投递', '查看招聘会', '去来源平台预约', '扫码预约', '复制来源链接']
const BANNED_COPY = ['一键投递', '立即投递', '平台投递', '企业收简历', '候选人管理', '我要应聘', '递交简历', '直投', '立即报名']

async function assertCtaWhitelist(scope: Page | ReturnType<Page['locator']>): Promise<void> {
  const buttons = scope.locator('button, a[href], [role="button"]')
  const count = await buttons.count()
  for (let i = 0; i < count; i += 1) {
    const el = buttons.nth(i)
    if (!(await el.isVisible())) continue
    const label = await el.getAttribute('aria-label')
    const actionNode = el.locator('.qx-me-acts .qx-me-small, .qx-me-row-go, .qx-home-tile-foot, .qx-btn-label').last()
    const actionText = (await actionNode.count()) > 0 ? (await actionNode.innerText()).trim() : ''
    const name = (label ?? (actionText || (await el.innerText()))).trim()
    // 只校验**投递 / 预约**类动作 —— CLAUDE.md §2 的白名单管的就是这两类。
    // 原来的正则还含「岗位 / 招聘会 / 来源」，会把「收藏岗位」「取消收藏」这种
    // 完全合规的控件也拖进来判越界（实测：一个收藏按钮把整条用例判红）。
    if (!name || !/投递|预约/.test(name)) continue
    const exact = CTA_WHITELIST.some((ok) => name === ok || name.startsWith(ok))
    // 只留这一条：报错直接说出越界文案。原来还有一条 arrayContaining 写法，
    // 判的是同一件事，却把失败渲染成 `Expected: ArrayContaining ["__missing__"]`，
    // 真正越界的文案被挤出可见范围，排查时得单跑才看得到。
    expect(exact, `CTA 文案越界：${name}`).toBe(true)
  }
}

async function assertBannedCopy(text: string): Promise<void> {
  let cleaned = text
  for (const ok of CTA_WHITELIST) cleaned = cleaned.replaceAll(ok, '')
  for (const banned of BANNED_COPY) {
    expect(cleaned, `禁用文案：${banned}`).not.toContain(banned)
  }
}

test('notifications mark-all-read toast is server-driven and stays inside the compliance whitelist @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  const item = {
    id: 'n-print-1',
    kind: 'personal',
    title: '打印订单状态更新',
    content: '你的一笔打印订单状态有变化，具体进度以服务端返回为准。',
    category: 'print',
    relatedType: null,
    relatedId: null,
    isRead: false,
    createdAt: '2026-09-01T08:00:00.000Z',
  }
  api.respond('GET', '/api/v1/me/notifications', {
    status: 200,
    json: { success: true, data: { items: [item], nextCursor: null, total: 1, unreadCount: 1 } },
  })
  api.respond('PATCH', '/api/v1/me/notifications/read-all', {
    status: 200,
    json: { success: true, data: { updated: 1 } },
  })

  await loginThroughVisibleUi(page, '/me/notifications')
  const row = page.getByText('打印订单状态更新', { exact: true })
  await expect(row).toBeVisible()
  await assertTapTargetPointerHit(page.getByRole('button', { name: '全部标记为已读' }))
  await page.getByRole('button', { name: '全部标记为已读' }).click()
  const toast = page.getByRole('status').filter({ hasText: '已标记全部已读' })
  await expect(toast).toBeVisible()
  await assertBannedCopy(await toast.innerText())
  await assertCtaWhitelist(page)
  await assertNoElementCrossesViewport(page)
  await expectFusionAcceptance(page, errors)
})

test('activity jump records stay action facts and never show fulfillment statuses @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  api.respond('GET', '/api/v1/me/browse-logs', {
    status: 200,
    json: {
      success: true,
      data: {
        items: [{ id: 'b1', targetType: 'job', targetId: 'job-1', targetTitle: '示例岗位浏览', sourceName: '来源机构', sourceUrl: 'https://jobs.example.gov.cn/1', externalId: 'ext-1', createdAt: '2026-09-01T08:00:00.000Z' }],
        nextCursor: null,
        total: 1,
      },
    },
  })
  api.respond('GET', '/api/v1/me/external-jump-logs', {
    status: 200,
    json: {
      success: true,
      data: {
        items: [{ id: 'j1', targetType: 'job', targetId: 'job-1', targetTitle: '示例岗位跳转', sourceName: '来源机构', sourceUrl: 'https://jobs.example.gov.cn/1', externalId: 'ext-1', action: 'external_apply', createdAt: '2026-09-01T09:00:00.000Z' }],
        nextCursor: null,
        total: 1,
      },
    },
  })
  api.respond('GET', '/api/v1/me/job-applications', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })

  await loginThroughVisibleUi(page, '/me/activity')
  await expect(page.getByText('示例岗位浏览', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /外部跳转记录/ }).click()
  const jumpList = page.getByRole('region', { name: '浏览与跳转记录' })
  await expect(jumpList.getByText('示例岗位跳转', { exact: true })).toBeVisible()
  await expect(jumpList.getByText('已投递')).toHaveCount(0)
  await expect(jumpList.getByText('待面试')).toHaveCount(0)
  await expect(jumpList.getByText('已录用')).toHaveCount(0)
  await expect(page.getByText('企业反馈')).toHaveCount(0)
  await expect(page.getByText('面试通知')).toHaveCount(0)
  await assertCtaWhitelist(page)
  await assertNoElementCrossesViewport(page)
  await expectFusionAcceptance(page, errors)
})

test('applications empty tab names the writer and does not invent ATS status @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  api.respond('GET', '/api/v1/me/browse-logs', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/external-jump-logs', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/job-applications', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })

  await loginThroughVisibleUi(page, '/me/activity')
  await page.getByRole('button', { name: /求职进度/ }).click()
  const panel = page.getByTestId('member-records-application-list')
  await expect(panel).toBeVisible()
  await expect(
    page.getByText('由你自己填写；本终端不参与投递，也不掌握来源平台的结果', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('手填入口待建设')).toBeVisible()
  await expect(page.getByText('本页不会替你造进度')).toBeVisible()
  await expect(panel.getByText('已投递')).toHaveCount(0)
  // 「查看岗位」在这一屏出现两处（空态引导行 + 底栏行动条），
  // 本条要证的是「空态里给了一条真实去向」，所以限定在面板内查。
  await expect(panel.getByRole('button', { name: '查看岗位' })).toBeVisible()
  await assertCtaWhitelist(page)
  await assertNoElementCrossesViewport(page)
  await expectFusionAcceptance(page, errors)
})

test('AI record delete waits for the server and keeps the row on failure @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  const record = {
    id: 'ai-1',
    kind: 'optimize',
    status: 'completed',
    taskId: 'task-1',
    provider: 'demo',
    optimized: false,
    hasDraft: false,
    latestVersion: null,
    createdAt: '2026-09-01T08:00:00.000Z',
    expiresAt: null,
  }
  api.respond('GET', '/api/v1/me/ai-records', {
    status: 200,
    json: { success: true, data: { items: [record], nextCursor: null, total: 1 } },
  })
  api.respond('GET', '/api/v1/me/job-ai-sessions', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  api.respond('GET', '/api/v1/me/mock-interviews', {
    status: 200,
    json: { success: true, data: { items: [] } },
  })
  api.respond('DELETE', '/api/v1/me/ai-records/ai-1', {
    status: 500,
    json: { success: false, error: { code: 'GONE', message: 'expired' } },
  })

  await loginThroughVisibleUi(page, '/me/ai-records')
  await expect(page.getByText('基于诊断生成的优化建议')).toBeVisible()
  await page.getByRole('button', { name: '删除 AI 服务记录' }).click()
  await expect(page.getByText('本页不会提前显示成功')).toBeVisible()
  await page.getByRole('button', { name: '确认删除这条记录，删除后不可恢复' }).click()
  const toast = page.getByRole('status').filter({ hasText: '删除失败，记录可能已到期或被清理' })
  await expect(toast).toBeVisible()
  await expect(page.getByText('基于诊断生成的优化建议')).toBeVisible()
  await expect(page.getByText('记录已删除')).toHaveCount(0)
  await assertNoElementCrossesViewport(page)
  await expectFusionAcceptance(page, errors)
})

// ───────────── 稿 38-member-assets：我的文档 / 打印订单（青序流光） ─────────────
// 夹具只是合成的服务端响应，用来驱动页面的真实请求路径；不代表真实后端、COS 或设备。

const LONG_DOC_NAME = '2026届秋招-应聘材料合集-个人简历与成绩单与获奖证书与实习证明-扫描合并版-最终确认稿-请勿外传.pdf'
const FUTURE = '2099-03-01T00:00:00.000Z'

function memberDocument(overrides: Record<string, unknown>): Record<string, unknown> {
  const id = String(overrides.id)
  return {
    filename: `${id}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 245_760,
    purpose: 'print_doc',
    sensitiveLevel: 'normal',
    assetCategory: 'original',
    retentionPolicy: 'months_3',
    allowedRetentionPolicies: ['months_3', 'months_6', 'long_term'],
    createdAt: '2026-09-01T08:00:00.000Z',
    expiresAt: FUTURE,
    downloadUrlPath: `/files/${id}/download-url`,
    previewUrlPath: `/files/${id}/preview-url`,
    ...overrides,
  }
}

const MEMBER_DOCUMENTS = [
  memberDocument({ id: 'doc-long', filename: LONG_DOC_NAME }),
  memberDocument({ id: 'doc-photo', filename: '一寸证件照.png', mimeType: 'image/png', allowedRetentionPolicies: ['months_3'] }),
  memberDocument({ id: 'doc-zip', filename: '作品集源文件.zip', mimeType: 'application/zip', allowedRetentionPolicies: ['months_3'] }),
  memberDocument({ id: 'doc-expired', filename: '已过期的求职信.pdf', expiresAt: '2020-01-01T00:00:00.000Z' }),
]

function memberOrder(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    status: 'completed',
    fileName: '个人简历.pdf',
    createdAt: '2026-09-02T08:00:00.000Z',
    completedAt: '2026-09-02T08:05:00.000Z',
    copies: 1,
    colorMode: 'black_white',
    duplex: 'simplex',
    paperSize: 'A4',
    pageRange: null,
    amountCents: null,
    payStatus: null,
    paymentSource: null,
    billablePages: null,
    billingPageSource: null,
    pickupCode: null,
    refundedAmountCents: null,
    discountCents: null,
    ...overrides,
  }
}

const MEMBER_ORDERS = [
  memberOrder({ id: 'order-queue', status: 'pending', completedAt: null, fileName: LONG_DOC_NAME, amountCents: 200, payStatus: 'unpaid', billablePages: 2, discountCents: 0, refundedAmountCents: 0 }),
  memberOrder({ id: 'order-paid', amountCents: 300, payStatus: 'paid', paymentSource: 'offline', billablePages: 3, pickupCode: 'W5K7Q2', discountCents: 0, refundedAmountCents: 0 }),
  memberOrder({ id: 'order-failed', status: 'failed', completedAt: null, fileName: '成绩单.pdf', amountCents: 100, payStatus: 'paid', paymentSource: 'offline', billablePages: 1, refundRequired: true, discountCents: 0, refundedAmountCents: 0 }),
  memberOrder({ id: 'order-history', fileName: '历史打印.pdf' }),
]

function memberPage(items: unknown[], nextCursor: string | null = null, total = items.length): { status: number; json: unknown } {
  return { status: 200, json: { success: true, data: { items, nextCursor, total } } }
}

/** 旧壳（KioskLayout 深藏青顶栏 + 底栏）不得叠在青序页上；QX 登记漏掉时这里第一个红。 */
async function expectQxAssetsShell(page: Page, state: string, tab: 'documents' | 'orders'): Promise<void> {
  await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
  await expect(page.getByTestId(`member-assets-state-${state}`)).toBeVisible()
  await expect(page.locator('.ui-kiosk-topbar'), '青序页不得再挂旧顶栏').toHaveCount(0)
  await expect(page.locator('.ui-kiosk-nav'), '青序页不得再挂旧底栏').toHaveCount(0)
  await expect(page.locator('.me-inkdetail, [data-kiosk-component="page-frame"]'), '不得回落墨青纸感 / V6 页框').toHaveCount(0)
  await expect(page.getByTestId(`member-assets-tab-${tab}`)).toHaveAttribute('aria-current', 'true')
}

/** 长文件名必须整段折行，不得压到右侧操作区上（同一行时右缘 ≤ 操作区左缘，换行后在它上方）。 */
async function expectNameClearOfActions(row: ReturnType<Page['locator']>): Promise<void> {
  const name = await row.locator('.qx-me-asset-name').boundingBox()
  const acts = await row.locator('.qx-me-acts').boundingBox()
  expect(name).not.toBeNull()
  expect(acts).not.toBeNull()
  const sameLine = name!.y < acts!.y + acts!.height && acts!.y < name!.y + name!.height
  if (sameLine) expect(name!.x + name!.width, '文件名不得压到操作区上').toBeLessThanOrEqual(acts!.x + 1)
  else expect(name!.y + name!.height, '换行后文件名在操作区上方').toBeLessThanOrEqual(acts!.y + 1)
}

async function assetShot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`member-assets-${name}.png`) })
}

test('documents: signed-out gate on the Qingxu shell sends zero member API requests @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  await page.goto('/me/documents')
  await expectQxAssetsShell(page, 'documents-login', 'documents')
  await expect(page.getByRole('heading', { name: '登录后查看我的文档' })).toBeVisible()
  await assetShot(page, 'documents-login')
  await expect(page.getByTestId('member-records-primary')).toHaveText('手机号登录')
  expect(api.requestCount('GET', '/api/v1/me/documents')).toBe(0)
  await page.getByTestId('member-assets-tab-orders').click()
  await expect(page).toHaveURL(/\/me\/print-orders$/)
  await expectQxAssetsShell(page, 'orders-login', 'orders')
  await expect(page.getByRole('heading', { name: '登录后查看打印订单' })).toBeVisible()
  await assetShot(page, 'orders-login')
  expect(api.requestCount('GET', '/api/v1/me/print-orders')).toBe(0)
  await expectFusionAcceptance(page, errors)
})

test('documents: real preview, retention, delete and print calls run on the Qingxu shell @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  registerPrintConfirm(api)
  api.respond('GET', '/api/v1/me/documents', memberPage(MEMBER_DOCUMENTS))
  api.respond('GET', '/api/v1/files/doc-photo/preview-url', {
    status: 200,
    json: { success: true, data: { fileId: 'doc-photo', url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/%3E', expiresAt: FUTURE, disposition: 'inline' } },
  })
  api.respond('PATCH', '/api/v1/files/doc-long/retention', {
    status: 200,
    json: { success: true, data: { file: { assetCategory: 'original', retentionPolicy: 'months_6', expiresAt: FUTURE }, allowedPolicies: ['months_3', 'months_6', 'long_term'] } },
  })
  api.respond('DELETE', '/api/v1/files/doc-zip', { status: 200, json: { success: true, data: { deleted: true } } })
  api.respond('GET', '/api/v1/files/doc-long/preview-url', {
    status: 200,
    json: { success: true, data: { fileId: 'doc-long', url: '/api/v1/files/doc-long/content?sig=preview', printFileUrl: '/api/v1/files/doc-long/content?sig=print', expiresAt: FUTURE, disposition: 'inline' } },
  })
  // 以下三条是 /print/confirm 落地时自己要读的（价目、本人权益、报价），与本页无关但 fail-closed 必须登记。
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: { billingEnabled: true, items: [{ serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' }] },
  })
  api.respond('GET', '/api/v1/me/benefits', { status: 200, json: { success: true, data: { items: [], total: 0 } } })
  api.respond('POST', '/api/v1/orders/quote', {
    status: 200,
    json: { amountCents: 200, billablePages: 2, billingPageSource: 'detected', priceLines: [{ serviceKey: 'print_bw_page', description: '黑白打印', unitCents: 100, quantity: 2, amountCents: 200 }] },
  })

  await loginThroughVisibleUi(page, '/me/documents')
  await expectQxAssetsShell(page, 'documents-ready', 'documents')
  const rows = page.getByTestId('member-assets-document')
  await expect(rows).toHaveCount(4)
  await expect(page.getByText(LONG_DOC_NAME, { exact: true })).toBeVisible()
  await expectNameClearOfActions(rows.filter({ hasText: LONG_DOC_NAME }))
  // 置灰原因常显在行内（触屏没有 hover，title 读不到）。
  await expect(page.getByText('该文件格式暂不支持打印', { exact: true })).toBeVisible()
  await expect(rows.filter({ hasText: '已过期的求职信.pdf' }).getByRole('button', { name: '已到期' })).toBeDisabled()
  await expect(rows.filter({ hasText: '作品集源文件.zip' }).getByRole('button', { name: '打印' })).toBeDisabled()
  await assetShot(page, 'documents-ready')
  await assertNoElementCrossesViewport(page)
  await expectFusionAcceptance(page, errors)

  // 查看：凭本人 token 现换短期链接，在当前页内预览。
  const previewRequest = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/v1/files/doc-photo/preview-url')
  await rows.filter({ hasText: '一寸证件照.png' }).getByRole('button', { name: '查看' }).click()
  expect((await (await previewRequest).allHeaders()).authorization).toBe(`Bearer ${MEMBER_TOKEN}`)
  const dialog = page.getByRole('dialog', { name: '一寸证件照.png' })
  await expect(dialog).toBeVisible()
  await assetShot(page, 'documents-preview')
  await assertTapTargetPointerHit(dialog.getByRole('button', { name: '关闭预览' }))
  await dialog.getByRole('button', { name: '关闭预览' }).click()
  await expect(dialog).toHaveCount(0)

  // 保存期限：6 个月要先同意，结果以服务端返回回填。
  const longRow = rows.filter({ hasText: LONG_DOC_NAME })
  await longRow.getByRole('button', { name: '修改保存期限' }).click()
  await longRow.getByRole('button', { name: '保存 6 个月' }).click()
  await assetShot(page, 'documents-retention-confirm')
  await page.getByRole('button', { name: '同意并保存' }).click()
  await expect(page.getByTestId('member-assets-toast')).toHaveText('保存期限已更新')
  expect(api.requestCount('PATCH', '/api/v1/files/doc-long/retention')).toBe(1)
  await expect(longRow.locator('.qx-me-chip')).toContainText('保存 6 个月')

  // 删除：两步确认，服务端成功后才从列表移除。
  const zipRow = rows.filter({ hasText: '作品集源文件.zip' })
  await zipRow.getByRole('button', { name: '删除文档 作品集源文件.zip' }).click()
  await zipRow.getByRole('button', { name: '再次点击确认删除文档 作品集源文件.zip' }).click()
  await expect(page.getByText('作品集源文件.zip', { exact: true })).toHaveCount(0)
  expect(api.requestCount('DELETE', '/api/v1/files/doc-zip')).toBe(1)

  // 打印：换内部 printFileUrl 后进打印确认页，由确认页重新报价。
  await longRow.getByRole('button', { name: '打印', exact: true }).click()
  await page.waitForURL('**/print/confirm')
  await expect(page.locator('[data-w2-page="print-confirm"]')).toBeVisible()
  expect(api.requestCount('GET', '/api/v1/files/doc-long/preview-url')).toBe(1)
})

test('documents and orders: error then empty come from the server, never a cached list @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  api.respond('GET', '/api/v1/me/documents', { status: 503, json: { success: false, error: { code: 'W5_DOCS_DOWN', message: 'fixture unavailable' } } })
  api.respond('GET', '/api/v1/me/print-orders', { status: 503, json: { success: false, error: { code: 'W5_ORDERS_DOWN', message: 'fixture unavailable' } } })

  await loginThroughVisibleUi(page, '/me/documents')
  await expectQxAssetsShell(page, 'documents-error', 'documents')
  await expect(page.getByRole('heading', { name: '文档这次没有加载出来' })).toBeVisible()
  await assetShot(page, 'documents-error')
  api.respond('GET', '/api/v1/me/documents', memberPage([]))
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.getByRole('heading', { name: '还没有文档' })).toBeVisible()
  await expect(page.getByRole('region', { name: '文档资产概览' })).toContainText('0')
  await expectFusionAcceptance(page, errors)

  await page.getByTestId('member-assets-tab-orders').click()
  await expectQxAssetsShell(page, 'orders-error', 'orders')
  await expect(page.getByRole('heading', { name: '打印订单这次没有加载出来' })).toBeVisible()
  api.respond('GET', '/api/v1/me/print-orders', memberPage([]))
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.getByRole('heading', { name: '还没有打印订单' })).toBeVisible()
  await assetShot(page, 'orders-empty')
  await expect(page.getByRole('region', { name: '打印记录概览' })).toContainText('0')
  await expectFusionAcceptance(page, errors)
})

test('orders: payment truth, pickup code, filters, detail, load-more and feedback stay server-driven @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  const second = memberOrder({ id: 'order-cancelled', status: 'cancelled', completedAt: null, fileName: '第二页取消的订单.pdf' })
  // 按游标应答，而不是按第几次请求：有进行中订单时页面每 5 秒会重拉首屏，
  // 按次数应答会让轮询和「加载更多」抢同一个号。后注册的路由先匹配，这条压过 ApiRouter。
  await page.route(/\/api\/v1\/me\/print-orders(?:\?.*)?$/, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    const body = cursor === 'cursor-page-2' ? memberPage([second], null, 5) : memberPage(MEMBER_ORDERS, 'cursor-page-2', 5)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.json) })
  })
  api.respond('GET', '/api/v1/me/feedback', memberPage([]))

  await loginThroughVisibleUi(page, '/me/print-orders')
  await expectQxAssetsShell(page, 'orders-ready', 'orders')
  const rows = page.getByTestId('member-assets-order')
  await expect(rows).toHaveCount(4)
  await expectNameClearOfActions(rows.filter({ hasText: LONG_DOC_NAME }))
  await expect(rows.filter({ hasText: '历史打印.pdf' })).toContainText('暂无支付信息')
  await expect(rows.filter({ hasText: '成绩单.pdf' })).toContainText('待退款')
  // 取件码提示只跟着服务端 pickupCode 走：四单里只有一单带码。
  await expect(page.locator('.qx-me-chip', { hasText: '取件码' })).toHaveCount(1)
  await expect(page.getByText('进行中任务每 5 秒自动更新')).toBeVisible()
  await assetShot(page, 'orders-ready')
  await assertNoElementCrossesViewport(page)
  await expectFusionAcceptance(page, errors)

  const failedFilter = page.getByRole('button', { name: /^失败/ })
  await failedFilter.click()
  await expect(failedFilter).toHaveAttribute('aria-pressed', 'true')
  await expect(rows).toHaveCount(1)
  await page.getByRole('button', { name: /^全部/ }).click()

  const paidRow = rows.filter({ hasText: '个人简历.pdf' }).first()
  await paidRow.getByRole('button', { name: '查看订单详单 个人简历.pdf' }).click()
  await expect(paidRow.getByText('W5K7Q2', { exact: true })).toBeVisible()
  await expect(paidRow.getByText('下单金额')).toBeVisible()
  await expect(paidRow.getByRole('button', { name: '去我的文档再打印' })).toBeVisible()
  await assetShot(page, 'orders-detail')

  await page.getByRole('button', { name: /加载更多（已加载 4 \/ 共 5 条）/ }).click()
  await expect(page.getByText('第二页取消的订单.pdf', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /加载更多/ })).toHaveCount(0)

  const feedbackLoaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/me/feedback')
  await rows.filter({ hasText: '成绩单.pdf' }).getByRole('button', { name: '反馈打印订单 成绩单.pdf' }).click()
  await expect(page).toHaveURL(/\/me\/feedback\?category=print&relatedPrintTaskId=order-failed$/)
  await feedbackLoaded
})

test('documents and orders stay operable at 390x844 without overlap @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  api.respond('GET', '/api/v1/me/documents', memberPage(MEMBER_DOCUMENTS))
  api.respond('GET', '/api/v1/me/print-orders', memberPage(MEMBER_ORDERS))
  api.respond('GET', '/api/v1/files/doc-photo/preview-url', {
    status: 200,
    json: { success: true, data: { fileId: 'doc-photo', url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/%3E', expiresAt: FUTURE, disposition: 'inline' } },
  })

  await loginThroughVisibleUi(page, '/me/documents', { checkLoginPage: false })
  await expectQxAssetsShell(page, 'documents-ready', 'documents')
  const docRows = page.getByTestId('member-assets-document')
  await expect(docRows).toHaveCount(4)
  await assetShot(page, 'mobile-documents-ready')
  for (let index = 0; index < 4; index += 1) {
    await docRows.nth(index).scrollIntoViewIfNeeded()
    await expectNameClearOfActions(docRows.nth(index))
  }
  const view = docRows.filter({ hasText: '一寸证件照.png' }).getByRole('button', { name: '查看' })
  await view.scrollIntoViewIfNeeded()
  await assertTapTargetPointerHit(view)
  await view.click()
  const dialog = page.getByRole('dialog', { name: '一寸证件照.png' })
  await expect(dialog).toBeVisible()
  await assetShot(page, 'mobile-documents-preview')
  const dialogBox = await dialog.boundingBox()
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390)
  await dialog.getByRole('button', { name: '关闭预览' }).click()
  await assertTapTargetPointerHit(page.getByTestId('member-records-primary'))
  await assertNoElementCrossesViewport(page)
  await expectFusionAcceptance(page, errors)

  await page.getByTestId('member-assets-tab-orders').click()
  await expectQxAssetsShell(page, 'orders-ready', 'orders')
  const orderRows = page.getByTestId('member-assets-order')
  await expect(orderRows).toHaveCount(4)
  for (let index = 0; index < 4; index += 1) {
    await orderRows.nth(index).scrollIntoViewIfNeeded()
    await expectNameClearOfActions(orderRows.nth(index))
  }
  const detail = orderRows.filter({ hasText: '个人简历.pdf' }).first().getByRole('button', { name: '查看订单详单 个人简历.pdf' })
  await detail.scrollIntoViewIfNeeded()
  await assertTapTargetPointerHit(detail)
  await detail.click()
  await expect(page.getByText('W5K7Q2', { exact: true })).toBeVisible()
  await assetShot(page, 'mobile-orders-detail')
  await assertNoElementCrossesViewport(page)
  await expectFusionAcceptance(page, errors)
})


// ── /me/settings：账号设置迁入青序会员壳（稿 30 ?screen=settings） ─────────────────
const CONSENT_STATUS = '/api/v1/me/ai-consents/status'
const CONSENT_REVOKE = '/api/v1/me/ai-consents/job_ai/revoke'
const LOGOUT = '/api/v1/member/auth/logout'
const STEP_UP_SMS = '/api/v1/member/auth/step-up/sms-code'
const STEP_UP_VERIFY = '/api/v1/member/auth/step-up/verify'
const PHONE_REBIND = '/api/v1/member/phone/rebind'

function consentRows(granted: boolean): { status: number; json: unknown } {
  return {
    status: 200,
    json: { success: true, data: [{ scope: 'job_ai', consentVersion: 'w5-v1', granted, grantedAt: granted ? '2026-09-01T00:00:00.000Z' : null, revokedAt: null }] },
  }
}

function serverDown(code: string): { status: number; json: unknown } {
  return { status: 503, json: { success: false, error: { code, message: 'fixture unavailable' } } }
}

/** 旧壳（深藏青顶栏 + 底栏 + 墨青纸感页框）不得叠在青序页上；QX 登记漏掉时这里第一个红。 */
async function expectQxSettingsShell(page: Page, state: string): Promise<void> {
  await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
  await expect(page.getByTestId(`member-settings-state-${state}`)).toBeVisible()
  await expect(page.locator('[data-kiosk-screen="member-settings"]')).toBeVisible()
  await expect(page.locator('.ui-kiosk-topbar'), '青序页不得再挂旧顶栏').toHaveCount(0)
  await expect(page.locator('.ui-kiosk-nav'), '青序页不得再挂旧底栏').toHaveCount(0)
  await expect(page.locator('.me-inkdetail, [data-kiosk-component="page-frame"]'), '不得回落墨青纸感 / V6 页框').toHaveCount(0)
  await expect(page.locator('.qx-me-viewtabs'), '账号设置不挂记录 / 资产分类 Tab').toHaveCount(0)
}

/** 公共终端：会员 token 只在内存里，任何浏览器存储都不得出现。 */
async function expectTokenNotPersisted(page: Page): Promise<void> {
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(stored).not.toContain(MEMBER_TOKEN)
}

async function settingsShot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`member-settings-${name}.png`) })
}

test('settings: guest state reads no account data, then returns to /me/settings after visible login @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  api.respond('GET', CONSENT_STATUS, consentRows(false))

  await page.goto('/me/settings')
  await expectQxSettingsShell(page, 'guest')
  await expect(page.getByRole('heading', { name: '当前是游客' })).toBeVisible()
  await expect(page.getByRole('region', { name: '协议与隐私' }).getByRole('button')).toHaveCount(2)
  await expect(page.getByRole('region', { name: '隐私与 AI 授权管理' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /换绑手机号|切换账号|隐私与数据请求/ })).toHaveCount(0)
  // 游客只看到登录后会出现哪几项：不可点、明确「登录后可用」。
  const locked = page.getByRole('region', { name: '登录后才出现的账号操作' }).locator('[aria-disabled="true"]')
  await expect(locked).toHaveCount(3)
  await expect(locked.filter({ hasText: '登录后可用' })).toHaveCount(3)
  await expect(page.getByText('账号注销和数据导出尚未开放', { exact: false })).toBeVisible()
  await expect(page.getByRole('region', { name: '公共终端会话说明' })).toContainText('不写入本机存储')
  await settingsShot(page, 'guest')
  expect(api.requestCount('GET', CONSENT_STATUS)).toBe(0)
  await expectFusionAcceptance(page, errors)

  await expect(page.getByTestId('member-settings-primary')).toHaveText('手机号登录')
  await page.getByTestId('member-settings-primary').click()
  await expect(page).toHaveURL(/\/login$/)
  await completeVisibleLogin(page, '/me/settings')
  await expectQxSettingsShell(page, 'member')
  await expect(page.getByRole('region', { name: '会员账号概览' })).toContainText('138****8000')
  expect(await page.locator('body').innerText(), '原始手机号不得出现在公共屏上').not.toContain(MEMBER_PHONE)
  await expect(page.getByTestId('member-settings-consent-status')).toHaveText('未授权')
  await expect(page.getByRole('button', { name: '撤回授权', exact: true })).toBeDisabled()
  expect(api.requestCount('GET', CONSENT_STATUS)).toBe(1)
  await expectTokenNotPersisted(page)
  await expectFusionAcceptance(page, errors)
})

test('settings: consent read failure shows 本次未取到, a failed revoke keeps the grant, success comes from the server @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  api.respond('GET', CONSENT_STATUS, serverDown('W5_CONSENT_DOWN'))

  await loginThroughVisibleUi(page, '/me/settings')
  await expectQxSettingsShell(page, 'consent-error')
  const consent = page.getByRole('region', { name: '隐私与 AI 授权管理' })
  const status = page.getByTestId('member-settings-consent-status')
  const revoke = page.getByRole('button', { name: '撤回授权', exact: true })
  await expect(status).toHaveText('本次未取到')
  await expect(consent, '读不到授权状态时不得猜成「未授权」').not.toContainText('未授权')
  await expect(revoke).toBeDisabled()
  await settingsShot(page, 'consent-error')
  await expectFusionAcceptance(page, errors)

  api.respond('GET', CONSENT_STATUS, consentRows(true))
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expectQxSettingsShell(page, 'member')
  await expect(status).toHaveText('已授权')
  await expect(revoke).toBeEnabled()
  expect(api.requestCount('GET', CONSENT_STATUS)).toBe(2)
  await settingsShot(page, 'member-granted')

  // 撤回失败：弹层留着并说清楚「没有改变」，取消后徽标和按钮都维持服务端上一次返回的「已授权」。
  api.respond('POST', CONSENT_REVOKE, serverDown('W5_REVOKE_DOWN'))
  await revoke.click()
  const dialog = page.getByRole('dialog', { name: '撤回岗位 AI 授权' })
  await expect(dialog).toBeVisible()
  const failed = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === CONSENT_REVOKE)
  await dialog.getByRole('button', { name: '确认撤回', exact: true }).click()
  expect((await (await failed).allHeaders()).authorization).toBe(`Bearer ${MEMBER_TOKEN}`)
  await expect(dialog.getByRole('alert')).toHaveText('撤回失败，请稍后重试；授权状态没有改变。')
  await settingsShot(page, 'revoke-failed')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(status).toHaveText('已授权')
  await expect(revoke).toBeEnabled()
  expect(api.requestCount('POST', CONSENT_REVOKE)).toBe(1)

  api.respond('POST', CONSENT_REVOKE, { status: 200, json: { success: true, data: { scope: 'job_ai', consentVersion: 'w5-v1', granted: false, grantedAt: null, revokedAt: '2026-09-23T00:00:00.000Z' } } })
  await revoke.click()
  await expect(dialog.getByRole('alert'), '重开弹层不得残留上一次的失败提示').toHaveCount(0)
  await dialog.getByRole('button', { name: '确认撤回', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('member-settings-toast')).toHaveText('已撤回岗位 AI 授权，再次使用时需要重新确认')
  await expect(status).toHaveText('未授权')
  await expect(revoke).toBeDisabled()
  expect(api.requestCount('POST', CONSENT_REVOKE)).toBe(2)
})

test('settings: phone rebind hides both codes, closes after 45s idle and clears the session when done @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  api.respond('GET', CONSENT_STATUS, consentRows(false))
  api.respond('POST', STEP_UP_SMS, { status: 200, json: { success: true, data: { challengeId: 'w5-rebind-challenge', phoneMasked: '138****8000', expiresInSeconds: 300, cooldownSeconds: 60 } } })
  api.respond('POST', STEP_UP_VERIFY, { status: 200, json: { success: true, data: { stepUpToken: 'w5-step-up-token', action: 'phone_rebind', expiresInSeconds: 300 } } })
  api.respond('POST', PHONE_REBIND, { status: 200, json: { success: true, data: { newPhoneMasked: '139****9000', sessionsRevoked: 1 } } })
  api.respond('POST', LOGOUT, { status: 200, json: { success: true, data: { loggedOut: true } } })
  await page.clock.install()

  await loginThroughVisibleUi(page, '/me/settings')
  await expectQxSettingsShell(page, 'member')
  await expectFusionAcceptance(page, errors)

  // 45 秒无操作：换绑弹层自己关掉，不留在大厅屏上。
  const rebindRow = page.getByRole('button', { name: /换绑手机号/ })
  await rebindRow.click()
  const dialog = page.getByRole('dialog', { name: '换绑手机号' })
  await expect(dialog).toContainText('第 1 步')
  await expect(dialog).toContainText('138****8000')
  await page.clock.fastForward(46_000)
  await expect(dialog).toHaveCount(0)
  expect(api.requestCount('POST', STEP_UP_SMS)).toBe(0)

  await rebindRow.click()
  await dialog.getByRole('button', { name: '发送验证码', exact: true }).click()
  const oldOtp = dialog.getByLabel('当前手机号验证码，已隐藏显示')
  await expect(oldOtp).toHaveAttribute('type', 'password')
  await oldOtp.fill('654321')
  await settingsShot(page, 'rebind-old-code')
  expect(await page.locator('body').innerText()).not.toContain('654321')
  const verify = page.waitForRequest((r) => new URL(r.url()).pathname === STEP_UP_VERIFY)
  await dialog.getByRole('button', { name: '下一步', exact: true }).click()
  expect((await verify).postDataJSON()).toEqual({ challengeId: 'w5-rebind-challenge', code: '654321' })

  await dialog.getByLabel('新手机号', { exact: true }).fill('13900139000')
  await dialog.getByRole('button', { name: '发送验证码', exact: true }).click()
  await expect(dialog).toContainText('139****9000')
  const newOtp = dialog.getByLabel('新手机号验证码，已隐藏显示')
  await expect(newOtp).toHaveAttribute('type', 'password')
  await newOtp.fill('112233')
  expect(await page.locator('body').innerText()).not.toContain('112233')
  const rebind = page.waitForRequest((r) => new URL(r.url()).pathname === PHONE_REBIND)
  await dialog.getByRole('button', { name: '确认换绑', exact: true }).click()
  expect((await rebind).postDataJSON()).toEqual({ stepUpToken: 'w5-step-up-token', newPhone: '13900139000', newPhoneCode: '112233' })
  await expect(dialog).toContainText('换绑成功')
  await settingsShot(page, 'rebind-done')

  await dialog.getByRole('button', { name: '去登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/login')
  await expect(page.getByText('换绑成功，请用新手机号登录')).toBeVisible()
  await expectTokenNotPersisted(page)
})

test('settings: switch-account cancel keeps the session, logout confirms first and clears it @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  registerHomeApi(api, [])
  api.respond('GET', CONSENT_STATUS, consentRows(true))
  api.respond('POST', LOGOUT, { status: 200, json: { success: true, data: { loggedOut: true } } })

  await loginThroughVisibleUi(page, '/me/settings')
  await expectQxSettingsShell(page, 'member')

  // 取消不清任何东西。
  await page.getByRole('button', { name: /切换账号/ }).click()
  const switchDialog = page.getByRole('dialog', { name: '切换账号' })
  await expect(switchDialog).toBeVisible()
  await switchDialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(switchDialog).toHaveCount(0)
  await expectQxSettingsShell(page, 'member')
  expect(api.requestCount('POST', LOGOUT)).toBe(0)

  await page.getByTestId('member-settings-primary').click()
  const logoutDialog = page.getByRole('dialog', { name: '退出登录' })
  await expect(logoutDialog).toBeVisible()
  await settingsShot(page, 'logout-confirm')
  await logoutDialog.getByRole('button', { name: '退出登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/profile')
  await expect(page.locator('[data-kiosk-screen="profile"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '手机号登录', exact: true })).toBeVisible()
  expect(api.requestCount('POST', LOGOUT)).toBe(1)
  await expectTokenNotPersisted(page)
  expect(errors).toEqual([])
})

// 清场后隐私边界会把「直接输网址」判成越界并清回首页，所以切换账号单独开一页，不在上一条里二次登录。
test('settings: switch account confirms, clears the session and lands on the login page @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  api.respond('GET', CONSENT_STATUS, consentRows(true))
  api.respond('POST', LOGOUT, { status: 200, json: { success: true, data: { loggedOut: true } } })

  await loginThroughVisibleUi(page, '/me/settings')
  await expectQxSettingsShell(page, 'member')
  await page.getByRole('button', { name: /切换账号/ }).click()
  const switchDialog = page.getByRole('dialog', { name: '切换账号' })
  await expect(switchDialog).toContainText('不会带入下一个账号')
  await switchDialog.getByRole('button', { name: '退出并切换', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/login')
  await expect(page.getByRole('button', { name: '验证并登录', exact: true })).toBeVisible()
  expect(api.requestCount('POST', LOGOUT)).toBe(1)
  await expectTokenNotPersisted(page)
  expect(errors).toEqual([])
})

test('settings stays operable at 390x844 without overlap @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerMemberLogin(api)
  registerAuthenticatedShell(api)
  api.respond('GET', CONSENT_STATUS, consentRows(true))

  await loginThroughVisibleUi(page, '/me/settings', { checkLoginPage: false })
  await expectQxSettingsShell(page, 'member')
  await settingsShot(page, 'mobile-member')
  await assertNoElementCrossesViewport(page)
  const revoke = page.getByRole('button', { name: '撤回授权', exact: true })
  await revoke.scrollIntoViewIfNeeded()
  await assertTapTargetPointerHit(revoke)
  const privacy = page.getByTestId('member-settings-privacy')
  await privacy.scrollIntoViewIfNeeded()
  await assertTapTargetPointerHit(privacy)
  await assertTapTargetPointerHit(page.getByTestId('member-settings-primary'))
  await expectFusionAcceptance(page, errors)

  await page.getByTestId('member-settings-primary').click()
  const dialog = page.getByRole('dialog', { name: '退出登录' })
  await expect(dialog).toBeVisible()
  await settingsShot(page, 'mobile-logout-confirm')
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  await assertTapTargetPointerHit(dialog.getByRole('button', { name: '取消', exact: true }))
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
