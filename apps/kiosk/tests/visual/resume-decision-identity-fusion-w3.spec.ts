import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter, DynamicResult } from '../fixtures/api-router'
import { assertNoHorizontalOverflow } from './assert-layout'

// ── 稿 46 决策工作台两条路由的身份闸（/resume/career-plan、/resume/job-fit/actions）─────
// 真实路径：会员登录 → 某条**带会员令牌**的请求回 401 → AuthProvider 同步 logout()
// （清掉令牌与本机 AI 简历会话）→ 回登录页那一步被扫描收尾闸按住（撤销一直拿不到确认）。
// 这段时间里路由仍然挂着：旧规划 / 旧清单 / 待确认的降级打印件必须当场隐藏，
// 在路上的读取 / 生成 / 打印晚回来既不许写状态，也不许把人带去打印确认页；
// 挂载时本机会话里的匿名令牌也不许再被带出去。文件名以 fusion-w3.spec.ts 结尾，由 W3 配置接进 CI。

const MEMBER_TOKEN = 'decision-identity-member-token'
const ANON_TOKEN = 'decision-identity-anon-token'
const SCAN_TASK_ID = 'decision-identity-scan-task'
const SCAN_PATH = `/api/v1/scan/sessions/${SCAN_TASK_ID}`
const EXPIRED = { status: 401, json: { success: false, error: { code: 'MEMBER_SESSION_EXPIRED', message: '登录已过期' } } }
const ENDED_VIEWPORTS = [{ width: 1080, height: 1920 }, { width: 390, height: 844 }] as const

const CAREER_PLAN = {
  taskId: 't-cp', status: 'completed', basedOn: { resume: true, jobFit: null, interview: null },
  summary: '经历偏执行落地，适合先从运营助理起步。',
  currentSnapshot: [{ point: '有活动执行经历', evidence: '负责过校园活动报名统计' }],
  directions: [{ title: '运营助理', why: '经历贴近落地执行', firstStep: '把活动结果写成数字' }],
  skillPlan: [{ skill: '表格整理', action: '补一门表格入门课', timeframe: '30 天' }],
  actionChecklist: ['把简历结果量化'],
}
const ACTIONS_RESULT = {
  taskId: 't-act', status: 'completed', fitLevel: 'reference_medium', summary: '有可补的地方',
  job: { id: 'j-act', title: '行政专员', company: '示例来源企业', sourceName: '来源平台', externalId: 'X-ACT' },
  matchPoints: [], gapPoints: [{ gap: '缺少 Excel 数据整理经历', suggestion: '把做过的报表整理写成一条经历' }],
  targetedSuggestions: ['把「协助行政」改写成具体做过的三件事'],
}
const printFile = (id: string, variant?: 'degraded') => ({
  fileId: id, filename: `${id}.pdf`, sizeBytes: 2048, pageCount: 1,
  printFileUrl: `/api/v1/files/${id}/content?sig=late`, ...(variant ? { variant } : {}),
})

function gate(): { released: Promise<void>; release: () => void } {
  let release = () => {}
  const released = new Promise<void>((resolve) => { release = resolve })
  return { released, release }
}

/** 一次被按住的应答：`arrived` 在请求真的到达时兑现，`release()` 之后才回 `result`。 */
function held(result: DynamicResult) {
  const arrived = gate()
  const go = gate()
  return { result, arrived: arrived.released, markArrived: arrived.release, released: go.released, release: go.release }
}
type Held = ReturnType<typeof held>

/** 同一条请求按第几次到达分别应答（超出部分沿用最后一步）。 */
function script(api: ApiRouter, method: string, path: string, steps: Array<DynamicResult | Held>): void {
  api.respondWith(method, path, async (n) => {
    const step = steps[Math.min(n, steps.length) - 1]
    if (!('markArrived' in step)) return step
    step.markArrived()
    await step.released
    return step.result
  })
}

/** 终端壳层 + 真实登录链路 + 一场撤不掉的扫描（撤销一直 502，回登录页那一步就一直被按住）。 */
function registerShell(api: ApiRouter): { confirmRevoke: () => void } {
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true } })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: { smartCampus: { enabled: false, modules: {}, items: [] }, toolbox: { enabled: false, items: [] }, configVersion: 'w3-identity', refreshIntervalMs: 300000, serverTime: '2026-09-23T00:00:00.000Z' },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: { success: true, data: { token: MEMBER_TOKEN, user: { id: 'decision-member', phoneMasked: '138****8000', nickname: '身份闸会员' } } },
  })
  api.respond('POST', '/api/v1/member/auth/logout', { status: 200, json: { success: true, data: { loggedOut: true } } })
  let confirmed = false
  api.respondWith('DELETE', SCAN_PATH, () => confirmed
    ? { status: 200, json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } } }
    : { status: 502, json: { success: false, error: { code: 'BAD_GATEWAY', message: '网关错误' } } })
  return { confirmRevoke: () => { confirmed = true } }
}

/** 记下每一次 API 请求带了什么凭证；`mark()` 之后的请求算作身份切换之后。 */
function recordCredentials(page: Page) {
  const seen: Array<{ after: boolean; method: string; path: string; auth?: string; anon?: string }> = []
  let after = false
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/')) return
    const headers = request.headers()
    seen.push({ after, method: request.method(), path: url.pathname, auth: headers.authorization, anon: headers['x-resume-access-token'] })
  })
  return {
    mark: () => { after = true },
    /** 切换之后仍带着旧会员令牌的请求（撤销扫描与登出本来就该用正在失效的那一张，除外）。 */
    staleMemberAfterSwitch: () => seen.filter((r) => r.after && r.auth === `Bearer ${MEMBER_TOKEN}`
      && !(r.method === 'DELETE' && r.path === SCAN_PATH) && !(r.method === 'POST' && r.path === '/api/v1/member/auth/logout')),
    anonymousTokenUses: () => seen.filter((r) => r.anon === ANON_TOKEN),
  }
}

async function loginThenOpen(page: Page, target: string, beforeLogin?: () => Promise<void>): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(target)}`)
  await beforeLogin?.()
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => `${url.pathname}${url.search}` === target)
}

/** 页内写入、不重载：会员令牌只在内存里。有这一场待撤的扫描，401 之后就停在原路由上。 */
async function seedLiveScan(page: Page): Promise<void> {
  await page.evaluate((taskId) => {
    window.sessionStorage.setItem('ai-job-print:current-scan-workbench', JSON.stringify({
      stage: 'progress', scanType: 'resume',
      live: { scanTaskId: taskId, controlToken: 'decision-identity-scan-control', instructions: ['放好原件'], expiresAt: '2099-01-01T00:00:00.000Z' },
    }))
  }, SCAN_TASK_ID)
}

/** 放行一条晚到的响应，并在页内再给它 300ms 去犯错（负向断言要一个真实的观察窗口）。 */
async function releaseLate(page: Page, path: string, release: () => void): Promise<void> {
  const delivered = page.waitForResponse((response) => new URL(response.url()).pathname === path)
  release()
  await delivered
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)))
}

const ROUTE_OF = { 'resume-career-plan': '/resume/career-plan', 'resume-job-fit-actions': '/resume/job-fit/actions' } as const

async function expectEnded(page: Page, screen: keyof typeof ROUTE_OF, hidden: string[]): Promise<void> {
  await expect(page.locator(`[data-kiosk-screen="${screen}"]`)).toHaveAttribute('data-state', 'session-ended')
  await expect(page.getByRole('heading', { name: '这次会话已结束' })).toBeVisible()
  for (const text of hidden) await expect(page.getByText(text, { exact: false })).toHaveCount(0)
  // 回登录页那一步被扫描收尾按住：路由仍然挂着（没去 /login，也没被晚到的返回带去 /print/confirm）。
  expect(new URL(page.url()).pathname).toBe(ROUTE_OF[screen])
}

async function captureEnded(page: Page, name: string): Promise<void> {
  for (const size of ENDED_VIEWPORTS) {
    await page.setViewportSize(size)
    await expect.poll(async () => {
      const ctabar = await page.locator('.qx-ctabar').boundingBox()
      return ctabar && ctabar.y + ctabar.height <= size.height + 0.5 ? 'ok' : 'ctabar outside viewport'
    }).toBe('ok')
    await assertNoHorizontalOverflow(page)
    for (const target of [page.locator('.qx-topbar-back'), page.locator('.qx-ctabar .qx-btn').last()]) {
      const box = await target.boundingBox()
      expect(box, '可点区域必须可见').not.toBeNull()
      expect(Math.min(box!.width, box!.height), `${name} ${size.width}x${size.height} 触控尺寸`).toBeGreaterThanOrEqual(48)
    }
    await page.screenshot({ path: test.info().outputPath(`${name}-${size.width}x${size.height}.png`) })
  }
  await page.setViewportSize({ width: 1080, height: 1920 })
}

/** 求职方案：本机会话里留着一枚匿名令牌，登录后读回规划；「已有材料」那条会员请求就是 401 的来源。 */
async function openCareerAsMember(page: Page, api: ApiRouter): Promise<Held> {
  const expiry = held(EXPIRED)
  script(api, 'GET', '/api/v1/me/resumes', [expiry])
  api.respond('GET', '/api/v1/resume/career-plan/t-cp', { status: 200, json: CAREER_PLAN })
  await loginThenOpen(page, '/resume/career-plan', () => page.evaluate((anon) => {
    window.sessionStorage.setItem('ai-job-print:current-ai-resume', JSON.stringify({ taskId: 't-cp', accessToken: anon }))
  }, ANON_TOKEN))
  await expect(page.locator('[data-kiosk-screen="resume-career-plan"]')).toHaveAttribute('data-state', 'ready')
  await expect(page.getByText(CAREER_PLAN.summary)).toBeVisible()
  await expiry.arrived
  await seedLiveScan(page)
  return expiry
}

test('career plan: a 401 while printing hides the plan in place and the late print never reaches confirm @w3-kiosk', async ({ page, api }) => {
  const shell = registerShell(api)
  const creds = recordCredentials(page)
  const print = held({ status: 200, json: printFile('f-cp-late') })
  script(api, 'POST', '/api/v1/resume/career-plan/t-cp/print', [print])
  const expiry = await openCareerAsMember(page, api)
  await page.getByRole('button', { name: '打印建议单' }).click()
  await expect(page.locator('[data-kiosk-screen="resume-career-plan"]')).toHaveAttribute('data-state', 'print-pending')
  await print.arrived

  creds.mark()
  expiry.release()
  await expectEnded(page, 'resume-career-plan', [CAREER_PLAN.summary, '运营助理'])
  await releaseLate(page, '/api/v1/resume/career-plan/t-cp/print', print.release)
  await expectEnded(page, 'resume-career-plan', [CAREER_PLAN.summary])
  for (const name of ['打印建议单', '重新生成', '仍然打印这份参考单']) await expect(page.getByRole('button', { name })).toHaveCount(0)
  expect(creds.staleMemberAfterSwitch()).toEqual([])
  expect(creds.anonymousTokenUses()).toEqual([])

  // 撤销拿到确认，401 那一步才真的发生：回登录页，地址里不带任何凭证。
  shell.confirmRevoke()
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 25_000 })
  expect(page.url()).not.toContain(MEMBER_TOKEN)
  expect(page.url()).not.toContain(ANON_TOKEN)
  expect(creds.anonymousTokenUses()).toEqual([])
})

test('career plan: a stored degraded-print action disappears with the session and cannot be confirmed @w3-kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('POST', '/api/v1/resume/career-plan/t-cp/print', { status: 200, json: printFile('f-cp-degraded', 'degraded') })
  const expiry = await openCareerAsMember(page, api)
  await page.getByRole('button', { name: '打印建议单' }).click()
  await expect(page.locator('[data-kiosk-screen="resume-career-plan"]')).toHaveAttribute('data-state', 'print-degraded')
  await expect(page.getByRole('button', { name: '仍然打印这份参考单', exact: true })).toBeVisible()

  expiry.release()
  await expectEnded(page, 'resume-career-plan', ['这次拿到的不是上面那份', CAREER_PLAN.summary])
  await expect(page.getByRole('button', { name: '仍然打印这份参考单' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '去打印确认' })).toHaveCount(0)
  await captureEnded(page, 'career-session-ended')
})

test('career plan: a regenerated plan that arrives after the session ended is never shown @w3-kiosk', async ({ page, api }) => {
  registerShell(api)
  const lateSummary = '迟到的新规划：换人之后不许出现'
  const generate = held({ status: 200, json: { ...CAREER_PLAN, summary: lateSummary } })
  script(api, 'POST', '/api/v1/resume/career-plan/t-cp', [generate])
  const expiry = await openCareerAsMember(page, api)
  await page.getByRole('button', { name: '重新生成' }).click()
  await generate.arrived

  expiry.release()
  await expectEnded(page, 'resume-career-plan', [CAREER_PLAN.summary])
  await releaseLate(page, '/api/v1/resume/career-plan/t-cp', generate.release)
  await expectEnded(page, 'resume-career-plan', [lateSummary, CAREER_PLAN.summary])
})

test('career plan: the read that itself comes back 401 ends the session instead of opening the generate screen @w3-kiosk', async ({ page, api }) => {
  registerShell(api)
  const read = held(EXPIRED)
  script(api, 'GET', '/api/v1/resume/career-plan/t-cp', [read])
  await loginThenOpen(page, '/resume/career-plan', () => page.evaluate(() => {
    window.sessionStorage.setItem('ai-job-print:current-ai-resume', JSON.stringify({ taskId: 't-cp' }))
  }))
  await expect(page.locator('[data-kiosk-screen="resume-career-plan"]')).toHaveAttribute('data-state', 'loading')
  await read.arrived
  await seedLiveScan(page)

  read.release()
  await expectEnded(page, 'resume-career-plan', [])
  for (const name of ['生成求职方案', '打印求职参考单（未含 AI 规划）']) await expect(page.getByRole('button', { name })).toHaveCount(0)
})

/**
 * 行动清单只有一条读取、一条打印，自己不发别的会员请求。401 的来源用真实的前后跳转造：
 * 回比对页（它挂载就读同一个 job-fit 结果）→ 把那一次按住 → 浏览器后退回到行动清单 →
 * 比对页那条迟到的请求才回 401。第 1、3 次读取属于行动清单，第 2 次属于比对页。
 */
async function openActionsWithPendingExpiry(page: Page, api: ApiRouter, third: 'ready' | 'held') {
  const ok: DynamicResult = { status: 200, json: ACTIONS_RESULT }
  const expiry = held(EXPIRED)
  const lateRead = held(ok)
  script(api, 'GET', '/api/v1/resume/job-fit/t-act', [ok, expiry, third === 'held' ? lateRead : ok])
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [ACTIONS_RESULT.job], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 } } })

  await loginThenOpen(page, '/resume/job-fit/actions?taskId=t-act')
  const screen = page.locator('[data-kiosk-screen="resume-job-fit-actions"]')
  await expect(screen).toHaveAttribute('data-state', 'ready')
  await page.locator('.qx-ctabar').getByRole('button', { name: '返回比对结果' }).click()
  await expect(page).toHaveURL(/\/resume\/job-fit$/)
  await expiry.arrived
  await page.goBack()
  await expect(page).toHaveURL(/\/resume\/job-fit\/actions\?taskId=t-act$/)
  return { expiry, lateRead, screen }
}

test('job fit actions: a 401 from the previous page ends the session and the late print never reaches confirm @w3-kiosk', async ({ page, api }) => {
  registerShell(api)
  const creds = recordCredentials(page)
  const print = held({ status: 200, json: printFile('f-act-late') })
  script(api, 'POST', '/api/v1/resume/job-fit/t-act/print', [print])
  const { expiry, screen } = await openActionsWithPendingExpiry(page, api, 'ready')
  await expect(screen).toHaveAttribute('data-state', 'ready')
  await seedLiveScan(page)
  await page.locator('.qx-ctabar').getByRole('button', { name: '生成打印版' }).click()
  await expect(screen).toHaveAttribute('data-state', 'print-pending')
  await print.arrived

  creds.mark()
  expiry.release()
  await expectEnded(page, 'resume-job-fit-actions', ['缺少 Excel 数据整理经历', '把「协助行政」改写成具体做过的三件事'])
  await releaseLate(page, '/api/v1/resume/job-fit/t-act/print', print.release)
  await expectEnded(page, 'resume-job-fit-actions', ['缺少 Excel 数据整理经历'])
  await expect(page.getByRole('button', { name: '返回比对结果' })).toHaveCount(0)
  expect(creds.staleMemberAfterSwitch()).toEqual([])
  await captureEnded(page, 'actions-session-ended')
})

test('job fit actions: a read that arrives after the session ended is never rendered @w3-kiosk', async ({ page, api }) => {
  registerShell(api)
  const { expiry, lateRead, screen } = await openActionsWithPendingExpiry(page, api, 'held')
  await expect(screen).toHaveAttribute('data-state', 'loading')
  await lateRead.arrived
  await seedLiveScan(page)

  expiry.release()
  await expectEnded(page, 'resume-job-fit-actions', ['缺少 Excel 数据整理经历'])
  await releaseLate(page, '/api/v1/resume/job-fit/t-act', lateRead.release)
  await expectEnded(page, 'resume-job-fit-actions', ['缺少 Excel 数据整理经历', '把「协助行政」改写成具体做过的三件事'])
})

/**
 * 跨挂载反例：比对结果页「查看行动清单」把 {taskId, accessToken} 放进这条历史记录的 state
 * （本机会话里是登录前留下的匿名令牌）。401 之后整页回 /login，再按浏览器返回，这条记录会被
 * **重新挂载**成下一位。它不许再从旧 state / 地址里捡回上一位的任务与匿名令牌。
 */
const ACTIONS_READ = '/api/v1/resume/job-fit/t-act'
const TRACE_KEY = '__identity_history_trace'

async function openActionsWithAnonState(page: Page, api: ApiRouter) {
  script(api, 'GET', ACTIONS_READ, [{ status: 200, json: ACTIONS_RESULT }])
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [ACTIONS_RESULT.job], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 } } })
  const print = held(EXPIRED)
  script(api, 'POST', '/api/v1/resume/job-fit/t-act/print', [print])
  await loginThenOpen(page, '/resume/job-fit', () => page.evaluate((anon) => {
    window.sessionStorage.setItem('ai-job-print:current-ai-resume', JSON.stringify({ taskId: 't-act', accessToken: anon }))
  }, ANON_TOKEN))
  await page.getByRole('button', { name: /查看行动清单/ }).click()
  await expect(page).toHaveURL(/\/resume\/job-fit\/actions$/)
  const screen = page.locator('[data-kiosk-screen="resume-job-fit-actions"]')
  await expect(screen).toHaveAttribute('data-state', 'ready')
  await expect(page.getByText('缺少 Excel 数据整理经历')).toBeVisible()
  // 阳性对照：这条记录此刻确实带着上一位的任务号与匿名令牌。
  expect(await page.evaluate(() => (window.history.state as { usr?: unknown } | null)?.usr)).toEqual({ taskId: 't-act', accessToken: ANON_TOKEN })
  await page.locator('.qx-ctabar').getByRole('button', { name: '生成打印版' }).click()
  await expect(screen).toHaveAttribute('data-state', 'print-pending')
  await print.arrived
  return { print, screen }
}

/** 同一份文档上留个记号：返回后记号还在 = 走了 bfcache（不是要测的重新挂载），用例就不算数。 */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => { (window as unknown as { __identitySentinel?: boolean }).__identitySentinel = true })
}

async function expectBackFromLoginIsClean(page: Page, api: ApiRouter, creds: ReturnType<typeof recordCredentials>): Promise<void> {
  const screen = page.locator('[data-kiosk-screen="resume-job-fit-actions"]')
  const readsBeforeBack = api.requestCount('GET', ACTIONS_READ)
  await page.goBack()
  await expect(page).toHaveURL((url) => url.pathname === '/resume/job-fit/actions')
  expect(await page.evaluate(() => (window as unknown as { __identitySentinel?: boolean }).__identitySentinel ?? false)).toBe(false)
  // 先等页面自己落定（没洗掉时它会拿旧令牌读回旧清单），再给 300ms 观察窗口。
  await expect(screen).not.toHaveAttribute('data-state', 'loading')
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)))
  expect.soft(creds.anonymousTokenUses(), '上一位的匿名令牌不得再被带出').toEqual([])
  expect.soft(api.requestCount('GET', ACTIONS_READ), '不得再按上一位的任务号读取').toBe(readsBeforeBack)
  expect.soft(await page.getByText('缺少 Excel 数据整理经历').count(), '上一位的清单不得恢复').toBe(0)
  await expect(screen).toHaveAttribute('data-state', 'missing-task')
  await expect(page.getByRole('button', { name: '生成打印版' })).toHaveCount(0)
  expect(creds.staleMemberAfterSwitch()).toEqual([])
  expect(new URL(page.url()).pathname).not.toBe('/print/confirm')
}

test('job fit actions: browser back from the 401 login page cannot revive the old task or anonymous token @w3-kiosk', async ({ page, api }) => {
  const shell = registerShell(api)
  const creds = recordCredentials(page)
  const { print } = await openActionsWithAnonState(page, api)
  await seedLiveScan(page)
  creds.mark()
  print.release()
  await expectEnded(page, 'resume-job-fit-actions', ['缺少 Excel 数据整理经历'])
  // 撤销按住期间原地洗掉这条记录：仍在本路由、仍是会话结束屏，只是 state 不再带旧任务号与匿名令牌。
  // 用软断言：没洗掉时也要继续走到「返回」那一步，把真正的后果（旧令牌被再次带出）暴露出来。
  await page.waitForFunction(() => ((window.history.state as { usr?: unknown } | null)?.usr ?? null) === null, null, { timeout: 2_000 }).catch(() => undefined)
  expect.soft(await page.evaluate(() => (window.history.state as { usr?: unknown } | null)?.usr ?? null), '会话结束后当前历史记录的 state 应已清空').toBeNull()
  await markDocument(page)
  shell.confirmRevoke()
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 25_000 })
  await expectBackFromLoginIsClean(page, api, creds)
})

/**
 * 同一反例的无扫描路径：没有待撤的扫描时，AuthProvider 在 401 事件里**同步** `location.assign('/login')`。
 * 之后 React 能否在卸载前再渲染一次、跑到 effect，取决于浏览器调度（本机 Chromium 常常赶得上，但那不是保证），
 * 所以清理必须在同一次事件派发里同步完成。页内记录（跨整页跳转仍在的 sessionStorage）如实记下
 * 「跨文档 navigate 事件」与每次 replaceState 的先后，以及是否处在发起跳转的同一段同步调用栈；
 * 返回后的结果证明那次清理确实赶在卸载之前生效。
 */
test('job fit actions: with no scan to cancel, the 401 leaves at once and browser back still cannot revive the old task or token @w3-kiosk', async ({ page, api }) => {
  registerShell(api)
  const creds = recordCredentials(page)
  await page.addInitScript((key) => {
    const log = (entry: string) => {
      try {
        const list = JSON.parse(window.sessionStorage.getItem(key) ?? '[]') as string[]
        list.push(entry)
        window.sessionStorage.setItem(key, JSON.stringify(list))
      } catch { /* 记录失败不影响被测页面 */ }
    }
    const nav = (window as unknown as { navigation?: EventTarget }).navigation
    nav?.addEventListener('navigate', (event) => {
      const destination = (event as unknown as { destination: { url: string; sameDocument: boolean } }).destination
      if (destination.sameDocument) return
      log(`navigate ${new URL(destination.url).pathname}`)
      // 标出「发起整页跳转的那一段同步调用栈」：微任务在这段栈跑完后才执行，把标记放下。
      const marker = window as unknown as { __identityNavStack?: boolean }
      marker.__identityNavStack = true
      queueMicrotask(() => { marker.__identityNavStack = false })
    })
    const replaceState = History.prototype.replaceState
    History.prototype.replaceState = function (state: unknown, unused: string, url?: string | URL | null) {
      const target = url ? new URL(String(url), window.location.href) : new URL(window.location.href)
      const sameStack = (window as unknown as { __identityNavStack?: boolean }).__identityNavStack === true
      log(`replaceState ${target.pathname}${target.search} usr=${JSON.stringify((state as { usr?: unknown } | null)?.usr ?? null)} sameStack=${sameStack}`)
      return replaceState.call(this, state, unused, url)
    }
  }, TRACE_KEY)
  const { print } = await openActionsWithAnonState(page, api)
  await markDocument(page)
  await page.evaluate((key) => window.sessionStorage.removeItem(key), TRACE_KEY)
  creds.mark()
  print.release()
  await page.waitForURL((url) => url.pathname === '/login')
  const trace = await page.evaluate((key) => JSON.parse(window.sessionStorage.getItem(key) ?? '[]') as string[], TRACE_KEY)
  const leave = trace.indexOf('navigate /login')
  // 清理必须落在发起整页跳转的同一段同步调用栈里（sameStack=true）：之后的 React 再渲染 / effect
  // 能不能排在卸载之前，取决于浏览器调度，不能当作保证。
  const scrub = trace.findIndex((entry, index) => index > leave && entry.startsWith('replaceState /resume/job-fit/actions ')
    && !entry.includes(ANON_TOKEN) && entry.endsWith('sameStack=true'))
  expect.soft(leave, `页内时序：${trace.join(' | ')}`).toBeGreaterThanOrEqual(0)
  expect.soft(scrub, `页内时序：${trace.join(' | ')}`).toBeGreaterThan(leave)
  await expectBackFromLoginIsClean(page, api, creds)
})
