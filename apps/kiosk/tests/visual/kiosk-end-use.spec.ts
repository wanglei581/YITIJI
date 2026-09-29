/**
 * 一体机统一清场（隐私 P0，走查 W-42 / W-43 / W-75 / W-64 / B-12；产品负责人 9/29「两处都堵，30 秒」）。
 *
 * 正式构建 + 本页时钟（page.clock）走真实用户路径，断言三件事：
 *   1. 从任何离场出口离开后（「不是我」、首页「结束上一位的使用」、完成页到点、换号、闲置到点），
 *      下一位从首页、「我的」、深链 /me/documents、浏览器后退都读不到上一位：
 *      屏上没有上一位的文件名 / 手机号（含打码），也不再有带上一位令牌的「我的」请求发出。
 *   2. 回首页后超过 30 秒再进「我的」一定先问「还是你吗？」，问的时候资产页一条请求都不发；30 秒内不问。
 *   3. 首页登录态不出现手机号（含打码形式）。
 *
 * 用 playwright.privacy-clear.config.ts 跑（隐私硬截止保持默认 300 秒，不会抢在被测出口之前清场）。
 */
import type { Page, Request } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { W2_FILE, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'
import {
  allowLocalBootTicket,
  fillPhoneLogin,
  loginThroughVisibleUi,
  memberDocument,
  PRIVACY_CLEAR_TASK_ID,
  registerPrivacyShell,
  shotTo,
} from './fixtures/privacy-clear-shell'

const EVIDENCE_DIR = `${process.env.HOME}/.cache/walk0929/evidence/fix-clear-p0`

const WANG = {
  phone: '13912345678',
  masked: '139****5678',
  id: 'member-wang-xiaoyu',
  nickname: '王晓雨',
  token: 'member-token-wang-xiaoyu',
  doc: '王晓雨-个人简历-2026秋招.pdf',
}
const CHEN = {
  phone: '13687654321',
  masked: '136****4321',
  id: 'member-chen-lixing',
  nickname: '陈立行',
  token: 'member-token-chen-lixing',
  doc: '陈立行-求职信-物流专员.pdf',
}
const MEMBERS = [WANG, CHEN]

interface MeCall { path: string; auth: string | null }

/** 登录按手机号认人；「我的文档」按令牌给各自的文件；记下每一条「我的」请求带的是谁的令牌。 */
async function routeMembers(page: Page, api: ApiRouter): Promise<MeCall[]> {
  registerPrivacyShell(api)
  const calls: MeCall[] = []
  page.on('request', (request: Request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/me/')) calls.push({ path: url.pathname, auth: request.headers()['authorization'] ?? null })
  })
  await page.route('**/api/v1/member/auth/login', async (route) => {
    const body = route.request().postDataJSON() as { phone?: string }
    const member = MEMBERS.find((m) => m.phone === body.phone)
    await route.fulfill({
      status: member ? 200 : 400,
      contentType: 'application/json',
      body: JSON.stringify(member
        ? { success: true, data: { token: member.token, user: { id: member.id, phoneMasked: member.masked, nickname: member.nickname } } }
        : { success: false, error: { code: 'MEMBER_LOGIN_FAILED', message: '登录失败' } }),
    })
  })
  await page.route('**/api/v1/me/documents**', async (route) => {
    const auth = route.request().headers()['authorization'] ?? ''
    const member = MEMBERS.find((m) => auth === `Bearer ${m.token}`)
    await route.fulfill({
      status: member ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(member
        ? { success: true, data: { items: [memberDocument(`doc-${member.id}`, member.doc)], nextCursor: null, total: 1 } }
        : { success: false, error: { code: 'MEMBER_UNAUTHORIZED', message: '请先登录' } }),
    })
  })
  return calls
}

const shot = (page: Page, name: string) => shotTo(EVIDENCE_DIR, page, name)
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true })

async function expectNoTraceOf(page: Page, member: typeof WANG): Promise<void> {
  await expect(page.locator('body')).not.toContainText(member.doc)
  await expect(page.locator('body')).not.toContainText(member.masked)
  await expect(page.locator('body')).not.toContainText(member.phone)
}

async function expectLoggedOutHome(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('session-guard-state-clearing')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '登录后查看本人记录' })).toBeVisible()
  await expect(page.getByTestId('home-end-previous')).toHaveCount(0)
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(800)
  await page.waitForLoadState('load')
  await expect(page.getByTestId('session-guard-state-clearing')).toHaveCount(0)
  await page.waitForLoadState('load')
}

/** 下一位从深链、「我的」、浏览器后退进来，都读不到上一位。 */
async function expectNextPersonSeesNothing(page: Page, calls: MeCall[], previous: typeof WANG, label: string): Promise<void> {
  const from = calls.length
  await page.goto('/me/documents')
  await expect(page.getByTestId('handover-confirm')).toHaveCount(0)
  await expectNoTraceOf(page, previous)
  await shot(page, `${label}-deeplink-documents.png`)
  // 后退可能落进边界之前的旧历史：守卫会当场遮罩、清场并重载回首页。等它走完再看。
  await page.goBack()
  await settle(page)
  await expectNoTraceOf(page, previous)
  await page.goto('/profile')
  await expectNoTraceOf(page, previous)
  // 读不到的原因必须是「根本没带上一位的令牌去问」，不是「问了但没画出来」。
  const leaked = calls.slice(from).filter((c) => c.auth === `Bearer ${previous.token}`)
  expect(leaked, `${label}：离场后仍有带上一位令牌的请求 ${JSON.stringify(leaked)}`).toEqual([])
}

test('W-75 back home, idle 31s, open 我的 → 还是你吗？→ 不是我 clears 王晓雨 @end-use', async ({ page, api }) => {
  await page.clock.install()
  const calls = await routeMembers(page, api)
  await allowLocalBootTicket(page)
  await loginThroughVisibleUi(page, '/', WANG.phone)

  // 首页登录态：只说有人登录着，手机号（含打码）不上首页。
  await expect(page.getByTestId('home-identity')).toHaveText('有人登录着')
  await expect(page.getByTestId('home-end-previous')).toHaveText('结束上一位的使用')
  await expectNoTraceOf(page, WANG)
  await shot(page, '01-home-member-no-phone.png')

  // 刚操作过：进「我的」不问，直接看到自己的文档。
  await nav(page, '我的').click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('handover-confirm')).toHaveCount(0)
  await page.getByTestId('profile-asset-documents').click()
  await expect(page.getByText(WANG.doc)).toBeVisible()
  await shot(page, '02-wang-documents.png')

  await nav(page, '首页').click()
  await expect(page).toHaveURL(/\/$/)

  // 离开了 31 秒，一下都没点。
  await page.clock.runFor(31_000)
  const beforeAsk = calls.length
  await nav(page, '我的').click()
  const dialog = page.getByTestId('handover-confirm')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '还是你吗？' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '是我，继续' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '不是我' })).toBeVisible()
  await expectNoTraceOf(page, WANG)
  // 先确认、后读取：确认层出现时资产页一条请求都不发。
  await page.waitForTimeout(400)
  expect(calls.slice(beforeAsk)).toEqual([])
  await shot(page, '03-still-you-after-31s.png')

  await dialog.getByRole('button', { name: '不是我' }).click()
  await expectLoggedOutHome(page)
  await expectNoTraceOf(page, WANG)
  await shot(page, '04-not-me-home-clean.png')

  await expectNextPersonSeesNothing(page, calls, WANG, '05-after-not-me')
})

test('W-75 within 30s no question; 是我，继续 goes straight in @end-use', async ({ page, api }) => {
  await page.clock.install()
  await routeMembers(page, api)
  await allowLocalBootTicket(page)
  await loginThroughVisibleUi(page, '/', WANG.phone)

  await page.clock.runFor(20_000)
  await nav(page, '我的').click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('handover-confirm')).toHaveCount(0)
  await expect(page.getByTestId('profile-asset-documents')).toBeVisible()

  // 在「我的」里又停了 31 秒，再点「我的文档」：同样要问；答「是我，继续」直接进。
  await page.clock.runFor(31_000)
  await page.getByTestId('profile-asset-documents').click()
  const dialog = page.getByTestId('handover-confirm')
  await expect(dialog).toBeVisible()
  await expect(page.getByText(WANG.doc)).toHaveCount(0)
  await dialog.getByRole('button', { name: '是我，继续' }).click()
  await expect(page.getByText(WANG.doc)).toBeVisible()
})

test('W-75 home 结束上一位的使用 logs 王晓雨 out @end-use', async ({ page, api }) => {
  await page.clock.install()
  const calls = await routeMembers(page, api)
  await allowLocalBootTicket(page)
  await loginThroughVisibleUi(page, '/', WANG.phone)

  await page.getByTestId('home-end-previous').click()
  await expectLoggedOutHome(page)
  await shot(page, '06-home-end-previous-clean.png')
  await expectNextPersonSeesNothing(page, calls, WANG, '07-after-end-previous')
})

test('W-43 print done countdown reaches 0 → ends the use and logs out @end-use', async ({ page, api }) => {
  await page.clock.install()
  const calls = await routeMembers(page, api)
  await allowLocalBootTicket(page)
  await loginThroughVisibleUi(page, '/', WANG.phone)

  await page.evaluate(
    ({ taskId, file, params }) => {
      const browserState = {
        ...(window.history.state ?? {}),
        usr: { taskId, file, params, source: 'document' },
        key: 'end-use-print-done',
      }
      window.history.pushState(browserState, '', '/print/done')
      window.dispatchEvent(new PopStateEvent('popstate', { state: browserState }))
    },
    { taskId: PRIVACY_CLEAR_TASK_ID, file: W2_FILE, params: W2_PRINT_PARAMS },
  )
  await expect(page.getByText('一会儿结束本次使用')).toBeVisible()
  await expect(page.getByText(/到点会结束本次使用并退出登录/)).toBeVisible()
  await expect(page.getByTestId('print-fulfill-primary')).toHaveText('我拿走了，结束使用')
  await shot(page, '08-print-done-countdown.png')

  await page.clock.runFor(61_000)
  await expectLoggedOutHome(page)
  await expectNoTraceOf(page, WANG)
  await shot(page, '09-print-done-timeout-logged-out.png')
  await expectNextPersonSeesNothing(page, calls, WANG, '10-after-print-done')
})

test('W-64 switch account: 王晓雨 → 陈立行, 陈立行 never sees 王晓雨 @end-use', async ({ page, api }) => {
  await page.clock.install()
  const calls = await routeMembers(page, api)
  await allowLocalBootTicket(page)
  await loginThroughVisibleUi(page, '/', WANG.phone)

  await nav(page, '我的').click()
  await page.getByTestId('profile-asset-documents').click()
  await expect(page.getByText(WANG.doc)).toBeVisible()
  await nav(page, '我的').click()
  await page.getByTestId('profile-account').first().click()
  await page.getByTestId('member-settings-switch').click()
  await page.getByRole('button', { name: '退出并切换' }).click()

  // 先完整清场再进登录页：登录页上没有上一位，也没落回留着上一位的首页。
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByTestId('session-guard-state-clearing')).toHaveCount(0)
  await expectNoTraceOf(page, WANG)
  await shot(page, '11-switch-login-page.png')
  const beforeChen = calls.length

  await fillPhoneLogin(page, CHEN.phone)
  await page.waitForURL((url) => url.pathname === '/profile')
  await page.getByTestId('profile-asset-documents').click()
  await expect(page.getByText(CHEN.doc)).toBeVisible()
  await expectNoTraceOf(page, WANG)
  await shot(page, '12-chen-documents-no-wang.png')

  const afterSwitch = calls.slice(beforeChen)
  expect(afterSwitch.length).toBeGreaterThan(0)
  expect(afterSwitch.filter((c) => c.auth === `Bearer ${WANG.token}`)).toEqual([])
  expect(afterSwitch.every((c) => c.auth === `Bearer ${CHEN.token}`)).toBe(true)
})

test('idle timeout exit: 3 minutes untouched → logged out, deep link reads nothing @end-use', async ({ page, api }) => {
  await page.clock.install()
  const calls = await routeMembers(page, api)
  await allowLocalBootTicket(page)
  await loginThroughVisibleUi(page, '/', WANG.phone)

  // 150 秒进「还在用吗？」，再 30 秒到点清场。
  await page.clock.runFor(185_000)
  await expectLoggedOutHome(page)
  await expectNoTraceOf(page, WANG)
  await expectNextPersonSeesNothing(page, calls, WANG, '13-after-idle')
})
