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
  await page.getByRole('button', { name: /^打印服务/ }).click()
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

function createdFeedbackDetail() {
  return {
    id: 'fb-new-1006',
    category: 'print',
    title: '页面使用反馈',
    content: '这是用于验证真实反馈提交成功后进入详情的合成说明。',
    contactPhoneMasked: null,
    terminalId: null,
    relatedPrintTaskId: null,
    status: 'pending',
    createdAt: '2026-10-06T10:16:00.000+08:00',
    updatedAt: '2026-10-06T10:16:00.000+08:00',
    replies: [],
  }
}

test('feedback submit stays disabled with a reason until category and ten characters are present @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/feedback', { status: 200, json: emptyPage(0) })

  await loginThroughVisibleUi(page, '/me/feedback')
  const blocked = page.getByRole('button', { name: '提交反馈（请先选择分类，并写满 10 个字）', exact: true })
  await expect(blocked).toBeDisabled()
  await expect(blocked).toContainText('请先选择分类，并写满 10 个字')
  await page.getByLabel('反馈内容').fill('还不够十个字')
  await expect(page.getByRole('button', { name: '提交反馈（请先选择分类，并写满 10 个字）', exact: true })).toBeDisabled()
  await expectComplianceCopy(page)
  expect(errors).toEqual([])
})

test('feedback submit success opens the new ticket detail @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  const detail = createdFeedbackDetail()
  api.respond('GET', '/api/v1/me/feedback', { status: 200, json: emptyPage(0) })
  api.respond('POST', '/api/v1/me/feedback', { status: 200, json: { success: true, data: detail } })
  api.respond('GET', '/api/v1/me/feedback/fb-new-1006', { status: 200, json: { success: true, data: detail } })

  await loginThroughVisibleUi(page, '/me/feedback')
  await page.getByRole('button', { name: /^打印服务/ }).click()
  await page.getByLabel('标题（选填）').fill(detail.title)
  await page.getByLabel('反馈内容').fill(detail.content)
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()

  await expect(page.getByTestId('member-feedback-state-success')).toBeVisible()
  await expect(page.getByText('反馈已提交', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/ticket=fb-new-1006/)
  await expect(page.getByRole('heading', { name: detail.title, exact: true })).toBeVisible()
  await expectComplianceCopy(page)
  expect(errors).toEqual([])
})

test('feedback submit failure keeps the filled form @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/feedback', { status: 200, json: emptyPage(0) })
  api.respond('POST', '/api/v1/me/feedback', {
    status: 503,
    json: { success: false, error: { code: 'W5_FEEDBACK_UNAVAILABLE', message: 'fixture unavailable' } },
  })

  await loginThroughVisibleUi(page, '/me/feedback')
  await page.getByRole('button', { name: /^打印服务/ }).click()
  await page.getByLabel('标题（选填）').fill('页面使用反馈')
  await page.getByLabel('联系电话（选填）').fill('13800138000')
  await page.getByLabel('反馈内容').fill('这是用于验证真实反馈提交失败后内容还在的合成说明。')
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()

  await expect(page.getByText('提交失败，请检查登录状态或稍后重试', { exact: true })).toBeVisible()
  await expect(page.getByLabel('标题（选填）')).toHaveValue('页面使用反馈')
  await expect(page.getByLabel('联系电话（选填）')).toHaveValue('13800138000')
  await expect(page.getByLabel('反馈内容')).toHaveValue('这是用于验证真实反馈提交失败后内容还在的合成说明。')
  await expect(page.getByRole('button', { name: '重试提交', exact: true })).toBeVisible()
  await expectComplianceCopy(page)
  expect(errors).toEqual([])
})

test('feedback detail back to list clears the ticket query @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  const item = {
    id: 'fb-preview-cut',
    category: 'print',
    title: '打印预览页文字被截掉一行',
    content: '简历预览最下面一行字被裁掉了，按预览打出来也少这一行。',
    contactPhoneMasked: null,
    terminalId: null,
    relatedPrintTaskId: null,
    status: 'processing',
    createdAt: '2026-10-02T09:18:00.000+08:00',
    updatedAt: '2026-10-03T11:05:00.000+08:00',
  }
  api.respond('GET', '/api/v1/me/feedback', {
    status: 200,
    json: { success: true, data: { items: [item], nextCursor: null, total: 1 } },
  })
  api.respond('GET', '/api/v1/me/feedback/fb-preview-cut', {
    status: 200,
    json: { success: true, data: { ...item, replies: [] } },
  })

  await loginThroughVisibleUi(page, '/me/feedback')
  await page.getByTestId('member-feedback-ticket-fb-preview-cut').click()
  await expect(page).toHaveURL(/ticket=fb-preview-cut/)
  await expect(page.getByRole('heading', { name: item.title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回列表', exact: true }).click()
  await expect(page).not.toHaveURL(/ticket=/)
  await expect(page.getByRole('heading', { name: '提交反馈', exact: true })).toBeVisible()
  await expectComplianceCopy(page)
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
  await expect(page.getByText('一体机不提供')).toBeVisible()
  await expect(page.getByText('一体机不办理')).toBeVisible()
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

/** take：头图里有没有六格说明。稿 38（文档、订单）有；稿 39 规则 4 写明四个记录页签「不再加六格说明」。 */
const ME_SHELL_PAGES: { path: string; name: string; tabs: boolean; take: boolean; ask: string; draft: string }[] = [
  { path: '/me/documents', name: '我的文档', tabs: true, take: true, ask: '问小青：怎么打', draft: '我的文档怎么打印？打印前要注意什么？' },
  { path: '/me/print-orders', name: '我的打印订单', tabs: true, take: true, ask: '问小青：怎么打', draft: '我的文档怎么打印？打印前要注意什么？' },
  { path: '/me/resumes', name: '我的简历', tabs: true, take: false, ask: '问小青', draft: '这里的记录能存多久？删掉会怎样？' },
  { path: '/me/favorites', name: '我的收藏', tabs: true, take: false, ask: '问小青', draft: '这里的记录能存多久？删掉会怎样？' },
  { path: '/me/ai-records', name: 'AI服务记录', tabs: true, take: false, ask: '问小青', draft: '这里的记录能存多久？删掉会怎样？' },
  { path: '/me/activity', name: '浏览与跳转记录', tabs: true, take: false, ask: '问小青', draft: '这里的记录能存多久？删掉会怎样？' },
  { path: '/me/notifications', name: '消息通知', tabs: false, take: false, ask: '问小青', draft: '收到这条通知，接下来我该怎么做？' },
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
    const tabTop = (tabBox!.y - origin.y) / scale
    if (item.take) {
      // 稿 38：头图带六格，页签排在六格下面。
      await expect(page.getByTestId('qx-me-take')).toHaveCount(1)
      expect(tabTop, `${item.path} 页签上边`).toBeGreaterThanOrEqual(500)
    } else {
      // 稿 39 规则 4：头图只留副标题这一句、不放六格，页签紧跟头图。
      // 实测：标语一行的三页约 317（稿上约 322），足迹页标语两行约 364；有六格时会被推到 500 以下。
      await expect(page.getByTestId('qx-me-take')).toHaveCount(0)
      expect(tabTop, `${item.path} 页签上边`).toBeGreaterThanOrEqual(280)
      expect(tabTop, `${item.path} 页签上边`).toBeLessThanOrEqual(420)
    }
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

const EXPORT_INVENTORY = '账号摘要、文件清单、AI 服务记录摘要、AI 用量（功能、时间、状态、金额）、打印订单、收藏、权益、浏览与打开来源记录、求职进度、通知、反馈、授权与历史请求'
const EXPORT_TAIL = `导出的是本人资料清单（${EXPORT_INVENTORY}），不含文件原文与简历正文全文。`
const EXPORT_WITH_PHONE = `公共屏上不导出个人资料。需要复制个人信息的，可以拨打服务电话 ${FIXTURE_SERVICE_PHONE}（${FIXTURE_SERVICE_HOURS}）申请。我们核实是你本人后，15 个工作日内处理。${EXPORT_TAIL}`
const CLOSURE_WITH_PHONE = `这台机器上不办理注销。可以拨打服务电话 ${FIXTURE_SERVICE_PHONE}（${FIXTURE_SERVICE_HOURS}）申请。我们核实是你本人后，15 个工作日内处理。`
const EXPORT_WITHOUT_PHONE = `公共屏上不导出个人资料。需要复制个人信息的，可以查看《隐私政策》里的联系方式申请。我们核实是你本人后，15 个工作日内处理。${EXPORT_TAIL}`
const CLOSURE_WITHOUT_PHONE = '这台机器上不办理注销。可以查看《隐私政策》里的联系方式申请。我们核实是你本人后，15 个工作日内处理。'

function privacyList(items: unknown[]) {
  return {
    status: 200,
    json: { success: true, data: { items, nextCursor: null, capabilities: { accountClosureAvailable: false } } },
  }
}

function privacyCreated(id: string) {
  return {
    id,
    requestType: 'revoke_consent',
    status: 'completed',
    requestedAt: '2026-10-06T10:24:00.000+08:00',
    handledAt: '2026-10-06T10:24:00.000+08:00',
    executionStep: null,
    exportExpiresAt: null,
    failureCode: null,
    canRetry: false,
    canDownload: false,
  }
}

test('小程序未发布且有电话时，隐私导出与注销只指向服务电话 @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact') && response.status() === 200)

  await page.goto('/me/privacy-requests')
  await contact
  await expect(page.getByTestId('member-privacy-state-login')).toBeVisible()
  await expect(page.getByTestId('member-privacy-export-line')).toHaveText(EXPORT_WITH_PHONE)
  await expect(page.getByTestId('member-privacy-closure-line')).toHaveText(CLOSURE_WITH_PHONE)
  await expect(page.getByTestId('member-privacy-export-line')).not.toContainText('也可以')
  await expect(page.getByTestId('member-privacy-closure-line')).not.toContainText('也可以')
  await expect(page.getByTestId('member-privacy-export-line')).not.toContainText('小程序')
  await expect(page.getByTestId('member-privacy-closure-line')).not.toContainText('小程序')
  await expect(page.getByText('一体机不提供')).toBeVisible()
  await expect(page.getByText('一体机不办理')).toBeVisible()
  await expectNoStaffHandoff(page)
  expect(errors).toEqual([])
})

test('小程序未发布且无电话时，隐私导出与注销指向隐私政策联系方式 @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  hideSupportContact(api)
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact') && response.status() === 404)

  await page.goto('/me/privacy-requests')
  await contact
  await expect(page.getByTestId('member-privacy-export-line')).toHaveText(EXPORT_WITHOUT_PHONE)
  await expect(page.getByTestId('member-privacy-closure-line')).toHaveText(CLOSURE_WITHOUT_PHONE)
  await expect(page.getByTestId('member-privacy-export-line')).not.toContainText('也可以')
  await expect(page.getByTestId('member-privacy-closure-line')).not.toContainText('也可以')
  await expect(page.getByTestId('member-privacy-export-line')).not.toContainText('小程序')
  await expect(page.getByTestId('member-privacy-closure-line')).not.toContainText('小程序')
  await expect(page.getByText(NO_PHONE_HINT).first()).toBeVisible()
  const body = await page.locator('body').innerText()
  expect(body.split('拨打服务电话').length - 1).toBe(0)
  await expectNoStaffHandoff(page)
  expect(errors).toEqual([])
})

test('小程序已发布且有电话时，隐私导出与注销和未发布时逐字相同 @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: {
      success: true,
      data: {
        servicePhone: FIXTURE_SERVICE_PHONE,
        serviceHours: FIXTURE_SERVICE_HOURS,
        otherOnlineTerminalNearby: false,
        miniappPublished: true,
      },
    },
  })
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact') && response.status() === 200)

  await page.goto('/me/privacy-requests')
  await contact
  await expect(page.getByTestId('member-privacy-export-line')).toHaveText(EXPORT_WITH_PHONE)
  await expect(page.getByTestId('member-privacy-closure-line')).toHaveText(CLOSURE_WITH_PHONE)
  await expect(page.getByTestId('member-privacy-export-line')).not.toContainText('小程序')
  await expect(page.getByTestId('member-privacy-closure-line')).not.toContainText('小程序')
  await expectNoStaffHandoff(page)
  expect(errors).toEqual([])
})

test('小程序已发布且无电话时，隐私导出与注销和未发布时逐字相同 @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: {
      success: true,
      data: {
        servicePhone: null,
        serviceHours: null,
        otherOnlineTerminalNearby: false,
        miniappPublished: true,
      },
    },
  })
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact') && response.status() === 200)

  await page.goto('/me/privacy-requests')
  await contact
  await expect(page.getByTestId('member-privacy-export-line')).toHaveText(EXPORT_WITHOUT_PHONE)
  await expect(page.getByTestId('member-privacy-closure-line')).toHaveText(CLOSURE_WITHOUT_PHONE)
  await expect(page.getByTestId('member-privacy-export-line')).not.toContainText('小程序')
  await expect(page.getByTestId('member-privacy-closure-line')).not.toContainText('小程序')
  const body = await page.locator('body').innerText()
  expect(body.split('拨打服务电话').length - 1).toBe(0)
  await expectNoStaffHandoff(page)
  expect(errors).toEqual([])
})

test('privacy revoke success opens the success screen @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/data-requests', privacyList([]))
  api.respond('POST', '/api/v1/me/data-requests', {
    status: 200,
    json: { success: true, data: privacyCreated('req-ok') },
  })

  await loginThroughVisibleUi(page, '/me/privacy-requests')
  await page.getByTestId('member-privacy-revoke-entry').click()
  await page.getByRole('button', { name: '确认撤回', exact: true }).click()
  await expect(page.getByTestId('member-privacy-state-success')).toBeVisible()
  await expect(page.getByTestId('member-privacy-result')).toContainText('已撤回 AI 使用授权，请求已记录')
  await expect(page.getByTestId('member-privacy-dialog')).toHaveCount(0)
  await expect(page.getByText('全部个人数据已删除')).toHaveCount(0)
  await expect(page.getByText('账号注销成功')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('privacy revoke failure opens the failure screen and retry can succeed @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/data-requests', privacyList([]))
  api.respondWith('POST', '/api/v1/me/data-requests', (attempt) => attempt === 1
    ? { status: 400, json: { success: false, error: { code: 'DATA_REQUEST_UNAVAILABLE', message: 'upstream rejected' } } }
    : { status: 200, json: { success: true, data: privacyCreated('req-retry') } })

  await loginThroughVisibleUi(page, '/me/privacy-requests')
  await page.getByTestId('member-privacy-revoke-entry').click()
  await page.getByRole('button', { name: '确认撤回', exact: true }).click()
  await expect(page.getByTestId('member-privacy-state-failure')).toBeVisible()
  await expect(page.getByTestId('member-privacy-result')).toContainText('授权没有变化')
  await expect(page.getByTestId('member-privacy-result')).toContainText('提交失败，请稍后重试')
  await expect(page.getByTestId('member-privacy-dialog')).toHaveCount(0)

  await page.getByTestId('member-privacy-primary').click()
  await expect(page.getByTestId('member-privacy-state-success')).toBeVisible()
  await expect(page.getByTestId('member-privacy-result')).toContainText('已撤回 AI 使用授权，请求已记录')
  expect(api.requestCount('POST', '/api/v1/me/data-requests')).toBe(2)
  expect(errors).toEqual([])
})

test('privacy bottom bar fills the row and the honest note sits under the buttons @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/data-requests', privacyList([
    privacyCreated('req-revoke'),
    {
      ...privacyCreated('req-export'),
      requestType: 'export',
      requestedAt: '2026-09-11T11:06:00.000+08:00',
      handledAt: '2026-09-16T09:40:00.000+08:00',
    },
  ]))

  await loginThroughVisibleUi(page, '/me/privacy-requests')
  await expect(page.getByTestId('member-privacy-state-history-ready')).toBeVisible()
  const exportSvg = await page.locator('[data-request-type="export"] .pr-ico svg').innerHTML()
  const revokeSvg = await page.locator('[data-request-type="revoke_consent"] .pr-ico svg').first().innerHTML()
  const capExportSvg = await page.locator('[data-capability="export"] .pr-ico svg').innerHTML()
  expect(exportSvg).toBe(capExportSvg)
  expect(exportSvg).not.toBe(revokeSvg)

  const metrics = await page.evaluate(() => {
    const bar = document.querySelector('.qx-ctabar')
    const truth = document.querySelector('.pr-cta .pr-truth')
    const row = document.querySelector('.pr-cta-row')
    const buttons = [...document.querySelectorAll('.pr-cta-row > .qx-btn, .pr-cta-row > .qx-ai-help')]
    if (!bar || !truth || !row || buttons.length !== 3) return null
    const stage = document.querySelector('.kiosk-stage')
    const transform = stage ? getComputedStyle(stage).transform : 'none'
    const scale = transform === 'none' ? 1 : Number(/^matrix\(([^,]+)/.exec(transform)?.[1] ?? 1)
    const barRect = bar.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const truthRect = truth.getBoundingClientRect()
    const sideInset = (rect: DOMRect) => ({
      left: rect.left - barRect.left,
      right: barRect.right - rect.right,
    })
    const boxes = buttons.map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        width: rect.width,
        height: rect.height,
        y: rect.top,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        text: element.textContent ?? '',
      }
    })
    return {
      scale,
      // 三键总宽对的是留边之后的内容宽度，不是整条底栏。
      contentWidth: rowRect.width,
      rowInset: sideInset(rowRect),
      truthInset: sideInset(truthRect),
      sum: boxes.reduce((total, box) => total + box.width, 0),
      boxes,
      truthY: truthRect.top,
    }
  })
  expect(metrics).not.toBeNull()
  expect(metrics!.sum / metrics!.contentWidth).toBeGreaterThanOrEqual(0.95)
  expect(metrics!.rowInset.left / metrics!.scale).toBeGreaterThanOrEqual(16)
  expect(metrics!.rowInset.right / metrics!.scale).toBeGreaterThanOrEqual(16)
  expect(metrics!.truthInset.left / metrics!.scale).toBeGreaterThanOrEqual(16)
  expect(metrics!.truthInset.right / metrics!.scale).toBeGreaterThanOrEqual(16)
  for (const box of metrics!.boxes) {
    expect(box.height / metrics!.scale, box.text).toBeGreaterThanOrEqual(72)
    expect(box.scrollWidth, box.text).toBeLessThanOrEqual(box.clientWidth + 1)
    expect(metrics!.truthY).toBeGreaterThan(box.y)
  }
  expect(errors).toEqual([])
})

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
    // 文案审查（C1-6）：「……时，」后接设问读起来断了。标准句不动，改成先说可以稍后再来。
    await expect(page.locator('.qx-me-legal').last()).toContainText(`多次重试仍不成功的话，可以稍后再来。${FIXTURE_HELP_LINE}`)
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
    // 文案审查（C1-6）：同上，404 时标准句是「需要帮助？查看《隐私政策》里的联系方式」。
    await expect(page.locator('.qx-me-legal').last()).toContainText(`多次重试仍不成功的话，可以稍后再来。需要帮助？${NO_PHONE_HINT}`)
    await expect(page.locator('.qx-me-guide')).toContainText(NO_PHONE_HINT)
    await expect(page.getByText(FIXTURE_SERVICE_PHONE)).toHaveCount(0)
    await expectNoStaffHandoff(page)
  }
  expect(errors).toEqual([])
})

function hideSupportContact(api: ApiRouter): void {
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 404,
    json: { success: false, error: { code: 'NOT_FOUND', message: 'no contact' } },
  })
}

function registerProfileReadFailure(api: ApiRouter): void {
  for (const path of ['/api/v1/me/resumes', '/api/v1/me/documents', '/api/v1/me/print-orders', '/api/v1/me/favorites', '/api/v1/me/benefits', '/api/v1/me/ai-records']) {
    api.respond('GET', path, { status: 500, json: { success: false, error: { code: 'DOWN', message: 'fixture unavailable' } } })
  }
  api.respond('GET', '/api/v1/me/pending-tasks', {
    status: 500,
    json: { success: false, error: { code: 'DOWN', message: 'fixture unavailable' } },
  })
}

function registerSettingsAccount(api: ApiRouter): void {
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/ai-consents/status', {
    status: 200,
    json: { success: true, data: [{ scope: 'job_ai', granted: false }] },
  })
  api.respond('POST', '/api/v1/member/auth/logout', { status: 200, json: { success: true } })
}

async function openSettingsLogoutFailure(page: Page): Promise<void> {
  await page.getByRole('button', { name: '结束使用并退出登录', exact: true }).click()
  await page.evaluate(() => {
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        throw new Error('fixture: privacy boundary token failed')
      },
    })
  })
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
}

test('profile error shows the fixture service phone and no staff handoff @w5-kiosk', async ({ page, api }) => {
  registerShell(api)
  registerMemberLogin(api)
  registerProfileReadFailure(api)
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact') && response.status() === 200)

  await loginThroughVisibleUi(page, '/profile')
  expect(await (await contact).json()).toMatchObject({ data: { servicePhone: FIXTURE_SERVICE_PHONE, serviceHours: FIXTURE_SERVICE_HOURS } })
  await expect(page.getByTestId('profile-state-error')).toBeVisible()
  await expect(page.locator('.qx-ctabar').getByRole('button', { name: '帮助中心', exact: true })).toBeVisible()
  await expect(page.getByTestId('profile-help-line')).toContainText(`需要帮助？拨打服务电话 ${FIXTURE_SERVICE_PHONE}（${FIXTURE_SERVICE_HOURS}）`)
  await expectNoStaffHandoff(page)
})

test('profile error points at the privacy policy when support contact is missing @w5-kiosk', async ({ page, api }) => {
  registerShell(api)
  registerMemberLogin(api)
  registerProfileReadFailure(api)
  hideSupportContact(api)
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact'))

  await loginThroughVisibleUi(page, '/profile')
  expect((await contact).status()).toBe(404)
  await expect(page.getByTestId('profile-help-line')).toContainText(`需要帮助？${NO_PHONE_HINT}`)
  await expect(page.getByText(FIXTURE_SERVICE_PHONE)).toHaveCount(0)
  await expect(page.getByText('拨打服务电话')).toHaveCount(0)
  await expectNoStaffHandoff(page)
})

// 清场入口同步抛错时，隐私守卫保持遮罩、不渲染设置页。
// 「本机登录尚未清除，请重试。需要帮助？…」「还不能切换账号，请重试。需要帮助？…」
// 仍写在设置页里，但被遮罩挡住，这条路径看不到。这是原有行为。
async function expectLogoutFailureStaysCovered(page: Page): Promise<void> {
  await openSettingsLogoutFailure(page)
  await expect(page.getByTestId('session-guard-state-clearing')).toBeVisible()
  await expect(page.getByText('本机登录尚未清除')).toHaveCount(0)
  await expect(page.getByText('还不能切换账号')).toHaveCount(0)
  await expect(page.getByTestId('member-settings-state-member')).toHaveCount(0)
  await expectNoStaffHandoff(page)
}

test('settings logout failure keeps the clearing overlay and does not reveal the page @w5-kiosk', async ({ page, api }) => {
  registerSettingsAccount(api)
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact') && response.status() === 200)

  await loginThroughVisibleUi(page, '/me/settings')
  expect(await (await contact).json()).toMatchObject({ data: { servicePhone: FIXTURE_SERVICE_PHONE } })
  await expectLogoutFailureStaysCovered(page)
})

test('settings logout failure keeps the clearing overlay when support contact is missing @w5-kiosk', async ({ page, api }) => {
  registerSettingsAccount(api)
  hideSupportContact(api)
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact'))

  await loginThroughVisibleUi(page, '/me/settings')
  expect((await contact).status()).toBe(404)
  await expectLogoutFailureStaysCovered(page)
  await expect(page.getByText(FIXTURE_SERVICE_PHONE)).toHaveCount(0)
})

test('benefits error shows the fixture service phone and no staff handoff @w5-kiosk', async ({ page, api }) => {
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/benefits', {
    status: 503,
    json: { success: false, error: { code: 'DOWN', message: 'fixture unavailable' } },
  })
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact') && response.status() === 200)

  await loginThroughVisibleUi(page, '/me/benefits')
  expect(await (await contact).json()).toMatchObject({ data: { servicePhone: FIXTURE_SERVICE_PHONE } })
  await expect(page.getByTestId('benefits-state-error')).toBeVisible()
  await expect(page.locator('.qx-ctabar').getByRole('button', { name: '帮助中心', exact: true })).toBeVisible()
  await expect(page.getByTestId('benefits-fallback')).toContainText(`需要帮助？拨打服务电话 ${FIXTURE_SERVICE_PHONE}（${FIXTURE_SERVICE_HOURS}）`)
  await expectNoStaffHandoff(page)
})

test('benefits error points at the privacy policy when support contact is missing @w5-kiosk', async ({ page, api }) => {
  registerShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/benefits', {
    status: 503,
    json: { success: false, error: { code: 'DOWN', message: 'fixture unavailable' } },
  })
  hideSupportContact(api)
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact'))

  await loginThroughVisibleUi(page, '/me/benefits')
  expect((await contact).status()).toBe(404)
  await expect(page.getByTestId('benefits-fallback')).toContainText(`需要帮助？${NO_PHONE_HINT}`)
  await expect(page.getByText(FIXTURE_SERVICE_PHONE)).toHaveCount(0)
  await expect(page.getByText('拨打服务电话')).toHaveCount(0)
  await expectNoStaffHandoff(page)
})

test('me error guide says 联系我们 and hides 拨打服务电话 when support contact is 404 @w5-kiosk', async ({ page, api }) => {
  // 文案审查（C1-6）：读不到号码时第三格粗体不再写「拨打服务电话」，改成「联系我们」。
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
    const third = page.locator('.qx-me-guide-item').nth(2)
    await expect(third.locator('.qx-me-guide-k')).toHaveText('仍不行')
    await expect(third.locator('.qx-me-guide-t')).toHaveText('联系我们')
    await expect(third.locator('.qx-me-guide-p')).toHaveText(NO_PHONE_HINT)
    expect(await page.locator('body').innerText()).not.toContain('拨打服务电话')
    await expectNoStaffHandoff(page)
  }
  expect(errors).toEqual([])
})


/** 在等待失败后读取状态，避免只报告等待前的状态。 */
async function withNotificationStateDiagnostics(page: Page, action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error: unknown) {
    const markers = await page.locator('[data-testid^="notifications-state-"]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-testid')),
    ).catch(() => ['状态标记读取失败'])
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${detail}\n当时页面根状态标记：${markers.length ? markers.join('、') : '未找到 notifications-state-*'}`)
  }
}

/** 复用九态并排图的夹具；只准备页面，不执行截图。 */
async function prepareNotificationState(page: Page, api: ApiRouter, state: string): Promise<void> {
  const { buildQingxuPairs } = await import('./fixtures/qingxu-pair-targets')
  const { prepareMePages } = await import('./fixtures/qingxu-pair-me-pages')
  const target = buildQingxuPairs().find((item) => item.nn === '35' && item.screen === 'main' && item.state === state)
  expect(target, `消息夹具应包含状态：${state}`).toBeDefined()
  registerShell(api)
  await withNotificationStateDiagnostics(page, async () => {
    await prepareMePages(page, api, target!)
    await expect(page.getByTestId(`notifications-state-${state}`)).toBeVisible()
  })
}

test('消息页置灰的主按钮画成置灰 @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await prepareNotificationState(page, api, 'ready-all')
  const primary = page.getByTestId('notifications-primary')
  await expect(primary).toHaveText('全部标记为已读')
  await expect(primary).not.toHaveAttribute('aria-disabled', 'true')
  const enabledBackground = await primary.evaluate((element) => getComputedStyle(element).backgroundColor)

  for (const state of ['loading', 'operation-busy']) {
    await prepareNotificationState(page, api, state)
    await expect(primary, `${state} 主按钮应禁用`).toHaveAttribute('aria-disabled', 'true')
    await expect.poll(async () => {
      const background = await primary.evaluate((element) => getComputedStyle(element).backgroundColor)
      return `${state}：置灰背景=${background}；可点击背景=${enabledBackground}`
    }, { message: `${state} 的计算背景色应与可点击主按钮不同` }).not.toContain(`置灰背景=${enabledBackground}；`)
  }

  // 九态夹具会登录并完成全部已读操作，保留消息且未读为零。
  await prepareNotificationState(page, api, 'operation-toast')
  await expect(primary).toHaveText('全部已读')
  await expect(primary).toHaveAttribute('aria-disabled', 'true')
  await expect.poll(async () => {
    const background = await primary.evaluate((element) => getComputedStyle(element).backgroundColor)
    return `无未读：置灰背景=${background}；可点击背景=${enabledBackground}`
  }, { message: '无未读时的计算背景色应与可点击主按钮不同' }).not.toContain(`置灰背景=${enabledBackground}；`)
  expect(errors).toEqual([])
})

test('消息全空时主按钮去我的记录 @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await prepareNotificationState(page, api, 'all-empty')
  registerMeShellLists(api)
  const primary = page.getByTestId('notifications-primary')
  await expect(primary).toHaveText('去我的记录')
  await expect(primary).not.toHaveAttribute('aria-disabled')
  await expect(primary).toBeEnabled()
  await expect(primary).toHaveAttribute('data-route', '/me/ai-records')
  await expect(primary.locator('svg')).toHaveCount(1)
  await primary.click()
  await expect(page).toHaveURL(/\/me\/ai-records$/)
  expect(errors).toEqual([])
})

test('消息行时间在标题行右侧，四条和加载更多在首屏 @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  const response = page.waitForResponse((reply) => new URL(reply.url()).pathname === '/api/v1/me/notifications' && reply.status() === 200)
  await prepareNotificationState(page, api, 'ready-all')
  const payload = await (await response).json() as { success: boolean; data: import('../../src/services/api/memberNotifications').MemberNotificationPage }
  expect(payload.data.items.length, `现有夹具消息数=${payload.data.items.length}，应超过四条`).toBeGreaterThan(4)
  // unreadOnly 改变 fetchPage，分页钩子会重新读取；页签切换保留内存登录态。
  await withNotificationStateDiagnostics(page, async () => {
    const unreadItems = payload.data.items.filter((item) => !item.isRead)
    api.respond('GET', '/api/v1/me/notifications', {
      status: 200,
      json: { ...payload, data: { ...payload.data, items: unreadItems, total: unreadItems.length, nextCursor: null } },
    })
    const unreadResponse = page.waitForResponse((reply) => {
      const url = new URL(reply.url())
      return url.pathname === '/api/v1/me/notifications' && url.searchParams.get('unreadOnly') === 'true' && reply.status() === 200
    })
    await page.getByTestId('notifications-tab-unread').click()
    await unreadResponse
    await expect(page.getByTestId('notifications-state-ready-unread')).toBeVisible()

    // 使用现有八条消息的首批四条，游标证明还有下一批，不另造消息。
    api.respond('GET', '/api/v1/me/notifications', {
      status: 200,
      json: { ...payload, data: { ...payload.data, items: payload.data.items.slice(0, 4), nextCursor: payload.data.items[3].id } },
    })
    const allResponse = page.waitForResponse((reply) => {
      const url = new URL(reply.url())
      return url.pathname === '/api/v1/me/notifications' && !url.searchParams.has('unreadOnly') && reply.status() === 200
    })
    await page.getByTestId('notifications-tab-all').click()
    await allResponse
    await expect(page.getByTestId('notifications-state-ready-all')).toBeVisible()
  })
  const list = page.getByTestId('notifications-list')
  const rows = list.locator('.qx-me-notice-row')
  await expect(rows).toHaveCount(4)
  const more = page.getByRole('button', { name: '加载更多', exact: true })
  await expect(more).toHaveCount(1)
  const scale = await stageScale(page)
  expect(scale, `舞台缩放=${scale}`).toBeGreaterThan(0)
  const measured = await list.evaluate((root) => {
    const listRect = root.getBoundingClientRect()
    const ratio = listRect.height / (root as HTMLElement).offsetHeight
    return {
      scrollTop: root.scrollTop,
      top: listRect.top + root.clientTop * ratio,
      bottom: listRect.top + (root.clientTop + root.clientHeight) * ratio,
      rows: [...root.querySelectorAll('.qx-me-notice-row')].map((row) => {
        const title = row.querySelector('.qx-me-row-title')!
        const time = row.querySelector('.qx-me-notice-time')!
        const titleRect = title.getBoundingClientRect()
        const timeRect = time.getBoundingClientRect()
        const timeStyle = getComputedStyle(time)
        return {
          title: title.textContent,
          time: time.textContent,
          sameHead: title.parentElement === time.parentElement && time.parentElement?.classList.contains('qx-me-row-head'),
          centerDelta: Math.abs(titleRect.top + titleRect.height / 2 - timeRect.top - timeRect.height / 2),
          titleRight: titleRect.right,
          timeLeft: timeRect.left,
          timeRight: timeRect.right,
          headRight: time.parentElement!.getBoundingClientRect().right,
          timeFont: parseFloat(timeStyle.fontSize),
          timeWhiteSpace: timeStyle.whiteSpace,
          timeOverflow: time.scrollWidth - time.clientWidth,
          bottom: row.getBoundingClientRect().bottom,
        }
      }),
    }
  })
  expect(measured.scrollTop, `首屏列表滚动位置=${measured.scrollTop}`).toBe(0)
  // 和页面一样在浏览器时区格式化，避免 Node 进程的时区影响期望值。
  const expectedTimes = await page.evaluate((timestamps) => timestamps.map((iso) => {
    const d = new Date(iso)
    const M = d.getMonth() + 1
    const D = d.getDate()
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${M}月${D}日 ${h}:${m}`
  }), payload.data.items.slice(0, 4).map((item) => item.createdAt))
  for (const [index, row] of measured.rows.entries()) {
    const reading = `第${index + 1}条「${row.title}」：时间=${row.time}，中心差=${(row.centerDelta / scale).toFixed(2)}px，标题右边=${row.titleRight.toFixed(2)}，时间左右=${row.timeLeft.toFixed(2)}/${row.timeRight.toFixed(2)}，标题行右边=${row.headRight.toFixed(2)}，缩放=${scale}`
    expect(row.sameHead, reading).toBe(true)
    expect(row.centerDelta / scale, reading).toBeLessThan(16)
    expect(row.timeLeft - row.titleRight, reading).toBeGreaterThanOrEqual(0)
    expect(Math.abs(row.headRight - row.timeRight) / scale, reading).toBeLessThanOrEqual(1)
    expect(row.timeFont, `${reading}，时间字号=${row.timeFont}`).toBe(21)
    expect(row.timeWhiteSpace, `${reading}，换行规则=${row.timeWhiteSpace}`).toBe('nowrap')
    expect(row.timeOverflow, `${reading}，时间横向溢出=${row.timeOverflow}`).toBeLessThanOrEqual(1)
    expect(row.time, reading).toBe(expectedTimes[index])
  }
  const fourthBottom = measured.rows[3].bottom
  expect(fourthBottom, `第四条底边=${fourthBottom.toFixed(2)}，列表可见底边=${measured.bottom.toFixed(2)}，缩放=${scale}`).toBeLessThanOrEqual(measured.bottom)
  const moreBox = await more.boundingBox()
  expect(moreBox, '加载更多应有盒子').not.toBeNull()
  const moreBottom = moreBox!.y + moreBox!.height
  expect(moreBox!.y, `加载更多顶边=${moreBox!.y.toFixed(2)}，列表可见顶边=${measured.top.toFixed(2)}`).toBeGreaterThanOrEqual(measured.top)
  expect(moreBottom, `加载更多底边=${moreBottom.toFixed(2)}，列表可见底边=${measured.bottom.toFixed(2)}，缩放=${scale}`).toBeLessThanOrEqual(measured.bottom)
  expect(errors).toEqual([])
})

test('占位行胶囊带图标 @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  for (const state of ['login', 'error']) {
    await prepareNotificationState(page, api, state)
    const mode = state === 'login' ? 'lock' : 'error'
    const rows = page.locator(`[data-notification-category][data-slot-mode="${mode}"]`)
    await expect(rows, `${state} 占位行数量应为六条`).toHaveCount(6)
    const measured = await rows.evaluateAll((elements) => elements.map((row) => {
      const capsule = row.querySelector('.qx-me-acts .qx-me-small')!
      const icons = capsule.querySelectorAll('svg')
      return {
        category: row.getAttribute('data-notification-category'),
        text: capsule.textContent,
        count: icons.length,
        width: icons[0]?.getAttribute('width'),
        height: icons[0]?.getAttribute('height'),
        icon: icons[0]?.getAttribute('class'),
      }
    }))
    for (const row of measured) {
      const reading = `${state} ${row.category} 胶囊「${row.text}」：图标数=${row.count}，尺寸=${row.width}×${row.height}，图标=${row.icon}`
      expect(row.count, reading).toBe(1)
      expect(row.width, reading).toBe('19')
      expect(row.height, reading).toBe('19')
      expect(row.icon, reading).toContain(state === 'login' ? 'lucide-lock' : 'lucide-triangle-alert')
    }
  }
  expect(errors).toEqual([])
})

// ── C4-1c：39 行内次级操作与确认卡、40 留边、41 电话片段、38 读取行 ──
async function prepareC41cMeState(page: Page, api: ApiRouter, nn: string, screen: string, state: string): Promise<void> {
  const { buildQingxuPairs } = await import('./fixtures/qingxu-pair-targets')
  const { prepareMePages } = await import('./fixtures/qingxu-pair-me-pages')
  const target = buildQingxuPairs().find((item) => item.nn === nn && item.screen === screen && item.state === state)
  expect(target, `夹具 ${nn}/${screen}/${state}：匹配数=${target ? 1 : 0}`).toBeDefined()
  registerShell(api)
  await prepareMePages(page, api, target!)
}

test('39 删除是次级按钮，确认才用朱砂且整张确认卡自动进入列表可见区 @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await prepareC41cMeState(page, api, '39', 'ai-records', 'ready')
  const list = page.getByTestId('member-records-list')
  const row = list.locator('[data-record-kind="parse"]').first()
  const open = row.getByRole('button', { name: '打开', exact: true })
  const remove = row.getByRole('button', { name: '删除 AI 服务记录', exact: true })
  const openBackground = await open.evaluate((element) => getComputedStyle(element).backgroundColor)
  const initial = await remove.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
  expect(initial.background, `删除背景=${initial.background}；同行打开背景=${openBackground}`).toBe(openBackground)
  const scale = await stageScale(page)
  expect(initial.height / scale, `删除高度=${initial.height / scale}px；缩放=${scale}`).toBeGreaterThanOrEqual(56)
  for (const button of [open, row.getByRole('button', { name: '接着打印', exact: true }), remove]) {
    const count = await button.locator('svg[aria-hidden="true"]').count()
    expect(count, `按钮「${await button.textContent()}」装饰图标数=${count}`).toBe(1)
  }
  await remove.click()
  const confirm = row.getByRole('button', { name: '确认删除这条记录，删除后不可恢复', exact: true })
  await expect(confirm).toBeVisible()
  const colors = await confirm.evaluate((element) => {
    const probe = document.createElement('span')
    probe.style.backgroundColor = 'var(--qx-cinnabar)'
    element.append(probe)
    const cinnabar = getComputedStyle(probe).backgroundColor
    probe.remove()
    return { background: getComputedStyle(element).backgroundColor, cinnabar }
  })
  expect(colors.background, `确认删除背景=${colors.background}；朱砂=${colors.cinnabar}；初次删除=${initial.background}`).toBe(colors.cinnabar)
  expect(colors.background, `确认背景=${colors.background}；初次背景=${initial.background}`).not.toBe(initial.background)
  await expect.poll(async () => {
    const measured = await list.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const ratio = box.height / (element as HTMLElement).offsetHeight
      const top = box.top + element.clientTop * ratio
      const bottom = top + element.clientHeight * ratio
      const card = element.querySelector('[data-record-kind="parse"][data-flag="true"]')
      const button = card?.querySelector('[data-variant="danger"]')
      const cardBox = card?.getBoundingClientRect()
      const buttonBox = button?.getBoundingClientRect()
      const visible = Boolean(cardBox && buttonBox && cardBox.top >= top - 0.5 && cardBox.bottom <= bottom + 0.5 && buttonBox.top >= top - 0.5 && buttonBox.bottom <= bottom + 0.5)
      return { visible, top, bottom, cardTop: cardBox?.top, cardBottom: cardBox?.bottom, buttonTop: buttonBox?.top, buttonBottom: buttonBox?.bottom, scrollTop: element.scrollTop }
    })
    return `${measured.visible ? '完整可见' : '未完整可见'}：${JSON.stringify(measured)}；缩放=${scale}`
  }, { timeout: 2500, message: '确认卡全文和确认按钮上下沿须在列表可见区内，自动滚动后验收' }).toMatch(/^完整可见：/)
  expect(errors).toEqual([])
})

for (const [screen, state] of [['resumes', 'ready'], ['favorites', 'ready'], ['ai-records', 'ready'], ['activity', 'browse-ready']]) {
  test(`39 ${screen} 头图按定稿不放六格 @w5-kiosk`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    // 足迹页还会读自填的求职进度；并排图夹具不登记它，这里补一条空回包，免得拆卸时报未处理请求。
    if (screen === 'activity') api.respond('GET', '/api/v1/me/job-applications', { status: 200, json: emptyPage(0) })
    await prepareC41cMeState(page, api, '39', screen, state)
    const count = await page.locator('.qx-me-xq .qx-me-take').count()
    expect(count, `${screen} 头图六格数=${count}；定稿=0`).toBe(0)
    expect(errors).toEqual([])
  })
}

test('40 表单列表和详情底栏及脚注各留至少 40px @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  const item = {
    id: 'fb-c41c-gutter', category: 'print', title: '打印预览页文字被截掉一行',
    content: '简历预览最下面一行字被裁掉了，按预览打出来也少这一行。',
    contactPhoneMasked: null, terminalId: null, relatedPrintTaskId: null, status: 'processing',
    createdAt: '2026-10-02T09:18:00.000+08:00', updatedAt: '2026-10-03T11:05:00.000+08:00',
  }
  api.respond('GET', '/api/v1/me/feedback', { status: 200, json: { success: true, data: { items: [item], nextCursor: null, total: 1 } } })
  api.respond('GET', `/api/v1/me/feedback/${item.id}`, { status: 200, json: { success: true, data: { ...item, replies: [] } } })
  await loginThroughVisibleUi(page, '/me/feedback')
  for (const state of ['form-list', 'detail']) {
    if (state === 'detail') {
      await page.getByTestId(`member-feedback-ticket-${item.id}`).click()
      await expect(page.getByRole('heading', { name: item.title, exact: true })).toBeVisible()
    } else {
      await expect(page.getByRole('heading', { name: '提交反馈', exact: true })).toBeVisible()
      const arrowCount = await page.getByTestId(`member-feedback-ticket-${item.id}`).locator('.fb-row-chevron svg').count()
      expect(arrowCount, `反馈历史箭头数=${arrowCount}`).toBe(1)
    }
    const scale = await stageScale(page)
    const reading = await page.locator('.qx-stage').evaluate((stage) => {
      const box = stage.getBoundingClientRect()
      const buttons = [...stage.querySelectorAll('.fb-cta-row > .qx-btn, .fb-cta-row > .qx-ai-help')]
      const first = buttons[0]?.getBoundingClientRect()
      const last = buttons.at(-1)?.getBoundingClientRect()
      const truth = stage.querySelector('.fb-truth')?.getBoundingClientRect()
      return { buttonCount: buttons.length, firstLeft: first ? first.left - box.left : -1, lastRight: last ? box.right - last.right : -1, truthLeft: truth ? truth.left - box.left : -1, truthRight: truth ? box.right - truth.right : -1 }
    })
    expect(reading.buttonCount, `${state}：${JSON.stringify(reading)}；缩放=${scale}`).toBeGreaterThanOrEqual(2)
    for (const key of ['firstLeft', 'lastRight', 'truthLeft', 'truthRight'] as const) {
      expect(reading[key] / scale, `${state} ${key}=${reading[key] / scale}px；读数=${JSON.stringify(reading)}；缩放=${scale}`).toBeGreaterThanOrEqual(40)
    }
  }
  expect(errors).toEqual([])
})

test('41 号码和服务时间各自一行，整句 textContent 逐字保留 @w5-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact') && response.status() === 200)
  await page.goto('/me/privacy-requests')
  await contact
  for (const [id, expected] of [['member-privacy-export-line', EXPORT_WITH_PHONE], ['member-privacy-closure-line', CLOSURE_WITH_PHONE]]) {
    const line = page.getByTestId(id)
    await expect(line).toHaveText(expected)
    const text = await line.textContent()
    expect(text, `${id} textContent=${JSON.stringify(text)}；长度=${text?.length}；原句长度=${expected.length}`).toBe(expected)
    const segment = line.getByTestId('member-privacy-phone-hours')
    await expect(segment).toHaveText(`${FIXTURE_SERVICE_PHONE}（${FIXTURE_SERVICE_HOURS}）`)
    const reading = await segment.evaluate((element) => ({ rectCount: element.getClientRects().length, text: element.textContent, whiteSpace: getComputedStyle(element).whiteSpace }))
    expect(reading.rectCount, `${id}：${JSON.stringify(reading)}`).toBe(1)
    expect(reading.whiteSpace, `${id}：${JSON.stringify(reading)}`).toBe('nowrap')
  }
  expect(errors).toEqual([])
})

for (const [state, iconClass] of [['documents-loading', 'lucide-file'], ['orders-loading', 'lucide-receipt-text']]) {
  test(`38 ${state} 四行均有读取中胶囊 @w5-kiosk`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    await prepareC41cMeState(page, api, '38', 'main', state)
    const list = page.getByTestId(`member-assets-state-${state}`).locator('.qx-me-list')
    await expect(list).toHaveAttribute('role', 'status')
    await expect(list).toHaveAttribute('aria-busy', 'true')
    await expect(list).toHaveAttribute('aria-label', '正在加载的记录占位')
    const rows = list.locator(':scope > .qx-me-row[data-slot-mode="loading"]')
    const count = await rows.count()
    expect(count, `${state} 读取行数=${count}；目标=4`).toBe(4)
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i)
      const text = await row.textContent()
      expect(text, `${state} 第${i + 1}行文字=${JSON.stringify(text)}；行数=${count}`).toBe('———读取中')
      await expect(row).toHaveAttribute('aria-hidden', 'true')
      await expect(row).toHaveAttribute('data-dead', 'true')
      expect(await row.locator('button, a, [tabindex]').count()).toBe(0)
      await expect(row.locator('.qx-me-acts .qx-me-small')).toHaveAttribute('aria-disabled', 'true')
      const iconCount = await row.locator(`.qx-me-row-ico svg.${iconClass}`).count()
      expect(iconCount, `${state} 第${i + 1}行文件/订单图标数=${iconCount}`).toBe(1)
      const slots = await row.locator('.qx-me-slot').allTextContents()
      expect(slots, `${state} 第${i + 1}行占位数=${slots.length}；文字=${JSON.stringify(slots)}`).toEqual(['—', '—', '—'])
      const clockCount = await row.locator('.qx-me-acts svg.lucide-clock').count()
      expect(clockCount, `${state} 第${i + 1}行时钟图标数=${clockCount}`).toBe(1)
    }
    expect(errors).toEqual([])
  })
}
