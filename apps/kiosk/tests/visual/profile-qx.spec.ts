import type { Page } from '@playwright/test'
import { UNATTENDED_FORBIDDEN_PHRASES } from '../../src/copy/unattendedCopy'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { RECRUITMENT_HOSTING_OFF, RECRUITMENT_HOSTING_ON, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'
import { assertNoElementCrossesViewport, assertNoHorizontalOverflow, assertTapTargetPointerHit } from './assert-layout'
import { isAbortedPdfjsBlobImport } from './fixtures/pdf-preview-blob-abort'

/** 默认夹具号码与服务时间，见 tests/fixtures/api-router.ts 的 support-contact。 */
const FIXTURE_SERVICE_PHONE = '18369161921'
const FIXTURE_SERVICE_HOURS = '工作日 9:00–18:00'
const NO_PHONE_HINT = '查看《隐私政策》里的联系方式'
const FIXTURE_HELP_LINE = `需要帮助？拨打服务电话 ${FIXTURE_SERVICE_PHONE}（${FIXTURE_SERVICE_HOURS}）`

const MEMBER_TOKEN = 'qx-profile-member-token'
const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (isAbortedPdfjsBlobImport(request)) return
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
      ...RECRUITMENT_HOSTING_ON,
      configVersion: 'qx-profile',
      refreshIntervalMs: 300000,
      serverTime: '2026-09-07T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
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
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
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
  await expect(page.locator('.qx-topbar button')).toHaveCount(1)
  await expect(page.locator('.qx-topbar button')).toHaveAccessibleName('返回首页')
  await expect(page.locator('.qx-step-prev')).toHaveText('返回首页')
  await expect(page.getByRole('button', { name: '去登录', exact: true })).toHaveCount(2)
  await expect(page.getByRole('region', { name: '我的资产' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '登录与不登录的分界' })).toBeVisible()
  await expect(page.getByText('这台机器是公共终端')).toBeVisible()
  await expectComplianceCopy(page)
  await assertNoHorizontalOverflow(page)
  await assertNoElementCrossesViewport(page)
  await assertTapTargetPointerHit(page.getByTestId('profile-primary'))
  await assertTapTargetPointerHit(page.locator('.pf-idbtn'))
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
  const idBox = await page.locator('.pf-idcard').boundingBox()
  const btnBox = await continueBtn.boundingBox()
  expect(btnBox && idBox && btnBox.y >= idBox.y + idBox.height - 1, '待办操作在身份卡下方').toBe(true)
  expect(btnBox && idBox && btnBox.y <= idBox.y + idBox.height + 120, '待办操作贴着身份卡，中间不留空档').toBe(true)
  expect(await page.locator('.pf-page').evaluate((el) => el.scrollHeight - el.clientHeight), '默认待办态首屏放得下').toBeLessThanOrEqual(1)
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

// 走查 W-01：一体机此前点不到 AI 内容投诉（服务端与小程序早就有 ai_content）。
// 从 AI 服务记录页的文字入口进来，应预选「AI 内容投诉」、显示 5 个工作日答复说明，并按这一类提交。
test('ai-records complaint entry preselects AI 内容投诉 and posts category ai_content @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/ai-records', { status: 200, json: emptyPage(0) })
  api.respond('GET', '/api/v1/me/job-ai-sessions', { status: 200, json: emptyPage(0) })
  api.respond('GET', '/api/v1/me/mock-interviews', { status: 200, json: { success: true, data: { items: [] } } })
  api.respond('GET', '/api/v1/me/feedback', { status: 200, json: emptyPage(0) })
  api.respond('POST', '/api/v1/me/feedback', {
    status: 503,
    json: { success: false, error: { code: 'W01_FEEDBACK_UNAVAILABLE', message: 'fixture unavailable' } },
  })

  await loginThroughVisibleUi(page, '/me/ai-records')
  const entry = page.getByTestId('member-records-ai-complaint').getByRole('button', { name: '投诉 AI 内容', exact: true })
  await expect(entry).toBeVisible()
  await assertTapTargetPointerHit(entry)
  await entry.click()
  await expect(page).toHaveURL(/\/me\/feedback\?category=ai_content$/)
  await expect(page.getByRole('button', { name: /^AI 内容投诉/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('member-feedback-ai-content-note')).toContainText('5 个工作日内答复')
  await page.getByLabel('反馈内容').fill('简历优化建议里把我的实习时间写错了，是合成验收说明。')

  const posted = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/me/feedback')
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()
  expect((await posted).postDataJSON()).toMatchObject({ category: 'ai_content' })
  await expect(page.getByText('提交失败，请检查登录状态或稍后重试', { exact: true })).toBeVisible()
  await assertNoHorizontalOverflow(page)
  await expectComplianceCopy(page)
  await page.screenshot({ path: test.info().outputPath('feedback-ai-content.png'), fullPage: true })
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
  await expect(page.getByText('撤回 AI 使用授权').first()).toBeVisible()
  // 2026-09-30 A 批：旧名「岗位 AI 授权」与工程词「元数据」「step-up」不再上屏（稿 41）。
  await expect(page.getByText(/岗位 AI 授权|元数据|step-up/)).toHaveCount(0)
  await expect(page.getByText('一体机未开放')).toBeVisible()
  await expect(page.getByText('暂未开放').first()).toBeVisible()
  await page.getByTestId('member-privacy-revoke-entry').click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const posted = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/me/data-requests')
  await page.getByRole('button', { name: '确认撤回', exact: true }).click()
  const request = await posted
  expect(request.postDataJSON()).toMatchObject({ requestType: 'revoke_consent' })
  expect((await request.allHeaders())['idempotency-key'] ?? (await request.allHeaders())['Idempotency-Key']).toBeTruthy()
  await expect(page.getByText('已撤回 AI 使用授权，请求已记录')).toBeVisible()
  await expect(page.getByText('全部个人数据已删除')).toHaveCount(0)
  await expect(page.getByText('账号注销成功')).toHaveCount(0)
  await expectComplianceCopy(page)
  await page.screenshot({ path: test.info().outputPath('privacy-revoke.png'), fullPage: true })
  expect(errors).toEqual([])
})

// ── 「我的」共用外壳（C1-2）：返回键、页名胶囊、页签下移、问小青、字号下限 ──

const ME_SHELL_PAGES: { path: string; name: string; tabs: boolean; ask: string; draft: string }[] = [
  { path: '/me/documents', name: '我的文档', tabs: true, ask: '问小青：怎么打', draft: '我的文档怎么打印？打印前要注意什么？' },
  { path: '/me/print-orders', name: '我的打印订单', tabs: true, ask: '问小青：怎么打', draft: '我的文档怎么打印？打印前要注意什么？' },
  { path: '/me/resumes', name: '我的简历', tabs: true, ask: '问小青', draft: '这里的记录能存多久？删掉会怎样？' },
  { path: '/me/favorites', name: '我的收藏', tabs: true, ask: '问小青', draft: '这里的记录能存多久？删掉会怎样？' },
  { path: '/me/ai-records', name: 'AI服务记录', tabs: true, ask: '问小青', draft: '这里的记录能存多久？删掉会怎样？' },
  { path: '/me/activity', name: '浏览与跳转记录', tabs: true, ask: '问小青', draft: '这里的记录能存多久？删掉会怎样？' },
  { path: '/me/notifications', name: '消息通知', tabs: false, ask: '问小青', draft: '收到这条通知，接下来我该怎么做？' },
]

async function stageScale(page: Page): Promise<number> {
  const scaler = page.locator('.kiosk-stage')
  if (await scaler.count() === 0) return 1
  const transform = await scaler.evaluate((element) => getComputedStyle(element).transform)
  return transform === 'none' ? 1 : Number(transform.match(/^matrix\(([^,]+)/)?.[1] ?? 1)
}

async function stageBox(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('.kiosk-stage').boundingBox()
  return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

function registerMeShellLists(api: ApiRouter): void {
  registerAssetCounts(api, {})
  const empty = { status: 200 as const, json: emptyPage(0) }
  api.respond('GET', '/api/v1/me/notifications', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0, unreadCount: 0 } },
  })
  api.respond('GET', '/api/v1/me/browse-logs', empty)
  api.respond('GET', '/api/v1/me/external-jump-logs', empty)
  api.respond('GET', '/api/v1/me/job-ai-sessions', empty)
  api.respond('GET', '/api/v1/me/job-applications', empty)
  api.respond('GET', '/api/v1/me/mock-interviews', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null } },
  })
}

async function countSmallVisibleText(page: Page): Promise<number> {
  return page.locator('.qx-stage').evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const seen = new Set<Element>()
    let count = 0
    let node = walker.nextNode()
    while (node) {
      const text = node.textContent?.replace(/\s+/g, '') ?? ''
      const el = node.parentElement
      node = walker.nextNode()
      if (!text || !el || seen.has(el)) continue
      if (/备案/.test(text)) continue
      seen.add(el)
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      if (parseFloat(style.fontSize) < 20) count += 1
    }
    return count
  })
}

/** 点「问小青」会进顾问页，顾问页挂载时读语音能力。登记上，避免拆卸时报未处理请求。 */
function registerAssistantLanding(api: ApiRouter): void {
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { data: { asrEnabled: false, ttsEnabled: false } },
  })
}

async function expectMeShell(page: Page, item: (typeof ME_SHELL_PAGES)[number]): Promise<void> {
  const scale = await stageScale(page)
  const origin = await stageBox(page)
  const back = page.locator('.qx-topbar-back')
  await expect(page.locator('[data-kiosk-domain="profile"]')).not.toHaveAttribute('data-state', /(^|-)loading$/)
  await expect(back).toHaveCount(1)
  await expect(back).toHaveAccessibleName('返回我的')
  const backBox = await back.boundingBox()
  expect(backBox, '返回键有盒子').not.toBeNull()
  expect(backBox!.width / scale).toBeGreaterThanOrEqual(64)
  expect(backBox!.height / scale).toBeGreaterThanOrEqual(64)
  await expect(page.locator('.qx-pill')).toHaveText(item.name)
  if (item.tabs) {
    const tab = page.locator('.qx-me-vtab').first()
    const tabBox = await tab.boundingBox()
    expect(tabBox, '页签有盒子').not.toBeNull()
    expect((tabBox!.y - origin.y) / scale, `${item.path} 页签上边`).toBeGreaterThanOrEqual(500)
  } else {
    await expect(page.locator('.qx-me-vtab')).toHaveCount(0)
    await expect(page.getByTestId('qx-me-take')).toHaveCount(0)
  }
  expect(await countSmallVisibleText(page), `${item.path} 小于 20px 的可见文字`).toBe(0)
  const keys = page.locator('.qx-me-cta-row .qx-btn')
  await expect(keys).toHaveCount(3)
  await expect(page.getByTestId('qx-me-ask')).toHaveAccessibleName(item.ask)
  await page.getByTestId('qx-me-ask').click()
  await expect(page).toHaveURL(/\/assistant$/)
  await expect(page.locator('#assistant-question')).toHaveValue(item.draft)
  await page.goto(item.path)
  await back.click()
  await expect(page).toHaveURL(/\/profile$/)
}

test('me error cta on documents and notifications includes 问小青 @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  const down = { status: 500 as const, json: { success: false, error: { code: 'DOWN', message: 'fixture unavailable' } } }
  api.respond('GET', '/api/v1/me/documents', down)
  api.respond('GET', '/api/v1/me/notifications', down)

  await loginThroughVisibleUi(page, '/me/documents')
  const documentsRow = page.locator('.qx-me-cta-row')
  // 2026-10-06：10/4 无人值守。失败态不再叫「联系工作人员」，改为「帮助中心」，仍去 /help。
  await expect(documentsRow.getByRole('button', { name: '帮助中心', exact: true })).toBeVisible()
  await expect(documentsRow.getByTestId('qx-me-ask')).toHaveAccessibleName('问小青：怎么打')
  await expect(documentsRow.getByRole('button', { name: '重新加载', exact: true }).locator('svg')).toHaveCount(1)
  await expect(documentsRow.locator('.qx-btn')).toHaveCount(3)

  await loginThroughVisibleUi(page, '/me/notifications')
  const notificationsRow = page.locator('.qx-me-cta-row')
  await expect(notificationsRow.getByRole('button', { name: '帮助中心', exact: true })).toBeVisible()
  await expect(notificationsRow.getByTestId('qx-me-ask')).toHaveAccessibleName('问小青')
  await expect(notificationsRow.getByRole('button', { name: '重新加载', exact: true }).locator('svg')).toHaveCount(1)
  await expect(notificationsRow.locator('.qx-btn')).toHaveCount(3)
  expect(errors).toEqual([])
})

/** 行盒子，以及行里画出来的内容，都不得压进下一行。 */
async function expectListRowsDoNotOverlap(page: Page, listName: string): Promise<void> {
  const list = page.getByRole('region', { name: listName })
  await expect(list.locator(':scope > .qx-me-row').nth(1)).toBeVisible()
  const hits = await list.evaluate((root) => {
    const rows = [...root.querySelectorAll(':scope > .qx-me-row')]
    const found: string[] = []
    for (let index = 0; index < rows.length - 1; index += 1) {
      const nextTop = rows[index + 1].getBoundingClientRect().top
      const pieces = [rows[index], ...rows[index].querySelectorAll('*')]
      for (const piece of pieces) {
        const box = piece.getBoundingClientRect()
        if (box.width < 1 || box.height < 1) continue
        if (box.bottom > nextTop + 0.5) {
          found.push(`第 ${index + 1} 行内容 bottom ${box.bottom.toFixed(1)} > 下一行 top ${nextTop.toFixed(1)}`)
          break
        }
      }
    }
    return found
  })
  expect(hits, hits.join('\n')).toEqual([])
}

test('me list rows do not overlap on notifications, documents and resumes @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  const createdAt = '2026-09-01T08:00:00.000Z'
  const expiresAt = '2099-03-01T00:00:00.000Z'
  api.respond('GET', '/api/v1/me/notifications', {
    status: 200,
    json: {
      success: true,
      data: {
        items: Array.from({ length: 8 }, (_, index) => ({
          id: `n-${index}`,
          kind: 'personal',
          title: `打印进度提醒 ${index + 1}：这份材料已经排到队列里`,
          content: '取件前请核对页数和颜色。这条说明要占一整行，避免行被压扁后文字叠到下一条。',
          category: index % 2 === 0 ? 'print' : 'feedback',
          relatedType: index % 2 === 0 ? null : 'feedback_ticket',
          relatedId: index % 2 === 0 ? null : `ticket-${index}`,
          isRead: false,
          createdAt,
        })),
        nextCursor: null,
        total: 8,
        unreadCount: 8,
      },
    },
  })
  api.respond('GET', '/api/v1/me/documents', {
    status: 200,
    json: {
      success: true,
      data: {
        items: Array.from({ length: 6 }, (_, index) => ({
          id: `doc-${index}`,
          filename: `2026届求职材料-个人简历与成绩单-第${index + 1}份-请勿外传.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 245760,
          purpose: 'print_doc',
          sensitiveLevel: 'normal',
          assetCategory: 'original',
          retentionPolicy: 'months_3',
          allowedRetentionPolicies: ['months_3', 'months_6', 'long_term'],
          createdAt,
          expiresAt,
          downloadUrlPath: `/files/doc-${index}/download-url`,
          previewUrlPath: `/files/doc-${index}/preview-url`,
          materialCheckRequired: false,
          pageCount: 2,
        })),
        nextCursor: null,
        total: 6,
      },
    },
  })
  api.respond('GET', '/api/v1/me/resumes', {
    status: 200,
    json: {
      success: true,
      data: {
        items: Array.from({ length: 6 }, (_, index) => ({
          id: `resume-${index}`,
          taskId: `task-${index}`,
          kind: 'parse',
          status: 'completed',
          provider: 'demo',
          optimized: false,
          hasDraft: false,
          latestVersion: null,
          createdAt,
          updatedAt: createdAt,
          expiresAt,
        })),
        nextCursor: null,
        total: 6,
      },
    },
  })

  await loginThroughVisibleUi(page, '/me/notifications')
  await expectListRowsDoNotOverlap(page, '消息通知')
  await loginThroughVisibleUi(page, '/me/documents')
  await expectListRowsDoNotOverlap(page, '我的文档')
  await loginThroughVisibleUi(page, '/me/resumes')
  await expectListRowsDoNotOverlap(page, '我的简历')
  expect(errors).toEqual([])
})

test('resume row titles do not include an 8-character hex task id @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  const createdAt = '2026-10-06T09:12:00.000+08:00'
  const expiresAt = '2099-12-20T09:12:00.000+08:00'
  api.respond('GET', '/api/v1/me/resumes', {
    status: 200,
    json: {
      success: true,
      data: {
        items: [
          {
            id: 'resume-hex',
            taskId: 'task-7f3a91c2',
            kind: 'parse',
            status: 'completed',
            provider: 'demo',
            optimized: true,
            hasDraft: false,
            latestVersion: 1,
            createdAt,
            updatedAt: createdAt,
            expiresAt,
          },
          {
            id: 'resume-hex-gen',
            taskId: 'task-2c8e44b1',
            kind: 'generate',
            status: 'completed',
            provider: 'demo',
            optimized: false,
            hasDraft: false,
            latestVersion: null,
            createdAt,
            updatedAt: createdAt,
            expiresAt,
          },
        ],
        nextCursor: null,
        total: 2,
      },
    },
  })

  await loginThroughVisibleUi(page, '/me/resumes')
  const titles = page.getByRole('region', { name: '我的简历' }).locator('.qx-me-row-title')
  await expect(titles).toHaveCount(2)
  const texts = await titles.allInnerTexts()
  for (const text of texts) {
    expect(text, text).not.toMatch(/\b[0-9a-f]{8,}\b/i)
    expect(text).toMatch(/上传诊断简历|AI 生成简历/)
  }
  expect(errors).toEqual([])
})

for (const item of ME_SHELL_PAGES) {
  test(`me shell signed-out ${item.path} shows page name, back, ask and 20px floor @w5-kiosk`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)
    registerAssistantLanding(api)
    await page.goto(item.path)
    await expectMeShell(page, item)
    expect(errors).toEqual([])
  })

  test(`me shell signed-in empty ${item.path} keeps the same chrome @w5-kiosk`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)
    registerAssistantLanding(api)
    registerMemberLogin(api)
    registerMeShellLists(api)
    await loginThroughVisibleUi(page, item.path)
    await expectMeShell(page, item)
    expect(errors).toEqual([])
  })
}

function registerEmptyAccount(api: ApiRouter): void {
  registerMemberLogin(api)
  registerAssetCounts(api, { resumes: 0, documents: 0, orders: 0, favorites: 0, benefits: 0, ai: 0 })
  api.respond('GET', '/api/v1/me/pending-tasks', {
    status: 200,
    json: { success: true, data: [] },
  })
}

async function expectEmptyThirdRow(page: Page, title: string, absent: string): Promise<void> {
  await loginThroughVisibleUi(page, '/profile')
  await expect(page.getByTestId('profile-state-empty')).toBeVisible()
  const third = page.getByTestId('profile-empty-start-third')
  await expect(third).toContainText(title)
  await expect(third).not.toContainText(absent)
  await expect(page.getByTestId('profile-help')).toContainText('帮助中心')
  await expect(page.getByTestId('profile-help')).toContainText('常见问题与操作说明。')
}

test('profile empty third row points at policy when no official channel is configured @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerEmptyAccount(api)

  await expectEmptyThirdRow(page, '看看就业政策并收藏', '看看机构官方渠道')
  await expect(page.getByTestId('profile-empty-start-third')).toContainText('查看办事指引，资格与办理以官方核验为准。')
  await expectComplianceCopy(page)
  expect(errors).toEqual([])
})

test('profile empty third row points at official channels when hosting is closed and one channel exists @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerEmptyAccount(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'qx-profile-hosting-off'),
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/official-channels', {
    status: 200,
    json: {
      items: [{
        name: '青岛示例大学就业信息网',
        url: 'https://career.example.edu.cn/jobs?from=kiosk',
        displayOrder: 1,
        organizationName: '青岛示例大学就业指导中心',
      }],
      legacyPlatforms: [],
    },
  })

  await expectEmptyThirdRow(page, '看看机构官方渠道', '看看就业政策并收藏')
  await expect(page.getByTestId('profile-empty-start-third')).toContainText('这里只放本机构的官方入口，报名不在这台机器上办。')
  await expectComplianceCopy(page)
  expect(errors).toEqual([])
})

const ME_READ_FAILURES = [
  { path: '/me/documents', heading: '文档这次没有加载出来' },
  { path: '/me/notifications', heading: '消息这次没有加载出来' },
  { path: '/me/resumes', heading: '简历记录这次没有加载出来' },
  // 记录详情的「联系工作人员」键在加载失败态。不存在的 id 配上读失败，就是这一屏。
  { path: '/me/activity/missing-c15', heading: '这条记录这次没有读到' },
] as const

function registerMeReadFailures(api: ApiRouter): void {
  const down = { status: 500 as const, json: { success: false, error: { code: 'DOWN', message: 'fixture unavailable' } } }
  api.respond('GET', '/api/v1/me/documents', down)
  api.respond('GET', '/api/v1/me/notifications', down)
  api.respond('GET', '/api/v1/me/resumes', down)
  api.respond('GET', '/api/v1/me/browse-logs', down)
  api.respond('GET', '/api/v1/me/external-jump-logs', down)
}

async function expectNoStaffHandoff(page: Page): Promise<void> {
  const text = await page.locator('body').innerText()
  for (const phrase of UNATTENDED_FORBIDDEN_PHRASES) {
    expect(text, `可见文字不含禁用说法「${phrase}」`).not.toContain(phrase)
  }
}

test('me error pages show the fixture service phone and no staff handoff @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  registerMeReadFailures(api)

  for (const item of ME_READ_FAILURES) {
    const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact') && response.ok())
    await loginThroughVisibleUi(page, item.path)
    expect(await (await contact).json()).toMatchObject({
      data: { servicePhone: FIXTURE_SERVICE_PHONE, serviceHours: FIXTURE_SERVICE_HOURS },
    })
    await expect(page.getByRole('heading', { name: item.heading })).toBeVisible()
    await expect(page.locator('.qx-me-cta-row').getByRole('button', { name: '帮助中心', exact: true })).toHaveAttribute('data-route', '/help')
    await expect(page.locator('.qx-me-legal').last()).toContainText(`多次重试仍失败时，${FIXTURE_HELP_LINE}`)
    await expect(page.locator('.qx-me-guide')).toContainText(FIXTURE_SERVICE_PHONE)
    await expect(page.locator('.qx-me-guide')).toContainText(FIXTURE_SERVICE_HOURS)
    await expectNoStaffHandoff(page)
  }

  await page.locator('.qx-me-cta-row').getByRole('button', { name: '帮助中心', exact: true }).click()
  await expect(page).toHaveURL(/\/help$/)
  expect(errors).toEqual([])
})

test('me error pages point at the privacy policy when support contact is missing @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  registerMeReadFailures(api)
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 404,
    json: { success: false, error: { code: 'NOT_FOUND', message: 'no contact' } },
  })

  for (const item of ME_READ_FAILURES) {
    const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact'))
    await loginThroughVisibleUi(page, item.path)
    expect((await contact).status()).toBe(404)
    await expect(page.getByRole('heading', { name: item.heading })).toBeVisible()
    await expect(page.locator('.qx-me-legal').last()).toContainText(`多次重试仍失败时，需要帮助？${NO_PHONE_HINT}`)
    await expect(page.locator('.qx-me-guide')).toContainText(NO_PHONE_HINT)
    await expect(page.getByText(FIXTURE_SERVICE_PHONE)).toHaveCount(0)
    await expectNoStaffHandoff(page)
  }
  expect(errors).toEqual([])
})
