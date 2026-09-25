import type { Locator, Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { RECRUITMENT_HOSTING_ON } from '../fixtures/recruitment-hosting'
import { assertNoHorizontalOverflow } from './assert-layout'

function homeFair(): Record<string, unknown> {
  const startTime = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  const endTime = new Date(startTime.getTime() + 8 * 60 * 60 * 1000)
  return {
    id: 'qx-home-fair',
    name: '2026 青岛秋季高校毕业生招聘会',
    organizer: '青岛市公共就业服务中心',
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    venue: '青岛国际会展中心',
    status: 'upcoming',
    sourceOrgId: 'source-qx',
    externalId: 'external-qx-home-fair',
    sourceName: '青岛公共就业服务网',
    sourceUrl: 'https://jobs.example.gov.cn/fairs/qx-home-fair',
    syncTime: '2026-09-07T00:00:00.000Z',
    hasManagedData: false,
    managedCompanyCount: 0,
    managedMaterialCount: 0,
    dataSourceNote: '招聘会信息由官方来源提供。',
  }
}

function registerHomeApi(api: ApiRouter, fairs: unknown[] = [homeFair()]): void {
  // 本套件最后一步会点主 CTA 进 /assistant，助手页挂载即请求语音能力。
  // 不 stub 的话，fixture 拆卸时会以「未处理请求」判失败——那是竞态不是缺陷。
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { asrEnabled: false, ttsEnabled: false },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: null, isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: {
        enabled: false,
        modules: { welcome: false, bigdata: false, luggage: false, panorama: false },
        items: [],
      },
      toolbox: { enabled: false, items: [] },
      // 本组测的是托管打开（客户私有化部署 b）时首页的招聘会 / 岗位磁贴；关闭态见 recruitment-hosting.spec.ts。
      ...RECRUITMENT_HOSTING_ON,
      configVersion: 'qx-home-e2e',
      refreshIntervalMs: 300000,
      serverTime: '2026-09-07T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { data: fairs, pagination: { page: 1, pageSize: 20, total: fairs.length, totalPages: fairs.length ? 1 : 0 } },
  })
}

async function expectTouchFloor(locator: Locator, minimumCssHeight: number): Promise<void> {
  const scale = await locator.first().evaluate((element) => {
    const host = element.closest('[data-kiosk-stage-fit]') as HTMLElement | null
    if (host?.dataset.kioskStageFit === 'off') return 1
    const stage = element.closest('.kiosk-stage') as HTMLElement | null
    if (!stage) return 1
    const rect = stage.getBoundingClientRect()
    return rect.width / 1080 || 1
  })
  const count = await locator.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const target = locator.nth(index)
    if (!(await target.isVisible())) continue
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width / scale).toBeGreaterThanOrEqual(48)
    expect(box!.height / scale).toBeGreaterThanOrEqual(minimumCssHeight)
    const hitTested = await target.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      // 圆角元素的四角在几何上不在元素内：半径 r 时，距角 3px 的点会落到外面，
      // elementFromPoint 必然命中别人。按实际圆角算最小内缩——
      // 45° 方向要退 r(1-√2/2) 才回到圆弧内侧，再留 2px 余量。
      const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
      const effectiveRadius = Math.min(radius, rect.width / 2, rect.height / 2)
      const cornerInset = effectiveRadius * (1 - Math.SQRT1_2) + 2
      const inset = Math.max(Math.min(3, rect.width / 4, rect.height / 4), cornerInset)
      const points = [
        [rect.left + inset, rect.top + inset],
        [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset],
        [rect.right - inset, rect.bottom - inset],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
      ]
      let pointerEvents = 0
      const onPointerDown = () => { pointerEvents += 1 }
      element.addEventListener('pointerdown', onPointerDown)
      const allHit = points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y)
        if (hit == null || (hit !== element && !element.contains(hit))) return false
        hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }))
        return true
      })
      element.removeEventListener('pointerdown', onPointerDown)
      return allHit && pointerEvents === points.length
    })
    expect(hitTested).toBe(true)
  }
}

// 主卡说明曾被 flex 压成 0 高、叠在标题与脚注之间（2026-09-24 实拍）。
// 判据是几何：说明完整可读（不被裁），且纵向落在标题之下、脚注之上。
async function expectReadableFeature(page: Page): Promise<void> {
  const tile = page.locator('[data-action="print-hub"]')
  const [title, desc, foot] = await Promise.all([
    tile.locator('strong').boundingBox(),
    tile.locator('.qx-home-tile-desc').boundingBox(),
    tile.locator('.qx-home-tile-foot').boundingBox(),
  ])
  expect(title && desc && foot).toBeTruthy()
  expect(desc!.height).toBeGreaterThanOrEqual(18)
  expect(desc!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1)
  expect(desc!.y + desc!.height).toBeLessThanOrEqual(foot!.y + 1)
  const clipped = await tile.locator('.qx-home-tile-desc').evaluate((el) =>
    el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
  )
  expect(clipped, '主卡说明不得在纵向或横向被裁切').toBe(false)
}

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('requestfailed', (request) => {
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()}`)
    }
  })
  return errors
}

// 只取 CSS 动画（悬停/按压的 transition 不算）：名称、播放次数、挂在谁身上。
async function homeAnimations(page: Page): Promise<Array<{ name: string; iterations: number; target: string }>> {
  return page.getByTestId('qx-home').evaluate((root) =>
    root.getAnimations({ subtree: true }).flatMap((animation) => {
      if (!('animationName' in animation)) return []
      const effect = animation.effect as KeyframeEffect
      const target = effect.target as HTMLElement
      return [{
        name: (animation as CSSAnimation).animationName,
        iterations: effect.getComputedTiming().iterations ?? 0,
        target: `${target.getAttribute('data-action') ?? target.className}${effect.pseudoElement ?? ''}`,
      }]
    }),
  )
}

test('home uses the Qingxu frame, honest states, and real destinations @w1-kiosk', async ({ page, api }) => {
  const runtimeErrors = collectRuntimeErrors(page)
  registerHomeApi(api)
  const fairRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/v1/job-fairs')

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const fairRequestUrl = new URL((await fairRequest).url())

  const home = page.getByTestId('qx-home')
  await expect(home).toBeVisible()
  await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
  await expect(page.locator('.ui-kiosk-topbar')).toHaveCount(0)
  await expect(page.locator('.ui-kiosk-nav')).toHaveCount(0)
  await expect(page.locator('.ui-kiosk-shell')).not.toHaveClass(/kiosk-home-mobile/)
  await expect(page.getByText('状态未知', { exact: true }).first()).toBeVisible()
  await expect(home.getByText('2026 青岛秋季高校毕业生招聘会', { exact: true })).toBeVisible()
  expect(fairRequestUrl.searchParams.get('terminalId')).toBe('KSK-001')
  await expect(home.getByText('这台机器上没有待继续的办理')).toBeVisible()
  // 打印机状态未知时，主卡照实说「状态未知」和受影响范围，不写成「进入后核验」的常态眉题。
  const printTile = home.locator('[data-action="print-hub"]')
  await expect(printTile).toHaveAttribute('data-panel-state', 'unknown')
  await expect(printTile.getByText('状态未知', { exact: true })).toBeVisible()
  await expect(printTile.getByText(/出纸与扫描暂停/)).toBeVisible()
  await expectReadableFeature(page)
  // 百宝箱 / 智慧校园是**能力闸门**：本机没开通就该点不动，浏览器不是绑定终端，
  // 所以这里必须 disabled。这两条钉的是 fail-closed，不是钉「当前恰好是灰的」。
  await expect(home.getByRole('button', { name: /百宝箱/ })).toBeDisabled()
  await expect(home.getByRole('button', { name: /智慧校园/ })).toBeDisabled()

  // 空态是陈述不是动作：它不能是按钮（无论 disabled 与否）。
  await expect(home.getByText('这台机器上没有待继续的办理')).toBeVisible()
  await expect(home.getByRole('button', { name: /没有待继续的办理/ })).toHaveCount(0)

  // 首页上每一颗点不动的按钮，都必须说得出「因为哪条能力闸门」。
  //
  // 2026-09-09 生产实走抓到三颗点不动的控件（「更多服务（目录迁移中）」
  // 「查看全部服务（目录迁移中）」和被做成 disabled 按钮的空态），
  // title 全是「全部服务目录尚未迁入运行时路由」——一体机没有鼠标悬停，
  // 那句解释根本没人看得到，用户只会反复去戳。
  //
  // **判据是结构不是禁词表。** 第一版写成 `/迁移中|待接入|TODO/` 的黑名单，
  // 只能抓写进表里的词；换一句「建设中」「敬请期待」就漏。现在要求每颗 disabled
  // 按钮带 `data-disabled-reason="capability:<配置项>"`，
  // 语义是「本机没开通这项服务」——真实状态、用户看得懂、运营改配置就能变。
  // 功能没做完不属于这一类：那种情况不该在首页摆按钮，直接不渲染。
  const unexplainedDisabled = await home.evaluate(() =>
    [...document.querySelectorAll('button[disabled], [aria-disabled="true"]')]
      .filter((el) => !/^capability:/.test(el.getAttribute('data-disabled-reason') ?? ''))
      .map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
  )
  expect(
    unexplainedDisabled,
    `首页出现了说不出理由的死控件：${unexplainedDisabled.join(' / ')}。`
      + `点不动只有一个正当理由——本机没开通这项能力，那就带上 data-disabled-reason="capability:x"；`
      + `功能没做完不要在首页摆按钮。`,
  ).toEqual([])
  await expect(home.getByText('本终端仅展示与跳转，不代收简历', { exact: false })).toBeVisible()
  await expect(home.getByRole('link', { name: '鲁ICP备2026023517号-2' })).toHaveAttribute('href', 'https://beian.miit.gov.cn/')
  await expect(home.getByRole('link', { name: '鲁公网安备37021402007308号' })).toHaveAttribute('href', /beian\.mps\.gov\.cn/)

  const primary = home.getByTestId('home-primary')
  // 主 CTA 只是打开 AI 顾问，不在首页开麦：文案不得写「点这里说话」。
  // W1 构建带 VITE_USE_TRTC_CALL=true 只说明助手页显示语音入口；首页不能承诺本机此刻可开麦。
  await expect(primary).toContainText('打开 AI 顾问，咨询求职问题')
  await expect(primary).toContainText('语音以本机检测为准')
  await expect(primary).not.toContainText('点这里说话')
  await expectTouchFloor(primary, 56)
  await expectTouchFloor(home.locator('button:visible, a:visible'), 48)
  await primary.click()
  await expect(page).toHaveURL(/\/assistant$/)
  expect(runtimeErrors).toEqual([])
})

test('home ready state defers capability claims to entry without hiding the real device pill @w1-kiosk', async ({ page, api }) => {
  registerHomeApi(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', isOnline: true } })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: true, modules: { welcome: true, bigdata: false, luggage: false, panorama: false }, items: [] },
      toolbox: { enabled: false, items: [] },
      ...RECRUITMENT_HOSTING_ON,
      configVersion: 'qx-home-ready',
      refreshIntervalMs: 300000,
      serverTime: '2026-09-07T00:00:00.000Z',
    },
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const home = page.getByTestId('qx-home')
  const printTile = home.locator('[data-action="print-hub"]')
  await expect(printTile).toHaveAttribute('data-panel-state', 'ready')
  // 真实设备态仍在顶栏胶囊；主卡按稿只写「进入后核验」，不重复报「打印机在线」。
  await expect(page.locator('.qx-topbar .qx-pill')).toHaveText('打印机在线')
  await expect(printTile.getByText('进入后核验打印与扫描能力', { exact: true })).toBeVisible()
  await expect(printTile.getByText('打印机在线')).toHaveCount(0)
  await expectReadableFeature(page)
  // 智慧校园开通只凭终端配置，首页不宣称「已授权」；开通后可点。
  const campus = home.getByRole('button', { name: /智慧校园/ })
  await expect(campus).toBeEnabled()
  await expect(campus.getByText('受控开放', { exact: true })).toBeVisible()
  await expect(home.getByText('已授权', { exact: true })).toHaveCount(0)
  await expect(home.getByRole('button', { name: /百宝箱/ })).toBeDisabled()
  await expect(home.getByRole('button', { name: /查看全部服务|更多服务/ })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('home-ready-1080x1920.png') })
})

test('home exposes an honest job-fair error and a real retry @w1-kiosk', async ({ page, api }) => {
  registerHomeApi(api)
  api.abort('GET', '/api/v1/job-fairs', 'internetdisconnected')

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const retry = page.getByTestId('qx-home').getByRole('button', { name: /招聘会.*重新加载/ })
  await expect(retry).toBeVisible()
  await expect(retry.getByText('读取失败', { exact: true })).toBeVisible()
  await expect(retry.getByText('没有使用缓存或示例数据，请稍后重试。', { exact: true })).toBeVisible()
  expect(api.requestCount('GET', '/api/v1/job-fairs')).toBe(1)
  const retryRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/v1/job-fairs')
  await retry.click()
  expect(new URL((await retryRequest).url()).searchParams.get('terminalId')).toBe('KSK-001')
  await expect.poll(() => api.requestCount('GET', '/api/v1/job-fairs')).toBe(2)
})

test('home keeps one shell and a usable narrow layout @w1-mobile', async ({ page, api }) => {
  const runtimeErrors = collectRuntimeErrors(page)
  registerHomeApi(api)

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('qx-home')).toBeVisible()
  await expect(page.locator('[data-qx-frame="true"]')).toHaveCount(1)
  await expect(page.locator('.ui-kiosk-topbar')).toHaveCount(0)
  await expect(page.locator('.ui-kiosk-nav')).toHaveCount(0)
  await expect(page.locator('.ui-kiosk-shell')).not.toHaveClass(/kiosk-home-mobile|v6-runtime-shell/)
  await assertNoHorizontalOverflow(page)
  await expectReadableFeature(page)
  await expect(page.getByTestId('home-identity')).toBeVisible()
  await expectTouchFloor(page.getByTestId('qx-home').locator('button:visible, a:visible'), 48)
  const status = await page.locator('.qx-home-hero-top .qx-pill').boundingBox()
  const print = await page.getByTestId('qx-home').locator('[data-action="print-hub"]').boundingBox()
  const nav = await page.locator('.qx-navbar').boundingBox()
  expect(status, '设备状态需完整落在手机屏幕内').not.toBeNull()
  expect(print, '首张服务卡需实际渲染').not.toBeNull()
  expect(nav, '底部导航需实际渲染').not.toBeNull()
  expect(status!.x).toBeGreaterThanOrEqual(0)
  expect(status!.x + status!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  expect(print!.y + 96, '首张服务卡至少露出 96px，不能被底栏盖住').toBeLessThan(nav!.y)
  await page.screenshot({ path: test.info().outputPath('home-390x844.png'), fullPage: true })
  expect(runtimeErrors).toEqual([])
})

// 入场动效必须真跑在运行时首页上，而且只播一次：W1 默认 reduced-motion，这里显式放开。
// 判据是「放完之后 .qx-home 里一条 CSS 动画都不剩」——任何循环的假忙碌都会让它转红。
test('home plays a one-shot entrance and light sweep, then settles with honest status colors @w1-kiosk', async ({ page, api }) => {
  const runtimeErrors = collectRuntimeErrors(page)
  registerHomeApi(api)
  api.abort('GET', '/api/v1/jobs', 'internetdisconnected')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const home = page.getByTestId('qx-home')
  await expect(home).toBeVisible()
  const intro = await homeAnimations(page)
  // 证据图：其余入场直接放完，流光定格在扫到一半，截图后放行（不改变后续判据）。
  await home.evaluate((root) => root.getAnimations({ subtree: true }).forEach((a) => ((a as CSSAnimation).animationName === 'qx-home-sheen' ? (a.pause(), (a.currentTime = 1350)) : a.finish())))
  await page.screenshot({ path: test.info().outputPath('home-intro-sheen-1080x1920.png') })
  await home.evaluate((root) => root.getAnimations({ subtree: true }).forEach((a) => a.play()))
  expect(intro.every((animation) => animation.iterations === 1), JSON.stringify(intro)).toBe(true)
  expect([...new Set(intro.map((animation) => animation.name))].sort()).toEqual(['qx-home-rise', 'qx-home-settle', 'qx-home-sheen'])
  expect(intro.filter((animation) => animation.name === 'qx-home-sheen').map((animation) => animation.target)).toEqual(['qx-home-voice::after'])
  // 小青头像、AI 图标、状态徽标本身都不单独做动效：不演「在听」「成功」。
  expect(intro.map((animation) => animation.target).filter((target) => /avatar|voice-icon|badge|status/.test(target))).toEqual([])

  await expect(home).toHaveAttribute('data-qx-intro', 'done')
  await expect.poll(() => homeAnimations(page)).toEqual([])
  await page.screenshot({ path: test.info().outputPath('home-intro-settled-1080x1920.png') })

  // 打印机状态未知时，主卡眉题不能是「一切正常」的翠绿。
  const printTile = home.locator('[data-action="print-hub"]')
  await expect(printTile).toHaveAttribute('data-panel-state', 'unknown')
  expect(await printTile.locator('.qx-home-tile-badge').evaluate((el) => getComputedStyle(el).color)).not.toBe('rgb(46, 230, 168)')

  // 键盘焦点：磁贴有描边并上浮；深色 hero 上的描边改用纸色，才看得见。
  await printTile.focus()
  await page.keyboard.press('Tab')
  const resumeTile = home.locator('[data-action="resume-hub"]')
  await expect(resumeTile).toBeFocused()
  // 青序 teal 描边，而不是全局 service-desk 主题那圈 42% 透明度的淡蓝（此前它一直压着首页自己的焦点样式）。
  expect(await resumeTile.evaluate((el) => [el.matches(':focus-visible'), getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineWidth, getComputedStyle(el).outlineColor])).toEqual([true, 'solid', '3px', 'rgb(31, 158, 134)'])
  await expect.poll(() => resumeTile.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeLessThan(-2)
  await printTile.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByTestId('home-identity')).toBeFocused()
  expect(await page.getByTestId('home-identity').evaluate((el) => getComputedStyle(el).outlineColor)).toBe('rgb(245, 242, 233)')

  // 岗位读取失败 → 重试会让磁贴重挂载；入场已放完，重挂载的磁贴不许再闪一遍。
  // 先给旧节点打标，等它被卸载——证明确实重挂载过，再断言；否则会在 React 重渲染前就判「没动画」（空转）。
  const jobsRetry = home.locator('[data-action="jobs-retry"]')
  await jobsRetry.evaluate((el) => el.setAttribute('data-before-retry', ''))
  await jobsRetry.click()
  await expect(home.locator('[data-before-retry]')).toHaveCount(0)
  await expect(jobsRetry).toBeVisible()
  expect(api.requestCount('GET', '/api/v1/jobs')).toBe(2)
  expect(await homeAnimations(page)).toEqual([])
  expect(runtimeErrors).toEqual([])
})

test('home is fully static under reduced motion yet keeps focus feedback @w1-kiosk', async ({ page, api }) => {
  registerHomeApi(api)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const home = page.getByTestId('qx-home')
  await expect(home).toBeVisible()
  expect(await homeAnimations(page)).toEqual([])
  const primary = page.getByTestId('home-primary')
  expect(await primary.evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe('none')
  await home.locator('[data-action="print-hub"]').focus()
  await page.keyboard.press('Tab')
  const resumeTile = home.locator('[data-action="resume-hub"]')
  await expect(resumeTile).toBeFocused()
  expect(await resumeTile.evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).transform])).toEqual(['solid', 'none'])
})

test('home entrance stays inside the narrow layout and settles fully @w1-mobile', async ({ page, api }) => {
  registerHomeApi(api)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const home = page.getByTestId('qx-home')
  await expect(home).toBeVisible()
  expect((await homeAnimations(page)).length).toBeGreaterThan(0)
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: test.info().outputPath('home-intro-midway-390x844.png') })
  await expect(home).toHaveAttribute('data-qx-intro', 'done')
  await expect.poll(() => homeAnimations(page)).toEqual([])
  await assertNoHorizontalOverflow(page)
  await expectTouchFloor(home.locator('button:visible, a:visible'), 48)
  await page.screenshot({ path: test.info().outputPath('home-intro-settled-390x844.png'), fullPage: true })
})
