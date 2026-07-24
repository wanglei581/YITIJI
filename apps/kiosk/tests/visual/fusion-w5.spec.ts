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

function registerAuthenticatedShell(api: ApiRouter): void {
  registerKioskShell(api)
  api.respond('GET', '/api/v1/me/favorites', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
}

function terminalConfig(toolbox: { enabled: boolean; items: unknown[] }): unknown {
  return {
    smartCampus: { enabled: false, modules: {}, items: [] },
    toolbox,
    configVersion: 'w5-browser-fixture',
    refreshIntervalMs: 300000,
    serverTime: '2026-07-24T00:00:00.000Z',
  }
}

test('profile permission state uses the canonical fusion shell @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerKioskShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: { smartCampus: { enabled: false, modules: {}, items: [] }, toolbox: { enabled: false, items: [] }, configVersion: 'w5', refreshIntervalMs: 300000, serverTime: '2026-07-24T00:00:00.000Z' },
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
  },
  { label: 'empty', toolbox: { enabled: false, items: [] }, text: '待配置' },
] as const) {
  test(`toolbox renders the ${scenario.label} terminal-config branch @w5-kiosk`, async ({ page, api }) => {
    const errors = runtimeErrors(page)
    registerKioskShell(api)
    api.respond('GET', '/api/v1/terminals/KSK-001/config', {
      status: 200,
      json: terminalConfig(scenario.toolbox),
    })

    await page.goto('/toolbox')
    await expect(page.locator('[data-kiosk-screen="toolbox"]')).toBeVisible()
    await expect(page.getByText(scenario.text, { exact: true })).toBeVisible()
    if (scenario.label === 'configured') {
      await expect(page.getByRole('button', { name: /使用帮助/ })).toBeEnabled()
    } else {
      await expect(page.locator('.ktoolbox .tile')).toHaveCount(0)
    }
    await expectFusionAcceptance(page, errors)
  })
}

test('session timeout exposes continue, logout and countdown controls @w5-kiosk', async ({ page }) => {
  const errors = runtimeErrors(page)
  await page.goto('/session-timeout')
  await expect(page.locator('[data-kiosk-screen="session-timeout"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '继续使用', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '立即退出并清除本机会话', exact: true })).toBeVisible()
  await expect(page.getByText('秒后自动退出', { exact: true })).toBeVisible()
  await expectFusionAcceptance(page, errors)
})

test('offline page retains the 8177 state after an aborted health request @w5-kiosk', async ({ page, api }) => {
  const errors = runtimeErrors(page)
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
  await page.getByLabel('选择文件').setInputFiles({
    name: 'w5-sample.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-w5-browser-fixture'),
  })
  await expect(page.getByText('上传失败', { exact: true })).toBeVisible()
  await expect(page.getByText('网络连接失败，请稍后重试', { exact: true })).toBeVisible()
  await expect(page.getByText('w5-one-time-upload')).toHaveCount(0)
  await expectFusionAcceptance(page, errors)
})
