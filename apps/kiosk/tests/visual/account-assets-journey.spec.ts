// 账号资产页未登录走查：直达 /me/resumes、/me/documents，必须停在登录门，且不得打 /api/v1/。
//
// 与既有 spec 的区别：本文件**每个路由独立 browser.newContext()**。共用 page 连跑
// 多路由时，一体机的清场/待机控制器会吞掉后续导航，产出「页面空白」的假结论
// （见 human-journey.spec.ts）。未登录断言的是客户端 fail-closed（0 条 /api/v1/），
// 不是服务端 401。
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'

const SHOTS = process.env.JOURNEY_SHOTS_DIR ?? 'test-results/account-assets-journey'
// 登录门的标题现在**逐页各说各的**——门上直接写清挡住的是什么，比一句通用文案强，
// 所以这里也逐页给期望值，而不是拿一句去套所有页（那样迁移一页就红一次，
// 且红的是「文案变了」不是「登录门没了」）。
const ASSET_ROUTES = [
  { path: '/me/resumes', gate: '登录后查看我的简历' },
  { path: '/me/documents', gate: '登录后查看本人记录' },
] as const

type Step = { n: number }

/** 截一步，并把该屏所有可见控件（文本 + 高度 + 是否禁用）打出来当证据。 */
async function step(page: Page, s: Step, label: string): Promise<void> {
  s.n += 1
  const tag = `${String(s.n).padStart(2, '00')}-${label}`
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
  expect(small, `${tag} 有低于 48px 的可点控件`).toEqual([])
}

test.describe('账号资产页（未登录）', () => {
  test('未登录依次访问 /me/resumes 与 /me/documents：登录门且零 /api/v1/ 请求 @kiosk', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const s: Step = { n: 0 }

    for (const { path, gate } of ASSET_ROUTES) {
      const context = await browser.newContext({
        viewport: { width: 1080, height: 1920 },
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        baseURL: 'http://127.0.0.1:4177',
      })
      const page = await context.newPage()
      const apiHits: string[] = []
      page.on('request', (request) => {
        const url = request.url()
        if (url.includes('/api/v1/')) {
          apiHits.push(`${request.method()} ${new URL(url).pathname}`)
        }
      })

      try {
        await page.goto(path)
        await expect(
          page.getByRole('heading', { name: gate }),
          `${path} 未出现登录门（期望标题「${gate}」）`,
        ).toBeVisible({ timeout: 15_000 })
        await expect(page.getByRole('button', { name: '手机号登录' })).toBeVisible()
        await step(page, s, path.slice(1).replaceAll('/', '-'))
        // 给壳层/页内延迟请求一个窗口，避免「门先出来、请求后发」漏计。
        await page.waitForTimeout(1500)
        expect(apiHits, `${path} 未登录仍发出了 /api/v1/ 请求：${apiHits.join(' ')}`).toEqual([])
        console.log(`\n  ${path} 登录门可见；/api/v1/ 请求数=${apiHits.length}`)
      } finally {
        await page.close()
        await context.close()
      }
    }
  })
})
