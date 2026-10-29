/**
 * 首页「继续办理」没有东西可摆时，版面照样填满（一体机触屏版第二包；总指挥 10/29：
 * 已登录、没有可继续的事项时，首页底部有约 160px 空带）。
 *
 * 原因：`.qxt-home-on` 按「已登录」把四张大卡压低（300px，压紧版 228px），那是给「继续办理」那一条让位的；
 * 稿里「已登录」一态永远画着那一条。运行页读到没有可继续的办理、或交接保护把它收起时，让出来的高度没人补，
 * 底部导航上面空出 130–160px。
 *
 * 正式构建 1080×1920，量「最后一块内容的底边到底部导航顶边」的距离，首页五种配置（第三行磁贴 2 / 3 / 4 / 5 / 6 块，
 * ≥ 4 块进压紧版式）：
 *   · 已登录、名下没有可继续的办理：留白 ≤ 105px，且内容不压到导航、不溢出；
 *   · 带面板的人，空档过 30 秒面板收起之后：同上；收起前（带面板）也在 0–105px 内，是对照；
 *   · 未登录态（默认配置）仍在 0–105px 内，也是对照：不为了填满这一态把别的态弄乱。
 *
 * 用 playwright.privacy-clear.config.ts 跑。
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { allowLocalBootTicket, loginThroughVisibleUi } from './fixtures/privacy-clear-shell'
import { configureHomeVariant, MEI, routeMembers, WANG, type HomeVariant } from './fixtures/home-members'

/** 一屏里最长留白的项目门槛（和样式验收的空带扫描同一个数）。 */
const MAX_BLANK_PX = 105
const VARIANTS: HomeVariant[] = ['default', 'channels', 'hosting', 'gov', 'full']

/** 最后一块内容的底边到底部导航顶边的距离（按 1080 宽的版心折算），以及内容区有没有溢出。 */
async function bottomGap(page: Page): Promise<{ gap: number; overflow: number }> {
  await expect(page.locator('[data-qx-page="home"]')).toHaveAttribute('data-qx-intro', 'done')
  return page.evaluate(() => {
    const body = document.querySelector('.qxt-body.qxt-home') as HTMLElement
    const nav = document.querySelector('.qxt-nav') as HTMLElement
    const stage = document.querySelector('.kiosk-stage') as HTMLElement | null
    const scale = stage ? stage.getBoundingClientRect().width / 1080 || 1 : 1
    const shown = [...body.children].filter((el) => getComputedStyle(el).display !== 'none') as HTMLElement[]
    const lastBottom = Math.max(...shown.map((el) => el.getBoundingClientRect().bottom))
    return { gap: (nav.getBoundingClientRect().top - lastBottom) / scale, overflow: body.scrollHeight - body.clientHeight }
  })
}

async function expectFilled(page: Page, label: string): Promise<void> {
  const { gap, overflow } = await bottomGap(page)
  expect(overflow, `${label}：内容不得溢出屏幕`).toBe(0)
  expect(gap, `${label}：最后一块内容不得压到底部导航（留白 ${gap.toFixed(1)}px）`).toBeGreaterThanOrEqual(0)
  expect(gap, `${label}：底部留白 ${gap.toFixed(1)}px，不得超过 ${MAX_BLANK_PX}px`).toBeLessThanOrEqual(MAX_BLANK_PX)
}

async function prepare(page: Page, api: Parameters<typeof routeMembers>[1], variant: HomeVariant): Promise<void> {
  await page.clock.install()
  await routeMembers(page, api)
  configureHomeVariant(api, variant)
  await allowLocalBootTicket(page)
}

for (const variant of VARIANTS) {
  test(`home page stays filled for a signed-in person with nothing to continue (${variant}) @home-fill`, async ({ page, api }) => {
    await prepare(page, api, variant)
    await loginThroughVisibleUi(page, '/', MEI.phone)
    await expect(page.getByTestId('home-identity')).toHaveText('有人登录着')
    await expect(page.locator('section.continue')).toHaveCount(0)
    await expectFilled(page, `已登录、没有可继续的办理（${variant}）`)
  })

  test(`home page stays filled before and after the continue block collapses (${variant}) @home-fill`, async ({ page, api }) => {
    await prepare(page, api, variant)
    await loginThroughVisibleUi(page, '/', WANG.phone)
    await expect(page.locator('section.continue')).toBeVisible()
    await expectFilled(page, `带「继续办理」面板（${variant}）`)

    await page.clock.runFor(31_000)
    await expect(page.locator('section.continue')).toHaveCount(0)
    await expectFilled(page, `面板收起之后（${variant}）`)
  })
}

test('signed-out home stays within the blank limit (default) @home-fill', async ({ page, api }) => {
  await prepare(page, api, 'default')
  await page.goto('/')
  await expect(page.getByRole('button', { name: '登录后查看本人记录' })).toBeVisible()
  await expectFilled(page, '未登录（default）')
})
