import type { Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'
import { setReactRouterState, W2_FILE, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

const EVIDENCE_DIR = `${process.env.HOME}/.cache/walk0929/evidence/fix-privacy-clear`
const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'
const TASK_ID = 'privacy-clear-task-001'
const BOOT_TICKET = 'a'.repeat(40)

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'privacy-clear-fixture'),
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
  })
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  api.respond('GET', '/api/v1/jobs', {
    status: 200,
    json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } },
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { asrEnabled: false, ttsEnabled: false },
  })
  for (const docType of ['terms_of_service', 'privacy_policy']) {
    api.respond('GET', `/api/v1/kiosk/legal/${docType}`, {
      status: 200,
      json: { success: true, data: { version: '2026-09-01', title: docType, status: 'active' } },
    })
  }
  for (const endpoint of ['start', 'heartbeat', 'end']) {
    api.respond('POST', `/api/v1/kiosk/session/${endpoint}`, {
      status: 200,
      json: { success: true },
    })
  }
  api.respond('POST', '/api/v1/terminals/session-token', {
    status: 200,
    json: { sessionToken: 'privacy-clear-terminal-session-token' },
  })
  // 本页刷新后若 sessionStorage 里已有终端票，启动会先续这一张票。
  api.respond('POST', '/api/v1/terminals/session-token/refresh', {
    status: 200,
    json: { sessionToken: 'privacy-clear-terminal-session-token' },
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
        token: 'privacy-clear-member-token',
        user: { id: 'privacy-clear-member', phoneMasked: '138****8000', nickname: '走查会员' },
      },
    },
  })
  const emptyPage = { success: true, data: { items: [], nextCursor: null, total: 0 } }
  for (const path of [
    '/api/v1/me/favorites',
    '/api/v1/me/print-orders',
    '/api/v1/me/resumes',
    '/api/v1/me/benefits',
  ]) {
    api.respond('GET', path, { status: 200, json: emptyPage })
  }
  api.respond('GET', '/api/v1/me/ai-records', {
    status: 200,
    json: {
      success: true,
      data: { items: [], nextCursor: null, total: 0, qaRecords: [], qaNextCursor: null, qaTotal: 0 },
    },
  })
  api.respond('GET', '/api/v1/me/pending-tasks', {
    status: 200,
    json: { success: true, data: [] },
  })
  api.respond('GET', '/api/v1/me/documents', {
    status: 200,
    json: {
      success: true,
      data: {
        items: [
          {
            id: 'doc-privacy',
            filename: '上一位留下的简历.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 245760,
            purpose: 'print_doc',
            sensitiveLevel: 'normal',
            assetCategory: 'original',
            retentionPolicy: 'months_3',
            allowedRetentionPolicies: ['months_3', 'months_6', 'long_term'],
            createdAt: '2026-09-01T08:00:00.000Z',
            expiresAt: '2099-03-01T00:00:00.000Z',
            downloadUrlPath: '/files/doc-privacy/download-url',
            previewUrlPath: '/files/doc-privacy/preview-url',
          },
        ],
        nextCursor: null,
        total: 1,
      },
    },
  })
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: { taskId: TASK_ID, status: 'completed', completedAt: '2026-09-29T00:00:00.000Z' },
  })
}

async function allowLocalBootTicket(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:9527/local/terminal-boot-ticket', async (route) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'X-Local-Bridge-Token, Accept, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({ data: { bootTicket: BOOT_TICKET } }),
    })
  })
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}`, fullPage: false })
}

async function expectThisMember(page: Page): Promise<void> {
  await expect(page.getByTestId('home-identity')).toContainText('138****8000')
}

async function openDocumentsFromHome(page: Page): Promise<void> {
  await page.getByTestId('home-identity').click()
  await expect(page).toHaveURL(/\/profile$/)
  await page.getByTestId('profile-asset-documents').click()
  await expect(page).toHaveURL(/\/me\/documents$/)
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of MEMBER_PHONE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

test('W-42 clean home tells the truth about auto logout @privacy-clear', async ({ page, api }) => {
  registerShell(api)
  await allowLocalBootTicket(page)
  await page.goto('/')
  await expect(page.getByText('不会显示上一位使用者的资料')).toBeVisible()
  await expect(page.getByText('离开 3 分钟 无操作自动退出登录')).toBeVisible()
  await expect(page.getByText('1 分 30 秒 无操作自动退出')).toBeVisible()
  await shot(page, 'W-42-home-clean-1080.png')

  await page.setViewportSize({ width: 390, height: 844 })
  const homeFooter = page.getByText('离开 3 分钟 无操作自动退出登录')
  await expect(homeFooter).toBeVisible()
  await homeFooter.scrollIntoViewIfNeeded()
  await expect(page.locator('body')).toContainText('1 分 30 秒 无操作自动退出')
  await shot(page, 'W-42-home-clean-390.png')
})

test('W-42 logged-in home and documents do not promise the previous person is gone @privacy-clear', async ({ page, api }) => {
  registerShell(api)
  await allowLocalBootTicket(page)
  await loginThroughVisibleUi(page, '/')
  await expectThisMember(page)
  await expect(page.getByText('不会显示上一位使用者的资料')).toHaveCount(0)
  await expect(page.getByText(/离开前请点结束使用，否则 3 分钟 无操作后才会自动退出/)).toBeVisible()
  await expect(page.getByText('离开 3 分钟 无操作自动退出登录')).toBeVisible()
  await expect(page.getByText('1 分 30 秒 无操作自动退出')).toBeVisible()
  await shot(page, 'W-42-home-logged-in-1080.png')

  await openDocumentsFromHome(page)
  await expect(page.getByText('上一位留下的简历.pdf')).toBeVisible()
  await expect(page.getByText(/1 分 30 秒 无操作后才会自动退出/)).toBeVisible()
  await expect(page.getByText('不会显示上一位使用者的资料')).toHaveCount(0)
  await shot(page, 'W-42-documents-logged-in-1080.png')

  await page.setViewportSize({ width: 390, height: 844 })
  const documentsTruth = page.getByText(/1 分 30 秒 无操作后才会自动退出/)
  await expect(documentsTruth).toBeVisible()
  await documentsTruth.scrollIntoViewIfNeeded()
  await shot(page, 'W-42-documents-logged-in-390.png')
})

test('W-43 print done puts the preview away and keeps the login @privacy-clear', async ({ page, api }) => {
  registerShell(api)
  await allowLocalBootTicket(page)
  await loginThroughVisibleUi(page, '/')
  await expectThisMember(page)

  await page.evaluate(
    ({ taskId, file, params }) => {
      const browserState = {
        ...(window.history.state ?? {}),
        usr: { taskId, file, params, source: 'document' },
        key: 'privacy-clear-print-done',
      }
      window.history.pushState(browserState, '', '/print/done')
      window.dispatchEvent(new PopStateEvent('popstate', { state: browserState }))
    },
    { taskId: TASK_ID, file: W2_FILE, params: W2_PRINT_PARAMS },
  )

  await expect(page.getByText('一会儿收起这次预览')).toBeVisible()
  await expect(page.getByText('账号不会因此退出')).toBeVisible()
  await expect(page.getByText('秒后收起预览')).toBeVisible()
  await expect(page.getByText('已清除')).toHaveCount(0)
  await expect(page.getByText('下一个人看不到')).toHaveCount(0)
  await expect(page.getByText('结束并清空')).toHaveCount(0)
  await shot(page, 'W-43-print-done-before-wipe-1080.png')

  const wipe = page.getByTestId('print-fulfill-primary')
  await wipe.click()
  await expect(wipe).toHaveText('再按一次，确认收起这次预览')
  await wipe.click()
  await expect(page.getByText('登录还在')).toBeVisible()
  await expect(page.getByText('账号还登录着')).toBeVisible()
  await expect(page.getByText('已清除')).toHaveCount(0)
  await shot(page, 'W-43-print-done-wiped-1080.png')

  await page.getByRole('button', { name: '回首页' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expectThisMember(page)
  await shot(page, 'W-43-after-wipe-still-logged-in-1080.png')
})

test('W-43 direct completed state still uses the honest wipe copy @privacy-clear', async ({ page, api }) => {
  registerShell(api)
  await allowLocalBootTicket(page)
  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', {
    taskId: TASK_ID,
    file: W2_FILE,
    params: W2_PRINT_PARAMS,
    source: 'document',
  })
  await expect(page.getByText('一会儿收起这次预览')).toBeVisible()
  await expect(page.getByText('已清除')).toHaveCount(0)
})
