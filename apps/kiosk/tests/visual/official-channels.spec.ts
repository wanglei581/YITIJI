// 本机构官方渠道（next-tasks 3.14）在一体机上的样子。
//
// 期望都来自 3.14 的决定（托管 a）：
//   · /official-channels 两种托管状态都渲染：机构终端只列本机构自己的渠道；每张卡片是名称、二维码和一句逐字固定的
//     「本渠道由XX提供，信息以其官网为准」（中文排版，机构名两侧不留空格）；一体机不打开外部网页，所以只有二维码，没有可点的外链；
//   · 客户私有化部署（b）另列「其他来源平台」；我们云上（a）即使服务端误发，也一条都不出现；
//   · 读取中不下结论；没有渠道（含本机没有终端身份）诚实说「暂未配置」、不说原因，给本机能办的事；失败可重试；
//   · 首页只在读到「托管关闭」且至少有一个渠道时，在岗位 / 招聘会那一行摆一张「岗位与招聘会」；
//     读取中、失败、为空都不摆，也不先闪出来再收回；托管打开（b）时首页照旧；
//   · 旧地址 /jobs/online-platforms 两种状态都落到本页，不被招聘内容托管闸门接走。
import { mkdirSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { RECRUITMENT_HOSTING_OFF, RECRUITMENT_HOSTING_ON, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'
import { assertNoElementCrossesViewport, assertNoHorizontalOverflow } from './assert-layout'

const CONFIG = '/api/v1/terminals/KSK-001/config'
const CHANNELS = '/api/v1/terminals/KSK-001/official-channels'
const ORG = '青岛示例大学就业指导中心'

interface Channel { name: string; url: string; displayOrder: number; organizationName: string }

/** 故意逆序下发：页面必须按 displayOrder 升序排。 */
const ORG_CHANNELS: Channel[] = [
  { name: '青岛示例大学就业信息网', url: 'https://career.example.edu.cn/jobs?from=kiosk', displayOrder: 2, organizationName: ORG },
  { name: '就业指导中心微信公众号', url: 'https://mp.example.edu.cn/official', displayOrder: 1, organizationName: ORG },
]
const ORG_SORTED = [ORG_CHANNELS[1]!, ORG_CHANNELS[0]!]
const LEGACY: Channel[] = [
  { name: '示例招聘平台', url: 'https://jobs.example.com/', displayOrder: 1, organizationName: '示例招聘平台运营公司' },
  { name: '示例人才网', url: 'https://talent.example.org/', displayOrder: 2, organizationName: '示例人才网运营公司' },
]
const caption = (organizationName: string) => `本渠道由${organizationName}提供，信息以其官网为准`

/** CLAUDE.md §2 禁词，外加「本机存 / 不存什么」这一类说法（3.14 页面不对存储下任何结论）。 */
const FORBIDDEN_COPY = ['一键投递', '立即投递', '平台投递', '企业收简历', '候选人管理', '不记录', '不保存', '不存储', '已保存'] as const

type Hosting = typeof RECRUITMENT_HOSTING_ON | typeof RECRUITMENT_HOSTING_OFF

function registerShell(api: ApiRouter, hosting: Hosting): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true } })
  api.respond('GET', CONFIG, { status: 200, json: terminalConfigWithHosting(hosting) })
}

/** 点出去之后落地页挂载时要读的两条（在线服务探测、语音能力）：登记上，落地页在用例内就把请求发完。 */
function registerLandingPages(api: ApiRouter): void {
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { data: { asrEnabled: false, ttsEnabled: false } } })
}

function respondChannels(api: ApiRouter, items: Channel[], legacyPlatforms: Channel[] = []): void {
  api.respond('GET', CHANNELS, { status: 200, json: { items, legacyPlatforms } })
}

/** 托管打开时首页会读岗位与招聘会（既有两张磁贴）。 */
function registerHostingOnHome(api: ApiRouter): void {
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 12, totalPages: 12 } } })
  api.respond('GET', '/api/v1/job-fairs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })
}

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

/** 与页面同一个库、同一组参数离线画一遍：二维码的模块路径一致，就证明编码的正是这条网址。 */
function expectedQrPath(url: string): string {
  const markup = renderToStaticMarkup(createElement(QRCodeSVG, { value: url, size: 200, level: 'M', marginSize: 0 }))
  const paths = [...markup.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((match) => match[1])
  const modules = paths.at(-1)
  if (!modules) throw new Error(`qrcode.react 没有画出模块路径：${markup.slice(0, 120)}`)
  return modules
}

/**
 * 从文档一开始就盯着某个选择器：记下它每一次出现时，测试是否已经放行了那条被扣住的答复。
 * 只在断言时刻看一眼会漏掉一闪而过的东西。
 */
async function recordAppearances(page: Page, selector: string): Promise<void> {
  await page.addInitScript((target) => {
    const w = window as unknown as { __ocSeen: boolean[]; __ocReleased: boolean }
    w.__ocSeen = []
    w.__ocReleased = false
    new MutationObserver(() => {
      if (document.querySelector(target)) w.__ocSeen.push(w.__ocReleased)
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true })
  }, selector)
}

async function markReleased(page: Page): Promise<void> {
  await page.evaluate(() => { (window as unknown as { __ocReleased: boolean }).__ocReleased = true })
}

async function appearances(page: Page): Promise<boolean[]> {
  return page.evaluate(() => (window as unknown as { __ocSeen: boolean[] }).__ocSeen)
}

async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function expectNoForbiddenCopy(page: Page, where: string): Promise<void> {
  const text = (await page.locator('body').innerText()).replaceAll('去来源平台投递', '')
  for (const word of FORBIDDEN_COPY) expect(text, `${where} 不得出现「${word}」`).not.toContain(word)
}

/** 舞台可能被等比缩放：量到的 px 除以 scale 才是 CSS px（见 QxPageFrame 头注释）。 */
async function stageScale(page: Page): Promise<number> {
  const scaler = page.locator('.kiosk-stage')
  if (await scaler.count() === 0) return 1
  const transform = await scaler.evaluate((element) => getComputedStyle(element).transform)
  return transform === 'none' ? 1 : Number(transform.match(/^matrix\(([^,]+)/)?.[1] ?? 1)
}

async function expectTouchTargets(page: Page, where: string): Promise<void> {
  const scale = await stageScale(page)
  const sizes = await page.locator('button:not(:disabled), a[href], [role="button"]').evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0
    })
    .map((element) => {
      const box = element.getBoundingClientRect()
      return { label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 24), width: box.width, height: box.height }
    }))
  expect(sizes.length, `${where} 至少有一个可点目标`).toBeGreaterThan(0)
  for (const size of sizes) {
    expect(size.width / scale, `${where}「${size.label}」宽度 ≥48px`).toBeGreaterThanOrEqual(48)
    expect(size.height / scale, `${where}「${size.label}」高度 ≥48px`).toBeGreaterThanOrEqual(48)
  }
}

/** 一块首页网格的几何：每一行都铺满网格宽度，行距等于该网格的 row-gap。 */
async function gridGeometry(page: Page, selector: string) {
  return page.locator(selector).evaluate((grid) => {
    const box = grid.getBoundingClientRect()
    const style = getComputedStyle(grid)
    const rowGap = Math.round(Number.parseFloat(style.rowGap) || Number.parseFloat(style.gap) || 0)
    const tiles = [...grid.children].map((el) => {
      const rect = el.getBoundingClientRect()
      return { action: el.getAttribute('data-action'), top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), height: Math.round(rect.height) }
    })
    const rows = new Map<number, typeof tiles>()
    for (const tile of tiles) rows.set(tile.top, [...(rows.get(tile.top) ?? []), tile])
    return {
      rowGap,
      grid: { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right) },
      rows: [...rows.values()].map((row) => ({
        actions: row.map((tile) => tile.action),
        left: Math.min(...row.map((tile) => tile.left)),
        right: Math.max(...row.map((tile) => tile.right)),
        top: row[0]!.top,
        bottom: Math.max(...row.map((tile) => tile.bottom)),
        minHeight: Math.min(...row.map((tile) => tile.height)),
      })),
    }
  })
}

function expectGridFilled(geometry: Awaited<ReturnType<typeof gridGeometry>>): void {
  for (const row of geometry.rows) {
    expect(row.left, `${row.actions.join('+')} 贴住左边`).toBeLessThanOrEqual(geometry.grid.left + 1)
    expect(row.right, `${row.actions.join('+')} 贴住右边`).toBeGreaterThanOrEqual(geometry.grid.right - 1)
    expect(row.minHeight, `${row.actions.join('+')} 触控高度`).toBeGreaterThanOrEqual(104)
  }
  for (let index = 1; index < geometry.rows.length; index += 1) {
    const gap = geometry.rows[index]!.top - geometry.rows[index - 1]!.bottom
    expect(Math.abs(gap - geometry.rowGap), '行间只有网格间距').toBeLessThanOrEqual(2)
  }
  expect(geometry.grid.bottom - geometry.rows.at(-1)!.bottom, '网格底部不留空白').toBeLessThanOrEqual(2)
}

const TASK_ROWS = [['resume-hub', 'interview-hub'], ['print-hub', 'policy-hub']]
const CLOSED_TILES = [['pickup-claim', 'help']]
const CHANNEL_TILES = [['pickup-claim', 'official-channels', 'help']]

const screenOf = (page: Page) => page.locator('[data-kiosk-screen="official-channels"]')
const cardsOf = (page: Page, section: 'org' | 'legacy') => page.getByTestId(`official-channels-${section}`).getByTestId('official-channel-card')

async function expectChannelCards(page: Page, section: 'org' | 'legacy', expected: Channel[]): Promise<void> {
  const cards = cardsOf(page, section)
  await expect(cards).toHaveCount(expected.length)
  await expect(cards.locator('.oc-card-name')).toHaveText(expected.map((channel) => channel.name))
  for (const [index, channel] of expected.entries()) {
    const card = cards.nth(index)
    await expect(card.locator('.oc-caption'), `${channel.name} 的来源说明逐字固定`).toHaveText(caption(channel.organizationName))
    await expect(card.locator('.oc-card-host')).toHaveText(new URL(channel.url).host)
    const modules = await card.locator('[data-testid="official-channel-qr-code"] svg path').last().getAttribute('d')
    expect(modules, `${channel.name} 的二维码编码的就是它登记的网址`).toBe(expectedQrPath(channel.url))
  }
}

/**
 * 空态 / 失败态是稿上的两张带插画去处卡，标题靠左。
 * 上界防的是卡片被 flex 拉成整屏空卡；下界是可点高度，卡里还要有插画。
 */
async function expectDraftPairs(page: Page, where: string, labels: readonly string[], { minHeight, maxHeight }: { minHeight: number; maxHeight: number }): Promise<void> {
  const scale = await stageScale(page)
  const cards = await page.getByTestId('official-channels-alternatives').locator('.qxp-pair-card').evaluateAll((elements) => elements.map((card) => {
    const box = card.getBoundingClientRect()
    const k = card.querySelector('.qxp-k')!
    const range = document.createRange()
    range.selectNodeContents(k)
    const text = range.getBoundingClientRect()
    return {
      label: k.textContent ?? '',
      height: box.height,
      centerOff: Math.abs(text.left + text.width / 2 - (box.left + box.width / 2)),
      art: card.querySelector('.qxp-artbox svg') ? 1 : 0,
    }
  }))
  expect(cards.map((card) => card.label), `${where}：去处`).toEqual([...labels])
  for (const card of cards) {
    expect(card.height / scale, `${where}「${card.label}」不被拉成没有内容的空卡（≤${maxHeight}px）`).toBeLessThanOrEqual(maxHeight)
    expect(card.height / scale, `${where}「${card.label}」保持可点高度（≥${minHeight}px）`).toBeGreaterThanOrEqual(minHeight)
    expect(card.centerOff / scale, `${where}「${card.label}」标题居中（稿 45 的空态、失败态是居中小标题加整幅插画）`).toBeLessThanOrEqual(24)
    expect(card.art, `${where}「${card.label}」有插画`).toBe(1)
  }
}
// 稿 45：空态、失败态的两张去处卡是撑满正文的大卡，卡里的插画占大头，所以上界放到一屏之内，空卡由「有插画」那条防。
const STAGE_PAIRS = { minHeight: 180, maxHeight: 1100 }
const PHONE_PAIRS = { minHeight: 140, maxHeight: 360 }

// ── 渠道页：机构终端 ─────────────────────────────────────────────────────────

test('org terminal: each channel is a card with its own QR and the exact source caption @w1-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  respondChannels(api, ORG_CHANNELS)

  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'items')
  await expect(page.getByRole('heading', { level: 1, name: '扫码，在手机上看' })).toBeVisible()
  await expect(page.getByText('本机构官方渠道').first()).toBeVisible()
  await expect(page.getByText('扫下面的码，在自己的手机上打开本机构核验过的官方页面。')).toBeVisible()
  await expect(page.locator('[data-kiosk-screen="official-channels"]')).not.toContainText('招聘')
  await expect(page.locator('.qxt-status')).toHaveText('2 个官方渠道')
  // 默认不分组：机构名写在每张卡的来源说明里（expectChannelCards 逐字核），整个分区里能找到机构名。
  await expect(page.getByTestId('official-channels-org'), '分区里写明是哪一家机构').toContainText(ORG)
  await expectChannelCards(page, 'org', ORG_SORTED)
  await expect(page.getByTestId('official-channels-legacy'), '托管关闭：没有「其他来源平台」').toHaveCount(0)
  await expect(page.locator('.qxt-screen a[href]'), '一体机不打开外部网页：整页没有可点的链接').toHaveCount(0)
  await expectNoForbiddenCopy(page, '渠道页')
  await expectTouchTargets(page, '渠道页')
  await assertNoHorizontalOverflow(page)
  await assertNoElementCrossesViewport(page)
  await page.screenshot({ path: test.info().outputPath('official-channels-items-1080x1920.png') })

  // AI 仍是驱动层：不确定先看什么时，直接进 AI 求职方向探索。
  registerLandingPages(api)
  await page.getByRole('button', { name: /AI 求职方向探索/ }).click()
  await page.waitForURL((url) => url.pathname === '/assistant' && url.searchParams.get('intent') === 'career_explore')
  await expect(page.locator('[data-kiosk-screen="assistant"]')).toBeVisible()
  await expect.poll(() => api.requestCount('GET', '/api/v1/mock-interviews/capabilities/voice'), '落地页的挂载请求在用例内发完').toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('the channels response may come in the success/data envelope too @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  api.respond('GET', CHANNELS, { status: 200, json: { success: true, data: { items: [ORG_CHANNELS[0]], legacyPlatforms: [] } } })
  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'items')
  await expectChannelCards(page, 'org', [ORG_CHANNELS[0]!])
  // 只有一张本机构渠道时照稿 45：码卡就是主角，不压分区标题（机构名在卡底来源说明里）。
  await expect(page.getByTestId('official-channels-org').locator('.qxp-k')).toHaveCount(0)
  await expect(page.getByTestId('official-channels-org').locator('.oc-card-name')).toHaveCount(1)
})

test('a channel whose link is not http(s) gets no QR and no card @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  respondChannels(api, [ORG_CHANNELS[1]!, { name: '脚本链接', url: 'javascript:alert(1)', displayOrder: 3, organizationName: ORG }])
  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'items')
  await expectChannelCards(page, 'org', [ORG_CHANNELS[1]!])
  await expect(page.getByText('脚本链接')).toHaveCount(0)
})

// ── 渠道页：没有渠道 / 没有终端身份 / 失败 / 读取中 ─────────────────────────────

test('empty: says the terminal has no channel configured, not why, and offers what still works here @w1-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  respondChannels(api, [])

  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'empty')
  const empty = page.getByTestId('official-channels-empty')
  await expect(page.getByRole('heading', { level: 1, name: '本终端暂未配置官方渠道' })).toBeVisible()
  // 只说事实，不说原因（没绑机构、机构没录、被下架……一律不猜）。
  await expect(empty).toContainText('本终端还没有可扫的码。')
  // 页上没有码，页头就不能说「扫下面的码」。
  await expect(page.getByText('没有可扫的码。可以问小青，或先看帮助。', { exact: true })).toBeVisible()
  await expect(page.locator('[data-kiosk-screen="official-channels"]')).not.toContainText('招聘')
  await expect(page.locator('.qxt-status')).toHaveText('暂未配置官方渠道')
  await expect(page.getByTestId('official-channel-card')).toHaveCount(0)
  const alternatives = page.getByTestId('official-channels-alternatives').locator('.qxp-k')
  await expect(alternatives).toHaveText(['问小青', '帮助'])
  await expectDraftPairs(page, '空态', ['问小青', '帮助'], STAGE_PAIRS)
  await expectNoForbiddenCopy(page, '空态')
  await expectTouchTargets(page, '空态')
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: test.info().outputPath('official-channels-empty-1080x1920.png') })

  registerLandingPages(api)
  api.respond('GET', '/api/v1/public/support-contact', { status: 200, json: { data: { servicePhone: null, serviceHours: null } } })
  await page.getByTestId('official-channels-alternatives').getByRole('button', { name: /^帮助/ }).click()
  await page.waitForURL((url) => url.pathname === '/help')
  await expect(page.locator('[data-qx-page="help"]')).toBeVisible()
  await expect.poll(() => api.requestCount('GET', '/api/v1/public/support-contact'), '帮助页挂载时读取服务电话').toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('no terminal identity: treated as empty-honest, and nothing is requested @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  const channelRequests: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/v1/') && path.endsWith('/official-channels')) channelRequests.push(request.url())
  })
  await page.route('**/local/terminal-identity', (route) => route.abort('connectionrefused'))

  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'empty')
  await expect(page.getByTestId('official-channels-empty')).toBeVisible()
  await expect(page.getByTestId('official-channels-error')).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(channelRequests, '没有终端身份就不发请求（更不会发出 /terminals//…）').toEqual([])
})

test('error then retry: honest failure with a working retry, no raw error text @w1-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  api.respondWith('GET', CHANNELS, (requestNumber) => requestNumber === 1
    ? { status: 503, json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'upstream timeout' } } }
    : { status: 200, json: { items: ORG_CHANNELS, legacyPlatforms: [] } })

  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'error')
  await expect(page.getByRole('heading', { level: 1, name: '官方渠道这次没有读取成功' })).toBeVisible()
  await expect(page.getByTestId('official-channels-error')).toContainText('这次没有读到官方渠道。请重新读取。')
  await expect(page.locator('.qxt-status')).toHaveText('渠道读取失败')
  await expect(page.getByTestId('official-channel-card')).toHaveCount(0)
  await expect(page.getByTestId('official-channels-empty'), '失败不冒充「没有渠道」').toHaveCount(0)
  await expect(page.getByTestId('official-channels-alternatives')).toBeVisible()
  await expectDraftPairs(page, '失败态', ['重新读取', '帮助'], STAGE_PAIRS)
  const text = await page.locator('body').innerText()
  for (const raw of ['SERVICE_UNAVAILABLE', 'upstream timeout', '503']) expect(text, `不直出原始错误「${raw}」`).not.toContain(raw)
  await expectTouchTargets(page, '失败态')
  await page.screenshot({ path: test.info().outputPath('official-channels-error-1080x1920.png') })

  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(screenOf(page)).toHaveAttribute('data-state', 'items')
  await expectChannelCards(page, 'org', ORG_SORTED)
  expect(api.requestCount('GET', CHANNELS)).toBe(2)
  expect(errors).toEqual([])
})

test('loading: neutral, never claims "none configured" before the answer arrives @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  const gate = deferred()
  api.respondWith('GET', CHANNELS, async () => {
    await gate.promise
    return { status: 200, json: { items: ORG_CHANNELS, legacyPlatforms: [] } }
  })
  await recordAppearances(page, '[data-testid="official-channels-empty"], [data-testid="official-channel-card"]')

  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'loading')
  await expect(page.getByTestId('official-channels-loading')).toContainText('正在读取本终端的官方渠道')
  await expect(page.locator('.qxt-status')).toHaveText('正在读取本机构渠道')
  await page.waitForTimeout(500)
  await expect(page.getByText('暂未配置官方渠道')).toHaveCount(0)
  await expect(page.getByTestId('official-channel-card')).toHaveCount(0)

  await markReleased(page)
  gate.resolve()
  await expect(screenOf(page)).toHaveAttribute('data-state', 'items')
  const seen = await appearances(page)
  expect(seen.length, '答复放行后卡片确实出现了（阳性对照）').toBeGreaterThan(0)
  expect(seen.every(Boolean), '答复之前既没出现卡片，也没说「暂未配置」').toBe(true)
})

// ── 渠道页：b 版本的「其他来源平台」 ─────────────────────────────────────────

test('version b: legacy platforms get a second section with the same cards @w1-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, RECRUITMENT_HOSTING_ON)
  respondChannels(api, [ORG_CHANNELS[1]!], LEGACY)

  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'items')
  const legacy = page.getByTestId('official-channels-legacy')
  await expect(legacy.locator('.qxp-k')).toContainText('其他来源平台')
  await expectChannelCards(page, 'org', [ORG_CHANNELS[1]!])
  await expectChannelCards(page, 'legacy', LEGACY)
  await expect(page.locator('.qxt-screen a[href]')).toHaveCount(0)
  await expectNoForbiddenCopy(page, 'b 版本渠道页')
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: test.info().outputPath('official-channels-b-legacy-1080x1920.png'), fullPage: true })

  // 机构自己还没有渠道：空态照样诚实，b 版本的平台目录照样列出（不拿平台目录冒充本机构渠道）。
  respondChannels(api, [], LEGACY)
  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'empty')
  await expect(page.getByTestId('official-channels-empty')).toBeVisible()
  await expect(page.getByTestId('official-channels-org')).toHaveCount(0)
  await expectChannelCards(page, 'legacy', LEGACY)
  expect(errors).toEqual([])
})

test('version a: legacy platforms never show, even if the server sends them @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  respondChannels(api, ORG_CHANNELS, LEGACY)
  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'items')
  await expectChannelCards(page, 'org', ORG_SORTED)
  // 配置确实读完了（首页同款判据：托管配置的答复已经到），再留两帧，然后才断言 b 段不在。
  await expect.poll(() => api.requestCount('GET', CONFIG)).toBeGreaterThan(0)
  await twoFrames(page)
  await expect(page.getByTestId('official-channels-legacy')).toHaveCount(0)
  for (const platform of LEGACY) await expect(page.getByText(platform.name)).toHaveCount(0)

  // 机构没有渠道时也一样：只剩诚实空态，服务端误发的平台目录不补位。
  respondChannels(api, [], LEGACY)
  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'empty')
  await twoFrames(page)
  await expect(page.getByTestId('official-channels-legacy')).toHaveCount(0)
})

// ── 旧地址 ─────────────────────────────────────────────────────────────────

test('the old /jobs/online-platforms URL lands on the official channels page in both hosting modes @w1-kiosk', async ({ page, api }) => {
  for (const hosting of [RECRUITMENT_HOSTING_OFF, RECRUITMENT_HOSTING_ON] as const) {
    registerShell(api, hosting)
    respondChannels(api, ORG_CHANNELS)
    await page.goto('/jobs/online-platforms', { waitUntil: 'domcontentloaded' })
    await page.waitForURL((url) => url.pathname === '/official-channels')
    await expect(screenOf(page), `${hosting.recruitmentHosting.reason}：落到本机构官方渠道`).toHaveAttribute('data-state', 'items')
    await expect(page.getByRole('heading', { level: 1, name: '扫码，在手机上看' })).toBeVisible()
    await expect(page.getByText('本机构官方渠道').first()).toBeVisible()
    await expect(page.locator('[data-kiosk-screen="recruitment-hosting"]'), '不被招聘内容托管闸门接走').toHaveCount(0)
    await expect(page.getByText('线上招聘平台')).toHaveCount(0)
  }
})

// ── 首页 ─────────────────────────────────────────────────────────────────

test('home: an org terminal with channels gets one 岗位与招聘会 tile in the job/fair row @w1-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  respondChannels(api, ORG_CHANNELS)

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const home = page.getByTestId('qx-home')
  await expect(home).toHaveAttribute('data-recruitment', 'closed')
  const tile = home.locator('[data-action="official-channels"]')
  await expect(tile).toBeVisible()
  await expect(home).toHaveAttribute('data-official-channels', 'shown')
  await expect(tile.locator('b')).toHaveText('本机构官方渠道')
  await expect(tile.locator('small')).toHaveText('本机有 2 个渠道，扫码到机构官网')
  for (const action of ['jobs-hub', 'fairs-hub', 'jobs-retry', 'fairs-retry', 'campus-zone']) {
    await expect(home.locator(`[data-action="${action}"]`), `托管关闭时首页不摆 ${action}`).toHaveCount(0)
  }
  await expect(home.locator('.qxt-home-foot')).toContainText('岗位与招聘会请看本机构官方渠道，本终端不代收简历。')
  await expect(home.locator('.qxt-home-foot'), '有渠道时不再说「未开放岗位与招聘会」').not.toContainText('未开放')

  // 四张大卡仍是 2×2。渠道补进第三行，和到机取件、帮助并排。
  const tasks = await gridGeometry(page, '.qxt-home-tasks')
  expect(tasks.rows.map((row) => row.actions)).toEqual(TASK_ROWS)
  expectGridFilled(tasks)
  const tiles = await gridGeometry(page, '.qxt-home-tiles')
  expect(tiles.rows.map((row) => row.actions)).toEqual(CHANNEL_TILES)
  expectGridFilled(tiles)
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: test.info().outputPath('home-official-channels-tile-1080x1920.png') })

  await tile.click()
  await page.waitForURL((url) => url.pathname === '/official-channels')
  await expect(screenOf(page)).toHaveAttribute('data-state', 'items')
  expect(errors).toEqual([])
})

test('home: no tile while the channels request is held, and it appears exactly once after @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  const gate = deferred()
  api.respondWith('GET', CHANNELS, async () => {
    await gate.promise
    return { status: 200, json: { items: ORG_CHANNELS, legacyPlatforms: [] } }
  })
  await recordAppearances(page, '[data-action="official-channels"]')

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const home = page.getByTestId('qx-home')
  await expect(home).toHaveAttribute('data-recruitment', 'closed')
  await expect(home).toHaveAttribute('data-toolbox', 'off')
  await page.waitForTimeout(600)
  await expect(home.locator('[data-action="official-channels"]')).toHaveCount(0)
  expect((await gridGeometry(page, '.qxt-home-tiles')).rows.map((row) => row.actions)).toEqual(CLOSED_TILES)

  await markReleased(page)
  gate.resolve()
  await expect(home.locator('[data-action="official-channels"]')).toBeVisible()
  const seen = await appearances(page)
  expect(seen.length, '答复放行后磁贴确实出现了（阳性对照）').toBeGreaterThan(0)
  expect(seen.every(Boolean), '答复之前磁贴一次都没出现过').toBe(true)
  await page.waitForTimeout(300)
  await expect(home.locator('[data-action="official-channels"]'), '出现之后不再收回').toHaveCount(1)
})

test('home: no tile when the channels request fails or the org has none @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  api.respond('GET', CHANNELS, { status: 500, json: { success: false, error: { code: 'INTERNAL', message: 'boom' } } })

  for (const label of ['读取失败', '没有渠道']) {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const home = page.getByTestId('qx-home')
    await expect(home).toHaveAttribute('data-recruitment', 'closed')
    await expect.poll(() => api.requestCount('GET', CHANNELS), `${label}：渠道答复已经到了`).toBeGreaterThan(label === '读取失败' ? 0 : 1)
    await page.waitForTimeout(400)
    await expect(home.locator('[data-action="official-channels"]'), `${label}：不摆磁贴`).toHaveCount(0)
    await expect(home).not.toHaveAttribute('data-official-channels', 'shown')
    expect((await gridGeometry(page, '.qxt-home-tiles')).rows.map((row) => row.actions), `${label}：仍是托管关闭、没有渠道时的第三行`).toEqual(CLOSED_TILES)
    await expect(home.locator('.qxt-home-foot')).toContainText('本终端未开放岗位与招聘会信息，也不代收简历。')
    respondChannels(api, [])
  }
})

test('home: hosting on keeps the job and fair tiles, even when the org has channels @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_ON)
  registerHostingOnHome(api)
  respondChannels(api, ORG_CHANNELS, LEGACY)

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const home = page.getByTestId('qx-home')
  await expect(home).toHaveAttribute('data-recruitment', 'open')
  await expect(home.locator('[data-action="jobs-hub"]')).toContainText('全职、兼职岗位和社会招聘会')
  await expect(home.locator('[data-action="jobs-hub"]')).not.toContainText('个在招')
  await expect(home.locator('[data-action="campus-zone"]')).toBeVisible()
  await expect(home.locator('[data-action="fairs-hub"]')).toHaveCount(0)
  // 不钉「托管打开时要不要去读渠道」——读或不读都对，钉的只是磁贴不出现。渠道答复是立即给的，
  // 等到岗位说明已经到了再留一段，读了的实现也早该渲染完。
  await page.waitForTimeout(400)
  await expect(home.locator('[data-action="official-channels"]')).toHaveCount(0)
  expect((await gridGeometry(page, '.qxt-home-tiles')).rows.map((row) => row.actions)).toEqual([
    ['pickup-claim', 'jobs-hub'],
    ['campus-zone', 'help'],
  ])
})

// ── 首页页眉的点位小字 ────────────────────────────────────────────────────
// 页眉品牌名下的小字不再写死「就业服务大厅」：读到本机绑定的机构名就写机构名，读不到给中性说法，不编地点。
const BRAND_SMALL = '.qxt-band .qxt-brand small'
const NEUTRAL_PLACE = '自助服务终端'
const LONG_ORG = '青岛市市南区人力资源和社会保障局就业服务中心第二分中心（香港中路营业厅）'

test('home: the header names the bound organization, and says nothing until the channels answer @w1-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  const gate = deferred()
  api.respondWith('GET', CHANNELS, async () => {
    await gate.promise
    return { status: 200, json: { items: ORG_CHANNELS, legacyPlatforms: [] } }
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const home = page.getByTestId('qx-home')
  await expect(home).toHaveAttribute('data-recruitment', 'closed')
  await page.waitForTimeout(600)
  // 渠道答复还没到：不先写一句中性说法再改口，小字整行不画（阳性对照在放行之后）。
  await expect(home.locator(BRAND_SMALL)).toHaveCount(0)
  await expect(home.locator('.qxt-band .qxt-brand b')).toHaveText('职易达')

  gate.resolve()
  await expect(home.locator(BRAND_SMALL)).toHaveText(ORG)
  await expect(home, '页眉不再写死「就业服务大厅」').not.toContainText('就业服务大厅')
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: test.info().outputPath('home-header-organization-1080x1920.png') })
  expect(errors).toEqual([])
})

test('home: the header falls back to the neutral line when no organization is known @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  api.respond('GET', CHANNELS, { status: 500, json: { success: false, error: { code: 'INTERNAL', message: 'boom' } } })

  for (const label of ['读取失败', '终端没绑机构或没有渠道']) {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const home = page.getByTestId('qx-home')
    await expect(home.locator(BRAND_SMALL), `${label}：中性说法`).toHaveText(NEUTRAL_PLACE)
    await expect(home, `${label}：不编地点`).not.toContainText('就业服务大厅')
    respondChannels(api, [])
  }
})

test('home: a very long organization name is cut so the header stays on one line @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  respondChannels(api, [{ name: '官方公众号', url: 'https://mp.example.edu.cn/official', displayOrder: 1, organizationName: LONG_ORG }])

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const small = page.getByTestId('qx-home').locator(BRAND_SMALL)
  const expected = `${Array.from(LONG_ORG).slice(0, 23).join('')}…`
  await expect(small).toHaveText(expected)
  expect(Array.from(expected).length).toBe(24)
  await assertNoHorizontalOverflow(page)
  await assertNoElementCrossesViewport(page)
})

// ── 手机宽度 ─────────────────────────────────────────────────────────────

test('phone 390x844: the home header keeps a long organization name inside the screen @w1-mobile', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  respondChannels(api, [{ name: '官方公众号', url: 'https://mp.example.edu.cn/official', displayOrder: 1, organizationName: LONG_ORG }])

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const small = page.getByTestId('qx-home').locator(BRAND_SMALL)
  await expect(small).toHaveText(`${Array.from(LONG_ORG).slice(0, 23).join('')}…`)
  const viewport = page.viewportSize()!
  const box = await small.boundingBox()
  expect(box!.x, '小字不越出左缘').toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width, '小字不越出右缘').toBeLessThanOrEqual(viewport.width)
  // 页眉上的装饰光晕（.qxt-halo）本来就越出手机宽度，是共享件的既有样子，所以这里只量小字自己和横向滚动。
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: test.info().outputPath('home-header-long-organization-390x844.png') })
})

test('taken-down channel drops its QR when the card is checked again @w1-kiosk @w90', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  const kept = ORG_CHANNELS[1]!
  const removed = ORG_CHANNELS[0]!
  api.respondWith('GET', CHANNELS, (requestNumber) => (requestNumber === 1
    ? { status: 200, json: { items: ORG_CHANNELS, legacyPlatforms: [] } }
    : { status: 200, json: { items: [kept], legacyPlatforms: [] } }))
  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'items')
  await expectChannelCards(page, 'org', ORG_SORTED)
  await page.locator('[data-testid="official-channel-card"]').filter({ hasText: kept.name }).getByTestId('official-channel-recheck').click()
  const note = page.getByTestId('official-channel-withdrawn')
  await expect(note).toHaveText(`「${removed.name}」已经撤下，不再提供二维码。`)
  await expect(page.getByTestId('official-channel-card')).toHaveCount(1)
  await expect(page.getByTestId('official-channel-card').filter({ hasText: removed.name })).toHaveCount(0)
  await expect(page.getByTestId('official-channel-qr')).toHaveCount(1)
  await expect(page.locator('.qxt-screen a[href]')).toHaveCount(0)
  const dir = process.env.WALK_FIX_DIR
  if (dir) {
    mkdirSync(dir, { recursive: true })
    await page.screenshot({ path: `${dir}/W-90-channel-qr-withdrawn.png` })
  }
})

test('a failed channel recheck keeps the QR and does not claim it was withdrawn @w1-kiosk @w90', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  const only = ORG_CHANNELS[1]!
  api.respondWith('GET', CHANNELS, (requestNumber) => (requestNumber === 1
    ? { status: 200, json: { items: [only], legacyPlatforms: [] } }
    : { status: 503, json: { success: false, error: { code: 'UPSTREAM' } } }))
  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 2, name: only.name })).toBeVisible()
  await page.getByTestId('official-channel-recheck').click()
  await expect(page.getByTestId('official-channel-withdrawn')).toHaveText('这次没有确认这些渠道还在，请再点一次。')
  await expect(page.getByText('已经撤下')).toHaveCount(0)
  await expect(page.getByTestId('official-channel-qr')).toHaveCount(1)
})

test('phone 390x844: the channels page stacks without overflow and keeps touch targets @w1-mobile', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  respondChannels(api, ORG_CHANNELS)
  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'items')
  await expectChannelCards(page, 'org', ORG_SORTED)
  const viewport = page.viewportSize()!
  for (const box of await page.locator('[data-testid="official-channel-qr-code"] svg').evaluateAll((svgs) => svgs.map((svg) => svg.getBoundingClientRect().toJSON() as DOMRect))) {
    expect(box.left, '二维码不越出左缘').toBeGreaterThanOrEqual(0)
    expect(box.right, '二维码不越出右缘').toBeLessThanOrEqual(viewport.width)
  }
  await expectTouchTargets(page, '手机渠道页')
  await assertNoHorizontalOverflow(page)
  await assertNoElementCrossesViewport(page)
  await page.screenshot({ path: test.info().outputPath('official-channels-items-390x844.png'), fullPage: true })
})

test('phone 390x844: the empty state keeps the alternatives as compact 88px rows @w1-mobile', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  respondChannels(api, [])
  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'empty')
  await expectDraftPairs(page, '手机空态', ['问小青', '帮助'], PHONE_PAIRS)
  await expectTouchTargets(page, '手机空态')
  await assertNoHorizontalOverflow(page)
  await assertNoElementCrossesViewport(page)
  await page.screenshot({ path: test.info().outputPath('official-channels-empty-390x844.png'), fullPage: true })
})

test('phone 390x844: the home tile sits in the single column without overflow @w1-mobile', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  respondChannels(api, ORG_CHANNELS)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const home = page.getByTestId('qx-home')
  const tile = home.locator('[data-action="official-channels"]')
  await expect(tile).toBeVisible()
  const [tileBox, gridBox] = await Promise.all([tile.boundingBox(), home.locator('.qxt-home-tiles').boundingBox()])
  expect(Math.round(tileBox!.width), '单列里铺满整行').toBe(Math.round(gridBox!.width))
  expect(tileBox!.height).toBeGreaterThanOrEqual(104)
  await expectTouchTargets(page, '手机首页')
  await assertNoHorizontalOverflow(page)
  // 首页在自己的滚动容器里滚：把磁贴滚进视口再截，截图里才看得到它。
  await tile.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('home-official-channels-tile-390x844.png') })
})
