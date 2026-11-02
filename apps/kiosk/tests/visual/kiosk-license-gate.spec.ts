/**
 * 一体机「贴牌与授权信号」走查（授权闸门三态 + 品牌上屏）。
 *
 * 契约：packages/shared/src/types/branding.ts 的 PublicKioskProfile（GET /api/v1/public/kiosk-profile）：
 *   · acceptsNewSessions 为 false（授权失效）时，当前凭证下正在办的事不被打断，但不再开始新的办理——入口停用并写明原因；
 *   · 凭证到期前（剩 5 分钟）提示尽快办完；
 *   · 凭证到期后才进静态「暂停服务」屏，待机屏停播宣传；换新会话由服务端拒绝，页面不自己硬重试；
 *   · 只认验过签的答复（licenseState 非空）：没验过的答复（「不知道、不拦」）既不能让页面进暂停，也不能解除暂停。
 *
 * 正式构建 + 假服务端 + 页面时钟（fixtures/license-world.ts）：页面自己走换票、续期、每 5 分钟一次的复查、每 3 分钟一次的续读，
 * 用例不替它喂结论。用 playwright.privacy-clear.config.ts 跑——那是没有 mock 会话票、走真实终端会话流程的正式构建，
 * 其余参数与隐私清场套件一致（空闲 180 秒、结果页 90 秒、隐私硬截止 300 秒）；用例里每段时钟推进后动一下鼠标，
 * 人还在屏前的场景不会被空闲清场打断，要模拟没人碰屏幕时关掉。
 *
 * 断言照规格写：入口是不是真的点不动（像手指一样按坐标点，不借 Playwright 的可操作性检查）、屏上是不是真的出现那几句，
 * 每一条「点了没反应 / 没弹 / 没出现」前面都有一条同样做法下「正常时有反应 / 会弹 / 会出现」的阳性对照。
 *
 * 到期前不是暂停屏，到期后 1 秒内必须进入暂停屏。
 */
import type { Locator, Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { MACHINE_UNUSABLE_LINE, whole } from '../fixtures/unattended-lines'
import { chooseInterviewExperience } from './fixtures/direction-selection'
import { configureHomeVariant } from './fixtures/home-members'
import { LicenseWorld } from './fixtures/license-world'
import { allowLocalBootTicket, loginThroughVisibleUi, registerPrivacyShell } from './fixtures/privacy-clear-shell'

test.describe.configure({ timeout: 120_000 })

const MINUTE = 60_000
/** 收尾中每个停用入口下面写的原因（产品口径：只写「不开始新的办理」，不提授权、到期）。 */
const NO_NEW_TASK = '本机暂不开始新的办理'
/** support-contact 默认应答里的公示号码与服务时间（ApiRouter 默认）。 */
const PHONE_SENTENCE = '拨打服务电话 18369161921（工作日 9:00–18:00）'
/** 首页入口：四张大卡 + 'gov' 配置下的四块磁贴（到机取件、本机构官方渠道、帮助、智慧校园；百宝箱要有已上架的扩展服务才摆）。 */
const HOME_TASKS = ['resume-hub', 'interview-hub', 'print-hub', 'policy-hub'] as const
const HOME_TILES = ['pickup-claim', 'official-channels', 'help', 'smart-campus'] as const

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
/** 1×1 PNG：机构 Logo 的阳性对照。 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

interface BootOptions {
  path?: string
  /** 待机宣传：开着并带一条素材（默认关）。 */
  screensaver?: boolean
}

/** 起一台「授权正常」的机器：换到会话票、读到验过签的 profile、首页入口可用。 */
async function boot(page: Page, api: ApiRouter, options: BootOptions = {}): Promise<LicenseWorld> {
  const world = new LicenseWorld(page)
  await world.install()
  await allowLocalBootTicket(page)
  registerPrivacyShell(api)
  configureHomeVariant(api, 'gov')
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

/** 像手指一样点一下：按元素中心的屏幕坐标发鼠标点击（停用的入口 Playwright 的 click 会拒绝点，那不是我们要测的）。 */
async function tap(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox()
  expect(box, '要点的东西得在屏上').not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
}

/** 点了之后地址不变（停用的入口、被锁的区域真的点不动）。 */
async function expectTapStays(page: Page, target: Locator, label: string): Promise<void> {
  const before = page.url()
  await tap(page, target)
  await page.waitForTimeout(350)
  expect(page.url(), `${label}：点了之后地址不该变`).toBe(before)
}

/** 站内跳转（不刷新页面，闸门状态与页面时钟都原样保留）：等同从别处的链接 / 按钮进去。 */
async function goInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.waitForURL((url) => `${url.pathname}${url.search}` === path)
}

const homeEntry = (page: Page, action: string) => page.locator(`[data-qx-page="home"] [data-action="${action}"]`)
const mainNav = (page: Page) => page.getByRole('navigation', { name: '主导航' })
const paused = (page: Page) => page.locator('[data-kiosk-screen="license-paused"]')
const windDownDialog = (page: Page) => page.getByRole('dialog', { name: '请尽快办完' })
const homeReminder = (page: Page) => page.locator('[data-qx-page="home"] .qxt-remind')

/** 收尾中的首页：说明条在、入口全部停用并写明原因。 */
async function expectHomeWindingDown(page: Page): Promise<void> {
  await expect(homeReminder(page)).toBeVisible()
  for (const action of [...HOME_TASKS, ...HOME_TILES]) {
    const entry = homeEntry(page, action)
    await expect(entry, `${action}：入口还在屏上`).toHaveCount(1)
    await expect(entry, `${action}：要停用`).toHaveAttribute('aria-disabled', 'true')
    await expect(entry, `${action}：要写原因`).toContainText(NO_NEW_TASK)
  }
}

/** 授权恢复后的首页：入口都可用、没有说明条。 */
async function expectHomeLive(page: Page): Promise<void> {
  await expect(page.locator('[data-qx-page="home"]')).toBeVisible()
  await expect(homeReminder(page)).toHaveCount(0)
  for (const action of [...HOME_TASKS, ...HOME_TILES]) {
    await expect(homeEntry(page, action), `${action}：要可用`).not.toHaveAttribute('aria-disabled', 'true')
    await expect(homeEntry(page, action)).not.toContainText(NO_NEW_TASK)
  }
}

/** 把时钟推进到页面进暂停屏为止（最多再走一个 profile 周期）；返回前确认页面真的是暂停屏。 */
async function reachPaused(world: LicenseWorld, page: Page, options: { active?: boolean } = {}): Promise<void> {
  await world.advanceUntil(async () => (await paused(page).count()) > 0, 4 * MINUTE, options)
  await expect(paused(page)).toBeVisible()
}

/** 进暂停前给旧文档打记号；进暂停时的结束使用清场会整页重载，记号没了就说明新文档已经起来。 */
const markDocument = (page: Page) => page.evaluate(() => { (window as unknown as { __beforePause?: boolean }).__beforePause = true })
/** 等旧文档被换掉再等暂停屏回来。requireReload 为真时，等不到重载就算失败（用例要看的是重载之后的样子）。 */
async function settleAfterPause(page: Page, options: { requireReload?: boolean } = {}): Promise<void> {
  const reloaded = page.waitForFunction(() => !(window as unknown as { __beforePause?: boolean }).__beforePause, undefined, { timeout: 5_000 })
  if (options.requireReload) await reloaded
  else await reloaded.catch(() => undefined)
  await expect(paused(page)).toBeVisible()
}

// ───────────────────────── a) 授权失效：收尾中 ─────────────────────────

test('授权失效、当前凭证还剩 10 分钟：首页入口停用并写明原因与服务电话，AI 顾问停用 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  const nav = mainNav(page)
  await expectHomeLive(page)

  // 阳性对照：授权正常时，同样的点法真的会进去（「我的」），再回来。
  await tap(page, nav.getByRole('button', { name: '我的' }))
  await page.waitForURL((url) => url.pathname === '/profile')
  await page.getByRole('button', { name: '返回首页' }).first().click()
  await page.waitForURL((url) => url.pathname === '/')
  await expectHomeLive(page)

  world.lapse(10 * MINUTE)
  // 页面每 3 分钟自己续读一次 profile，下一次读回来的就是「授权失效、凭证还剩约 6 分钟」。
  await world.advance(3.5 * MINUTE)
  await expectHomeWindingDown(page)
  // 只说一遍：整条说明就是标准句 3（原因 + 请稍后再来 + 服务电话），「这台机器暂时不能用」只出现一次。
  const reminder = homeReminder(page)
  await expect(reminder).toHaveText(whole(MACHINE_UNUSABLE_LINE))
  await expect(reminder).toContainText(PHONE_SENTENCE)
  expect(((await reminder.innerText()).match(/这台机器暂时不能用/g) ?? []).length).toBe(1)

  // 每个停用的入口都点一遍：地址不变，还在首页。
  for (const action of [...HOME_TASKS, ...HOME_TILES]) {
    await expectTapStays(page, homeEntry(page, action), action)
  }
  await expect(page.locator('[data-qx-page="home"]')).toBeVisible()

  // 底部导航：「首页」照旧，「AI 顾问」停用，点了不跳。
  await expect(nav.getByRole('button', { name: '首页' })).not.toHaveAttribute('aria-disabled', 'true')
  for (const name of ['AI 顾问']) {
    const button = nav.getByRole('button', { name })
    await expect(button, `${name}：要停用`).toHaveAttribute('aria-disabled', 'true')
    await expectTapStays(page, button, name)
  }

  // 首页顶上那条「问小青」长条：被锁住（点不动），不会把人带进顾问页。
  await expect(page.locator('[data-license-locked] [data-testid="home-primary"]')).toHaveCount(1)
  await expectTapStays(page, page.getByTestId('home-primary'), '问小青长条')
  expect(world.log.profile.some((entry) => entry.verified && entry.licenseState === 'inactive')).toBe(true)
})

test('授权失效：已经在办理的页面不被打断，还能接着办 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api, { path: '/interview/tips' })
  await page.waitForURL((url) => url.pathname === '/interview' && url.searchParams.get('stage') === 'tips')
  await page.getByTestId('interview-primary').click()
  await page.waitForURL((url) => url.searchParams.get('stage') === 'setup')
  await chooseInterviewExperience(page)
  const experience = page.locator('.iv-choice').filter({ hasText: '经验（必选）' })

  world.lapse(10 * MINUTE)
  await world.advance(3.5 * MINUTE)
  // 授权失效的消息已经读回来了（别处会停用入口，见上一条）。
  expect(world.log.profile.some((entry) => entry.verified && entry.licenseState === 'inactive')).toBe(true)

  // 这一页没被打断：地址、已选的、弹层、暂停屏，一样不多。
  expect(new URL(page.url()).searchParams.get('stage')).toBe('setup')
  await expect(experience.getByRole('button', { name: '1-3 年', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(paused(page)).toHaveCount(0)
  await expect(windDownDialog(page)).toHaveCount(0)
  // 还能接着办：改选另一项照样生效。
  await experience.getByRole('button', { name: '3-5 年', exact: true }).click()
  await expect(experience.getByRole('button', { name: '3-5 年', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(new URL(page.url()).searchParams.get('stage')).toBe('setup')
})

test('收尾中八分钟不续期或换票，正在办理的选择保留 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api, { path: '/interview/tips' })
  await page.getByTestId('interview-primary').click()
  await page.waitForURL((url) => url.searchParams.get('stage') === 'setup')
  await chooseInterviewExperience(page)
  const selected = page.locator('.iv-choice').filter({ hasText: '经验（必选）' }).getByRole('button', { name: '1-3 年', exact: true })
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  world.lapse(10 * MINUTE)
  const refreshBefore = world.log.refresh.length
  const exchangeBefore = world.log.exchange.length
  await world.advance(8 * MINUTE)
  expect(world.log.profile.some((entry) => entry.verified && entry.licenseState === 'inactive')).toBe(true)
  expect(world.log.refresh.length).toBe(refreshBefore)
  expect(world.log.exchange.length).toBe(exchangeBefore)
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  expect(new URL(page.url()).searchParams.get('stage')).toBe('setup')
  await expect(paused(page)).toHaveCount(0)
})

test('例行续期后两分钟到期，暂停复查距续期至少五分钟 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  await world.freeze()
  const before = world.log.refresh.length
  world.afterRefresh = (at) => {
    world.active = false
    for (const [token, endsAt] of world.sessions) world.sessions.set(token, Math.min(endsAt, at + 2 * MINUTE))
    delete world.afterRefresh
  }
  await world.advanceUntil(async () => world.log.refresh.length > before, 11 * MINUTE)
  const t = world.log.refresh[world.log.refresh.length - 1]!
  expect(world.log.profile.some((entry) => entry.verified && entry.licenseState === 'inactive')).toBe(true)
  await reachPaused(world, page)
  const refreshBefore = world.log.refresh.length
  const exchangeBefore = world.log.exchange.length
  await world.advanceUntil(async () => world.log.refresh.length > refreshBefore || world.log.exchange.length > exchangeBefore, 6 * MINUTE)
  const attempts = [...world.log.refresh.slice(refreshBefore), ...world.log.exchange.slice(exchangeBefore)]
  expect(Math.min(...attempts)).toBeGreaterThanOrEqual(t + 5 * MINUTE)
  await world.thaw()
})

test('授权失效：简历台、练面试、查政策、打印台的入口停用并写明原因，问小青停用 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  const hubs = [
    { path: '/resume-service', root: '[data-qx-page="resume"]' },
    { path: '/interview-service', root: '[data-qx-page="interview"]' },
    { path: '/policy-service', root: '[data-qx-page="service-hub"]' },
  ] as const
  const entriesOf = (root: string) => page.locator(root).locator('.qxt-task, .qxt-tile')
  const liveOf = (root: string) => page.locator(root).locator('.qxt-task:not([aria-disabled="true"]), .qxt-tile:not([aria-disabled="true"])')

  // 阳性对照：授权正常时，这几个服务台里都有能点的入口，问小青也是亮的；打印台没有被锁住的区域。
  for (const { path, root } of hubs) {
    await goInApp(page, path)
    await expect(page.locator(root), `${path}：服务台要在屏上`).toBeVisible()
    await expect(liveOf(root).first(), `${path}：正常时要有能点的入口`).toBeVisible()
    await expect(page.locator('.qxt-askq[data-qxt-ask="on"]'), `${path}：正常时问小青是亮的`).toHaveCount(1)
  }
  await goInApp(page, '/print-scan')
  await expect(page.locator('[data-w2-page="print-scan-home"]')).toBeVisible()
  await expect(page.locator('[data-license-locked]')).toHaveCount(0)

  world.lapse(12 * MINUTE)
  await world.advance(3.5 * MINUTE)

  for (const { path, root } of hubs) {
    await goInApp(page, path)
    await expect(entriesOf(root).first(), `${path}：入口要在屏上`).toBeVisible()
    const total = await entriesOf(root).count()
    expect(total, `${path}：入口个数`).toBeGreaterThanOrEqual(4)
    await expect(liveOf(root), `${path}：不能有还能点的入口`).toHaveCount(0)
    await expect(page.locator(root).getByText(NO_NEW_TASK).first(), `${path}：要写原因`).toBeVisible()
    await expect(page.locator('.qxt-askq[data-qxt-ask="off"]'), `${path}：问小青停用`).toHaveCount(1)
    await expect(page.locator('.qxt-askq[data-qxt-ask="on"]')).toHaveCount(0)
    await expectTapStays(page, entriesOf(root).first(), `${path} 第一个入口`)
  }

  // 打印台：整块入口被锁（点不动），台上写明原因，问小青停用。
  await goInApp(page, '/print-scan')
  await expect(page.locator('[data-license-locked]')).toHaveCount(1)
  await expect(page.getByRole('status').filter({ hasText: NO_NEW_TASK })).toBeVisible()
  await expect(page.locator('.qxt-askq[data-qxt-ask="off"]')).toHaveCount(1)
  await expectTapStays(page, page.locator('[data-license-locked] button').first(), '打印台第一个入口')
})

// ───────────────────────── b) 剩 5 分钟：请尽快办完 ─────────────────────────

test('凭证剩不到 5 分钟弹「请尽快办完」，点「知道了」关掉后同一次不再弹 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  world.lapse(10 * MINUTE)
  await world.advance(3.5 * MINUTE)
  await expectHomeWindingDown(page)

  // 阴性对照：还剩 6 分多钟，不弹。
  await expect(windDownDialog(page)).toHaveCount(0)

  await world.advance(3 * MINUTE)
  const dialog = windDownDialog(page)
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('这台机器约 4 分钟后暂停使用，请尽快办完手上的事。')
  await dialog.getByRole('button', { name: '知道了' }).click()
  await expect(dialog).toHaveCount(0)

  // 同一次不再弹：中间还有一次 3 分钟续读（同一个到期时刻），也不重弹。
  await world.advance(1.5 * MINUTE)
  await expect(dialog).toHaveCount(0)
  await world.advance(1 * MINUTE)
  await expect(dialog).toHaveCount(0)
  // 弹过又关掉，没有顺带把暂停提前：还是收尾中的首页。
  await expect(paused(page)).toHaveCount(0)
  await expectHomeWindingDown(page)
})

// ───────────────────────── c) 凭证到期：暂停服务屏 ─────────────────────────

test('凭证到期后整机换成「暂停服务」屏：到期前不是、到期后 1 秒内是，写明原因与服务电话，没有任何能点的入口 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  world.lapse(10 * MINUTE)
  await world.advance(3.5 * MINUTE)
  await expectHomeWindingDown(page)
  // 阴性对照：到期之前不是暂停屏。再冻结页面时钟，精确地走到到期前 300 毫秒（仍不是）和到期后 1 秒（必须是）。
  await world.advance(5 * MINUTE)
  await expect(paused(page)).toHaveCount(0)
  const deadline = Date.parse(world.currentEndsAt()!)
  await world.freeze()
  await world.advance(deadline - 300 - world.now())
  await expect(paused(page), '凭证到期前不能是暂停屏').toHaveCount(0)
  await markDocument(page)
  await world.advance(1300, { step: 100 })
  await expect(paused(page), '凭证截止后 1 秒内必须进入暂停屏').toBeVisible()
  await world.thaw()
  await settleAfterPause(page)

  const screen = paused(page)
  await expect(screen.getByRole('heading', { name: '暂停服务' })).toBeVisible()
  // 正文是标准句 3（原因 + 服务电话）；「这台机器暂时不能用」整屏只出现一次。
  await expect(screen).toContainText(MACHINE_UNUSABLE_LINE)
  await expect(screen).toContainText(PHONE_SENTENCE)
  expect(((await screen.innerText()).match(/这台机器暂时不能用/g) ?? []).length).toBe(1)
  // 静态屏：整个页面上没有任何能点的按钮或链接，首页和底部导航都没了。
  await expect(page.locator('button:visible, a[href]:visible')).toHaveCount(0)
  await expect(page.locator('[data-qx-page="home"]')).toHaveCount(0)
  await expect(mainNav(page)).toHaveCount(0)
})

// 暂停屏的副标题「现在不能开始新的办理」。进暂停时的结束使用清场会整页重载，重载后凭证已过期，profile 的答复是「没验过」、没有 noticeLine；
// 原先页面只在有 noticeLine 时才画副标题，noticeLine 也没有跟着暂停标记一起存下来——于是这句只在重载前的一瞬间出现，之后一直没有。
// 已改成暂停就一定写这句（KioskPausedScreen 不再看 notice）；这条守住重载之后副标题仍在。
test('进暂停并清场重载之后，暂停屏仍写「现在不能开始新的办理」 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  world.lapse(10 * MINUTE)
  await world.advance(3.5 * MINUTE)
  await world.advance(5 * MINUTE)
  await markDocument(page)
  await reachPaused(world, page)
  await settleAfterPause(page, { requireReload: true })
  await expect(paused(page)).toContainText('现在不能开始新的办理')
})

test('到期那一刻正在播宣传的待机屏停播：换成「暂停服务」屏，宣传素材不再出现 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api, { path: '/screensaver', screensaver: true })
  const standby = page.locator('[data-kiosk-screen="screensaver"]')
  const slot = page.getByTestId('standby-material-slot')
  await expect(standby).toBeVisible()
  // 阳性对照：授权正常时这块屏确实在播素材（图真的解码出来了）。
  const ad = slot.locator('img')
  await expect(ad).toHaveCount(1)
  await expect.poll(() => ad.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)

  world.lapse(10 * MINUTE)
  await world.advance(3.5 * MINUTE, { active: false })
  await world.advance(6 * MINUTE, { active: false })
  await expect(paused(page)).toHaveCount(0)
  await reachPaused(world, page, { active: false })
  await expect(standby).toHaveCount(0)
  await expect(slot).toHaveCount(0)
  await expect(page.locator('img')).toHaveCount(0)
})

test('暂停之后没人碰屏幕，空闲到点也不会再冒出待机宣传 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api, { screensaver: true })
  const standby = page.locator('[data-kiosk-screen="screensaver"]')

  // 阳性对照：授权正常、没人碰屏幕，空闲到点就进待机屏播宣传。
  await world.advance(3.5 * MINUTE, { active: false })
  await expect(standby).toBeVisible()
  await standby.getByTestId('standby-primary').click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.locator('[data-qx-page="home"]')).toBeVisible()
  // 待机清场算「这一位用完了」，这时授权失效会直接进暂停屏（见下一条）。要走收尾中，得有人正在办：
  // 让下一位进一个办理页再回首页（登录、选游客、进办理页都算下一位开始用了）。
  await tap(page, homeEntry(page, 'help'))
  await page.waitForURL((url) => url.pathname === '/help')
  await page.getByRole('button', { name: '返回首页' }).first().click()
  await page.waitForURL((url) => url.pathname === '/')

  world.lapse(6 * MINUTE)
  await world.advance(3.5 * MINUTE)
  await expectHomeWindingDown(page)
  // 到期之前（还剩半分钟）不是暂停屏，到期后进暂停屏。
  await world.advance(2 * MINUTE)
  await expect(paused(page)).toHaveCount(0)
  await reachPaused(world, page)
  // 暂停后一直没人碰屏幕，空闲计时早就到点：仍是暂停屏，没有待机宣传。
  await world.advance(5 * MINUTE, { active: false })
  await expect(paused(page)).toBeVisible()
  await expect(standby).toHaveCount(0)
  await expect(page.locator('img')).toHaveCount(0)
})

test('没人在用时授权失效，下一次读到后直接进暂停屏，不用等凭证到期 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api, { screensaver: true })
  const standby = page.locator('[data-kiosk-screen="screensaver"]')

  // 没人碰屏幕，空闲到点进待机（这一位用完了）；有人轻触唤醒后停在首页，还没开始办任何事。
  await world.advance(3.5 * MINUTE, { active: false })
  await expect(standby).toBeVisible()
  await standby.getByTestId('standby-primary').click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.locator('[data-qx-page="home"]')).toBeVisible()

  // 授权失效、当前凭证还有 10 分钟。没人在办，不必等到凭证到期：页面下一次读到授权失效就进暂停屏。
  world.lapse(10 * MINUTE)
  const deadline = Date.parse(world.currentEndsAt()!)
  await reachPaused(world, page)
  expect(world.now(), '没人在办时不必等到凭证到期才暂停').toBeLessThan(deadline)
})

test('收尾中刷新页面，仍是收尾中（入口仍停用、到期仍进暂停屏） @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  world.lapse(10 * MINUTE)
  await world.advance(3.5 * MINUTE)
  await expectHomeWindingDown(page)

  await page.reload()
  await world.sync()
  // 刷新后内存里的状态没了；页面用 sessionStorage 里仍有效的票续期（被拒）并重新读 profile，回到收尾中，不是回到能用的首页。
  await expect(page.locator('[data-qx-page="home"]')).toBeVisible()
  await expectHomeWindingDown(page)
  await expect(paused(page)).toHaveCount(0)
  // 刷新没有把到期时刻弄丢：到期之前（还剩半分钟）不是暂停屏，到期后进暂停屏。
  await world.advance(6 * MINUTE)
  await expect(paused(page)).toHaveCount(0)
  await reachPaused(world, page)
})

// 暂停状态只在内存里，刷新后要靠换票被拒的标记重新进暂停：刷新后页面拿 sessionStorage 里已过期的票续期（401），再向本机程序要新引导票换会话，
// 服务端因授权失效回 403 TERMINAL_LICENSE_INACTIVE。这条路上的 403 曾经没有记成「续期被拒」，会话落到 failed 而闸门 normal 档不看 failed，
// 整机刷新（看门狗重启浏览器、前端发版自动刷新、断电重启都一样）后回到入口全亮的首页（2026-11-02 走查在 6b3312b41 上抓到，B6 修复）。
test('暂停之后刷新页面，仍是暂停屏 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  world.lapse(10 * MINUTE)
  await world.advance(3.5 * MINUTE)
  await expectHomeWindingDown(page)
  await world.advance(6 * MINUTE)
  await reachPaused(world, page)

  await page.reload()
  await world.sync()
  // 刷新后页面重新换票：服务端仍拒绝签发（授权没恢复），不能因为内存里的状态没了就回到能用的首页。
  await expect(paused(page)).toBeVisible()
  await expect(page.locator('[data-qx-page="home"]')).toHaveCount(0)
})

test('暂停后刷新且本机 Agent 取票失败，仍是暂停屏 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  world.lapse(6 * MINUTE)
  await world.advance(5.5 * MINUTE)
  await reachPaused(world, page)
  let failures = 0
  await page.route('http://127.0.0.1:9527/local/terminal-boot-ticket', async (route) => {
    failures += 1
    await route.abort('failed')
  })
  await page.reload()
  await world.sync()
  await world.advance(6 * MINUTE)
  expect(failures, '必须实际尝试向本机 Agent 取票').toBeGreaterThan(0)
  await expect(paused(page)).toBeVisible()
  await expect(page.locator('[data-qx-page="home"]')).toHaveCount(0)
})

test('登录办理到期暂停后恢复首页，不留下上一位登录态和资料 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  api.respond('POST', '/api/v1/member/auth/login', { status: 200, json: { success: true, data: { token: 'privacy-member-token', user: { id: 'privacy-member', phoneMasked: '139****5678', nickname: '王晓雨' } } } })
  await loginThroughVisibleUi(page, '/', '13912345678')
  await world.sync()
  await expect(page.getByTestId('home-end-previous')).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('ai-job-print:job-material-draft:v1', '上一位的隐私资料'))
  world.lapse(6 * MINUTE)
  await world.advance(5.5 * MINUTE)
  await reachPaused(world, page)
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('ai-job-print:job-material-draft:v1'))).toBeNull()
  world.restore()
  await world.advanceUntil(async () => (await paused(page).count()) === 0, 6 * MINUTE)
  await expect(page).toHaveURL((url) => url.pathname === '/')
  await expect(page.getByRole('button', { name: '登录后查看本人记录' })).toBeVisible()
  await expect(page.getByTestId('home-end-previous')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('王晓雨')
  await expect(page.locator('body')).not.toContainText('139****5678')
  expect(await page.evaluate(() => sessionStorage.getItem('ai-job-print:job-material-draft:v1'))).toBeNull()
})

test('收尾中我的可进入并结束使用，待办和重新打印锁住并说明原因 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  api.respond('POST', '/api/v1/member/auth/login', { status: 200, json: { success: true, data: { token: 'privacy-member-token', user: { id: 'privacy-member', phoneMasked: '139****5678', nickname: '王晓雨' } } } })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [{ id: 'pending-1', type: 'print', status: 'pending', payStatus: 'unpaid', fileName: '待付款.pdf', updatedAt: '2026-09-07T09:00:00.000Z', resume: { kind: 'payment', orderId: 'order-1', orderNo: 'P001', amountCents: 240, priceLines: [], paymentSessionToken: 'payment-1' } }] } })
  await loginThroughVisibleUi(page, '/', '13912345678')
  await world.sync()
  world.lapse(10 * MINUTE)
  await world.advance(3.5 * MINUTE)
  await expectHomeWindingDown(page)
  await tap(page, mainNav(page).getByRole('button', { name: '我的' }))
  await page.waitForURL((url) => url.pathname === '/profile')
  // 离开屏幕超过 30 秒再进「我的」，照旧先问一句「还是你吗？」，收尾中也一样；答「是我，继续」才看到本人的待办。
  const handover = page.getByTestId('handover-confirm')
  await expect(handover).toBeVisible()
  await handover.getByRole('button', { name: '是我，继续' }).click()
  await expect(page.getByTestId('profile-resume')).toBeVisible()
  await expect(page.locator('[data-license-locked] [data-testid="profile-resume"]')).toHaveCount(1)
  await expectTapStays(page, page.getByTestId('profile-resume'), '继续付款')
  await expect(page.getByText(NO_NEW_TASK).first()).toBeVisible()
  await goInApp(page, '/')
  await page.evaluate(() => {
    const state = { ...(window.history.state ?? {}), usr: { savedResume: { name: '本次简历.pdf', size: '1 MB', format: 'PDF' } }, key: 'license-profile-record' }
    window.history.pushState(state, '', '/profile')
    window.dispatchEvent(new PopStateEvent('popstate', { state }))
  })
  const print = page.getByRole('button', { name: '打印', exact: true })
  await expect(print).toBeDisabled()
  await expect(print).toHaveAttribute('title', NO_NEW_TASK)
  await expectTapStays(page, print, '重新打印')
  await expect(page.getByRole('button', { name: '删除', exact: true })).toBeEnabled()
  await expect(page.getByTestId('profile-primary')).toBeEnabled()
  const logout = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/member/auth/logout')
  await page.getByTestId('profile-primary').click()
  await logout
  await expect(page.getByTestId('home-end-previous')).toHaveCount(0)
})

// ───────────────────────── d) 未验签的答复 ─────────────────────────

test('暂停之后收到未验签的 profile（licenseState 为空、acceptsNewSessions 为 true）不能解除暂停 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  world.lapse(10 * MINUTE)
  await world.advance(3.5 * MINUTE)
  await world.advance(6 * MINUTE)
  await reachPaused(world, page)

  // 凭证已过期，服务端对这张票的答复就是「没验过」。再等够两轮 3 分钟续读，页面确实读到了这种答复。
  const readsBefore = world.log.profile.length
  await world.advance(6.5 * MINUTE)
  const unverified = world.log.profile.slice(readsBefore).filter((entry) => !entry.verified && entry.licenseState === null)
  expect(unverified.length, '期间页面应读到未验签的答复').toBeGreaterThanOrEqual(2)
  await expect(paused(page)).toBeVisible()
  await expect(page.locator('[data-qx-page="home"]')).toHaveCount(0)
})

test('收尾中收到未验签的 profile，入口仍然停用、不回到正常 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  world.lapse(12 * MINUTE)
  await world.advance(3.5 * MINUTE)
  await expectHomeWindingDown(page)

  // 服务端暂时回不出授权块（缓存服务抖动）：答复是「不知道、不拦」，不能当成授权恢复。
  world.forceUnverified = true
  const readsBefore = world.log.profile.length
  await world.advance(3.5 * MINUTE)
  expect(world.log.profile.slice(readsBefore).some((entry) => !entry.verified && entry.licenseState === null)).toBe(true)
  await expectHomeWindingDown(page)
  await expect(paused(page)).toHaveCount(0)
})

// ───────────────────────── e) 授权恢复：5 分钟复查后回首页 ─────────────────────────

test('授权恢复后，暂停屏在下一次 5 分钟复查时自动回首页、入口恢复；复查不会比每 5 分钟一次更密 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  world.lapse(6 * MINUTE)
  await world.advance(3.5 * MINUTE)
  await expectHomeWindingDown(page)
  // 到期之前（还剩半分钟）不是暂停屏，到期后进暂停屏。
  await world.advance(2 * MINUTE)
  await expect(paused(page)).toHaveCount(0)
  await reachPaused(world, page)

  // 授权仍失效时，暂停期间的复查（换票）一律被服务端拒绝；两次复查之间不少于 5 分钟。
  const exchangeBefore = world.log.exchange.length
  const refreshBefore = world.log.refresh.length
  await world.freeze()
  await world.advance(12 * MINUTE)
  const attempts = [...world.log.exchange.slice(exchangeBefore), ...world.log.refresh.slice(refreshBefore)].sort((left, right) => left - right)
  expect(attempts.length, '暂停期间应有复查').toBeGreaterThanOrEqual(2)
  expect(attempts.length, '12 分钟内复查最多 3 次（每 5 分钟一次）').toBeLessThanOrEqual(3)
  for (let i = 1; i < attempts.length; i += 1) {
    expect(attempts[i]! - attempts[i - 1]!, `第 ${i} 次与第 ${i + 1} 次复查的间隔`).toBeGreaterThanOrEqual(5 * MINUTE)
  }
  await world.thaw()
  await expect(paused(page)).toBeVisible()

  // 授权恢复（后台续期）。最迟再过一个复查周期，页面自己换到新票、读到验过签的 ok，自动回首页。
  world.restore()
  await world.advanceUntil(async () => (await paused(page).count()) === 0, 6 * MINUTE)
  await expect(page).toHaveURL((url) => url.pathname === '/')
  await expectHomeLive(page)
  expect(world.log.profile[world.log.profile.length - 1]?.licenseState).toBe('ok')

  // 入口真的恢复：同一个点法现在进得去（阳性），回来后仍是正常首页。
  await tap(page, homeEntry(page, 'help'))
  await page.waitForURL((url) => url.pathname === '/help')
})

// ───────────────────────── f) 品牌 ─────────────────────────

test('profile 给了品牌名与字标：首页页头与待机屏显示它；给空值回落「职易达」 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api, { screensaver: true })
  const brand = page.locator('[data-qx-page="home"] .qxt-brand')
  // 阳性对照：没有机构品牌时，首页就是平台默认「职易达」。
  await expect(brand.locator('b')).toHaveText('职易达')
  await expect(brand.locator('.qxt-mark')).toContainText('职')

  world.brand = { brandName: '云帆就业', brandMark: '云' }
  // 品牌随下一次读 profile 到屏上（页面每 3 分钟续读，换会话时也读）。
  await world.advance(3.5 * MINUTE)
  await expect(brand.locator('b')).toHaveText('云帆就业')
  await expect(brand.locator('.qxt-mark')).toContainText('云')

  // 待机屏：品牌名、字标，以及「轻触屏幕进入……首页」的读屏提示。
  await goInApp(page, '/screensaver')
  const standby = page.locator('[data-kiosk-screen="screensaver"]')
  await expect(standby.locator('.sb-name')).toHaveText('云帆就业')
  await expect(standby.locator('.sb-seal')).toContainText('云')
  await expect(standby.getByTestId('standby-primary')).toHaveAttribute('aria-label', '轻触屏幕进入云帆就业首页')

  // 空值（服务端没配置、或返回了空串 / 空白）：回落平台默认「职易达」「职」，不出现空白品牌。
  world.brand = { brandName: '', brandMark: '  ' }
  await world.advance(3.5 * MINUTE, { active: false })
  await expect(standby.locator('.sb-name')).toHaveText('职易达')
  await expect(standby.locator('.sb-seal')).toContainText('职')
  await expect(standby.getByTestId('standby-primary')).toHaveAttribute('aria-label', '轻触屏幕进入职易达首页')
  await standby.getByTestId('standby-primary').click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.locator('[data-qx-page="home"] .qxt-brand b')).toHaveText('职易达')
  await expect(page.locator('[data-qx-page="home"] .qxt-brand .qxt-mark')).toContainText('职')
})

test('profile 给了机构 Logo：字标上盖着 Logo 图；图加载不出来时留着字标 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  const logoPath = '/api/v1/public/brand-logo/logo-yunfan-2026'
  await page.route(`**${logoPath}`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }))
  await page.route(`**${logoPath}-gone`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  const mark = page.locator('[data-qx-page="home"] .qxt-brand .qxt-mark')

  world.brand = { brandName: '云帆就业', brandMark: '云', logoUrl: logoPath }
  await world.advance(3.5 * MINUTE)
  const logo = mark.locator('img')
  await expect(logo).toHaveCount(1)
  await expect(logo).toHaveAttribute('src', new RegExp(`${logoPath}$`))
  await expect.poll(() => logo.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)

  // 图加载失败：图自己收起，字标还在（不能出现一个空白的品牌位）。
  world.brand = { brandName: '云帆就业', brandMark: '云', logoUrl: `${logoPath}-gone` }
  await world.advance(3.5 * MINUTE)
  await expect(mark).toContainText('云')
  await expect(mark.locator('img')).toBeHidden()
})
