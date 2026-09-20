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

function registerShell(
  api: ApiRouter,
  { api: apiMode, printer }: { api: Mode; printer: { isOnline: boolean; printerStatus: string } },
): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', PRINTER_STATUS, {
    status: 200,
    json: { isOnline: printer.isOnline, printerStatus: printer.printerStatus, paperLevel: 'sufficient' },
  })
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
    return {
      probe: hub.getAttribute('data-hub-device-probe'),
      readiness: document.querySelector('.qx-hub-notice')?.getAttribute('data-readiness') ?? null,
      pill: document.querySelector('.qx-pill')?.textContent?.trim() ?? '',
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
