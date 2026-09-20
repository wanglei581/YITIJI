// 五个服务台（稿 16-service-hubs）的**动态故障态**行为。
//
// 为什么要这一份：服务台的静态结构由 verify:service-entry-readiness 钉住，
// 但「后端 503 时这张卡还能不能点」「打印机离线时哪几张卡该被拦」只有真跑才知道。
// 2026-09-20 修复前，四个没有设备能力的服务台都在替打印机播报状态（顶栏一直写着
// 「正在确认本机设备」，而那句话在那四页上永远不会有下文），静态断言看不出来。
//
// 夹具保持 fail-closed：ApiRouter 对没登记的请求一律 abort，并在用例结束时
// assertNoUnhandledRequests() 抛错。所以「这一页到底发了哪些请求」本身也是被断言的。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'

const PRINTER_STATUS = '/api/v1/terminals/KSK-001/printer-status'

type Mode = 'ready' | 'down' | 'checking'

/**
 * 打印机状态：给定值即立即应答；`'pending'` 表示把应答压住不给。
 *
 * `useTerminalDeviceStatus` 的 `loading` 只在首拉在途时为 true，而且**没有超时**——
 * 它不像 useApiReadiness 那样 4s 后自己翻成 unavailable。所以「正在确认本机设备」
 * 这一档要靠压住应答来稳定复现，而不是抢时间窗。
 */
type PrinterMode = { isOnline: boolean; printerStatus: string } | 'pending'

function registerShell(
  api: ApiRouter,
  { api: apiMode, printer }: { api: Mode; printer: PrinterMode },
): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  if (printer === 'pending') {
    api.respondWith('GET', PRINTER_STATUS, async () => {
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      return { status: 200, json: { isOnline: true, printerStatus: 'ready', paperLevel: 'sufficient' } }
    })
  } else {
    api.respond('GET', PRINTER_STATUS, {
      status: 200,
      json: { isOnline: printer.isOnline, printerStatus: printer.printerStatus, paperLevel: 'sufficient' },
    })
  }
  if (apiMode === 'down') {
    api.respond('GET', '/api/v1/health', { status: 503, json: { error: 'unavailable' } })
    return
  }
  if (apiMode === 'checking') {
    // useApiReadiness 自己 4s 超时后会转成 unavailable，所以「正在确认」这一档
    // 最多只存在 4 秒；这里把应答压在超时之外，用例必须在挂载后立刻取快照。
    api.respondWith('GET', '/api/v1/health', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      return { status: 200, json: { ok: true } }
    })
    return
  }
  api.respond('GET', '/api/v1/health', { status: 200, json: { ok: true } })
}

interface HubEntry {
  title: string
  /** 真的是可点控件（<button>），不是「看起来能点」。 */
  clickable: boolean
  /** 不可点时页面给出的原因；可点时为 null。 */
  reason: string | null
}

interface HubSnapshot {
  probe: string | null
  readiness: string | null
  pill: string
  /** 提示条正文的粗体首句。它和 pill / readiness / 图标必须说同一件事。 */
  noticeTitle: string
  noticeDetail: string
  cards: HubEntry[]
  goals: HubEntry[]
  quick: HubEntry[]
}

/**
 * 一次性取整页状态。
 *
 * 用单次 evaluate 而不是多条 await expect：'checking' 档只有 4 秒寿命，
 * 逐条等待会在中途翻成 'unavailable'，把一个真实缺陷测成随机失败。
 */
async function readHub(page: Page): Promise<HubSnapshot> {
  await page.waitForSelector('[data-qx-page="service-hub"]')
  return page.evaluate(() => {
    const hub = document.querySelector('[data-qx-page="service-hub"]')!
    const entry = (el: Element, titleSel: string, reasonSel: string): {
      title: string
      clickable: boolean
      reason: string | null
    } => {
      const clickable = el.tagName === 'BUTTON' && !el.hasAttribute('aria-disabled')
      const title = (el.querySelector(titleSel) ?? el).textContent?.trim() ?? ''
      return { title, clickable, reason: clickable ? null : el.querySelector(reasonSel)?.textContent?.trim() ?? null }
    }
    const notice = document.querySelector('.qx-hub-notice-copy')
    return {
      probe: hub.getAttribute('data-hub-device-probe'),
      readiness: document.querySelector('.qx-hub-notice')?.getAttribute('data-readiness') ?? null,
      pill: document.querySelector('.qx-pill')?.textContent?.trim() ?? '',
      noticeTitle: notice?.querySelector('b')?.textContent?.trim() ?? '',
      noticeDetail: notice?.querySelector('b + span')?.textContent?.trim() ?? '',
      cards: [...hub.querySelectorAll('.qx-hub-grid > *')].map((el) => entry(el, 'h3', '.qx-hub-why')),
      goals: [...hub.querySelectorAll('.qx-hub-goal')].map((el) => ({
        title: el.textContent?.trim() ?? '',
        clickable: el.tagName === 'BUTTON' && !el.hasAttribute('aria-disabled'),
        reason: el.getAttribute('aria-label')?.split('：')[1] ?? null,
      })),
      quick: [...hub.querySelectorAll('.qx-hub-quick-item')].map((el) => entry(el, 'b', 'span span')),
    }
  })
}

const byTitle = (entries: HubEntry[], title: string): HubEntry => {
  const found = entries.find((entry) => entry.title === title)
  if (!found) throw new Error(`服务台上找不到「${title}」，现有：${entries.map((e) => e.title).join('、')}`)
  return found
}

test('没有设备能力的服务台不探测、也不播报本机设备 @kiosk', async ({ page, api }) => {
  // 打印机明确离线。有设备能力的服务台该说这件事，没有的不该。
  registerShell(api, { api: 'ready', printer: { isOnline: false, printerStatus: 'offline' } })

  await page.goto('/jobs-service')
  const jobs = await readHub(page)
  // 壳层顶栏自己会轮询一次设备状态（KioskShell 对全路由无条件调用），
  // 这里记下它作为基线——本断言要证的是服务台**没有再加一次**。
  const shellOnly = api.requestCount('GET', PRINTER_STATUS)

  expect(jobs.probe).toBe('off')
  expect(jobs.readiness).toBe('ready')
  expect(jobs.pill).toBe('能力与设备状态以办理时确认为准')
  // 打印机离线是真的，但它和这一页无关：这页一张 kind:'device' 的卡都没有。
  await expect(page.getByText('本机设备', { exact: false })).toHaveCount(0)
  await expect(page.getByText('打印机', { exact: false })).toHaveCount(0)
  expect(jobs.cards.every((card) => card.clickable)).toBe(true)

  // 同样的离线打印机，简历服务台必须说，并且恰好多探一次（壳层 + 本页）。
  await page.goto('/resume-service')
  const resume = await readHub(page)
  const withHub = api.requestCount('GET', PRINTER_STATUS)

  expect(resume.probe).toBe('on')
  expect(resume.readiness).toBe('degraded')
  expect(resume.pill).toBe('本机设备不可用')
  // 两个数字分别说明一件事，所以分开断言：
  //   · 岗位服务台整页只探了 1 次 —— 那一次是壳层的，本页没有加。
  //   · 简历服务台整页重载后累计 3 次 —— 壳层第二次 + 本页自己这一次。
  // 任一条变了都值得看一眼：它要么说明壳层改了轮询口径，要么说明服务台又开始
  // 替不相干的页面探设备。
  expect(shellOnly).toBe(1)
  expect(withHub).toBe(3)
})

test('resume 的 device-off 只拦简历打印，AI 与浏览类照常可进 @kiosk', async ({ page, api }) => {
  registerShell(api, { api: 'ready', printer: { isOnline: false, printerStatus: 'offline' } })

  await page.goto('/resume-service')
  const hub = await readHub(page)

  const print = byTitle(hub.cards, '简历打印')
  expect(print.clickable).toBe(false)
  expect(print.reason).toBe('本机设备当前不可用')

  // 其余七张（AI 类与模板目录）不受本机设备影响，必须仍是可点控件。
  const others = hub.cards.filter((card) => card.title !== '简历打印')
  expect(others).toHaveLength(7)
  expect(others.filter((card) => !card.clickable)).toEqual([])
  expect(hub.quick.filter((link) => !link.clickable)).toEqual([])
  expect(hub.goals.filter((goal) => !goal.clickable)).toEqual([])

  // 严重度只有一档：顶栏胶囊说 warn（本机设备不可用），提示条就不能用 unavailable 的红。
  expect(hub.readiness).toBe('degraded')
  expect(hub.pill).toBe('本机设备不可用')
})

test('在线服务 503：白名单离线入口仍可进，其余一律不可点 @kiosk', async ({ page, api }) => {
  registerShell(api, { api: 'down', printer: { isOnline: true, printerStatus: 'ready' } })

  await page.goto('/jobs-service')
  const hub = await readHub(page)

  // 白名单：OnlinePlatformsPage 自己不发请求，后端断了也该能看二维码目录。
  expect(byTitle(hub.cards, '线上招聘平台').clickable).toBe(true)
  // 其余八张都要后端；写着「进入 →」点进去只有错误页，所以必须 fail-closed 并说明原因。
  expect(byTitle(hub.cards, '全职岗位')).toEqual({
    title: '全职岗位',
    clickable: false,
    reason: '在线服务当前不可用',
  })
  expect(byTitle(hub.cards, '岗位匹配参考').reason).toBe('AI能力当前不可用')
  expect(hub.cards.filter((card) => card.clickable).map((card) => card.title)).toEqual(['线上招聘平台'])
  expect(hub.readiness).toBe('unavailable')

  // 白名单那张真的能走通，不是只长得像可点。
  await page.getByRole('button', { name: /线上招聘平台/ }).click()
  await page.waitForURL((url) => url.pathname === '/jobs/online-platforms')
})

test('在线服务「正在确认」同样不放行，白名单不受影响 @kiosk', async ({ page, api }) => {
  registerShell(api, { api: 'checking', printer: { isOnline: true, printerStatus: 'ready' } })

  await page.goto('/policy-service')
  const hub = await readHub(page)

  expect(hub.readiness).toBe('checking')
  expect(hub.pill).toBe('正在确认在线服务')
  // 「还不知道」不构成放行理由：checking 与 unavailable 一样 fail-closed。
  expect(byTitle(hub.cards, '就业政策')).toEqual({
    title: '就业政策',
    clickable: false,
    reason: '正在确认在线服务',
  })
  expect(byTitle(hub.cards, '打开AI顾问').reason).toBe('正在确认AI能力状态')
  // 白名单的两条静态指引不依赖后端，checking 期间照样可进。
  expect(hub.cards.filter((card) => card.clickable).map((card) => card.title).sort()).toEqual(
    ['社保指南', '档案与登记'].sort(),
  )
  // 政策服务台没有设备能力：即使在线服务还没确认，也不该顺带播报本机设备。
  expect(hub.probe).toBe('off')
})

test('本机设备「正在确认」时提示条不说就绪态的话 @kiosk', async ({ page, api }) => {
  // 后端已就绪，只有本机打印机状态还没回来——这是简历服务台每次进入都要经过的那几百毫秒。
  registerShell(api, { api: 'ready', printer: 'pending' })

  await page.goto('/resume-service')
  const hub = await readHub(page)

  // 四个信号必须同口径。修复前前三个都对，只有正文说的是就绪态的话，
  // 而用户读的正是那行字：顶栏转着圈说「正在确认」，正文却说「进入具体服务后再确认实时能力」。
  expect(hub.probe).toBe('on')
  expect(hub.readiness).toBe('checking')
  expect(hub.pill).toBe('正在确认本机设备')
  expect(hub.noticeTitle).toBe('正在确认本机设备。')
  expect(hub.noticeDetail).toContain('涉及出纸或扫描的入口暂不开放')
  // 就绪态那两句一个字都不能出现在这一档。
  expect(hub.noticeTitle).not.toBe('进入具体服务后再确认实时能力。')
  expect(hub.noticeDetail).not.toContain('本页只负责分流')
  // 也不能借用 device-off 的「请稍后再试」：那已经是结论了，此刻还没有结论。
  expect(hub.noticeDetail).not.toContain('请稍后再试')

  // 卡片那一层的 fail-closed 一字未动，这里一并钉住：只有设备类被拦，其余照常可进。
  const print = byTitle(hub.cards, '简历打印')
  expect(print.clickable).toBe(false)
  expect(print.reason).toBe('正在确认本机设备状态')
  expect(hub.cards.filter((card) => !card.clickable).map((card) => card.title)).toEqual(['简历打印'])
  expect(hub.quick.filter((link) => !link.clickable)).toEqual([])
})

test('在线服务 503：面试技巧可读，但不能从技巧页绕进模拟面试 @kiosk', async ({ page, api }) => {
  registerShell(api, { api: 'down', printer: { isOnline: true, printerStatus: 'ready' } })

  await page.goto('/interview-service')
  const hub = await readHub(page)

  // 这两条一起才构成「绕过」的前提：正门被拦、侧门开着。
  expect(byTitle(hub.cards, '开始模拟面试')).toEqual({
    title: '开始模拟面试',
    clickable: false,
    reason: 'AI能力当前不可用',
  })
  expect(byTitle(hub.cards, '面试技巧').clickable).toBe(true)

  // 走用户真正会走的那条路：点服务台上的「面试技巧」。
  await page.getByTestId('hub-interview-grid-面试技巧').click()
  await page.waitForURL((url) => url.searchParams.get('stage') === 'tips')

  // 白名单的用意是「断网也有东西可读」，所以本地内容必须一条不少。
  await expect(page.getByRole('heading', { name: '面试前准备清单' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '高频问题应对' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /STAR/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: '自我介绍结构建议' })).toBeVisible()

  // 出口则必须关上：它要 POST /mock-interviews，不是本地内容。
  const start = page.getByTestId('interview-primary')
  await expect(start).toHaveAttribute('aria-disabled', 'true')
  await expect(start).toHaveAttribute('data-disabled-reason', 'api:unavailable')
  const why = page.locator('#interview-tips-start-why')
  await expect(why).toContainText('在线服务当前不可用')
  await expect(why).toContainText('可以继续看')

  // 渲染层：Playwright 的可操作性检查把 aria-disabled 读成「不可用」并拒绝点击。
  // 这条断言把那个事实写下来——普通触控走不到 onClick。
  await expect(start).toBeDisabled()

  // 行为层：但 aria-disabled 拦不住合成事件，也拦不住别处代码直接调 onClick。
  // 所以绕过渲染层真派发一次，证明 goSetup 自己的 `if (gate) return` 也在。
  // 「看起来点不动」和「点了不会发生」必须是同一件事。
  await start.dispatchEvent('click')
  await start.click({ force: true })
  await expect(page.locator('[data-interview-workbench]')).toHaveAttribute('data-interview-stage', 'tips')
  expect(new URL(page.url()).searchParams.get('stage')).toBe('tips')
  // 「重新检测」仍在：不能让用户在这一页只剩退出去一条路。
  await expect(page.getByTestId('interview-tips-recheck')).toBeVisible()
})

test('阳性对照：在线服务就绪时，同一个按钮真的会进入 setup @kiosk', async ({ page, api }) => {
  // 没有这一条，上面那条「点了没跳」可能只是因为这个按钮本来就从不跳。
  registerShell(api, { api: 'ready', printer: { isOnline: true, printerStatus: 'ready' } })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { data: { asrEnabled: false, ttsEnabled: false } },
  })

  await page.goto('/interview/tips')
  await page.waitForURL((url) => url.searchParams.get('stage') === 'tips')

  const start = page.getByTestId('interview-primary')
  await expect(start).not.toHaveAttribute('aria-disabled', 'true')
  await start.click()
  await page.waitForURL((url) => url.searchParams.get('stage') === 'setup')
  await expect(page.locator('[data-interview-workbench]')).toHaveAttribute('data-interview-stage', 'setup')
})
