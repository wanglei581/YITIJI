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
import { KIOSK_AI_CAPABILITIES_PATH, kioskAiCapabilitiesResponse } from '../fixtures/ai-capabilities'
import { test, expect } from '../fixtures/kiosk-test'
import { expectInterviewDirectionUnselected, chooseInterviewExperience } from './fixtures/direction-selection'

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
/** 政策服务台改触屏后的读法。标题、原因、放行判据与旧卡一致，选择器换成触屏入口。 */
async function readPolicyHub(page: Page): Promise<HubSnapshot> {
  await page.waitForSelector('[data-qx-page="service-hub"]')
  return page.evaluate(() => {
    const hub = document.querySelector('[data-qx-page="service-hub"]')!
    const entry = (el: Element) => {
      const button = el.querySelector('button')
      const clickable = Boolean(button) && !button!.hasAttribute('aria-disabled') && !button!.hasAttribute('disabled')
      const title = el.querySelector('b')?.textContent?.trim() ?? ''
      // 原因只在卡内写一次：停用的卡把说明换成原因，所以从卡里的 small 读
      const reason = el.querySelector('button small')?.textContent?.trim() ?? null
      return { title, clickable, reason: clickable ? null : reason }
    }
    const notice = hub.querySelector('[data-hub-notice]')
    return {
      probe: hub.getAttribute('data-hub-device-probe'),
      readiness: hub.querySelector('[data-readiness]')?.getAttribute('data-readiness') ?? null,
      pill: document.querySelector('.qxt-status')?.textContent?.trim() ?? '',
      noticeTitle: notice?.querySelector('b')?.textContent?.trim() ?? '',
      noticeDetail: notice?.querySelector('b + span')?.textContent?.trim() ?? '',
      cards: [...hub.querySelectorAll('[data-hub-entry]')].map(entry),
      goals: [...hub.querySelectorAll('[data-hub-goal]')].map(entry),
      quick: [...hub.querySelectorAll('[data-hub-quick]')].map(entry),
    }
  })
}

async function readHub(page: Page): Promise<HubSnapshot> {
  await page.waitForSelector('[data-qx-page="service-hub"], [data-qx-page="resume"]')
  // 触屏版简历服务台只直接画四块，其余入口收在「其余 N 项」弹层里：先把弹层打开，再把整页（含弹层）的入口一次读全。
  // 练面试服务台也有一个「其余 4 项」，但它是页内换视图、没有弹层：只在简历服务台点，否则会读到另一个视图、
  // 并一直等一个不会出现的 [data-qx-page="resume-more"]。
  const resumeHub = (await page.locator('[data-qx-page="resume"]').count()) > 0
  const more = page.getByRole('button', { name: /^其余 \d+ 项/ })
  const sheetOpened = resumeHub && (await more.count()) > 0
  if (sheetOpened) {
    await more.click()
    await page.waitForSelector('[data-qx-page="resume-more"]')
  }
  const snapshot = await readHubDom(page)
  if (sheetOpened) await page.getByRole('button', { name: '收起', exact: true }).click()
  return snapshot
}

async function readHubDom(page: Page): Promise<HubSnapshot> {
  return page.evaluate(() => {
    const hub = document.querySelector('[data-qx-page="service-hub"], [data-qx-page="resume"]')!
    const entry = (el: Element, titleSel: string, reasonSel: string): {
      title: string
      clickable: boolean
      reason: string | null
    } => {
      const clickable = el.tagName === 'BUTTON' && !el.hasAttribute('aria-disabled')
      const marked = el.getAttribute('data-hub-title')
      const title = marked || (el.querySelector(titleSel) ?? el).textContent?.trim() || ''
      const reasonAttr = el.getAttribute('data-hub-reason')
      return {
        title,
        clickable,
        reason: clickable ? null : (reasonAttr || el.querySelector(reasonSel)?.textContent?.trim() || null),
      }
    }
    const notice = document.querySelector('.qx-hub-notice-copy')
    const noticeTitle = document.querySelector('[data-hub-notice-title]')
    const noticeDetail = document.querySelector('[data-hub-notice-detail]')
    const grid = [...hub.querySelectorAll('.qx-hub-grid > *')]
    const quickItems = [...hub.querySelectorAll('.qx-hub-quick-item')]
    // 弹层在页面外层，入口标记要从整个文档里取（简历服务台的「其余」入口在弹层里）。
    const marked = (attr: string) => [...document.querySelectorAll(`[${attr}]`)]
    const pill = document.querySelector('.qxt-band .qx-pill') ?? document.querySelector('.qx-pill')
    return {
      probe: hub.getAttribute('data-hub-device-probe'),
      readiness: document.querySelector('.qx-hub-notice')?.getAttribute('data-readiness') ?? hub.getAttribute('data-readiness'),
      pill: pill?.textContent?.trim() ?? '',
      noticeTitle: noticeTitle?.textContent?.trim() ?? notice?.querySelector('b')?.textContent?.trim() ?? '',
      noticeDetail: noticeDetail?.textContent?.trim() ?? notice?.querySelector('b + span')?.textContent?.trim() ?? '',
      // 练面试服务台换了触屏磁贴，停用原因句挂在 .qxt-tile-why；其余服务台仍是 .qx-hub-why。
      cards: (grid.length ? grid : marked('data-hub-card')).map((el) => entry(el, 'h3', '.qx-hub-why, .qxt-tile-why')),
      goals: [...hub.querySelectorAll('.qx-hub-goal')].map((el) => ({
        title: el.textContent?.trim() ?? '',
        clickable: el.tagName === 'BUTTON' && !el.hasAttribute('aria-disabled'),
        reason: el.getAttribute('aria-label')?.split('：')[1] ?? null,
      })),
      quick: (quickItems.length ? quickItems : marked('data-hub-quick')).map((el) => entry(el, 'b', 'span span')),
    }
  })
}

/**
 * 政策服务台「检查中」「不可用」两态各块不能互相压住：
 * 「常用入口」标题顶 ≥ 上一组（四个目标）里所有元素的最低底边，
 * 页脚第一句顶 ≥ 常用入口那一组里所有元素的最低底边。
 * 底边取整组所有后代的最大值，卡外多渲染的字、溢出卡片的字都算进去。
 */
async function expectPolicyHubStacksCleanly(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const hub = document.querySelector('[data-qx-page="service-hub"]')!
    const lowest = (root: Element | null) =>
      root ? Math.max(...[root, ...root.querySelectorAll('*')].map((el) => el.getBoundingClientRect().bottom)) : null
    const goals = hub.querySelector('section[aria-label="四个目标"]')
    const quick = hub.querySelector('section[aria-label="常用入口"]')
    const note = hub.querySelector('.p10-note')
    return {
      goalsBottom: lowest(goals),
      headingTop: quick?.querySelector('h2')?.getBoundingClientRect().top ?? null,
      quickBottom: lowest(quick),
      noteTop: note?.getBoundingClientRect().top ?? null,
      tileOverflow: [...hub.querySelectorAll('.qxt-tile')]
        .filter((el) => el.scrollHeight > el.clientHeight + 1)
        .map((el) => el.querySelector('b')?.textContent?.trim() ?? ''),
    }
  })
  expect(geometry.goalsBottom, '四个目标那一组必须存在').not.toBeNull()
  expect(geometry.headingTop, '「常用入口」标题必须存在').not.toBeNull()
  expect(geometry.headingTop!, '「常用入口」标题不能压在上一组卡上').toBeGreaterThanOrEqual(geometry.goalsBottom!)
  expect(geometry.noteTop, '页脚第一句必须存在').not.toBeNull()
  expect(geometry.noteTop!, '页脚第一句不能压在最后一张卡上').toBeGreaterThanOrEqual(geometry.quickBottom!)
  expect(geometry.tileOverflow, '卡里的字不能溢出卡片').toEqual([])
}

const byTitle = (entries: HubEntry[], title: string): HubEntry => {
  const found = entries.find((entry) => entry.title === title)
  if (!found) throw new Error(`服务台上找不到「${title}」，现有：${entries.map((e) => e.title).join('、')}`)
  return found
}

interface RecruitDoorSnapshot {
  probe: string | null
  pill: string
  doors: HubEntry[]
}

/** 社会招聘台：门在 [data-door-title] 上，不可点时原因写在「标题，原因。说明」里。 */
async function readRecruitHub(page: Page): Promise<RecruitDoorSnapshot> {
  await page.waitForSelector('[data-qx-page="recruit"]')
  return page.evaluate(() => {
    const root = document.querySelector('[data-qx-page="recruit"]')!
    const doors = [...root.querySelectorAll('[data-door-title]')].map((el) => {
      const title = el.getAttribute('data-door-title') ?? ''
      const button = el.querySelector('button')
      const clickable = Boolean(button) && !button!.hasAttribute('aria-disabled')
      let reason: string | null = null
      if (!clickable) {
        const label = button?.getAttribute('aria-label') ?? ''
        const marker = `${title}，`
        const rest = label.startsWith(marker) ? label.slice(marker.length) : ''
        reason = rest.split('。')[0] || null
      }
      return { title, clickable, reason }
    })
    return {
      probe: root.querySelector('[data-hub-device-probe]')?.getAttribute('data-hub-device-probe') ?? null,
      pill: root.querySelector('.qxt-status')?.textContent?.trim() ?? '',
      doors,
    }
  })
}

test('没有设备能力的服务台不探测、也不播报本机设备 @kiosk', async ({ page, api }) => {
  // 打印机明确离线。有设备能力的服务台该说这件事，没有的不该。
  registerShell(api, { api: 'ready', printer: { isOnline: false, printerStatus: 'offline' } })

  await page.goto('/jobs-service')
  const jobs = await readRecruitHub(page)
  // 壳层顶栏自己会轮询一次设备状态（KioskShell 对全路由无条件调用），
  // 这里记下它作为基线——本断言要证的是服务台**没有再加一次**。
  const shellOnly = api.requestCount('GET', PRINTER_STATUS)

  expect(jobs.probe).toBe('off')
  expect(jobs.pill).toBe('社会招聘 · 来源信息入口')
  expect(jobs.doors.length).toBeGreaterThan(0)
  // 打印机离线是真的，但它和这一页无关：这页一张 kind:'device' 的卡都没有。
  await expect(page.getByText('本机设备', { exact: false })).toHaveCount(0)
  await expect(page.getByText('打印机', { exact: false })).toHaveCount(0)
  expect(jobs.doors.every((door) => door.clickable)).toBe(true)

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
  const hub = await readRecruitHub(page)

  // 旧台有 data-readiness 属性可断言；触屏台没有，改断言顶栏胶囊和屏的状态标记，两者都要说「不可用」。
  expect(hub.pill).toBe('在线服务当前不可用')
  await expect(page.locator('[data-qx-page="recruit"]')).toHaveAttribute('data-qxt-state', 'unavailable')
  // 要后端的门一律不可点，并说出原因。找全职是信息门，岗位匹配参考和问 AI 顾问走 AI 话术。
  expect(hub.doors.length).toBeGreaterThan(0)
  expect(hub.doors.filter((door) => door.clickable).map((door) => door.title)).toEqual([])
  expect(byTitle(hub.doors, '找全职')).toEqual({
    title: '找全职',
    clickable: false,
    reason: '在线服务当前不可用',
  })
  expect(byTitle(hub.doors, '岗位匹配参考').reason).toBe('AI能力当前不可用')
  expect(byTitle(hub.doors, '问 AI 顾问').reason).toBe('AI能力当前不可用')

  // 跨到校园招聘的那条不在能力门里，后端断开时仍可点，而且真的走到 /fairs-service。
  const campus = page.locator('.rt-hint button', { hasText: '校园招聘' })
  await expect(campus).toHaveCount(1)
  await expect(campus).toBeEnabled()
  await campus.click()
  await page.waitForURL((url) => url.pathname === '/fairs-service')
})

test('在线服务「正在确认」同样不放行，白名单不受影响 @kiosk', async ({ page, api }) => {
  registerShell(api, { api: 'checking', printer: { isOnline: true, printerStatus: 'ready' } })

  await page.goto('/policy-service')
  const hub = await readPolicyHub(page)

  expect(hub.readiness).toBe('checking')
  expect(hub.pill).toBe('正在确认在线服务')
  expect(hub.probe).toBe('off')
  expect(byTitle(hub.cards, '查政策与公告')).toEqual({
    title: '查政策与公告',
    clickable: false,
    reason: '正在确认在线服务',
  })
  expect(byTitle(hub.goals, '找就业政策')).toEqual({
    title: '找就业政策',
    clickable: false,
    reason: '正在确认在线服务',
  })
  expect(byTitle(hub.goals, '核对申领条件')).toEqual({
    title: '核对申领条件',
    clickable: false,
    reason: '正在确认在线服务',
  })
  for (const title of ['浏览记录', 'AI 服务记录', '政策收藏']) {
    expect(byTitle(hub.quick, title)).toEqual({
      title,
      clickable: false,
      reason: '正在确认在线服务',
    })
  }
  const clickable = [...hub.cards, ...hub.goals, ...hub.quick]
    .filter((entry) => entry.clickable)
    .map((entry) => entry.title)
    .sort()
  expect(clickable).toEqual(['全部服务', '查社保材料', '看登记档案'].sort())
  await expect(page.getByRole('button', { name: '打开AI顾问' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '问小青' })).toBeVisible()
  await expectPolicyHubStacksCleanly(page)
})

test('在线服务不可用时只放行社保、登记、全部服务和重新检测 @kiosk', async ({ page, api }) => {
  registerShell(api, { api: 'down', printer: { isOnline: true, printerStatus: 'ready' } })

  await page.goto('/policy-service')
  const hub = await readPolicyHub(page)

  expect(hub.readiness).toBe('unavailable')
  expect(hub.probe).toBe('off')
  expect(byTitle(hub.cards, '查政策与公告').reason).toBe('在线服务当前不可用')
  expect(byTitle(hub.goals, '找就业政策').reason).toBe('在线服务当前不可用')
  expect(byTitle(hub.goals, '核对申领条件').reason).toBe('在线服务当前不可用')
  for (const title of ['浏览记录', 'AI 服务记录', '政策收藏']) {
    expect(byTitle(hub.quick, title).reason).toBe('在线服务当前不可用')
  }
  const clickable = [...hub.cards, ...hub.goals, ...hub.quick]
    .filter((entry) => entry.clickable)
    .map((entry) => entry.title)
    .sort()
  expect(clickable).toEqual(['全部服务', '查社保材料', '看登记档案'].sort())
  await expect(page.getByRole('button', { name: '重新检测' })).toBeEnabled()
  await expectPolicyHubStacksCleanly(page)
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
  expect(byTitle(hub.cards, '马上练一场')).toEqual({
    title: '马上练一场',
    clickable: false,
    reason: 'AI能力当前不可用',
  })
  expect(byTitle(hub.cards, '面试技巧').clickable).toBe(true)

  // 主卡停用时，出路在卡片外面，读屏不能把它读成不可用。
  const fallback = page.getByRole('button', { name: '可以先看面试技巧' })
  await expect(fallback).toBeVisible()
  expect(await fallback.evaluate((el) => Boolean(el.closest('[aria-disabled="true"]')))).toBe(false)
  await fallback.click()
  await page.waitForURL((url) => url.searchParams.get('stage') === 'tips')
  await page.goto('/interview-service')

  // 走用户真正会走的那条路：点服务台上的「面试技巧」。
  await page.getByTestId('hub-interview-grid-面试技巧').click()
  await page.waitForURL((url) => url.searchParams.get('stage') === 'tips')

  // 白名单的用意是「断网也有东西可读」，所以本地内容必须一条不少。
  // 2.0 稿 tips 态：STAR 那张卡的标题是「回答一题的基本结构」，右侧注「STAR 练习法」。
  await expect(page.getByRole('heading', { name: '面试前准备清单' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '高频问题应对' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '回答一题的基本结构' })).toBeVisible()
  await expect(page.getByText('STAR 练习法', { exact: true })).toBeVisible()
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

/**
 * 练面试服务台一屏的几何：整个服务台装得下（不滚动），每一行字的中点都落在自己所在的那张卡上，没被别的东西压住。
 * 用一次 evaluate 读完：'checking' 档只有 4 秒寿命。
 */
async function readInterviewHubFit(page: Page): Promise<{ over: number; covered: string[] }> {
  await page.waitForSelector('[data-qx-page="service-hub"]')
  return page.evaluate(() => {
    const hub = document.querySelector('.qxt-ivhub') as HTMLElement
    const covered: string[] = []
    for (const card of hub.querySelectorAll('.qx-hub-grid > *, .qxt-iv-more, .qx-hub-notice, .qxt-iv-wide')) {
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        if (!node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const rect of range.getClientRects()) {
          if (rect.width < 2 || rect.height < 2) continue
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          if (!hit || !card.contains(hit)) covered.push(`${node.textContent.trim().slice(0, 14)} @${Math.round(rect.top)}`)
        }
      }
    }
    return { over: hub.scrollHeight - hub.clientHeight, covered }
  })
}

test('练面试服务台：正常、在线服务不可用、检查中三态都一屏放下，字不被压住 @kiosk', async ({ page, api }) => {
  for (const mode of ['ready', 'down', 'checking'] as const) {
    registerShell(api, { api: mode, printer: { isOnline: true, printerStatus: 'ready' } })
    await page.goto('/interview-service')
    const fit = await readInterviewHubFit(page)
    expect(fit.over, `${mode}：服务台比一屏高 ${fit.over}px，会出现滚动`).toBeLessThanOrEqual(1)
    expect(fit.covered, `${mode}：这些字被别的元素压住`).toEqual([])
    // 磁贴标题 28px（稿 .tile b），「其余四项」里的也一样。放不下就从别处匀高度，不缩字。
    const sizes = await page.locator('.qxt-ivhub .qxt-tile h3').evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).fontSize))
    expect(sizes.length, `${mode}：四张入口磁贴`).toBe(4)
    expect([...new Set(sizes)], `${mode}：磁贴标题字号`).toEqual(['28px'])
  }
})

test('练面试服务台：切到「其余 4 项」再回来，焦点落在意图带标题上，磁贴标题仍是 28px @kiosk', async ({ page, api }) => {
  registerShell(api, { api: 'ready', printer: { isOnline: true, printerStatus: 'ready' } })
  await page.goto('/interview-service')
  await page.waitForSelector('[data-qx-page="service-hub"]')
  await page.getByRole('button', { name: /其余 4 项/ }).click()
  await expect(page.locator('.qxt-band h1')).toBeFocused()
  await expect(page.locator('.qxt-band h1')).toHaveText('其余四项入口')
  const more = await page.locator('.qxt-ivhub .qxt-tile h3').evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).fontSize))
  expect(more).toEqual(['28px', '28px', '28px', '28px'])
  await page.getByRole('button', { name: /返回练面试/ }).click()
  await expect(page.locator('.qxt-band h1')).toBeFocused()
  await expect(page.locator('.qxt-band h1')).toHaveText('把表达练熟，不替你下结论')
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
  await expectInterviewDirectionUnselected(page)
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const dialog = page.getByRole('dialog', { name: '选择面试行业' })
  await expect(dialog.getByText('当前：尚未选择', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { pressed: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: '制造业', exact: true }).click()
  await dialog.getByRole('button', { name: '完成' }).click()
  await chooseInterviewExperience(page)
})

// ── 练面试服务台按「各 AI 能力的配置状态」放行（GET /kiosk/ai/capabilities） ──
// 在线服务可达，但某一项 AI 能力后台关了、降级了、读不到：只停对应入口并写原因，其余照常。
// 服务端给的内部原因（管理员关闭、开发 mock）不上屏；读不到按没确认处理，不当成可用。

const CAPABILITY_OFF = { status: 'off', reason: '管理员已关闭该能力' } as const

async function openInterviewHub(
  page: Page,
  api: ApiRouter,
  capabilities: { status: number; json: unknown } | 'hold',
): Promise<HubSnapshot> {
  registerShell(api, { api: 'ready', printer: { isOnline: true, printerStatus: 'ready' } })
  if (capabilities === 'hold') {
    // 「正在确认」只活到 hook 的 4 秒超时，所以把应答压在超时之外，用例必须在挂载后立刻取快照。
    api.respondWith('GET', KIOSK_AI_CAPABILITIES_PATH, async () => {
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      return { status: 200, json: kioskAiCapabilitiesResponse() }
    })
  } else {
    api.respond('GET', KIOSK_AI_CAPABILITIES_PATH, capabilities)
  }
  await page.goto('/interview-service')
  return readHub(page)
}

const withCapabilities = (overrides: Parameters<typeof kioskAiCapabilitiesResponse>[0]) =>
  ({ status: 200, json: kioskAiCapabilitiesResponse(overrides) })

test('练面试服务台：只关模拟面试时，只停「马上练一场」并写原因，其余入口和问小青照常 @kiosk', async ({ page, api }) => {
  const hub = await openInterviewHub(page, api, withCapabilities({ mock_interview: CAPABILITY_OFF }))
  expect(byTitle(hub.cards, '马上练一场')).toEqual({ title: '马上练一场', clickable: false, reason: 'AI能力当前不可用' })
  for (const title of ['面试技巧', '训练报告', '职业自我探索', '职业规划建议']) {
    expect(byTitle(hub.cards, title).clickable, title).toBe(true)
  }
  await expect(page.getByRole('button', { name: '问小青：先练哪一项？' })).toBeEnabled()
  // 主卡停用时，出路在卡片外面：不依赖 AI 的面试技巧。
  await expect(page.getByRole('button', { name: '可以先看面试技巧' })).toBeVisible()
  // 服务端给的内部原因不能原样上屏。
  await expect(page.getByText('管理员已关闭')).toHaveCount(0)
})

test('练面试服务台：自我探索、职业规划各自关闭时，只停各自那张卡 @kiosk', async ({ page, api }) => {
  const hub = await openInterviewHub(page, api, withCapabilities({ self_assessment: CAPABILITY_OFF, career_plan: CAPABILITY_OFF }))
  expect(byTitle(hub.cards, '职业自我探索')).toEqual({ title: '职业自我探索', clickable: false, reason: 'AI能力当前不可用' })
  expect(byTitle(hub.cards, '职业规划建议')).toEqual({ title: '职业规划建议', clickable: false, reason: 'AI能力当前不可用' })
  expect(byTitle(hub.cards, '面试技巧').clickable).toBe(true)
  expect(byTitle(hub.cards, '训练报告').clickable).toBe(true)
  // 模拟面试没关，主卡仍是能点的按钮。
  await expect(page.getByRole('button', { name: /马上练一场/ })).toBeVisible()
})

test('练面试服务台：小青关闭时，底栏问小青换成停用态并写出路，主入口不受影响 @kiosk', async ({ page, api }) => {
  await openInterviewHub(page, api, withCapabilities({ assistant_chat: CAPABILITY_OFF }))
  const ask = page.locator('[data-qxt-ask="off"]')
  await expect(ask).toHaveText('小青暂时不可用，先看面试技巧')
  await expect(ask).toBeDisabled()
  await expect(page.locator('[data-qxt-ask="on"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /马上练一场/ })).toBeVisible()
})

test('练面试服务台：能力降级（开发 mock）不当成可用，开发用语也不上屏 @kiosk', async ({ page, api }) => {
  const hub = await openInterviewHub(page, api, withCapabilities({
    mock_interview: { status: 'degraded', reason: '当前为开发 mock，未接真实模型' },
  }))
  expect(byTitle(hub.cards, '马上练一场').clickable).toBe(false)
  await expect(page.getByText('mock')).toHaveCount(0)
})

test('练面试服务台：能力状态读不到时按没确认处理，AI 入口与问小青都不放行，不依赖 AI 的照常 @kiosk', async ({ page, api }) => {
  const hub = await openInterviewHub(page, api, { status: 503, json: { success: false, error: { code: 'CAPABILITIES_UNAVAILABLE', message: 'x' } } })
  for (const title of ['马上练一场', '职业自我探索', '职业规划建议']) {
    expect(byTitle(hub.cards, title), title).toEqual({ title, clickable: false, reason: '暂时无法确认AI能力状态' })
  }
  for (const title of ['面试技巧', '训练报告']) expect(byTitle(hub.cards, title).clickable, title).toBe(true)
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveText('小青状态未确认，先看面试技巧')
  await expect(page.locator('[data-qxt-ask="on"]')).toHaveCount(0)
})

test('练面试服务台：能力状态还没读回来时写「正在确认」，不放行 @kiosk', async ({ page, api }) => {
  const hub = await openInterviewHub(page, api, 'hold')
  expect(byTitle(hub.cards, '马上练一场')).toEqual({ title: '马上练一场', clickable: false, reason: '正在确认AI能力状态' })
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveText('小青状态确认中，先看面试技巧')
})

test('练面试服务台：能力状态 4 秒还没读回来就按没确认处理，不放行，也不一直写「正在确认」 @kiosk', async ({ page, api }) => {
  registerShell(api, { api: 'ready', printer: { isOnline: true, printerStatus: 'ready' } })
  api.respondWith('GET', KIOSK_AI_CAPABILITIES_PATH, async () => {
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    return { status: 200, json: kioskAiCapabilitiesResponse() }
  })
  await page.clock.install()
  await page.goto('/interview-service')
  await page.waitForSelector('[data-qx-page="service-hub"]')
  expect(byTitle((await readHub(page)).cards, '马上练一场').reason).toBe('正在确认AI能力状态')
  await page.clock.fastForward(4_100)
  await expect.poll(async () => byTitle((await readHub(page)).cards, '马上练一场')).toEqual({
    title: '马上练一场', clickable: false, reason: '暂时无法确认AI能力状态',
  })
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveText('小青状态未确认，先看面试技巧')
})

test('阳性对照：能力都可用时，服务台主卡真的会进入 setup，问小青可点 @kiosk', async ({ page, api }) => {
  // 没有这一条，上面「停用」的断言可能只是因为这些入口本来就从不放行。
  registerShell(api, { api: 'ready', printer: { isOnline: true, printerStatus: 'ready' } })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { data: { asrEnabled: false, ttsEnabled: false } } })
  await page.goto('/interview-service')
  await expect(page.locator('[data-qxt-ask="on"]')).toHaveText('问小青：先练哪一项？')
  await page.getByRole('button', { name: /马上练一场/ }).click()
  await page.waitForURL((url) => url.searchParams.get('stage') === 'setup')
})

test('条件核对未选中的选项有边框且高度不少于 64 @kiosk', async ({ page, api }) => {
  registerShell(api, { api: 'ready', printer: { isOnline: true, printerStatus: 'ready' } })
  api.respond('GET', '/api/v1/policies', {
    status: 200,
    json: { data: [], pagination: { total: 0 } },
  })
  api.respond('GET', '/api/v1/policies/eligibility-questions', {
    status: 200,
    json: {
      questionSetVersion: 'policy-eligibility-questions-v1',
      privacyNotice: '作答只留在本页，不写进网址。',
      disclaimer: '本结果不是资格认定。',
      questions: [{
        key: 'household_social',
        label: '户籍',
        sensitive: true,
        options: [
          { value: 'local_household', label: '本地户籍' },
          { value: 'other', label: '非本地户籍' },
        ],
      }],
    },
  })
  api.respond('POST', '/api/v1/policies/eligibility-check', {
    status: 200,
    json: {
      questionSetVersion: 'policy-eligibility-questions-v1',
      checkedAt: '2026-10-27T00:00:00.000Z',
      answeredCount: 0,
      ignoredQuestionKeys: [],
      disclaimer: '本结果不是资格认定。',
      method: 'deterministic_comparison',
      items: [{
        policyId: 'p1',
        title: '示例政策',
        conditionsRecorded: true,
        overall: 'some_conditions_unknown',
        overallLabel: '有无法判定的条件',
        conditions: [],
        source: { sourceName: '来源机构', syncTime: '2026-10-27T00:00:00.000Z', externalId: null },
      }],
    },
  })

  await page.goto('/renshi?tab=eligibility')
  const opt = page.locator('.k8-elig-opt[aria-pressed="false"]').first()
  await expect(opt).toBeVisible()
  const box = await opt.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(64)
  const border = await opt.evaluate((el) => Number.parseFloat(getComputedStyle(el).borderTopWidth))
  expect(border).toBeGreaterThan(0)
})

/** 条件核对的问项与比对结果。`down` 时问项 503，页面落到「做不了」的重新检查。 */
function registerEligibilityApi(api: ApiRouter, mode: 'ok' | 'down'): void {
  api.respond('GET', '/api/v1/policies', { status: 200, json: { data: [], pagination: { total: 0 } } })
  if (mode === 'down') {
    api.respond('GET', '/api/v1/policies/eligibility-questions', { status: 503, json: { error: 'unavailable' } })
    api.respond('POST', '/api/v1/policies/eligibility-check', { status: 503, json: { error: 'unavailable' } })
    return
  }
  api.respond('GET', '/api/v1/policies/eligibility-questions', {
    status: 200,
    json: {
      questionSetVersion: 'policy-eligibility-questions-v1',
      privacyNotice: '作答只留在本页，不写进网址。',
      disclaimer: '本结果不是资格认定。',
      questions: [{
        key: 'household_social',
        label: '户籍',
        sensitive: true,
        options: [
          { value: 'local_household', label: '本地户籍' },
          { value: 'other', label: '非本地户籍' },
        ],
      }],
    },
  })
  api.respond('POST', '/api/v1/policies/eligibility-check', {
    status: 200,
    json: {
      questionSetVersion: 'policy-eligibility-questions-v1',
      checkedAt: '2026-10-27T00:00:00.000Z',
      answeredCount: 1,
      ignoredQuestionKeys: [],
      disclaimer: '本结果不是资格认定。',
      method: 'deterministic_comparison',
      items: [{
        policyId: 'p1',
        title: '示例政策',
        conditionsRecorded: true,
        overall: 'some_conditions_unknown',
        overallLabel: '有无法判定的条件',
        conditions: [],
        source: { sourceName: '来源机构', syncTime: '2026-10-27T00:00:00.000Z', externalId: null },
      }],
    },
  })
}

/** 底栏三个按钮（返回、问小青、主按钮）的高度。主按钮是 portal 进 .rq-cta-host 的那一颗。 */
async function readEligibilityDockHeights(page: Page): Promise<{ back: number; ask: number; primary: number; primaryText: string }> {
  return page.evaluate(() => {
    const height = (el: Element | null) => Math.round(el?.getBoundingClientRect().height ?? 0)
    const primary = document.querySelector('.rq-cta-host > button')
    return {
      back: height(document.querySelector('.rq-touch-dock .qxt-btn-sec')),
      ask: height(document.querySelector('.rq-touch-dock .qxt-askq')),
      primary: height(primary),
      primaryText: primary?.textContent?.trim() ?? '',
    }
  })
}

test('条件核对表单、结果、连不上三态：底栏主按钮高 88，和同排按钮一样高 @kiosk', async ({ page, api }) => {
  registerShell(api, { api: 'ready', printer: { isOnline: true, printerStatus: 'ready' } })
  registerEligibilityApi(api, 'ok')

  // 表单：按政策原文逐条比对
  await page.goto('/renshi?tab=eligibility')
  await expect(page.locator('.k8-elig-opt').first()).toBeVisible()
  const form = await readEligibilityDockHeights(page)
  expect(form.primaryText).toContain('按政策原文逐条比对')
  expect(form.primary, '表单态主按钮高度').toBe(88)
  expect(form.back).toBe(88)
  expect(form.ask).toBe(88)

  // 结果：重新填写并再比对一次
  await page.locator('.k8-elig-opt', { hasText: '本地户籍' }).first().click()
  await page.locator('.rq-cta-host > button').click()
  await expect(page.locator('.k8-elig-restart')).toBeVisible()
  const result = await readEligibilityDockHeights(page)
  expect(result.primaryText).toContain('重新填写并再比对一次')
  expect(result.primary, '结果态主按钮高度').toBe(88)
})

test('条件核对连不上时：底栏「重新检查」高 88 @kiosk', async ({ page, api }) => {
  registerShell(api, { api: 'ready', printer: { isOnline: true, printerStatus: 'ready' } })
  registerEligibilityApi(api, 'down')

  await page.goto('/renshi?tab=eligibility')
  await expect(page.locator('.k8-elig-notice-retry')).toBeVisible()
  const offline = await readEligibilityDockHeights(page)
  expect(offline.primaryText).toContain('重新检查')
  expect(offline.primary, '连不上态主按钮高度').toBe(88)
  expect(offline.back).toBe(88)
})
