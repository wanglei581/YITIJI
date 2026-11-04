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
 *   · 已登录、名下没有可继续的办理：留白 ≤ 105px，且内容不压到导航、不溢出；照同屏未登录态排——大卡不比未登录态（340px）
 *     更高，磁贴少的配置段间距回到 16px；
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

/** 一体机设计稿里的版心宽度；页面缩放时按它折算。 */
const DESIGN_WIDTH = 1080
/** 未登录态一张大卡的高度：没有「继续办理」时，大卡可以长高来填屏，但不比它更高。 */
const SIGNED_OUT_CARD_PX = 340
/** 带「继续办理」面板时一张大卡的高度（不压紧版式）：大卡给面板让了位，这一态的版面不动。 */
const WITH_PANEL_CARD_PX = 300
/** 未登录态段与段之间的间隔（≥761px 宽）。 */
const SIGNED_OUT_SECTION_GAP_PX = 16
/** 压紧版式（第三行磁贴 ≥ 4 块）段与段之间的间隔，本来就是 12px。 */
const COMPACT_SECTION_GAP_PX = 12

interface HomeLayout {
  /** 最后一块内容的底边到底部导航顶边的距离。 */
  gap: number
  /** 内容区有没有溢出。 */
  overflow: number
  /** 第一张大卡的高度。 */
  cardHeight: number
  /** 内容区各段之间的间隔。 */
  sectionGap: number
}

/** 首页版面读数（都按 1080 宽的版心折算）。 */
async function readLayout(page: Page): Promise<HomeLayout> {
  await expect(page.locator('[data-qx-page="home"]')).toHaveAttribute('data-qx-intro', 'done')
  return page.evaluate((designWidth) => {
    const body = document.querySelector('.qxt-body.qxt-home') as HTMLElement
    const nav = document.querySelector('.qxt-nav') as HTMLElement
    const card = document.querySelector('.qxt-home-tasks .qxt-task') as HTMLElement
    const stage = document.querySelector('.kiosk-stage') as HTMLElement | null
    const scale = stage ? stage.getBoundingClientRect().width / designWidth || 1 : 1
    const shown = [...body.children].filter((el) => getComputedStyle(el).display !== 'none') as HTMLElement[]
    const lastBottom = Math.max(...shown.map((el) => el.getBoundingClientRect().bottom))
    return {
      gap: (nav.getBoundingClientRect().top - lastBottom) / scale,
      overflow: body.scrollHeight - body.clientHeight,
      cardHeight: card.getBoundingClientRect().height / scale,
      sectionGap: parseFloat(getComputedStyle(body).rowGap) / scale,
    }
  }, DESIGN_WIDTH)
}

/** 留白在门槛内、内容不压到导航也不溢出。 */
async function expectFilled(page: Page, label: string): Promise<HomeLayout> {
  const layout = await readLayout(page)
  expect(layout.overflow, `${label}：内容不得溢出屏幕`).toBe(0)
  expect(layout.gap, `${label}：最后一块内容不得压到底部导航（留白 ${layout.gap.toFixed(1)}px）`).toBeGreaterThanOrEqual(0)
  expect(layout.gap, `${label}：底部留白 ${layout.gap.toFixed(1)}px，不得超过 ${MAX_BLANK_PX}px`).toBeLessThanOrEqual(MAX_BLANK_PX)
  return layout
}

/**
 * 没有「继续办理」可摆的已登录态：填满之外，照同屏未登录态排——大卡不比未登录态高；
 * 磁贴少（不进压紧版式）的配置，段间距也和未登录态一样（压紧版式本来就是 12px，不动）。
 */
async function expectFilledLikeSignedOut(page: Page, label: string, variant: HomeVariant): Promise<HomeLayout> {
  const layout = await expectFilled(page, label)
  expect(layout.cardHeight, `${label}：大卡 ${layout.cardHeight.toFixed(1)}px，不得比未登录态（${SIGNED_OUT_CARD_PX}px）更高`).toBeLessThanOrEqual(SIGNED_OUT_CARD_PX + 0.5)
  if (variant === 'default' || variant === 'channels') {
    expect(layout.sectionGap, `${label}：段间距要回到未登录态的 ${SIGNED_OUT_SECTION_GAP_PX}px`).toBeCloseTo(SIGNED_OUT_SECTION_GAP_PX, 0)
  } else {
    expect(layout.sectionGap, `${label}：压紧版式的段间距不动，仍是 ${COMPACT_SECTION_GAP_PX}px`).toBeCloseTo(COMPACT_SECTION_GAP_PX, 0)
  }
  return layout
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
    await expect(page.getByTestId('home-identity')).toHaveText('你已登录')
    await expect(page.locator('section.continue')).toHaveCount(0)
    await expectFilledLikeSignedOut(page, `已登录、没有可继续的办理（${variant}）`, variant)
  })

  test(`home page stays filled before and after the continue block collapses (${variant}) @home-fill`, async ({ page, api }) => {
    await prepare(page, api, variant)
    await loginThroughVisibleUi(page, '/', WANG.phone)
    await expect(page.locator('section.continue')).toBeVisible()
    const withPanel = await expectFilled(page, `带「继续办理」面板（${variant}）`)
    if (variant === 'default' || variant === 'channels') {
      expect(withPanel.cardHeight, `带面板时大卡仍给面板让位，不超过 ${WITH_PANEL_CARD_PX}px（${variant}）`).toBeLessThanOrEqual(WITH_PANEL_CARD_PX + 0.5)
    }

    await page.clock.runFor(31_000)
    await expect(page.locator('section.continue')).toHaveCount(0)
    const collapsed = await expectFilledLikeSignedOut(page, `面板收起之后（${variant}）`, variant)
    // 大卡是给面板让位才矮的：面板没了，大卡把让出来的高度拿回去。
    expect(collapsed.cardHeight, `面板收起之后大卡应比带面板时高（${withPanel.cardHeight.toFixed(1)} → ${collapsed.cardHeight.toFixed(1)}px）`).toBeGreaterThan(withPanel.cardHeight + 30)
  })
}

test('signed-out home stays within the blank limit (default) @home-fill', async ({ page, api }) => {
  await prepare(page, api, 'default')
  await page.goto('/')
  await expect(page.getByRole('button', { name: '登录后查看本人记录' })).toBeVisible()
  await expectFilled(page, '未登录（default）')
})
