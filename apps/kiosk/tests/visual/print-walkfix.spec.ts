/**
 * 触屏版本机全链路走查（2026-10-29）打印链路的修复用例（A 路）。
 *
 * 每条用例对应走查问题单里的一个问题号（I-xx），标题里写明；改前这些用例在当时的运行页上是红的。
 * 夹具沿用 fusion-w2-print.spec.ts 的口径（未登记能力的机器 = 试点常态）。
 */
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'
import { seedPrintHandoff, W2_FILE, W2_MATERIAL_CHECK } from './fixtures/fusion-w2-state'

const NOW = '2026-07-24T00:00:00.000Z'

const CAPABILITY_KEYS = [
  'document_print', 'phone_upload', 'cloud_upload', 'usb_import', 'material_pack', 'scan',
  'copy', 'id_photo', 'format_convert', 'signature_stamp', 'color_print', 'duplex_print',
]

/** 试点常态：每个键都下发，但没有被管理员配成 available（configured=false）。overrides 里的键配成对应状态。 */
function capabilities(overrides: Record<string, string> = {}): unknown {
  return {
    terminalCode: 'KSK-001',
    capabilities: CAPABILITY_KEYS.map((capabilityKey) => (
      overrides[capabilityKey]
        ? { capabilityKey, status: overrides[capabilityKey], note: null, configured: true, updatedAt: NOW }
        : { capabilityKey, status: 'not_verified', note: null, configured: false, updatedAt: null }
    )),
  }
}

/** 目测用：设了 WF_SHOT_DIR 才落一张 1080×1920 截图，平时什么都不做。 */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['WF_SHOT_DIR']
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` })
}

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return errors
}

function registerShell(api: ApiRouter, overrides: Record<string, string> = {}): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', { status: 200, json: capabilities(overrides) })
  api.respond('GET', '/api/v1/materials/tasks/w2-inspection-001/print-param-suggestions', {
    status: 200,
    json: {
      success: true,
      data: {
        taskId: 'w2-inspection-001', featureKey: 'print_param_prefill', derivation: 'deterministic_rules', advisory: true,
        available: false, unavailableReason: { code: 'PARAM_PREFILL_OFF', text: '参数预填当前已关闭。' },
        capabilityProfile: null, items: [], notices: [], evidence: null, disclaimer: '', generatedAt: NOW,
      },
    },
  })
}

const PREVIEW_URL = '/print/desk?step=preview'

/** 单选组里的一个选项（颜色 / 单双面）。 */
function option(page: Page, name: string) {
  return page.locator('[data-w2-page="print-preview"]').getByRole('button', { name, exact: true })
}

async function strikeThrough(button: ReturnType<typeof option>): Promise<boolean> {
  return button.evaluate((el) => getComputedStyle(el).textDecorationLine.includes('line-through'))
}

// ── I-08 预览与参数：只有真不可用的选项才划掉 ─────────────────────────────────
// 走查：试点终端彩色、双面都没开通，颜色一行的「黑白」「彩色」和单双面一行的三个选项全被划线变灰，
// 连可用且已选的「黑白」「单面」也是，看着像「黑白也不能选」。
test('I-08 preview params: only the unavailable options are struck out; the selected and available ones stay normal @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  await seedPrintHandoff(page)
  await page.goto(PREVIEW_URL)
  await expect(page.locator('[data-w2-page="print-preview"]')).toBeVisible()

  for (const name of ['黑白', '单面']) {
    const button = option(page, name)
    await expect(button, `${name} 是已选且可用`).toHaveAttribute('data-selected', 'true')
    await expect(button, `${name} 不是不可用`).not.toHaveAttribute('aria-disabled', 'true')
    expect(await strikeThrough(button), `${name} 不能划线`).toBe(false)
    expect(Number(await button.evaluate((el) => getComputedStyle(el).opacity)), `${name} 不能发灰`).toBeGreaterThanOrEqual(0.95)
  }
  for (const name of ['彩色', '双面（长边）', '双面（短边）']) {
    const button = option(page, name)
    await expect(button, `${name} 本机没开通`).toHaveAttribute('aria-disabled', 'true')
    expect(await strikeThrough(button), `${name} 要划线`).toBe(true)
  }
  await shot(page, 'i08-preview-unverified')
  expect(errors).toEqual([])
})

test('I-08 preview params: with color on and duplex off, only the duplex options are struck out @w2', async ({ page, api }) => {
  registerShell(api, { color_print: 'available' })
  await seedPrintHandoff(page)
  await page.goto(PREVIEW_URL)
  await expect(page.locator('[data-w2-page="print-preview"]')).toBeVisible()
  for (const name of ['黑白', '彩色', '单面']) {
    const button = option(page, name)
    await expect(button).not.toHaveAttribute('aria-disabled', 'true')
    expect(await strikeThrough(button), `${name} 不能划线`).toBe(false)
  }
  for (const name of ['双面（长边）', '双面（短边）']) {
    await expect(option(page, name)).toHaveAttribute('aria-disabled', 'true')
    expect(await strikeThrough(option(page, name))).toBe(true)
  }
  // 彩色开通了就真能选上。
  await option(page, '彩色').click()
  await expect(option(page, '彩色')).toHaveAttribute('data-selected', 'true')
  await shot(page, 'i08-preview-color-on')
})

// ── I-10 预览与参数：大标题不是一句状态 ───────────────────────────────────────
test('I-10 preview params: the headline is not a status sentence, and the capability reasons sit beside their options @w2', async ({ page, api }) => {
  registerShell(api)
  await seedPrintHandoff(page)
  await page.goto(PREVIEW_URL)
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toBeVisible()
  await expect(heading).not.toContainText('暂未开通')
  await expect(heading).not.toContainText('部分打印能力')
  // 能力说明放在对应选项旁：颜色那一行说彩色，单双面那一行说双面。
  const colorRow = page.locator('.pdk-prow', { has: page.getByText('颜色', { exact: true }) })
  await expect(colorRow).toContainText('彩色：本机彩色打印暂未开通')
  const duplexRow = page.locator('.pdk-prow', { has: page.getByText('单双面', { exact: true }) })
  await expect(duplexRow).toContainText('双面：本机自动双面暂未开通')
})

// ── I-09 预览徽标按材料检查的真实结果说 ───────────────────────────────────────
// 走查：材料检查里选了「3 处个人信息全部保留」，预览页却写「没发现需要遮挡的内容」，核价页写「发现 3 处……全部保留」。
// 早先（真机 F-13，4200511d05）改过一次，触屏版集成线上又回到旧句。
for (const [findingCount, keptCount, expected, forbidden] of [
  [3, 3, '发现 3 处个人信息，你选择了全部保留 · 打印使用原件，纸上是完整信息', '没发现需要遮挡的内容'],
  [0, 0, '没发现需要遮挡的内容 · 打印使用原件', '你选择了全部保留'],
] as const) {
  test(`I-09 preview badge follows the material check result (findings ${findingCount}, kept ${keptCount}) @w2`, async ({ page, api }) => {
    registerShell(api)
    await seedPrintHandoff(page, {
      materialCheck: {
        ...W2_MATERIAL_CHECK,
        findingCount, redactedCount: 0, keptCount,
        redaction: { ...W2_MATERIAL_CHECK.redaction, keptCount },
      },
    })
    await page.goto(PREVIEW_URL)
    const badge = page.locator('.qpd-redaction-badge')
    await expect(badge).toContainText(expected)
    await expect(badge).not.toContainText(forbidden)
    await shot(page, `i09-badge-findings-${findingCount}`)
  })
}

// ── I-36 遮挡后的核对勾选框 ≥48 ───────────────────────────────────────────────
test('I-36 preview params: the "I checked the masked file" checkbox is at least 48px and tapping its sentence ticks it @w2', async ({ page, api }) => {
  registerShell(api)
  await seedPrintHandoff(page, {
    materialCheck: {
      ...W2_MATERIAL_CHECK,
      findingCount: 2, redactedCount: 2, keptCount: 0,
      redaction: {
        claim: 'redacted_verified', redactedFileId: W2_FILE.fileId, appliedRedactedCount: 2, failedNoPositionCount: 0,
        keptCount: 0, reverifyRemainingCount: 0, reverifyRan: true,
      },
    },
  })
  await page.goto(PREVIEW_URL)
  const box = page.getByRole('checkbox', { name: /我已逐页核对遮挡后的文件/ })
  await expect(box).toBeVisible()
  const rect = await box.boundingBox()
  expect(rect, '勾选框要有包围盒').not.toBeNull()
  expect(rect?.width ?? 0, '勾选框宽 ≥48').toBeGreaterThanOrEqual(48)
  expect(rect?.height ?? 0, '勾选框高 ≥48').toBeGreaterThanOrEqual(48)
  // 下一步在勾选前不可用；点那一句话（不是方框本身）就勾上。
  await expect(page.getByRole('button', { name: '请先确认隐私处理结果' })).toBeDisabled()
  await page.getByText('我已逐页核对遮挡后的文件，确认可以继续').click()
  await expect(box).toBeChecked()
  await expect(page.getByRole('button', { name: '下一步：核对价格' })).toBeEnabled()
  await assertNoHorizontalOverflow(page)
  await shot(page, 'i36-privacy-confirm')
})
