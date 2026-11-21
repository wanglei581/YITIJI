/**
 * 一体机首页四个入口的短价（收费第 7 项第五包 P2e-5；稿 docs/design/kiosk-touch-2026-10/pay-1113.js「首页短价」）。
 *
 * 价只取本机终端配置 GET /terminals/:id/config 的 pricing.effective。五个价都读到、并且至少一个大于 0
 * （这台机器在收费）才在改简历、练面试、打印 · 扫描三张卡上标价；读不齐、全 0 一行不画。
 * 已登录且有「继续办理」那一条时压低四张卡，页脚三行和备案号仍在底部导航之上，小样图按右下角缩到 0.78。
 *
 * 用 playwright.w1.config.ts 跑（@w1-kiosk / @w1-mobile）。
 */
import type { Locator, Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { machinePricingWith, type MachinePriceKey } from '../fixtures/machine-pricing'
import { RECRUITMENT_HOSTING_OFF, RECRUITMENT_HOSTING_ON, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'
import { assertNoHorizontalOverflow } from './assert-layout'
import { loginThroughVisibleUi, registerAuthenticatedMemberApis, registerMemberLogin } from './fixtures/kiosk-p1-evidence-capture-api'

const CONFIG = '/api/v1/terminals/KSK-001/config'
const PRICE_NOTICE = '收费以现场公示为准'
const PRICE = '.qxt-task-price'

/** 一台真在收费的机器：几项价各不相同，彩色单价首页不出。 */
const MIXED: Partial<Record<MachinePriceKey, number>> = {
  resume_optimize: 200,
  mock_interview: 150,
  print_bw_page: 50,
  print_color_page: 120,
  scan: 100,
}

function registerHome(api: ApiRouter, pricing: Record<string, unknown> | null, homeFreeBadge = true): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', CONFIG, {
    status: 200,
    json: {
      ...terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'home-price-lines'),
      homeFreeBadge,
      ...(pricing ? { pricing } : {}),
    },
  })
}

async function openHome(page: Page): Promise<Locator> {
  // 价和收费句来自同一轮配置：先等配置应答回来，再看屏。
  const config = page.waitForResponse((response) => new URL(response.url()).pathname === CONFIG)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await config
  const home = page.getByTestId('qx-home')
  await expect(home.locator('[data-action="print-hub"]')).toHaveAttribute('data-panel-state', 'ready')
  return home
}

/** 证据截图（并排图用）：设了 P2E5_SHOT_DIR 才拍。 */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.P2E5_SHOT_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}` })
}

/** 断言「没有」之前：配置应答已到，再留一拍给这一轮发布，免得在还没画之前就判没有。 */
async function settled(page: Page): Promise<void> {
  await page.waitForTimeout(600)
}

function card(home: Locator, action: 'resume-hub' | 'interview-hub' | 'print-hub' | 'policy-hub'): Locator {
  return home.locator(`[data-action="${action}"]`)
}

async function priceTexts(home: Locator): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const action of ['resume-hub', 'interview-hub', 'print-hub', 'policy-hub'] as const) {
    out[action] = await card(home, action).locator(PRICE).allInnerTexts()
  }
  return out
}

async function expectNoPriceLines(home: Locator): Promise<void> {
  await expect(home.locator(PRICE)).toHaveCount(0)
  await expect(home.getByText(/每次 |黑白每页|诊断免费/)).toHaveCount(0)
}

/** 页脚收费句接在自动退出登录后面，「收费以现场公示为准」整句排在一行里。 */
async function expectNoticeKeptWhole(home: Locator): Promise<void> {
  const foot = home.locator('.qxt-home-foot p').first()
  await expect(foot).toContainText(/无操作自动退出登录 · 收费以现场公示为准 · 打开本人文档/)
  const keep = foot.locator('.qxt-home-keep')
  await expect(keep).toHaveText(PRICE_NOTICE)
  expect(await keep.evaluate((el) => el.getClientRects().length), '收费句不得拆到两行').toBe(1)
}

test('首页短价：四项都收 1.00 元，三张卡照稿标价，诊断免费写在改简历后面 @w1-kiosk', async ({ page, api }) => {
  registerHome(api, machinePricingWith({ resume_optimize: 100, mock_interview: 100, print_bw_page: 100, print_color_page: 150, scan: 100 }))
  const home = await openHome(page)
  await expect(card(home, 'resume-hub').locator(PRICE)).toHaveCount(1)
  expect(await priceTexts(home)).toEqual({
    'resume-hub': ['每次 1.00 元 · 诊断免费'],
    'interview-hub': ['每次 1.00 元'],
    'print-hub': ['打印 黑白每页 1.00 元', '扫描 每次 1.00 元'],
    'policy-hub': [],
  })
  // 价紧跟标题、在说明之前；读屏把价读进卡片描述。
  const resume = card(home, 'resume-hub')
  const [title, price, desc] = await Promise.all([
    resume.locator('h3').boundingBox(),
    resume.locator(PRICE).boundingBox(),
    resume.locator('p').boundingBox(),
  ])
  expect(price!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1)
  expect(desc!.y).toBeGreaterThanOrEqual(price!.y + price!.height - 1)
  await expect(resume).toHaveAccessibleName('改简历')
  await expect(resume).toHaveAccessibleDescription(/^每次 1\.00 元 · 诊断免费 /)
  await expect(card(home, 'print-hub')).toHaveAccessibleDescription(/^打印 黑白每页 1\.00 元 扫描 每次 1\.00 元 /)
  // 稿上的字：22px 粗体，浅卡青墨、深卡亮绿；标价的卡标题 36px、说明 21px；查政策不标价、样子不变。
  const style = (locator: Locator) => locator.evaluate((el) => {
    const css = getComputedStyle(el)
    return { size: css.fontSize, weight: css.fontWeight, color: css.color, wrap: css.whiteSpace }
  })
  expect(await style(resume.locator(PRICE))).toEqual({ size: '22px', weight: '800', color: 'rgb(15, 110, 92)', wrap: 'nowrap' })
  expect(await style(card(home, 'print-hub').locator(PRICE).first())).toEqual({ size: '22px', weight: '800', color: 'rgb(46, 230, 168)', wrap: 'nowrap' })
  expect(await resume.locator('h3').evaluate((el) => getComputedStyle(el).fontSize)).toBe('36px')
  expect(await resume.locator('p').evaluate((el) => getComputedStyle(el).fontSize)).toBe('21px')
  expect(await card(home, 'policy-hub').locator('h3').evaluate((el) => getComputedStyle(el).fontSize)).toBe('34px')
  // 收费机器：没有「免费使用」，页脚写收费句。
  await expect(home.getByLabel('免费使用')).toHaveCount(0)
  await expectNoticeKeptWhole(home)
  await expect(home).not.toContainText('¥')
  await expect(home).not.toContainText('工作人员')
  await assertNoHorizontalOverflow(page)
  await shot(page, 'run-fee-100.png')
})

test('首页短价：扫描 0 元、其余照收，扫描那一行写「扫描 免费」 @w1-kiosk', async ({ page, api }) => {
  registerHome(api, machinePricingWith({ resume_optimize: 100, mock_interview: 100, print_bw_page: 100, print_color_page: 150, scan: 0 }))
  const home = await openHome(page)
  await expect(card(home, 'print-hub').locator(PRICE)).toHaveCount(2)
  expect(await priceTexts(home)).toEqual({
    'resume-hub': ['每次 1.00 元 · 诊断免费'],
    'interview-hub': ['每次 1.00 元'],
    'print-hub': ['打印 黑白每页 1.00 元', '扫描 免费'],
    'policy-hub': [],
  })
  await expectNoticeKeptWhole(home)
  await shot(page, 'run-pyzero-scan.png')
})

test('首页短价：真实价各不相同，金额写成 X.XX 元，0 元写免费 @w1-kiosk', async ({ page, api }) => {
  registerHome(api, machinePricingWith({ ...MIXED, mock_interview: 0, print_bw_page: 0 }))
  const home = await openHome(page)
  await expect(card(home, 'print-hub').locator(PRICE)).toHaveCount(2)
  expect(await priceTexts(home)).toEqual({
    'resume-hub': ['每次 2.00 元 · 诊断免费'],
    'interview-hub': ['免费'],
    'print-hub': ['打印 免费', '扫描 每次 1.00 元'],
    'policy-hub': [],
  })
  // 彩色单价 1.20 元首页不出。
  await expect(home).not.toContainText('1.20')
})

test('首页短价：五个价全是 0，一行价都不画，免费角标照开关 @w1-kiosk', async ({ page, api }) => {
  registerHome(api, machinePricingWith({}), true)
  const home = await openHome(page)
  await expect(home.locator('.qxt-greet').getByLabel('免费使用')).toBeVisible()
  await expectNoPriceLines(home)
  await expect(home.locator('.qxt-home-foot')).not.toContainText(PRICE_NOTICE)
  // 不收费的样子与改前一致：卡片标题仍是 34px、内边距不变。
  const resume = card(home, 'resume-hub')
  expect(await resume.locator('h3').evaluate((el) => getComputedStyle(el).fontSize)).toBe('34px')
  expect(await resume.evaluate((el) => getComputedStyle(el).padding)).toBe('14px 16px 12px')
  await shot(page, 'run-nofee.png')
})

test('首页短价：五个价全是 0、免费角标开关关着，角标和价都不画 @w1-kiosk', async ({ page, api }) => {
  registerHome(api, machinePricingWith({}), false)
  const home = await openHome(page)
  // 阳性对照：同一份配置的托管已读到（页脚写「未开放」）。
  await expect(home.getByTestId('home-recruitment-boundary')).toContainText('本终端未开放岗位与招聘会信息')
  await settled(page)
  await expect(home.getByLabel('免费使用')).toHaveCount(0)
  await expectNoPriceLines(home)
})

for (const [label, pricing] of [
  ['练面试缺键', machinePricingWith(MIXED, ['mock_interview'])],
  ['扫描是负数', machinePricingWith({ ...MIXED, scan: -100 })],
  ['黑白是字符串', machinePricingWith({ ...MIXED, print_bw_page: '50' })],
  ['改简历是小数', machinePricingWith({ ...MIXED, resume_optimize: 99.5 })],
] as const) {
  test(`首页短价：有一个价读不到（${label}），一行价都不画 @w1-kiosk`, async ({ page, api }) => {
    registerHome(api, pricing)
    const home = await openHome(page)
    // 读到的价里已有正价：照原规则写收费句（阳性对照，证明这一轮配置确实读完了）。
    await expect(home.locator('.qxt-home-foot')).toContainText(PRICE_NOTICE)
    await expectNoPriceLines(home)
    await expect(home.getByLabel('免费使用')).toHaveCount(0)
  })
}

test('首页短价：配置里没有 pricing（如 mock）或配置读失败，一行价都不画 @w1-kiosk', async ({ page, api }) => {
  registerHome(api, null)
  const home = await openHome(page)
  await expect(home.getByTestId('home-recruitment-boundary')).toContainText('本终端未开放岗位与招聘会信息')
  await settled(page)
  await expectNoPriceLines(home)
  await expect(home.locator('.qxt-home-foot')).not.toContainText(PRICE_NOTICE)

  api.respond('GET', CONFIG, { status: 503, json: {} })
  const failed = page.waitForResponse((response) => new URL(response.url()).pathname === CONFIG && response.status() === 503)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await failed
  await settled(page)
  await expect(page.getByTestId('qx-home').locator('[data-action="resume-hub"]')).toBeVisible()
  await expectNoPriceLines(page.getByTestId('qx-home'))
  await expect(page.getByTestId('qx-home').locator('.qxt-home-foot')).not.toContainText(PRICE_NOTICE)
})

const ACTIVE_ORDER = {
  id: 'task-p2e5-20261119-4c81d0',
  orderNo: 'ORD-20261119-4C81D0',
  status: 'printing',
  fileName: '毕业生就业推荐表（已填写）.pdf',
  createdAt: '2026-11-19T05:40:12.000Z',
  completedAt: null,
  copies: 1,
  colorMode: 'black_white',
  duplex: 'simplex',
  paperSize: 'A4',
  pageRange: 'all',
}

async function loginToHome(page: Page, api: ApiRouter, withContinue: boolean): Promise<Locator> {
  registerMemberLogin(api)
  registerAuthenticatedMemberApis(api)
  if (withContinue) {
    api.respond('GET', '/api/v1/me/print-orders', {
      status: 200,
      json: { success: true, data: { items: [ACTIVE_ORDER], nextCursor: null, total: 1 } },
    })
  }
  await loginThroughVisibleUi(page, '/')
  const home = page.getByTestId('qx-home')
  await expect(home.getByTestId('home-identity')).toHaveText('你已登录')
  await expect(card(home, 'resume-hub').locator(PRICE)).toHaveText('每次 2.00 元 · 诊断免费')
  return home
}

/** 页脚（三行）与备案号的下沿、底部导航的上沿，以及正文有没有被裁。 */
async function footAboveNav(page: Page): Promise<{ footBottom: number; icpBottom: number; navTop: number; overflow: number }> {
  return page.evaluate(() => {
    const body = document.querySelector('.qxt-body.qxt-home') as HTMLElement
    const foot = document.querySelector('.qxt-home-foot p') as HTMLElement
    const icp = document.querySelector('.qxt-home-icp') as HTMLElement
    const nav = document.querySelector('.qxt-nav') as HTMLElement
    return {
      footBottom: foot.getBoundingClientRect().bottom,
      icpBottom: icp.getBoundingClientRect().bottom,
      navTop: nav.getBoundingClientRect().top,
      overflow: body.scrollHeight - body.clientHeight,
    }
  })
}

test('首页短价：已登录且有继续办理，四张卡压低，页脚三行与备案号在底部导航之上，小样图缩到 0.78 @w1-kiosk', async ({ page, api }) => {
  registerHome(api, machinePricingWith(MIXED))
  const home = await loginToHome(page, api, true)
  await expect(home.locator('section.continue')).toContainText('打印任务进行中')
  expect(await priceTexts(home)).toEqual({
    'resume-hub': ['每次 2.00 元 · 诊断免费'],
    'interview-hub': ['每次 1.50 元'],
    'print-hub': ['打印 黑白每页 0.50 元', '扫描 每次 1.00 元'],
    'policy-hub': [],
  })
  await expect(home.locator('.qxt-home-foot')).toContainText(PRICE_NOTICE)

  const box = await footAboveNav(page)
  expect(box.overflow, '首页正文不得溢出被裁').toBe(0)
  expect(box.footBottom, `页脚下沿 ${box.footBottom} 不得压到底部导航上沿 ${box.navTop}`).toBeLessThanOrEqual(box.navTop)
  expect(box.icpBottom, `备案号下沿 ${box.icpBottom} 不得压到底部导航上沿 ${box.navTop}`).toBeLessThanOrEqual(box.navTop)
  expect(box.navTop - box.icpBottom, '压低后四张卡分掉剩下的高度，底部导航上方不留空带').toBeLessThanOrEqual(105)
  expect(await home.locator('.qxt-home-foot p').first().evaluate((el) => Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight))), '页脚三行').toBe(3)

  // 四张卡的小样图都按右下角缩到 0.78，缩完不压到右上角的角标。
  for (const action of ['resume-hub', 'interview-hub', 'print-hub', 'policy-hub'] as const) {
    const mini = await card(home, action).evaluate((el) => {
      const art = el.querySelector('.qxt-mini') as HTMLElement
      const chip = el.querySelector('.qxt-chip') as HTMLElement
      const css = getComputedStyle(art)
      const a = art.getBoundingClientRect()
      const c = chip.getBoundingClientRect()
      return {
        transform: css.transform,
        origin: css.transformOrigin,
        overlap: a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top,
      }
    })
    expect(mini.transform, `${action} 小样图缩放`).toBe('matrix(0.78, 0, 0, 0.78, 0, 0)')
    expect(mini.overlap, `${action} 小样图不得压到角标`).toBe(false)
  }
  // 压低之后字也不少于 20px，整张卡仍是大按钮。
  const smallest = await home.locator('.qxt-home-tasks').evaluate((root) => Math.min(
    ...[...root.querySelectorAll('h3, p, small, span')]
      .filter((el) => (el as HTMLElement).innerText?.trim() && !el.closest('svg, [aria-hidden="true"]'))
      .map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
  ))
  expect(smallest).toBeGreaterThanOrEqual(20)
  for (const action of ['resume-hub', 'interview-hub', 'print-hub', 'policy-hub'] as const) {
    const size = await card(home, action).boundingBox()
    expect(size!.height).toBeGreaterThanOrEqual(48)
  }
  expect(await card(home, 'resume-hub').locator('h3').evaluate((el) => getComputedStyle(el).fontSize)).toBe('32px')
  expect(await card(home, 'resume-hub').locator(PRICE).evaluate((el) => getComputedStyle(el).fontSize)).toBe('20px')
  await assertNoHorizontalOverflow(page)
  await shot(page, 'run-login-fee.png')
})

test('首页短价：已登录但没有可继续的办理，照未登录排、不压低，页脚仍在底部导航之上 @w1-kiosk', async ({ page, api }) => {
  registerHome(api, machinePricingWith(MIXED))
  const home = await loginToHome(page, api, false)
  await expect(home.locator('section.continue')).toHaveCount(0)
  const box = await footAboveNav(page)
  expect(box.overflow).toBe(0)
  expect(box.footBottom).toBeLessThanOrEqual(box.navTop)
  expect(box.icpBottom).toBeLessThanOrEqual(box.navTop)
  expect(await card(home, 'resume-hub').locator('h3').evaluate((el) => getComputedStyle(el).fontSize)).toBe('36px')
  expect(await card(home, 'resume-hub').locator('.qxt-mini').evaluate((el) => getComputedStyle(el).transform)).toBe('none')
})

test('首页短价：未登录收费态，页脚与备案号也在底部导航之上且标准 2 磁贴不压低 @w1-kiosk', async ({ page, api }) => {
  registerHome(api, machinePricingWith(MIXED))
  const home = await openHome(page)
  await expect(card(home, 'interview-hub').locator(PRICE)).toHaveText('每次 1.50 元')
  const box = await footAboveNav(page)
  expect(box.overflow).toBe(0)
  expect(box.footBottom).toBeLessThanOrEqual(box.navTop)
  expect(box.icpBottom).toBeLessThanOrEqual(box.navTop)
  expect(await card(home, 'resume-hub').locator('h3').evaluate((el) => getComputedStyle(el).fontSize)).toBe('36px')
  expect(await card(home, 'resume-hub').locator('.qxt-mini').evaluate((el) => getComputedStyle(el).transform)).toBe('none')
  await shot(page, 'run-fee-mixed.png')
})

test('首页短价：私有化部署磁贴多（压紧版式）收费时也压低，正文不被裁、页脚不被挡 @w1-kiosk', async ({ page, api }) => {
  registerHome(api, machinePricingWith(MIXED))
  api.respond('GET', CONFIG, {
    status: 200,
    json: { ...terminalConfigWithHosting(RECRUITMENT_HOSTING_ON, 'home-price-lines-b'), homeFreeBadge: true, pricing: machinePricingWith(MIXED) },
  })
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
  api.respond('GET', '/api/v1/job-fairs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })
  const home = await openHome(page)
  await expect(home.locator('.qxt-home-tiles')).toHaveAttribute('data-count', '4')
  await expect(card(home, 'print-hub').locator(PRICE)).toHaveText(['打印 黑白每页 0.50 元', '扫描 每次 1.00 元'])
  const box = await footAboveNav(page)
  expect(box.overflow).toBe(0)
  expect(box.footBottom).toBeLessThanOrEqual(box.navTop)
  expect(box.icpBottom).toBeLessThanOrEqual(box.navTop)
  expect(await card(home, 'resume-hub').locator('.qxt-mini').evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(0.78, 0, 0, 0.78, 0, 0)')
})

test('首页短价：手机宽度下价可以折行，不横向溢出 @w1-mobile', async ({ page, api }) => {
  registerHome(api, machinePricingWith({ ...MIXED, resume_optimize: 1250 }))
  const home = await openHome(page)
  await expect(card(home, 'resume-hub').locator(PRICE)).toHaveText('每次 12.50 元 · 诊断免费')
  await assertNoHorizontalOverflow(page)
  expect(await card(home, 'resume-hub').locator(PRICE).evaluate((el) => getComputedStyle(el).fontSize)).toBe('20px')
})
