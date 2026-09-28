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

/** 首页服务区的几何：每一行都铺满两列宽度，行与行之间只有网格间距。 */
async function homeTileGeometry(page: Page) {
  return page.locator('.qx-home-tiles').evaluate((grid) => {
    const box = grid.getBoundingClientRect()
    const tiles = [...grid.children].map((el) => {
      const rect = el.getBoundingClientRect()
      return { action: el.getAttribute('data-action'), top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), height: Math.round(rect.height) }
    })
    const rows = new Map<number, typeof tiles>()
    for (const tile of tiles) rows.set(tile.top, [...(rows.get(tile.top) ?? []), tile])
    return {
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

const CLOSED_ROWS = [['resume-hub', 'interview-hub'], ['print-hub'], ['policy-hub']]
const CHANNEL_ROWS = [['resume-hub', 'interview-hub'], ['print-hub'], ['policy-hub', 'official-channels']]

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
 * 空态 / 失败态的三条去处是紧凑行（与招聘托管说明页同一套 qx-row）：舞台上 128px 一行，不许被拉成空卡。
 * 上界防的是 2026-09-27 协调窗口截图里的样子——三项平分余量、每张约 410px、字漂在正中间；
 * 下界是 128px 行高本身（手机档 88px，按 `minHeight` 传）。图标、标题、说明一律靠左。
 */
async function expectCompactAlternatives(page: Page, where: string, { minHeight, maxHeight }: { minHeight: number; maxHeight: number }): Promise<void> {
  const scale = await stageScale(page)
  const rows = await page.getByTestId('official-channels-alternatives').locator('.qx-row').evaluateAll((elements) => elements.map((row) => {
    const rect = (selector: string) => row.querySelector(selector)!.getBoundingClientRect()
    const box = row.getBoundingClientRect()
    return {
      label: row.querySelector('.qx-row-t')?.textContent ?? '',
      height: box.height,
      left: box.left,
      iconLeft: rect('.qx-row-ic').left,
      iconRight: rect('.qx-row-ic').right,
      titleLeft: rect('.qx-row-t').left,
      descLeft: rect('.qx-row-d').left,
    }
  }))
  expect(rows.map((row) => row.label), `${where}：三条去处`).toEqual(['就业政策', 'AI 求职工具', '打印 · 扫描'])
  for (const row of rows) {
    expect(row.height / scale, `${where}「${row.label}」不被拉成空卡（≤${maxHeight}px）`).toBeLessThanOrEqual(maxHeight)
    expect(row.height / scale, `${where}「${row.label}」保持紧凑行高（≥${minHeight}px）`).toBeGreaterThanOrEqual(minHeight)
    expect((row.iconLeft - row.left) / scale, `${where}「${row.label}」图标靠左`).toBeLessThanOrEqual(32)
    expect(row.titleLeft, `${where}「${row.label}」标题在图标右边`).toBeGreaterThanOrEqual(row.iconRight)
    expect((row.titleLeft - row.iconRight) / scale, `${where}「${row.label}」标题紧跟图标，不居中`).toBeLessThanOrEqual(32)
    expect(Math.abs(row.descLeft - row.titleLeft), `${where}「${row.label}」说明与标题左对齐`).toBeLessThanOrEqual(1)
  }
}
const STAGE_ROWS = { minHeight: 127, maxHeight: 180 }

// ── 渠道页：机构终端 ─────────────────────────────────────────────────────────

test('org terminal: each channel is a card with its own QR and the exact source caption @w1-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  respondChannels(api, ORG_CHANNELS)

  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
  await expect(screenOf(page)).toHaveAttribute('data-state', 'items')
  await expect(page.getByRole('heading', { level: 1, name: '本机构官方渠道' })).toBeVisible()
  await expect(page.locator('.qx-pagehead p')).toHaveText('扫码后在手机上打开本机构的官网或官方公众号。')
  await expect(page.locator('.qx-pill')).toHaveText('2 个官方渠道')
  await expect(page.getByTestId('official-channels-org').locator('.dw-sec-h .t'), '分区标题写是哪一家机构').toHaveText(ORG)
  await expectChannelCards(page, 'org', ORG_SORTED)
  await expect(page.getByTestId('official-channels-legacy'), '托管关闭：没有「其他来源平台」').toHaveCount(0)
  await expect(page.locator('[data-qx-frame="true"] a[href]'), '一体机不打开外部网页：整页没有可点的链接').toHaveCount(0)
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
  await expect(empty.locator('.qx-state-t')).toHaveText('本终端暂未配置官方渠道')
  // 只说事实，不说原因（没绑机构、机构没录、被下架……一律不猜）。
  await expect(empty.locator('.qx-state-d')).toHaveText('可以先办下面这些事。')
  await expect(page.locator('.qx-pill')).toHaveText('暂未配置官方渠道')
  await expect(page.getByTestId('official-channel-card')).toHaveCount(0)
  const alternatives = page.getByTestId('official-channels-alternatives').locator('.qx-row-t')
  await expect(alternatives).toHaveText(['就业政策', 'AI 求职工具', '打印 · 扫描'])
  await expectCompactAlternatives(page, '空态', STAGE_ROWS)
  await expectNoForbiddenCopy(page, '空态')
  await expectTouchTargets(page, '空态')
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: test.info().outputPath('official-channels-empty-1080x1920.png') })

  registerLandingPages(api)
  await page.getByRole('button', { name: /就业政策/ }).click()
  await page.waitForURL((url) => url.pathname === '/policy-service')
  await expect(page.locator('[data-qx-page="service-hub"]')).toBeVisible()
  await expect.poll(() => api.requestCount('GET', '/api/v1/health'), '落地页的挂载请求在用例内发完').toBeGreaterThan(0)
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
  await expect(page.getByTestId('official-channels-error').locator('.qx-state-t')).toHaveText('官方渠道这次没有读取成功')
  await expect(page.locator('.qx-pill')).toHaveText('渠道读取失败')
  await expect(page.getByTestId('official-channel-card')).toHaveCount(0)
  await expect(page.getByTestId('official-channels-empty'), '失败不冒充「没有渠道」').toHaveCount(0)
  await expect(page.getByTestId('official-channels-alternatives')).toBeVisible()
  await expectCompactAlternatives(page, '失败态', STAGE_ROWS)
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
  await expect(page.locator('.qx-pill')).toHaveText('正在读取本机构渠道')
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
  await expect(legacy.locator('.dw-sec-h .t')).toHaveText('其他来源平台')
  await expectChannelCards(page, 'org', [ORG_CHANNELS[1]!])
  await expectChannelCards(page, 'legacy', LEGACY)
  await expect(page.locator('[data-qx-frame="true"] a[href]')).toHaveCount(0)
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
    await expect(page.getByRole('heading', { level: 1, name: '本机构官方渠道' })).toBeVisible()
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
  await expect(tile.locator('strong')).toHaveText('机构官方渠道')
  await expect(tile.locator('.qx-home-tile-desc')).toHaveText('本机有 2 个渠道，扫码到机构官网')
  await expect(tile.locator('.qx-home-tile-badge')).toHaveText('机构提供')
  await expect(tile.locator('.qx-home-tile-foot')).toContainText('扫码前往')
  for (const action of ['jobs-hub', 'fairs-hub', 'jobs-retry', 'fairs-retry']) {
    await expect(home.locator(`[data-action="${action}"]`), `托管关闭时首页不摆 ${action}`).toHaveCount(0)
  }
  await expect(home.locator('.qx-home-truth')).toContainText('岗位与招聘会请看本机构官方渠道，本终端不代收简历。')
  await expect(home.locator('.qx-home-truth'), '有渠道时不再说「未开放岗位与招聘会」').not.toContainText('未开放')

  // 这一张补在岗位 / 招聘会那一行：五行与托管打开时逐行同构，每行铺满、行间只有网格间距、底部不留空。
  const geometry = await homeTileGeometry(page)
  expect(geometry.rows.map((row) => row.actions)).toEqual(CHANNEL_ROWS)
  for (const row of geometry.rows) {
    expect(row.left, `${row.actions.join('+')} 贴住左边`).toBeLessThanOrEqual(geometry.grid.left + 1)
    expect(row.right, `${row.actions.join('+')} 贴住右边`).toBeGreaterThanOrEqual(geometry.grid.right - 1)
    expect(row.minHeight, `${row.actions.join('+')} 触控高度`).toBeGreaterThanOrEqual(104)
  }
  for (let index = 1; index < geometry.rows.length; index += 1) {
    expect(geometry.rows[index]!.top - geometry.rows[index - 1]!.bottom, '行间只有网格间距').toBeLessThanOrEqual(16)
  }
  expect(geometry.grid.bottom - geometry.rows.at(-1)!.bottom, '服务区底部不留空白').toBeLessThanOrEqual(16)
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
  expect((await homeTileGeometry(page)).rows.map((row) => row.actions)).toEqual(CLOSED_ROWS)

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
    expect((await homeTileGeometry(page)).rows.map((row) => row.actions), `${label}：仍是托管关闭、没有渠道时的三行`).toEqual(CLOSED_ROWS)
    await expect(home.locator('.qx-home-truth')).toContainText('本终端未开放岗位与招聘会信息，也不代收简历。')
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
  await expect(home.locator('[data-action="jobs-hub"]')).toContainText('12 个在招')
  // 不钉「托管打开时要不要去读渠道」——读或不读都对，钉的只是磁贴不出现。渠道答复是立即给的，
  // 等到岗位计数已经到了再留一段，读了的实现也早该渲染完。
  await page.waitForTimeout(400)
  await expect(home.locator('[data-action="official-channels"]')).toHaveCount(0)
  expect((await homeTileGeometry(page)).rows.map((row) => row.actions)).toEqual([
    ['resume-hub', 'interview-hub'],
    ['print-hub'],
    ['jobs-hub', 'fairs-hub'],
    ['policy-hub'],
  ])
})

// ── 手机宽度 ─────────────────────────────────────────────────────────────

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
  await expectCompactAlternatives(page, '手机空态', { minHeight: 87, maxHeight: 120 })
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
  const [tileBox, gridBox] = await Promise.all([tile.boundingBox(), home.locator('.qx-home-tiles').boundingBox()])
  expect(Math.round(tileBox!.width), '单列里铺满整行').toBe(Math.round(gridBox!.width))
  expect(tileBox!.height).toBeGreaterThanOrEqual(104)
  await expectTouchTargets(page, '手机首页')
  await assertNoHorizontalOverflow(page)
  // 首页在自己的滚动容器里滚：把磁贴滚进视口再截，截图里才看得到它。
  await tile.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('home-official-channels-tile-390x844.png') })
})
