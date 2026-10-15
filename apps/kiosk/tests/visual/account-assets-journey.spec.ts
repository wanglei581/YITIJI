// 上线前清单 4.1「账号与资产」里，mock 层能验的三条。
//
// 真短信登录、QR 扫码、真机空闲清场不在本文件。忙碌锁也没有 window 钩子，
// 对应用例如实 test.skip，不写恒真断言。
//
// 写法对齐 human-journey.spec.ts：step() 自动截图、每条旅程独立 context、
// 可点区 ≥48px。游客资产页断言的是客户端 fail-closed（0 条 /api/v1/），不是 401。
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'

const SHOTS = process.env.JOURNEY_SHOTS_DIR ?? 'test-results/account-assets-journey'

const GUEST_ASSET_ROUTES = [
  { path: '/me/resumes', title: '我的简历' },
  { path: '/me/documents', title: '我的文档' },
  { path: '/me/print-orders', title: '打印订单' },
  { path: '/me/ai-records', title: 'AI服务记录' },
  { path: '/me/favorites', title: '我的收藏' },
  { path: '/me/activity', title: '浏览与跳转记录' },
] as const

type Step = { n: number }

/** 截一步，并把该屏所有可见控件（文本 + 高度 + 是否禁用）打出来当证据。 */
async function step(page: Page, s: Step, label: string): Promise<void> {
  s.n += 1
  const tag = `${String(s.n).padStart(2, '0')}-${label}`
  await page.screenshot({ path: `${SHOTS}/${tag}.png` })
  const ctrls = await page
    .locator('button:visible, a[href]:visible, [role="button"]:visible')
    .evaluateAll((els) =>
      els
        .map((e) => {
          const r = e.getBoundingClientRect()
          return {
            t: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 20),
            h: Math.round(r.height),
            dis: (e as HTMLButtonElement).disabled === true,
          }
        })
        .filter((x) => x.h > 0),
    )
  const small = ctrls.filter((c) => c.h < 48)
  console.log(
    `\n  [${tag}] ${page.url().replace(/^https?:\/\/[^/]+/, '')}` +
      `\n    控件 ${ctrls.length} 个（禁用 ${ctrls.filter((c) => c.dis).length}）：` +
      ctrls.map((c) => `${c.t}(${c.h}${c.dis ? '·禁' : ''})`).join(' ') +
      (small.length ? `\n    ⚠ <48px：${small.map((c) => `${c.t}(${c.h})`).join(' ')}` : ''),
  )
  // 一体机硬约束：可点区不小于 48px（CLAUDE.md §9）
  expect(small, `${tag} 有低于 48px 的可点控件`).toEqual([])
}

function shotLabel(path: string, prefix: string): string {
  const slug = path === '/' ? 'home' : path.slice(1).replaceAll('/', '-')
  return `${prefix}-${slug}`
}

async function openIsolatedGuestPage(browser: Browser): Promise<{
  context: BrowserContext
  page: Page
  apiHits: string[]
}> {
  const viewport = test.info().project.use.viewport ?? { width: 1080, height: 1920 }
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL ?? 'http://127.0.0.1:4177',
    viewport,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const apiHits: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (!url.includes('/api/v1/')) return
    apiHits.push(`${request.method()} ${new URL(url).pathname}`)
  })
  return { context, page, apiHits }
}

test.describe('账号与资产走查（模拟数据）', () => {
  test('未登录游客不展示跨会话资产 @kiosk', async ({ browser }) => {
    test.setTimeout(180_000)
    const s: Step = { n: 0 }

    for (const route of GUEST_ASSET_ROUTES) {
      const { context, page, apiHits } = await openIsolatedGuestPage(browser)
      try {
        await page.goto(route.path)
        await expect(
          page.getByRole('heading', { name: route.title }),
          `${route.path} 未落到资产页`,
        ).toBeVisible({ timeout: 15_000 })
        await expect(
          page.getByRole('heading', { name: '登录后查看本人记录' }),
          `${route.path} 未出现登录门`,
        ).toBeVisible()
        await expect(page.getByRole('button', { name: '手机号登录' })).toBeVisible()
        // 给壳层/页内延迟请求一个窗口，避免「门先出来、请求后发」漏计。
        await page.waitForTimeout(1500)
        await step(page, s, shotLabel(route.path, 'guest'))
        expect(
          apiHits,
          `${route.path} 未登录仍发出了 /api/v1/ 请求（应为 0 条。0 条是客户端 fail-closed，401 是服务端过滤）：${apiHits.join(' ')}`,
        ).toEqual([])
        console.log(`\n  ${route.path} 登录门可见；/api/v1/ 请求数=${apiHits.length}`)
      } finally {
        await context.close()
      }
    }
  })

  test('忙碌态不误触发退出 @kiosk', async () => {
    test.skip(
      true,
      [
        'mock 层做不到这条。KioskBusyContext 只暴露 React 钩子 lock() / useBusyLock(active)，',
        '没有 window 可注入的忙碌开关，Playwright 无法凭空持有引用计数锁。',
        'useIdleLogout 的 enabled 是 !busy && …，空闲阈值由构建期 VITE_KIOSK_LOGOUT_IDLE_SEC 烘焙，',
        '本 spec 跑在 playwright.config.ts 的 kiosk-1080x1920 下，默认 180s，mock 无法把阈值压到可观察窗口。',
        '忙碌态豁免的真实覆盖在 kiosk-session-warning.spec.ts（playwright.privacy-warning.config.ts，idle=4s）',
        '「an active print job is never interrupted by the ordinary idle countdown」。',
      ].join(''),
    )
  })

  test('资产区不展示假数量 @kiosk', async ({ browser }) => {
    test.setTimeout(180_000)
    const s: Step = { n: 0 }
    const fakeCount = /0\s*(份|条)/
    const pages = [{ path: '/profile', title: '我的' }, ...GUEST_ASSET_ROUTES]

    for (const route of pages) {
      const { context, page } = await openIsolatedGuestPage(browser)
      try {
        await page.goto(route.path)
        await expect(
          page.getByText('登录后查看本人记录').first(),
          `${route.path} 未出现未登录引导`,
        ).toBeVisible({ timeout: 15_000 })
        await page.waitForTimeout(800)
        await step(page, s, shotLabel(route.path, 'counts'))

        const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
        expect(
          body,
          `${route.path} 未登录却写出了具体数量（系统此时不知道数量，写 0 份 / 0 条就是伪造）`,
        ).not.toMatch(fakeCount)
        console.log(`\n  ${route.path} 未见 0 份 / 0 条`)
      } finally {
        await context.close()
      }
    }
  })
})
