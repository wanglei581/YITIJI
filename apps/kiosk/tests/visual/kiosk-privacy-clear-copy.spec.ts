import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { setReactRouterState, W2_FILE, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'
import {
  allowLocalBootTicket,
  loginThroughVisibleUi as loginWithPhone,
  memberDocument,
  PRIVACY_CLEAR_TASK_ID as TASK_ID,
  registerPrivacyShell,
  shotTo,
} from './fixtures/privacy-clear-shell'

const EVIDENCE_DIR = `${process.env.HOME}/.cache/walk0929/evidence/fix-privacy-clear`
const MEMBER_PHONE = '13800138000'

function registerShell(api: ApiRouter): void {
  registerPrivacyShell(api)
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
  api.respond('GET', '/api/v1/me/documents', {
    status: 200,
    json: {
      success: true,
      data: { items: [memberDocument('doc-privacy', '上一位留下的简历.pdf')], nextCursor: null, total: 1 },
    },
  })
}

async function shot(page: Page, name: string): Promise<void> {
  await shotTo(EVIDENCE_DIR, page, name)
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await loginWithPhone(page, returnTo, MEMBER_PHONE)
}

// W-75（9/29）：首页登录态只说「有人登录着」，手机号（含打码）不上首页。
async function expectThisMember(page: Page): Promise<void> {
  await expect(page.getByTestId('home-identity')).toHaveText('有人登录着')
  await expect(page.getByTestId('home-end-previous')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('138****8000')
}

async function openDocumentsFromHome(page: Page): Promise<void> {
  // 进个人区走底部「我的」（首页不放「进入我的」直达入口）；刚操作过，不问「还是你吗？」。
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的' }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await page.getByTestId('profile-asset-documents').click()
  await expect(page).toHaveURL(/\/me\/documents$/)
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

test('W-43 print done "我拿走了，结束使用" really ends the use and logs out @privacy-clear', async ({ page, api }) => {
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

  await expect(page.getByText('一会儿结束本次使用')).toBeVisible()
  await expect(page.getByText(/到点会结束本次使用并退出登录/)).toBeVisible()
  await expect(page.getByText('秒后结束使用')).toBeVisible()
  await expect(page.getByText('已清除')).toHaveCount(0)
  await expect(page.getByText('下一个人看不到')).toHaveCount(0)
  await expect(page.getByText('结束并清空')).toHaveCount(0)
  await shot(page, 'W-43-print-done-before-end-1080.png')

  const end = page.getByTestId('print-fulfill-primary')
  await expect(end).toHaveText('我拿走了，结束使用')
  await end.click()
  await expect(end).toHaveText('再按一次，确认结束使用')
  await end.click()

  // 真的结束：回首页、已退出登录，首页不再说有人登录着。
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('button', { name: '登录后查看本人记录' })).toBeVisible()
  await expect(page.getByTestId('home-end-previous')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('138****8000')
  await shot(page, 'W-43-after-end-logged-out-1080.png')
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
  await expect(page.getByText('一会儿结束本次使用')).toBeVisible()
  // 没登录：如实只说结束本次使用，不说退出登录。
  await expect(page.getByText(/到点会结束本次使用，本机这次的打印预览一并收起/)).toBeVisible()
  await expect(page.getByText('已清除')).toHaveCount(0)
})
