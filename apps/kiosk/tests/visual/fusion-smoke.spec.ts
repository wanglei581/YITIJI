import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { RECRUITMENT_HOSTING_OFF } from '../fixtures/recruitment-hosting'
import { assertNoHorizontalOverflow } from './assert-layout'
import { productionRoutePatterns } from './route-manifest'

const kioskScenarios = [
  // 2026-09-25 迁入稿 09-system-state：进页默认是「还没检测」，页面标题换成稿的八项状态区块标题。
  { path: '/error-offline', landmark: '这台机器的八项状态', registerHealthProbe: true },
] as const

const mobileScenarios = [
  { path: '/member/qr-login', landmark: '这个链接不能用来登录' },
  { path: '/upload/phone', landmark: '这个链接不能用来上传' },
] as const

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (request.resourceType() === 'document') {
      errors.push(`document request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
    }
  })
  return errors
}

function registerHomeShellApi(api: ApiRouter) {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: {
        enabled: false,
        modules: { welcome: false, bigdata: false, luggage: false, panorama: false },
        items: [],
      },
      toolbox: { enabled: false, items: [] },
      // 按我们云上的默认（招聘内容托管关闭，3.13）：首页底栏说的是「本终端未开放岗位与招聘会信息，也不代收简历」。
      ...RECRUITMENT_HOSTING_OFF,
      configVersion: 'filing-smoke-fixture',
      refreshIntervalMs: 300000,
      serverTime: '2026-07-28T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  // 包 K2：上传/预览页挂载时探测文档转换能力；基线按未配置处理（Word 入口置灰，不打断页面）。
  api.respond('GET', '/api/v1/document-conversion/capabilities', {
    status: 200,
    json: { data: { wordToPdf: false, engine: 'none', cjkFonts: false, reason: 'Word 转 PDF 暂未开通，请另存为 PDF 上传。' } },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/smart-campus', {
    status: 200,
    json: {
      enabled: false,
      modules: { welcome: false, bigdata: false, luggage: false, panorama: false },
      items: [],
    },
  })
  // V6 首页会真实请求招聘会列表；给精确的 200 空列表，让首页呈现诚实 empty 态。
  // 其余未注册 API 仍由 ApiRouter fail-closed。
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
  })
}

function registerPrivacyRuntimeApi(api: ApiRouter) {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  // 包 K2：上传/预览页挂载时探测文档转换能力；基线按未配置处理（Word 入口置灰，不打断页面）。
  api.respond('GET', '/api/v1/document-conversion/capabilities', {
    status: 200,
    json: { data: { wordToPdf: false, engine: 'none', cjkFonts: false, reason: 'Word 转 PDF 暂未开通，请另存为 PDF 上传。' } },
  })
}

async function assertHelpCenterFilingInfo(page: Page) {
  const filingInfo = page.locator('[aria-label="网站备案信息"]')
  await expect(filingInfo).toBeVisible()
  await expect(filingInfo.getByRole('link', { name: '鲁ICP备2026023517号-2' })).toHaveAttribute(
    'href',
    'https://beian.miit.gov.cn/',
  )
  await expect(filingInfo.getByRole('link', { name: '鲁公网安备37021402007308号' })).toHaveAttribute(
    'href',
    'https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308',
  )
  await expect(filingInfo).toContainText('职易达AI')
}

const HELP_SMS_ANSWER = '先核对手机号有没有输错。验证码 6 位、5 分钟内有效，60 秒后可以重新获取；也看看手机有没有把短信拦进了骚扰短信。还是收不到，可以先不登录继续用——打印、扫描、复印、机构官方渠道和政策查询都不需要账号；也可以改用扫码登录，在手机上确认。'
const HELP_JAM_ANSWER = '别自己打开机器，也别拽纸——撕在里面更难取，也可能弄坏机器。先把出纸口里已经出来的纸取走收好，记下屏幕上的订单号。用到机码打印、屏上提示可以接着打的，回到这台机器再输一次同一个到机码就能接着打，每单最多 2 次。需要帮助请看本页「遇到问题怎么办」里的服务电话。'
const HELP_NO_PAPER_ANSWER = '先看屏幕上这一单的状态：还在打印的，请在出纸口旁等一会儿。屏上写「打印结果未确认」时，照屏上的提示办：用到机码打印的，过 5 分钟回这台机器再输一次同一个到机码；在这台机器上打的 0 元单，可以回到打印重新选文件再打一次。登录过的，可以在「我的 → 打印订单」按订单号查。付过钱的单子先别重新下单，照屏上提示办，或打服务电话问。需要帮助请看本页「遇到问题怎么办」里的服务电话。'
const HELP_USB_ANSWER = '这台机器开通了 U 盘导入的，U 盘插在机器右侧的 USB 口。屏上只列最外层和下一层文件夹里能打印的文件（PDF、JPG、PNG，单份不超过 15MB）。读不出来先点「重新读一次 U 盘」，或换个 U 盘再读一次；还不行就改用手机扫码上传。'

async function expectSentenceFullyVisible(locator: Locator) {
  await locator.scrollIntoViewIfNeeded()
  const fit = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    let top = 0
    let bottom = window.innerHeight
    let left = 0
    let right = window.innerWidth
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node)
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip' || style.overflowY === 'auto' || style.overflowY === 'scroll'
      const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip' || style.overflowX === 'auto' || style.overflowX === 'scroll'
      if (!clipsY && !clipsX) continue
      const box = node.getBoundingClientRect()
      if (clipsY) {
        top = Math.max(top, box.top)
        bottom = Math.min(bottom, box.bottom)
      }
      if (clipsX) {
        left = Math.max(left, box.left)
        right = Math.min(right, box.right)
      }
    }
    // 底栏不是祖先，压在上面时祖先裁剪框量不出来：另按底栏顶边收一次。
    const bar = document.querySelector('.qx-ctabar')?.getBoundingClientRect()
    if (bar) bottom = Math.min(bottom, bar.top)
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      clipTop: top,
      clipBottom: bottom,
      inside: rect.top >= top - 1 && rect.bottom <= bottom + 1 && rect.left >= left - 1 && rect.right <= right + 1,
    }
  })
  expect(fit.inside, `整句要落在可见区域内 ${JSON.stringify(fit)}`).toBe(true)
}

async function scrollHelpToEnd(page: Page) {
  await page.evaluate(() => {
    for (const node of [document.querySelector('.k1-help-scroll'), document.querySelector('.qx-stage'), document.scrollingElement]) {
      if (node && node.scrollHeight > node.clientHeight + 1) node.scrollTop = node.scrollHeight
    }
  })
}

test('orphan /session-timeout fails closed to a clean home @kiosk', async ({ page, api }) => {
  expect(productionRoutePatterns).toContain('/session-timeout')
  registerHomeShellApi(api)
  const runtimeErrors = collectRuntimeErrors(page)

  await page.goto('/session-timeout', { waitUntil: 'domcontentloaded' })

  await expect(page).toHaveURL(/\/$/)
  const homeMain = page.locator('main').first()
  await expect(homeMain).toBeVisible()
  // 断言意图是「已落到干净首页」，不是锁定某句营销文案。V6 首页不再有
  // 「简历、岗位、打印」，改用首页底部的合规声明作锚点：它是 CLAUDE.md §2/§10
  // 强制要求必须出现的文本，稳定且不会随视觉改版消失，断言它同时守住合规底线。
  // 3.13 起这句随招聘内容托管变：本夹具是托管关闭（我们云上的默认），打开时那句由 qingxu-home / fusion-w1 钉。
  await expect(
    page.getByText('本终端未开放岗位与招聘会信息，也不代收简历', { exact: false }).first()
  ).toBeVisible()
  await expect(page.locator('[data-kiosk-screen="session-timeout"]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /还在用吗/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /我还在，继续使用/ })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '结束并清除这台机器上的这次使用记录', exact: true })
  ).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('login gate can leave without logging in @kiosk', async ({ page, api }) => {
  expect(productionRoutePatterns).toContain('/login')
  registerHomeShellApi(api)
  const runtimeErrors = collectRuntimeErrors(page)
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  // 稿 03：顶栏留返回键（规则 1），底部「上一步」一排也能回首页 —— 两处都在。
  await expect(page.getByRole('button', { name: '返回首页' })).toHaveCount(2)
  await expect(page.locator('.qx-topbar').getByRole('button', { name: '返回首页' })).toBeVisible()
  await expect(page.getByRole('button', { name: '不登录，继续使用' })).toBeVisible()
  await expect(page.getByText('已登录', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '不登录，继续使用' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(runtimeErrors).toEqual([])
})

test('session resume without login goes to login gate @kiosk', async ({ page, api }) => {
  expect(productionRoutePatterns).toContain('/session-resume')
  registerHomeShellApi(api)
  await page.goto('/session-resume', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: '返回首页' })).toHaveCount(2)
  await expect(page.locator('.qx-topbar').getByRole('button', { name: '返回首页' })).toBeVisible()
})

for (const projectTag of ['@kiosk', '@mobile'] as const) {
  test(`help center renders filing information ${projectTag}`, async ({ page, api }) => {
    registerHomeShellApi(api)
    const runtimeErrors = collectRuntimeErrors(page)

    await page.goto('/help', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
    await expect(page.locator('.ui-kiosk-topbar')).toHaveCount(0)
    const categories = page.getByRole('group', { name: '按分类筛选常见问题' })
    // 2026-10-13 回话单第 25 条：登录与账号加了「收不到短信验证码怎么办？」，分类卡从 3 问改为 4 问。
    // 打印与扫描在「怎么打印文件？」后加了卡纸、没出纸、U 盘三条，从 2 问改为 5 问。
    await expect(categories.getByRole('button', { name: /登录与账号.*4 问/ })).toBeVisible()
    await expect(categories.getByRole('button', { name: /要不要登录、收不到验证码、为什么变回游客、怎么换账号/ })).toBeVisible()
    await expect(categories.getByRole('button', { name: /打印与扫描.*5 问/ })).toBeVisible()
    await expect(categories.getByRole('button', { name: /怎么打印、卡纸和没出纸、U 盘读不出、扫描件保存在哪/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /一定要登录才能使用吗/ })).toHaveCount(0)
    // 概要变长后分类卡各多一行，首页第一屏放不下「需要帮助」卡最后一句；滑到底两张求助卡要整张露在底栏之上。
    await scrollHelpToEnd(page)
    const deskCards = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.k1-help-people .k1-help-contact')]
      const bar = document.querySelector('.qx-ctabar')
      if (cards.length !== 2 || !bar) return null
      const barTop = bar.getBoundingClientRect().top
      return cards.map((card) => card.getBoundingClientRect().bottom <= barTop + 0.5)
    })
    expect(deskCards, '首页滑到底，「需要帮助」「网络断开」两张卡整张露在底栏之上').toEqual([true, true])
    await categories.getByRole('button', { name: /打印与扫描.*5 问/ }).click()
    await expect(page.locator('.k1-help-question strong')).toHaveText([
      '怎么打印文件？',
      '打印时卡纸了怎么办？',
      '确认打印以后没出纸怎么办？',
      'U 盘插上了读不出来怎么办？',
      '扫描的文件保存在哪里？',
    ])
    for (const answer of [HELP_JAM_ANSWER, HELP_NO_PAPER_ANSWER, HELP_USB_ANSWER]) {
      const paragraph = page.locator('.k1-help-answer p', { hasText: answer })
      await expect(paragraph).toHaveText(answer)
      await expectSentenceFullyVisible(paragraph)
    }
    await scrollHelpToEnd(page)
    const edges = await page.evaluate(() => {
      const last = document.querySelector('.k1-help-faq-list')?.lastElementChild
      const miss = document.querySelector('.k1-help-miss')
      const bar = document.querySelector('.qx-ctabar')
      if (!last || !miss || !bar) return null
      return {
        lastBottom: last.getBoundingClientRect().bottom,
        missBottom: miss.getBoundingClientRect().bottom,
        barTop: bar.getBoundingClientRect().top,
      }
    })
    expect(edges, '最后一条问答和「这里没答上你的问题」要能量到底边').not.toBeNull()
    expect(edges!.lastBottom).toBeLessThan(edges!.barTop)
    expect(edges!.missBottom).toBeLessThan(edges!.barTop)
    await assertNoHorizontalOverflow(page)
    await page.getByRole('button', { name: '返回分类', exact: true }).click()
    await page.getByRole('group', { name: '按分类筛选常见问题' }).getByRole('button', { name: /登录与账号.*4 问/ }).click()
    const smsQuestion = page.locator('.k1-help-question strong', { hasText: '收不到短信验证码怎么办？' })
    await expect(smsQuestion).toHaveText('收不到短信验证码怎么办？')
    await expectSentenceFullyVisible(smsQuestion)
    const smsAnswer = page.locator('.k1-help-answer p', { hasText: HELP_SMS_ANSWER })
    await expect(smsAnswer).toHaveText(HELP_SMS_ANSWER)
    await expectSentenceFullyVisible(smsAnswer)
    const question = page.getByRole('button', { name: /一定要登录才能使用吗/ })
    await expect(question).toBeVisible()
    await question.click()
    await expect(question).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText('不需要。大部分服务可以游客身份直接使用。', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: '去登录' })).toBeVisible()
    await assertHelpCenterFilingInfo(page)
    await assertNoHorizontalOverflow(page)
    expect(runtimeErrors).toEqual([])
  })
}

for (const scenario of kioskScenarios) {
  test(`${scenario.path} renders the fusion state @kiosk`, async ({ page, api }) => {
    expect(productionRoutePatterns).toContain(scenario.path)
    registerPrivacyRuntimeApi(api)
    const runtimeErrors = collectRuntimeErrors(page)

    if ('registerHealthProbe' in scenario && scenario.registerHealthProbe) {
      api.respond('GET', '/api/v1/health', {
        status: 503,
        json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'offline' } },
      })
    }

    await page.goto(scenario.path, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('main')).toBeVisible()
    await expect(page.getByText(scenario.landmark, { exact: false }).first()).toBeVisible()
    await assertNoHorizontalOverflow(page)
    expect(runtimeErrors).toEqual([])
  })
}

for (const scenario of mobileScenarios) {
  test(`${scenario.path} renders the fusion state @mobile`, async ({ page, api }) => {
    void api
    expect(productionRoutePatterns).toContain(scenario.path)
    const runtimeErrors = collectRuntimeErrors(page)

    await page.goto(scenario.path, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('main')).toBeVisible()
    await expect(page.getByText(scenario.landmark, { exact: false }).first()).toBeVisible()
    await assertNoHorizontalOverflow(page)
    expect(runtimeErrors).toEqual([])
  })
}
