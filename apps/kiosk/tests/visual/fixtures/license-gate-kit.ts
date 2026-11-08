import type { Locator, Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import { expect } from '../../fixtures/kiosk-test'
import { configureHomeVariant } from './home-members'
import { LicenseWorld } from './license-world'
import { allowLocalBootTicket, registerPrivacyShell } from './privacy-clear-shell'

/**
 * 授权闸门走查（kiosk-license-gate.spec.ts、kiosk-license-wind-down.spec.ts）共用的开机、点按、站内跳转与首页断言。
 * 假服务端 + 页面时钟在 license-world.ts；这里是「起一台机器」「像手指一样点」「收尾中的首页长什么样」这类两份用例都要用的零件。
 */
export const MINUTE = 60_000
/** 收尾中每个停用入口下面写的原因（产品口径：只写「不开始新的办理」，不提授权、到期）。 */
export const NO_NEW_TASK = '本机暂不开始新的办理'
/** support-contact 默认应答里的公示号码与服务时间（ApiRouter 默认）。 */
export const PHONE_SENTENCE = '拨打服务电话 18369161921（工作日 9:00–18:00）'
/**
 * 首页入口：四张大卡 + 'gov' 配置下的三块磁贴（到机取件、本机构官方渠道、帮助）。
 * gov 仍把百宝箱与智慧校园配成开，但 2026-11-04 停放后（#1583）首页不摆这两块。
 */
export const HOME_TASKS = ['resume-hub', 'interview-hub', 'print-hub', 'policy-hub'] as const
export const HOME_TILES = ['pickup-claim', 'official-channels', 'help'] as const

/** 一张宣传图（秋季招聘会海报）：能真正解码，作待机屏播放的阳性对照。 */
const AD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1280" viewBox="0 0 960 1280">'
  + '<rect width="960" height="1280" fill="#e76f51"/>'
  + '<text x="480" y="600" font-size="80" text-anchor="middle" fill="#ffffff">2026 秋季招聘会</text></svg>'
const AD_ITEM = {
  id: 'ad-autumn-career-fair',
  type: 'image',
  url: `data:image/svg+xml;utf8,${encodeURIComponent(AD_SVG)}`,
  mimeType: 'image/png',
  durationSec: 300,
  sha256: 'sha-ad-autumn-career-fair',
}

export interface BootOptions {
  path?: string
  /** 待机宣传：开着并带一条素材（默认关）。 */
  screensaver?: boolean
  /** GET /public/support-contact 里的 miniappPublished（默认按 ApiRouter：未发布）。拦截屏、暂停屏有一块「在手机上也能看」，只在已发布时出现。 */
  miniappPublished?: boolean
}

/** 起一台「授权正常」的机器：换到会话票、读到验过签的 profile、首页入口可用。 */
export async function boot(page: Page, api: ApiRouter, options: BootOptions = {}): Promise<LicenseWorld> {
  const world = new LicenseWorld(page)
  await world.install()
  await allowLocalBootTicket(page)
  registerPrivacyShell(api)
  configureHomeVariant(api, 'gov')
  if (options.miniappPublished !== undefined) {
    // 号码与服务时间同 ApiRouter 默认（PHONE_SENTENCE 钉的就是它们），只切小程序发布标志。
    api.respond('GET', '/api/v1/public/support-contact', {
      status: 200,
      json: {
        success: true,
        data: { servicePhone: '18369161921', serviceHours: '工作日 9:00–18:00', otherOnlineTerminalNearby: false, miniappPublished: options.miniappPublished },
      },
    })
  }
  if (options.screensaver) {
    api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
      status: 200,
      json: { enabled: true, idleTimeoutSec: 180, items: [AD_ITEM] },
    })
  }
  await page.goto(options.path ?? '/')
  await world.waitForVerifiedProfile()
  return world
}

/**
 * 像手指一样点一下：按元素中心的屏幕坐标发鼠标点击（停用的入口 Playwright 的 click 会拒绝点，那不是我们要测的）。
 * 先等元素在屏上、位置稳住再点：页面刚渲染、列表和数字刚读回来时版面还会挪（例如「我的」读回待办后，下面的行整体下移），
 * 按挪动前量到的坐标点会点空，用例就在 waitForURL 上白等到超时。
 */
export async function tap(page: Page, target: Locator): Promise<void> {
  await target.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined)
  let box = await target.boundingBox()
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await page.waitForTimeout(80)
    const next = await target.boundingBox()
    const settled = box !== null && next !== null && Math.abs(next.x - box.x) < 0.5 && Math.abs(next.y - box.y) < 0.5
    box = next
    if (settled) break
  }
  expect(box, '要点的东西得在屏上').not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
}

/** 点了之后地址不变（停用的入口、被锁的区域真的点不动）。 */
export async function expectTapStays(page: Page, target: Locator, label: string): Promise<void> {
  const before = page.url()
  await tap(page, target)
  await page.waitForTimeout(350)
  expect(page.url(), `${label}：点了之后地址不该变`).toBe(before)
}

/**
 * 站内跳转（不刷新页面，闸门状态与页面时钟都原样保留）：等同从别处的链接 / 按钮进去。
 * 推进去的历史条目带路由器自己的 key 与 idx，和应用里 navigate() 推出来的一样——
 * 拦截屏上的「返回」认 location.key，不带 key 会被当成「没有上一页」直接回首页。
 */
export async function goInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    const current = window.history.state as { idx?: number } | null
    window.history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx: (current?.idx ?? 0) + 1 }, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.waitForURL((url) => `${url.pathname}${url.search}` === path)
}

export const homeEntry = (page: Page, action: string) => page.locator(`[data-qx-page="home"] [data-action="${action}"]`)
export const mainNav = (page: Page) => page.getByRole('navigation', { name: '主导航' })
export const paused = (page: Page) => page.locator('[data-kiosk-screen="license-paused"]')
/** 收尾中进入「另一项服务的办理页」时整屏换成的拦截屏（运行时根集中拦，目标页不渲染）。 */
export const windDownBlocked = (page: Page) => page.locator('[data-kiosk-screen="license-wind-down-blocked"]')
export const windDownDialog = (page: Page) => page.getByRole('dialog', { name: '请尽快办完' })
export const homeReminder = (page: Page) => page.locator('[data-qx-page="home"] .qxt-remind')

/** 收尾中的首页：说明条在、入口全部停用并写明原因。 */
export async function expectHomeWindingDown(page: Page): Promise<void> {
  await expect(homeReminder(page)).toBeVisible()
  for (const action of [...HOME_TASKS, ...HOME_TILES]) {
    const entry = homeEntry(page, action)
    await expect(entry, `${action}：入口还在屏上`).toHaveCount(1)
    await expect(entry, `${action}：要停用`).toHaveAttribute('aria-disabled', 'true')
    await expect(entry, `${action}：要写原因`).toContainText(NO_NEW_TASK)
  }
}

/** 收尾开始：授权失效、当前凭证还剩 10 分钟，推进到页面自己读到验过签的失效答复为止。 */
export async function startWindDown(world: LicenseWorld): Promise<void> {
  world.lapse(10 * MINUTE)
  await world.advance(3.5 * MINUTE)
  expect(world.log.profile.some((entry) => entry.verified && entry.licenseState === 'inactive'), '页面应已读到授权失效').toBe(true)
}

/** 授权恢复后的首页：入口都可用、没有说明条。 */
export async function expectHomeLive(page: Page): Promise<void> {
  await expect(page.locator('[data-qx-page="home"]')).toBeVisible()
  await expect(homeReminder(page)).toHaveCount(0)
  for (const action of [...HOME_TASKS, ...HOME_TILES]) {
    await expect(homeEntry(page, action), `${action}：要可用`).not.toHaveAttribute('aria-disabled', 'true')
    await expect(homeEntry(page, action)).not.toContainText(NO_NEW_TASK)
  }
}

/** 把时钟推进到页面进暂停屏为止（最多再走一个 profile 周期）；返回前确认页面真的是暂停屏。 */
export async function reachPaused(world: LicenseWorld, page: Page, options: { active?: boolean } = {}): Promise<void> {
  await world.advanceUntil(async () => (await paused(page).count()) > 0, 4 * MINUTE, options)
  await expect(paused(page)).toBeVisible()
}

/** 进暂停前给旧文档打记号；进暂停时的结束使用清场会整页重载，记号没了就说明新文档已经起来。 */
export const markDocument = (page: Page) => page.evaluate(() => { (window as unknown as { __beforePause?: boolean }).__beforePause = true })
/** 等旧文档被换掉再等暂停屏回来。requireReload 为真时，等不到重载就算失败（用例要看的是重载之后的样子）。 */
export async function settleAfterPause(page: Page, options: { requireReload?: boolean } = {}): Promise<void> {
  const reloaded = page.waitForFunction(() => !(window as unknown as { __beforePause?: boolean }).__beforePause, undefined, { timeout: 5_000 })
  if (options.requireReload) await reloaded
  else await reloaded.catch(() => undefined)
  await expect(paused(page)).toBeVisible()
}
