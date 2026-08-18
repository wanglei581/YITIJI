// ============================================================
// print-confirm-price-truth — 确认页「展示的参数」必须等于「计价的参数」
//
// 起因（2026-08-18）：PrintConfirmPage 的参数摘要卡里，色彩模式那一行写死成 '黑白'，
// 而同页报价（unitCentsFor(config, params.colorMode)）和建单都读真实 params.colorMode。
// TerminalCapability 表里 color_print 长期零记录 → 彩色前端禁用 → 撞不到。
// 一旦管理员把某台终端的 color_print 标成 available，用户选彩色后就会
// 看到「色彩模式 黑白」、按 print_color_page 单价扣款、拿到彩色纸 ——
// 看到的和付的钱不一致且多付（资损 + 客诉），并直接违反 CLAUDE.md §9「不伪造能力」。
//
// 门禁形态（刻意不是「源码里必须出现某段字符串」）：
//   - 用真实组件在真实浏览器里渲染确认页；
//   - /orders/quote 的桩**按请求体里真实收到的 params.colorMode 计价**，
//     所以「页面用哪个色彩模式计价」是被观测出来的，不是被假设的；
//   - 断言：摘要卡展示的色彩模式 === 计价所用色彩模式对应的中文名，
//     且计费方式行显示的单价 === 价目表里该色彩模式的单价。
// 锁字面量的门禁一旦被重构就会被顺手改掉；这里锁的是两者「同源」这个行为。
// ============================================================

import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { W2_FILE, W2_PRINT_PARAMS, setReactRouterState } from './fixtures/fusion-w2-state'

const NOW = '2026-08-18T00:00:00.000Z'

/** 价目表：黑白 20 分/页、彩色 50 分/页（与生产 seed 的服务键一致）。 */
const UNIT_CENTS = { black_white: 20, color: 50 } as const
const SERVICE_KEY = { black_white: 'print_bw_page', color: 'print_color_page' } as const
/** 用户可见的色彩模式中文名 —— 本文件对「页面该说什么」的独立预期。 */
const COLOR_MODE_TEXT = { black_white: '黑白', color: '彩色' } as const

type ColorMode = keyof typeof UNIT_CENTS

const CAPABILITY_KEYS = [
  'document_print', 'phone_upload', 'cloud_upload', 'usb_import', 'material_pack',
  'scan', 'copy', 'id_photo', 'format_convert', 'signature_stamp',
  'color_print', 'duplex_print',
]

function capabilities(available: string[]): unknown {
  return {
    terminalCode: 'KSK-001',
    capabilities: CAPABILITY_KEYS.map((capabilityKey) =>
      available.includes(capabilityKey)
        ? { capabilityKey, status: 'available', note: null, configured: true, updatedAt: NOW }
        : { capabilityKey, status: 'not_verified', note: null, configured: false, updatedAt: null },
    ),
  }
}

function registerShell(api: ApiRouter, available: string[]): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', { status: 200, json: capabilities(available) })
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: {
      billingEnabled: true,
      items: [
        { serviceKey: SERVICE_KEY.black_white, unitCents: UNIT_CENTS.black_white, unit: 'page', description: '黑白打印' },
        { serviceKey: SERVICE_KEY.color, unitCents: UNIT_CENTS.color, unit: 'page', description: '彩色打印' },
      ],
    },
  })
}

/**
 * /orders/quote 的桩：**按请求体里真实收到的 colorMode 计价**，并把它记录下来。
 * 这样「页面按哪个色彩模式计价」是从线上观测到的事实，测试无需假设。
 */
async function routePricingQuote(page: Page, billablePages: number, seen: { colorMode?: string }): Promise<void> {
  await page.route('**/api/v1/orders/quote', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    const body = route.request().postDataJSON() as { params?: { colorMode?: string } }
    const colorMode = (body.params?.colorMode ?? 'black_white') as ColorMode
    seen.colorMode = colorMode
    const unitCents = UNIT_CENTS[colorMode] ?? UNIT_CENTS.black_white
    const amountCents = unitCents * billablePages
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        amountCents,
        billablePages,
        billingPageSource: 'detected',
        priceLines: [
          {
            serviceKey: SERVICE_KEY[colorMode] ?? SERVICE_KEY.black_white,
            description: colorMode === 'color' ? '彩色打印' : '黑白打印',
            unitCents,
            quantity: billablePages,
            amountCents,
          },
        ],
      }),
    })
  })
}

const yuan = (cents: number): string => `¥${(cents / 100).toFixed(2)}`

// 摘要卡的每一行都带 data-sum-row=<行名>，不依赖类名或 DOM 层级。
const summaryValue = (page: Page, label: string) => page.locator(`[data-sum-row="${label}"] .v`)

for (const scenario of [
  // 已登记彩色的终端 + 用户选彩色：这就是产品负责人标完 color_print 后的真实生产路径。
  { name: 'color', chosen: 'color' as ColorMode, available: ['color_print'] },
  // 未登记彩色 + 用户仍带着彩色进页：前端 fail-closed 收口成黑白，展示也必须跟着说黑白。
  { name: 'black_white', chosen: 'black_white' as ColorMode, available: [] },
]) {
  test(`print confirm shows the same color mode it prices (${scenario.name}) @kiosk`, async ({ page, api }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    registerShell(api, scenario.available)
    const seen: { colorMode?: string } = {}
    await routePricingQuote(page, W2_FILE.pages, seen)

    await page.goto('/print/confirm')
    await setReactRouterState(page, '/print/confirm', {
      file: W2_FILE,
      params: { ...W2_PRINT_PARAMS, colorMode: 'color' },
      source: 'document',
    })

    await expect(page.locator('[data-w2-page="print-confirm"]')).toBeVisible()
    // 能力查询返回前，前端 fail-closed 先按黑白报一次价；能力落地后才按真实选择重报。
    // 等最终单价出现 = 等这一页稳定，避免读到中间态。
    // ③ 计费方式行的单价，必须是价目表里**该色彩模式**的单价。
    await expect(page.locator('[data-cost-calc]')).toHaveText(
      `${yuan(UNIT_CENTS[scenario.chosen])}/页 × ${W2_FILE.pages} 页`,
    )

    // ① 页面实际拿去计价的色彩模式（观测值，来自 /orders/quote 请求体）。
    const pricedColorMode = seen.colorMode as ColorMode
    expect(pricedColorMode).toBe(scenario.chosen)

    // ② 核心断言：摘要卡展示的色彩模式，必须与用于计价的色彩模式一致。
    //    展示侧写死时，两个 scenario 必有一个红 —— 写死成哪个值都躲不掉。
    await expect(summaryValue(page, '色彩模式')).toHaveText(COLOR_MODE_TEXT[pricedColorMode])

    // ④ 反向：色彩模式那一行绝不能出现另一种模式的名字。
    const other: ColorMode = pricedColorMode === 'color' ? 'black_white' : 'color'
    await expect(summaryValue(page, '色彩模式')).not.toContainText(COLOR_MODE_TEXT[other])

    // ⑤ 同一张卡里的邻居行也必须读真实参数（同类写死的回归网）。
    await expect(summaryValue(page, '打印份数')).toHaveText(`${W2_PRINT_PARAMS.copies} 份`)
    await expect(summaryValue(page, '单双面')).toHaveText('单面')

    expect(pageErrors).toEqual([])
  })
}
