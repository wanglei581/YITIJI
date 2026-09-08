import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoElementCrossesViewport, assertNoHorizontalOverflow, assertTapTargetPointerHit } from './assert-layout'

const MEMBER_TOKEN = 'qx-profile-member-token'
const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
    }
  })
  return errors
}

function emptyPage(total = 0) {
  return { success: true, data: { items: [], nextCursor: null, total } }
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
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: false, modules: { welcome: false, bigdata: false, luggage: false, panorama: false }, items: [] },
      toolbox: { enabled: false, items: [] },
      configVersion: 'qx-profile',
      refreshIntervalMs: 300000,
      serverTime: '2026-09-07T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
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
      data: {
        token: MEMBER_TOKEN,
        user: { id: 'member-qx-profile', phoneMasked: '138****8000', nickname: '青序验收用户' },
      },
    },
  })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: emptyPage(0) })
}

function registerAssetCounts(api: ApiRouter, totals: Record<string, number>): void {
  api.respond('GET', '/api/v1/me/resumes', { status: 200, json: emptyPage(totals.resumes ?? 0) })
  api.respond('GET', '/api/v1/me/documents', { status: 200, json: emptyPage(totals.documents ?? 0) })
  api.respond('GET', '/api/v1/me/print-orders', { status: 200, json: emptyPage(totals.orders ?? 0) })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: emptyPage(totals.favorites ?? 0) })
  api.respond('GET', '/api/v1/me/benefits', { status: 200, json: emptyPage(totals.benefits ?? 0) })
  api.respond('GET', '/api/v1/me/ai-records', { status: 200, json: emptyPage(totals.ai ?? 0) })
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

async function expectComplianceCopy(page: Page): Promise<void> {
  await expect(page.getByText('一键投递')).toHaveCount(0)
  await expect(page.getByText('立即投递')).toHaveCount(0)
  await expect(page.getByText('平台投递')).toHaveCount(0)
  await expect(page.getByText('投递简历')).toHaveCount(0)
  await expect(page.getByText('我要应聘')).toHaveCount(0)
  await expect(page.getByText('立即报名')).toHaveCount(0)
  await expect(page.getByText('已投递')).toHaveCount(0)
  await expect(page.getByText('待面试')).toHaveCount(0)
  await expect(page.getByText('已录用')).toHaveCount(0)
}

test('profile signed-out reads no member totals and keeps recruitment copy at zero @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/profile')
  await expect(page.getByTestId('profile-state-signed-out')).toBeVisible()
  await expect(page.getByRole('button', { name: '手机号登录', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('region', { name: '我的资产' })).toBeVisible()
  await expect(page.getByText('这台机器是公共终端')).toBeVisible()
  await expectComplianceCopy(page)
  await assertNoHorizontalOverflow(page)
  await assertNoElementCrossesViewport(page)
  await assertTapTargetPointerHit(page.getByRole('button', { name: '手机号登录', exact: true }).first())
  await page.screenshot({ path: test.info().outputPath('profile-signed-out.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('profile payment todo is driven by pending-tasks payload @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  registerAssetCounts(api, { resumes: 3, documents: 7, orders: 2, favorites: 12, benefits: 1, ai: 9 })
  const pendingRequest = page.waitForRequest((request) =>
    request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/me/pending-tasks',
  )
  api.respond('GET', '/api/v1/me/pending-tasks', {
    status: 200,
    json: {
      success: true,
      data: [{
        id: 'task-pay-1',
        type: 'print',
        status: 'pending',
        payStatus: 'unpaid',
        fileName: '求职简历-终稿.pdf',
        updatedAt: '2026-09-07T09:00:00.000Z',
        resume: {
          kind: 'payment',
          orderId: 'ord-1',
          orderNo: 'P2609020317',
          amountCents: 240,
          priceLines: [],
          paymentSessionToken: 'pay-token-1',
        },
      }],
    },
  })

  await loginThroughVisibleUi(page, '/profile')
  const pending = await pendingRequest
  expect((await pending.allHeaders()).authorization).toBe(`Bearer ${MEMBER_TOKEN}`)
  await expect(page.getByTestId('profile-state-ready')).toBeVisible()
  await expect(page.getByText('有一份文件还没付款')).toBeVisible()
  await expect(page.getByText('求职简历-终稿.pdf')).toBeVisible()
  await expect(page.getByText('¥2.40')).toBeVisible()
  await expect(page.getByTestId('profile-asset-resumes')).toContainText('3')
  await expectComplianceCopy(page)

  const continueBtn = page.getByTestId('profile-resume')
  await expect(continueBtn).toHaveText('继续付款')
  await assertTapTargetPointerHit(continueBtn)
  await page.screenshot({ path: test.info().outputPath('profile-payment.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('profile overview error keeps slots as dash and does not reuse previous totals @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  for (const path of ['/api/v1/me/resumes', '/api/v1/me/documents', '/api/v1/me/print-orders', '/api/v1/me/favorites', '/api/v1/me/benefits', '/api/v1/me/ai-records']) {
    api.respond('GET', path, { status: 500, json: { success: false, error: { code: 'DOWN', message: 'fixture unavailable' } } })
  }
  api.respond('GET', '/api/v1/me/pending-tasks', {
    status: 500,
    json: { success: false, error: { code: 'DOWN', message: 'fixture unavailable' } },
  })

  await loginThroughVisibleUi(page, '/profile')
  await expect(page.getByTestId('profile-state-error')).toBeVisible()
  await expect(page.getByTestId('profile-fallback').getByText('账号数据这次没取到')).toBeVisible()
  await expect(page.getByTestId('profile-asset-resumes')).toContainText('—')
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible()
  await expectComplianceCopy(page)
  await page.screenshot({ path: test.info().outputPath('profile-error.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('benefits empty and error states stay honest and read GET /me/benefits @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/benefits', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })

  await loginThroughVisibleUi(page, '/me/benefits')
  await expect(page.getByTestId('benefits-state-empty')).toBeVisible()
  await expect(page.getByText('还没有权益')).toBeVisible()
  await expect(page.getByRole('button', { name: '看可参加的活动', exact: true })).toBeVisible()
  await expect(page.getByText('立即支付')).toHaveCount(0)
  await expect(page.getByText('核销成功')).toHaveCount(0)
  await expectComplianceCopy(page)
  api.respond('GET', '/api/v1/activities', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  await page.getByRole('button', { name: '看可参加的活动', exact: true }).click()
  await expect(page).toHaveURL(/\/activities/)
  expect(errors).toEqual([])
})

test('benefits error does not invent a ledger after GET failure @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/benefits', {
    status: 503,
    json: { success: false, error: { code: 'DOWN', message: 'fixture unavailable' } },
  })

  await loginThroughVisibleUi(page, '/me/benefits')
  await expect(page.getByTestId('benefits-state-error')).toBeVisible()
  await expect(page.getByTestId('benefits-fallback').getByText('权益台账这次没取到')).toBeVisible()
  await expect(page.getByText('不显示上一次缓存的权益')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible()
  await expectComplianceCopy(page)
  await page.screenshot({ path: test.info().outputPath('benefits-error.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('feedback submit posts the visible form payload and shows server failure @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
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

  const posted = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/me/feedback')
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()
  const request = await posted
  expect(request.postDataJSON()).toMatchObject({
    category: 'print',
    title: '页面使用反馈',
    content: '这是用于验证真实反馈提交失败状态的合成说明。',
  })
  await expect(page.getByText('提交失败，请检查登录状态或稍后重试', { exact: true })).toBeVisible()
  await expectComplianceCopy(page)
  await page.screenshot({ path: test.info().outputPath('feedback-submit-error.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('privacy revoke posts revoke_consent and does not claim account deletion @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/data-requests', {
    status: 200,
    json: {
      success: true,
      data: { items: [], nextCursor: null, capabilities: { accountClosureAvailable: false } },
    },
  })
  api.respond('POST', '/api/v1/me/data-requests', {
    status: 200,
    json: {
      success: true,
      data: {
        id: 'req-1',
        requestType: 'revoke_consent',
        status: 'completed',
        requestedAt: '2026-09-07T09:00:00.000Z',
        handledAt: '2026-09-07T09:00:00.000Z',
        executionStep: null,
        exportExpiresAt: null,
        failureCode: null,
        canRetry: false,
        canDownload: false,
      },
    },
  })

  await loginThroughVisibleUi(page, '/me/privacy-requests')
  await expect(page.getByText('撤回岗位 AI 授权').first()).toBeVisible()
  await expect(page.getByText('一体机未开放')).toBeVisible()
  await expect(page.getByText('暂未开放').first()).toBeVisible()
  await page.getByTestId('member-privacy-revoke-entry').click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const posted = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/me/data-requests')
  await page.getByRole('button', { name: '确认撤回', exact: true }).click()
  const request = await posted
  expect(request.postDataJSON()).toMatchObject({ requestType: 'revoke_consent' })
  expect((await request.allHeaders())['idempotency-key'] ?? (await request.allHeaders())['Idempotency-Key']).toBeTruthy()
  await expect(page.getByText('已撤回岗位 AI 授权，请求已记录')).toBeVisible()
  await expect(page.getByText('全部个人数据已删除')).toHaveCount(0)
  await expect(page.getByText('账号注销成功')).toHaveCount(0)
  await expectComplianceCopy(page)
  await page.screenshot({ path: test.info().outputPath('privacy-revoke.png'), fullPage: true })
  expect(errors).toEqual([])
})
