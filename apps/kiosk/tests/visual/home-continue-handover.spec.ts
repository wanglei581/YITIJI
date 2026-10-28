/**
 * 首页「继续办理」的隐私防线（隐私 P0，一体机触屏版第二包；第六包取证报告 7.2 条）。
 *
 * 这台机器摆在政府就业服务大厅里无人值守：上一位没退出就走开，下一位可能接着站到屏前。
 * 首页 ContinuePanel 用登录人的令牌读 /me/print-orders、/me/resumes，有进行中的打印或还没优化的简历，
 * 就把文件名直接写在首页上——而且在「我的」的「还是你吗？」之外：上一位走开后，已经画出来的文件名
 * 一直留在屏上；下一位一碰屏，面板还会再用上一位的令牌发请求。
 *
 * 正式构建 + 本页时钟（page.clock）走真实用户路径，断言：
 *   1. 本人在用（空档没到 30 秒，中途点过屏）：首页照常写出文件名；
 *   2. 空档超过 30 秒（和「我的」闸同一个判据）：已画出来的立刻收起，屏上没有文件名、订单、简历状态，
 *      此后一条带令牌的 /me 请求都不再发；
 *   3. 下一位碰屏、等过「点进来那一下」的 2 秒窗口、去别的页再回首页：仍然收着，仍然不发请求；
 *   4. 本人在「我的」的确认里答「是我，继续」：回首页照常显示，读取带本人令牌；
 *   5. 答「不是我」：清场，上一位的信息全无；下一位登录后看到的是自己的。
 *
 * 用 playwright.privacy-clear.config.ts 跑（隐私硬截止保持默认 300 秒，不会抢在被测空档之前清场）。
 */
import type { Locator, Page, Request, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { allowLocalBootTicket, fillPhoneLogin, loginThroughVisibleUi, registerPrivacyShell, shotTo } from './fixtures/privacy-clear-shell'

/** 设了环境变量才存证据截图；不设就不写任何目录（CI 上不落盘）。 */
const EVIDENCE_DIR = process.env.HOME_CONTINUE_EVIDENCE_DIR ?? ''

interface Member {
  phone: string
  masked: string
  id: string
  nickname: string
  token: string
}

const WANG: Member = { phone: '13912345678', masked: '139****5678', id: 'member-wang-xiaoyu', nickname: '王晓雨', token: 'member-token-wang-xiaoyu' }
const CHEN: Member = { phone: '13687654321', masked: '136****4321', id: 'member-chen-lixing', nickname: '陈立行', token: 'member-token-chen-lixing' }
const LIN: Member = { phone: '13755556666', masked: '137****6666', id: 'member-lin-yue', nickname: '林悦', token: 'member-token-lin-yue' }
const MEMBERS = [WANG, CHEN, LIN]

const WANG_FILE = '王晓雨-个人简历-2026秋招.pdf'
const CHEN_FILE = '陈立行-求职信-物流专员.pdf'
const PRINT_TITLE = '打印任务进行中'
const RESUME_TITLE = '上次诊断的简历，可继续优化'

function printOrder(id: string, fileName: string, status: 'pending' | 'claimed' | 'printing', createdAt: string) {
  return {
    id,
    orderNo: `ORD-20261029-${id.slice(-6).toUpperCase()}`,
    status,
    fileName,
    createdAt,
    completedAt: null,
    copies: 1,
    colorMode: 'black_white',
    duplex: 'simplex',
    paperSize: 'A4',
    pageRange: 'all',
  }
}

function diagnosedResume(id: string, taskId: string) {
  return {
    id,
    taskId,
    kind: 'parse',
    status: 'completed',
    provider: 'deepseek',
    optimized: false,
    hasDraft: false,
    latestVersion: null,
    createdAt: '2026-10-29T01:03:11.000Z',
    updatedAt: '2026-10-29T01:04:52.000Z',
    expiresAt: null,
  }
}

/** 每个人名下的打印订单与简历，按令牌给；没带令牌或令牌不认识给 401。 */
const ORDERS: Record<string, unknown[]> = {
  [WANG.token]: [printOrder('task-wang-20261029-a3f7c2', WANG_FILE, 'printing', '2026-10-29T01:12:40.000Z')],
  [CHEN.token]: [printOrder('task-chen-20261029-9be041', CHEN_FILE, 'pending', '2026-10-29T02:31:05.000Z')],
  [LIN.token]: [],
}
const RESUMES: Record<string, unknown[]> = {
  [WANG.token]: [diagnosedResume('resume-row-wang-01', 'ai-task-wang-5d21e8')],
  [CHEN.token]: [],
  [LIN.token]: [diagnosedResume('resume-row-lin-01', 'ai-task-lin-77c0b4')],
}

interface MeCall {
  path: string
  auth: string | null
}

/** 登录按手机号认人；打印订单、简历按令牌给各自的；记下每一条 /me 请求带的是谁的令牌。 */
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
  const byToken = (table: Record<string, unknown[]>) => async (route: Route) => {
    const auth = route.request().headers()['authorization'] ?? ''
    const member = MEMBERS.find((m) => auth === `Bearer ${m.token}`)
    await route.fulfill({
      status: member ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(member
        ? { success: true, data: { items: table[member.token] ?? [], nextCursor: null, total: (table[member.token] ?? []).length } }
        : { success: false, error: { code: 'MEMBER_UNAUTHORIZED', message: '请先登录' } }),
    })
  }
  await page.route('**/api/v1/me/print-orders**', byToken(ORDERS))
  await page.route('**/api/v1/me/resumes**', byToken(RESUMES))
  return calls
}

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true })
const region = (page: Page): Locator => page.getByTestId('home-context-region')
const panel = (page: Page): Locator => page.locator('section.continue')
const shot = async (page: Page, name: string) => {
  if (EVIDENCE_DIR) await shotTo(EVIDENCE_DIR, page, name)
}
/** 下一位碰一下屏：只按一个不触发任何功能的键（触碰监听记的是 pointerdown / touchstart / keydown）。 */
const touchScreen = (page: Page) => page.keyboard.press('Shift')

async function startAs(page: Page, api: ApiRouter, member: Member): Promise<MeCall[]> {
  await page.clock.install()
  const calls = await routeMembers(page, api)
  await allowLocalBootTicket(page)
  await loginThroughVisibleUi(page, '/', member.phone)
  await expect(page.getByTestId('home-identity')).toHaveText('有人登录着')
  return calls
}

/** 屏上不得留有这一位的任何痕迹：文件名、两种面板标题、姓名、手机号（含打码）。 */
async function expectNoTraceOf(page: Page, member: Member, file: string | null): Promise<void> {
  const body = page.locator('body')
  if (file) await expect(body).not.toContainText(file)
  await expect(body).not.toContainText(PRINT_TITLE)
  await expect(body).not.toContainText(RESUME_TITLE)
  await expect(body).not.toContainText(member.nickname)
  await expect(body).not.toContainText(member.masked)
  await expect(body).not.toContainText(member.phone)
  await expect(panel(page)).toHaveCount(0)
}

/** 带令牌的 /me 请求里，哪些是这个人的。 */
const callsBy = (calls: MeCall[], member: Member) => calls.filter((c) => c.auth === `Bearer ${member.token}`)
const homePanelCalls = (calls: MeCall[]) => calls.filter((c) => c.path === '/api/v1/me/print-orders' || c.path === '/api/v1/me/resumes')

test('home continue block shows the signed-in owner’s print file while they keep using the screen @home-continue', async ({ page, api }) => {
  const calls = await startAs(page, api, WANG)

  await expect(panel(page)).toBeVisible()
  await expect(region(page)).toContainText(PRINT_TITLE)
  await expect(region(page)).toContainText(`${WANG_FILE} · 打印中`)
  await expect(region(page).getByRole('button', { name: /查看进度/ })).toBeVisible()
  // 面板读了打印订单和简历两条，带的是本人令牌。（登录时收藏夹合并也会带令牌读一次 /me/favorites，那不是面板的。）
  expect(homePanelCalls(callsBy(calls, WANG)).map((c) => c.path).sort()).toEqual(['/api/v1/me/print-orders', '/api/v1/me/resumes'])
  await shot(page, '01-home-owner-continue-visible.png')

  // 一直有人在用：每隔不到 30 秒点一下，累计 60 秒，面板始终在。
  for (let round = 0; round < 3; round += 1) {
    await page.clock.runFor(20_000)
    await touchScreen(page)
    await expect(region(page)).toContainText(WANG_FILE)
  }
  expect(homePanelCalls(callsBy(calls, WANG)), '面板挂着的这段时间只读一次，不反复读').toHaveLength(2)

  // 本人去别的页、不到 30 秒回来：没有空档，面板重新挂载、照常读照常显示（不误收）。
  await page.locator('[data-action="help"]').click()
  await expect(page).toHaveURL(/\/help$/)
  await page.clock.runFor(8_000)
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect(region(page)).toContainText(`${WANG_FILE} · 打印中`)
  expect(homePanelCalls(callsBy(calls, WANG))).toHaveLength(4)
})

for (const scene of [
  { label: 'a print job in progress', member: WANG, file: WANG_FILE, title: PRINT_TITLE },
  { label: 'only a diagnosed resume to optimize', member: LIN, file: null, title: RESUME_TITLE },
] as const) {
  test(`home continue block (${scene.label}) collapses once the screen sat untouched past the handover gap and stops reading /me @home-continue`, async ({ page, api }) => {
    const calls = await startAs(page, api, scene.member)
    await expect(region(page)).toContainText(scene.title)
    if (scene.file) await expect(region(page)).toContainText(scene.file)

    // 29 秒：还没到判据（>30 秒），面板在。
    await page.clock.runFor(29_000)
    await expect(region(page)).toContainText(scene.title)
    const before = calls.length

    // 过了 30 秒还没人点：立刻收起，屏上没有任何这一位的东西，那一块不占位。
    await page.clock.runFor(2_500)
    await expectNoTraceOf(page, scene.member, scene.file)
    await expect(region(page)).toBeHidden()
    await shot(page, `02-home-collapsed-${scene.member.id}.png`)

    // 此后不再发任何带令牌的 /me 请求（包括面板已经收起之后的这几秒）。
    await page.clock.runFor(10_000)
    await page.waitForTimeout(300)
    expect(calls.slice(before), '收起之后不应再有 /me 请求').toEqual([])
  })
}

test('home continue block stays collapsed when the next person touches the screen, waits, or leaves and comes back @home-continue', async ({ page, api }) => {
  const calls = await startAs(page, api, WANG)
  await expect(region(page)).toContainText(WANG_FILE)

  await page.clock.runFor(31_000)
  await expectNoTraceOf(page, WANG, WANG_FILE)
  const before = calls.length

  // 下一位碰屏。「我的」闸看的是「点进来那一下之前空了多久」，碰过 2 秒之后判据会翻回「没空多久」，
  // 首页这一块不能跟着翻回来。
  await touchScreen(page)
  await page.clock.runFor(2_500)
  await touchScreen(page)
  await page.clock.runFor(6_000)
  await expectNoTraceOf(page, WANG, WANG_FILE)
  expect(calls.slice(before)).toEqual([])

  // 离开首页（站内跳转，不重载页面）再回来：还是收着，面板的两条读取一条都没发。
  await page.locator('[data-action="help"]').click()
  await expect(page).toHaveURL(/\/help$/)
  await page.clock.runFor(4_000)
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('qx-home')).toBeVisible()
  await page.clock.runFor(4_000)
  await expectNoTraceOf(page, WANG, WANG_FILE)
  expect(homePanelCalls(calls.slice(before)), '回到首页也不该再读打印订单和简历').toEqual([])
  await shot(page, '03-home-after-touch-and-return.png')
})

test('home continue block is already collapsed when the next person taps the home tab after the gap on another page @home-continue', async ({ page, api }) => {
  const calls = await startAs(page, api, WANG)
  await expect(region(page)).toContainText(WANG_FILE)

  // 上一位在别的页上走开：首页没挂着，面板不在场。
  await page.locator('[data-action="help"]').click()
  await expect(page).toHaveURL(/\/help$/)
  await page.clock.runFor(31_000)
  const before = calls.length

  // 下一位点底部「首页」：进页那一下之前空了 31 秒——面板挂都不该挂，更不该发请求。
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('qx-home')).toBeVisible()
  await page.clock.runFor(3_000)
  await expectNoTraceOf(page, WANG, WANG_FILE)
  expect(homePanelCalls(calls.slice(before)), '空了 31 秒后进首页，面板不该读上一位的订单').toEqual([])
})

test('home continue block collapses on the very first touch after the gap even before the one-second check ran @home-continue', async ({ page, api }) => {
  const calls = await startAs(page, api, WANG)
  await expect(region(page)).toContainText(WANG_FILE)
  const before = calls.length

  // 先把页面时钟停住：之后一个定时器都不会跑，每秒一次的检查也就没有机会收起面板。
  // 再把系统时间一下拨过 40 秒（setSystemTime 不触发定时器）；下一位这时碰屏——只有「碰屏即判」这条路能收起。
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(now + 200)
  await page.clock.setSystemTime(now + 40_000)
  await touchScreen(page)
  await expectNoTraceOf(page, WANG, WANG_FILE)
  await page.clock.runFor(6_000)
  await expectNoTraceOf(page, WANG, WANG_FILE)
  expect(calls.slice(before)).toEqual([])
})

test('home continue block comes back after the owner answers 是我，继续 in the handover confirm @home-continue', async ({ page, api }) => {
  const calls = await startAs(page, api, WANG)
  await expect(region(page)).toContainText(WANG_FILE)

  await page.clock.runFor(31_000)
  await expectNoTraceOf(page, WANG, WANG_FILE)

  // 本人回来了，经底部「我的」答「还是你吗？」。确认层出现时一条 /me 请求都不发。
  const beforeAsk = calls.length
  await nav(page, '我的').click()
  const dialog = page.getByTestId('handover-confirm')
  await expect(dialog).toBeVisible()
  await expect(page.locator('body')).not.toContainText(WANG_FILE)
  await page.waitForTimeout(300)
  expect(calls.slice(beforeAsk)).toEqual([])

  await dialog.getByRole('button', { name: '是我，继续' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/profile$/)

  // 回首页：本人确认过了，面板照常显示，读取带本人令牌。
  const beforeHome = calls.length
  await nav(page, '首页').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(region(page)).toContainText(`${WANG_FILE} · 打印中`)
  await expect(region(page).getByRole('button', { name: /查看进度/ })).toBeVisible()
  const homeReads = homePanelCalls(calls.slice(beforeHome))
  expect(homeReads.map((c) => c.path).sort()).toEqual(['/api/v1/me/print-orders', '/api/v1/me/resumes'])
  expect(homeReads.every((c) => c.auth === `Bearer ${WANG.token}`)).toBe(true)
  await shot(page, '04-home-after-owner-confirmed.png')

  // 确认过之后又是新的一轮：再空 31 秒，照样收起。
  await page.clock.runFor(31_000)
  await expectNoTraceOf(page, WANG, WANG_FILE)
})

test('home continue block leaves nothing of the previous person after 不是我 and the next person sees only their own @home-continue', async ({ page, api }) => {
  const calls = await startAs(page, api, WANG)
  await expect(region(page)).toContainText(WANG_FILE)

  await page.clock.runFor(31_000)
  await expectNoTraceOf(page, WANG, WANG_FILE)

  await nav(page, '我的').click()
  const dialog = page.getByTestId('handover-confirm')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '不是我' }).click()

  // 清场：回到干净的未登录首页，上一位的东西一点没有。
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('button', { name: '登录后查看本人记录' })).toBeVisible()
  await expect(page.getByTestId('home-end-previous')).toHaveCount(0)
  await expectNoTraceOf(page, WANG, WANG_FILE)
  await shot(page, '05-home-after-not-me.png')

  // 下一位从首页点登录：不被上一位留下的「收起」拦住，看到的是自己的，没有王晓雨的。
  const beforeNext = calls.length
  await page.getByRole('button', { name: '登录后查看本人记录' }).click()
  await expect(page).toHaveURL(/\/login/)
  await fillPhoneLogin(page, CHEN.phone)
  await page.waitForURL((url) => url.pathname === '/')
  await expect(region(page)).toContainText(`${CHEN_FILE} · 排队中`)
  await expect(page.locator('body')).not.toContainText(WANG_FILE)
  expect(callsBy(calls.slice(beforeNext), WANG), '下一位登录之后不该再有王晓雨令牌的请求').toEqual([])
})
