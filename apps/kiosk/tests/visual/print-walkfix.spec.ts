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
import { seedPrintHandoff, setReactRouterState, W2_FILE, W2_MATERIAL_CHECK, W2_ORDER, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

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

// ── 完成屏 / 失败屏共用的路由状态与接口 ────────────────────────────────────────
const flowState = { file: W2_FILE, params: W2_PRINT_PARAMS, source: 'document', ...W2_ORDER }
const JOB_PATH = `/api/v1/print/jobs/${W2_ORDER.taskId}`

function registerCompletedJob(api: ApiRouter): void {
  api.respond('GET', JOB_PATH, {
    status: 200,
    json: { taskId: W2_ORDER.taskId, status: 'completed', completedAt: '2026-07-26T00:00:00.000Z' },
  })
}

// ── I-12 打印完成屏页底两句话分开 ─────────────────────────────────────────────
// 走查：「少了页、印花了、对内容有疑问？需要帮助？查看《隐私政策》里的联系方式 不再点屏幕，60 秒后结束本次使用……」
// 连成一段，读起来像一句话。求助句和「不再点屏幕就结束」是两件事，各占一行。
test('I-12 done screen: the help sentence and the auto-end sentence are two separate lines @w2', async ({ page, api }) => {
  registerShell(api)
  registerCompletedJob(api)
  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', flowState)
  const block = page.getByTestId('print-fulfill-fallback')
  await expect(block).toBeVisible()
  const lines = block.locator('p')
  expect(await lines.count(), '页底说明至少分成两段').toBeGreaterThanOrEqual(2)
  await expect(lines.nth(0)).toContainText('少了页、印花了、对内容有疑问？')
  await expect(lines.nth(0)).not.toContainText('不再点屏幕')
  await expect(lines.nth(1)).toContainText('不再点屏幕，60 秒后结束本次使用')
  const text = await block.innerText()
  expect(text, '求助句和自动结束句之间不能只隔一个空格').not.toMatch(/(?:联系方式|）|[0-9])\s+不再点屏幕/)
  const [first, second] = await Promise.all([lines.nth(0).boundingBox(), lines.nth(1).boundingBox()])
  expect((second?.y ?? 0) + 1, '第二句在第一句下面另起一行').toBeGreaterThanOrEqual((first?.y ?? 0) + (first?.height ?? 0))
  await shot(page, 'i12-done')
})

// ── I-13 大厅「打印文件」进来源选择屏 ──────────────────────────────────────────
// 走查：大厅「打印文件」的链接带 tab=file，一体机上 tab=file 直接走手机二维码，跳过了稿 print-src 的「文件在哪」选择屏，
// 想用 U 盘的人（没手机或手机不方便）在正常状态下找不到入口。
const HUB_READY = { document_print: 'available', phone_upload: 'available', usb_import: 'available', scan: 'available', copy: 'available', format_convert: 'available' }

test('I-13 hub: 打印文件 opens the file-source chooser (phone, USB, my documents), not the phone QR page @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, HUB_READY)
  await page.goto('/print-scan')
  await page.getByTestId('print-hub-cap-doc-print').click()
  await expect(page).toHaveURL(/\/print\/upload\?/)
  expect(new URL(page.url()).searchParams.get('tab'), '链接不带 tab，才会进来源选择屏').toBeNull()
  const channels = page.getByTestId('file-source-channels')
  await expect(channels).toBeVisible()
  await expect(page.getByTestId('file-source-ch-qr').locator('button')).toBeEnabled()
  await expect(page.getByTestId('file-source-ch-usb').locator('button')).toBeEnabled()
  await expect(page.getByTestId('file-source-member-source')).toBeVisible()
  await expect(channels).toContainText('U 盘导入')
  await shot(page, 'i13-chooser')
  // 选 U 盘就进 U 盘通道（而不是只在二维码过期后才露面）。
  await page.route('http://127.0.0.1:9527/local/usb/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ success: true, data: { present: false } }),
  }))
  await page.getByTestId('file-source-ch-usb').locator('button').click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('U 盘')
  await expect(page.getByTestId('file-source-member-source')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('I-13 hub: 照片打印 also lands on the chooser and keeps the photo category @w2', async ({ page, api }) => {
  registerShell(api, HUB_READY)
  await page.goto('/print-scan')
  await page.getByRole('button', { name: /照片打印/ }).click()
  await expect(page).toHaveURL(/\/print\/upload\?/)
  const url = new URL(page.url())
  expect(url.searchParams.get('tab')).toBeNull()
  expect(url.searchParams.get('category')).toBe('photo')
  await expect(page.getByTestId('file-source-channels')).toBeVisible()
})

test('I-13 chooser: the USB card is greyed out with the reason when the backend has not opened it on this machine @w2', async ({ page, api }) => {
  registerShell(api, { ...HUB_READY, usb_import: 'maintenance' })
  await page.goto('/print/upload?source=document')
  const usb = page.getByTestId('file-source-ch-usb')
  await expect(usb).toBeVisible()
  await expect(usb.locator('button')).toBeDisabled()
  await expect(usb).toContainText('维护中')
  await expect(usb).toContainText('请改用手机上传')
  await expect(page.getByTestId('file-source-ch-qr').locator('button')).toBeEnabled()
  await shot(page, 'i13-chooser-usb-off')
})

test('I-13 chooser: with the capability not configured for this machine, USB stays available (没接管就放行) @w2', async ({ page, api }) => {
  registerShell(api)
  await page.goto('/print/upload?source=document')
  await expect(page.getByTestId('file-source-ch-usb').locator('button')).toBeEnabled()
})

// ── I-11 缺纸 / 卡纸 / 结果未确认三屏 ──────────────────────────────────────────
// 走查：三屏的「下一步」落在「加完纸」「处理好后」「查看《隐私政策》里的联系方式」上；现场没人加纸、没人处理，
// 那句联系方式是纯文字点不开（没配服务电话时全站「出错有路」就只剩它）；打印机仍故障时「重新提交打印」还亮着。
type FailKind = 'PAPER_EMPTY' | 'PRINTER_ERROR' | 'PRINT_JOB_UNCONFIRMED'

function registerFailedJob(api: ApiRouter, errorCode: FailKind, canRetry: boolean): void {
  api.respond('GET', JOB_PATH, {
    status: 200,
    json: { taskId: W2_ORDER.taskId, status: 'failed', errorCode, failureReasonForUser: '' },
  })
  api.respond('POST', `${JOB_PATH}/takeaway-url`, {
    status: 200,
    json: {
      signedUrl: '/api/v1/files/signed/takeaway-demo', expiresAt: '2099-01-01T00:00:00.000Z',
      filename: W2_FILE.name, mimeType: 'application/pdf', sizeBytes: 128,
      orderId: W2_ORDER.orderId, orderNo: W2_ORDER.orderNo, payStatus: 'paid', amountCents: 0, canRetry,
    },
  })
}

function registerSupportContact(api: ApiRouter, servicePhone: string | null): void {
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: {
      success: true,
      data: {
        servicePhone, serviceHours: servicePhone ? '工作日 9:00–18:00' : null,
        otherOnlineTerminalNearby: false, miniappPublished: false,
      },
    },
  })
}

/** 隐私政策页的两份正文（页面一进来就各取一次，不接会被判成没接的请求）。 */
function registerLegalDocs(api: ApiRouter): void {
  const doc = (title: string) => ({
    status: 200,
    json: { success: true, data: { content: `一、说明\n这是${title}。\n\n五、联系我们\n请通过终端公示的联系方式联系我们。`, publishedAt: NOW, version: 'v-fixture' } },
  })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', doc('隐私政策'))
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', doc('用户服务协议'))
}

const FAIL_SCREENS: ReadonlyArray<{ kind: FailKind; testId: string; label: string }> = [
  { kind: 'PAPER_EMPTY', testId: 'print-fulfill-state-out-of-paper', label: '缺纸' },
  { kind: 'PRINTER_ERROR', testId: 'print-fulfill-state-paper-jam', label: '卡纸' },
  { kind: 'PRINT_JOB_UNCONFIRMED', testId: 'print-fulfill-state-result-unconfirmed', label: '结果未确认' },
]

for (const { kind, testId, label } of FAIL_SCREENS) {
  test(`I-11 ${label} screen: no step waits for someone to add paper or fix it, and without a service phone the contact is a tappable entry @w2`, async ({ page, api }) => {
    registerShell(api)
    registerSupportContact(api, null)
    registerLegalDocs(api)
    registerFailedJob(api, kind, kind !== 'PRINT_JOB_UNCONFIRMED')
    await page.goto('/print/done')
    await setReactRouterState(page, '/print/done', flowState)
    const screen = page.getByTestId(testId)
    await expect(screen).toBeVisible()
    const whole = page.locator('[data-qx-page]').first()
    await expect(whole).not.toContainText('加完纸')
    await expect(whole).not.toContainText('处理好后')
    // 没配服务电话：「查看《隐私政策》里的联系方式」那句话旁边有能点开的入口。
    await expect(whole).toContainText('查看《隐私政策》里的联系方式')
    const entry = page.getByRole('button', { name: '查看联系方式' })
    await expect(entry).toBeVisible()
    const box = await entry.boundingBox()
    expect(box?.height ?? 0, '联系方式入口可点区 ≥64').toBeGreaterThanOrEqual(64)
    await shot(page, `i11-${kind}-nophone`)
    await entry.click()
    await expect(page).toHaveURL(/\/legal\/privacy\?/)
    expect(new URL(page.url()).searchParams.get('section')).toBe('联系')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('隐私政策')
  })

  test(`I-11 ${label} screen: with a service phone the phone is on screen and there is no extra contact entry @w2`, async ({ page, api }) => {
    registerShell(api)
    registerSupportContact(api, '0532-82870136')
    registerFailedJob(api, kind, kind !== 'PRINT_JOB_UNCONFIRMED')
    await page.goto('/print/done')
    await setReactRouterState(page, '/print/done', flowState)
    await expect(page.getByTestId(testId)).toBeVisible()
    await expect(page.locator('[data-qx-page]').first()).toContainText('拨打服务电话 0532-82870136')
    await expect(page.getByRole('button', { name: '查看联系方式' })).toHaveCount(0)
  })
}

// 打印机仍故障：「重新提交打印」置灰并写原因（缺纸、卡纸各一条），机器好了才亮。
for (const [kind, testId, printerStatus, reason] of [
  ['PAPER_EMPTY', 'print-fulfill-state-out-of-paper', 'paper_empty', '缺纸'],
  ['PRINTER_ERROR', 'print-fulfill-state-paper-jam', 'error', '故障'],
] as const) {
  test(`I-11 ${kind}: 重新提交打印 is greyed out with the reason while the printer is still faulty, and works once it is ready @w2`, async ({ page, api }) => {
    registerShell(api)
    registerFailedJob(api, kind, true)
    let printer: string = printerStatus
    api.respondWith('GET', '/api/v1/terminals/KSK-001/printer-status', () => ({
      status: 200, json: { printerStatus: printer, paperLevel: 'sufficient', isOnline: true },
    }))
    const retries: string[] = []
    api.respondWith('POST', `${JOB_PATH}/retry`, () => {
      retries.push('retry')
      return { status: 200, json: { taskId: W2_ORDER.taskId, orderId: W2_ORDER.orderId, orderNo: W2_ORDER.orderNo, amountCents: 0, payStatus: 'paid', status: 'pending' } }
    })
    await page.goto('/print/done')
    await setReactRouterState(page, '/print/done', flowState)
    const retry = page.getByRole('button', { name: '重新提交打印' })
    await expect(page.getByTestId(testId)).toBeVisible()
    await expect(retry).toBeVisible()
    await expect(retry).toHaveAttribute('aria-disabled', 'true')
    const why = page.getByTestId('print-retry-blocked-reason')
    await expect(why).toContainText(reason)
    await expect(retry).toHaveAttribute('aria-describedby', await why.getAttribute('id') ?? 'missing')
    await shot(page, `i11-${kind}-retry-blocked`)
    await retry.click({ force: true })
    expect(retries, '打印机还坏着，点了也不能把重提发出去').toEqual([])
    // 机器好了（状态每分钟刷新一次；这里直接换页面重进，读到新状态）：按钮亮起、原因消失。
    printer = 'ready'
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '重新提交打印' })).not.toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByTestId('print-retry-blocked-reason')).toHaveCount(0)
    await page.getByRole('button', { name: '重新提交打印' }).click()
    await page.waitForURL('**/print/progress')
    expect(retries).toEqual(['retry'])
  })
}

// ── I-30 打印途中后端断开 ─────────────────────────────────────────────────────
// 走查：纸已出来，后端不可达，屏停在「无法确认打印结果」，后端恢复后这一屏仍不更新，没有订单号、没有「重新查看」，
// 游客拿着已出的纸，屏上却说「请勿据此判断已经出纸」，容易重打一次。
// 修：读不到状态不判失败，转到完成页「无法确认」态，带订单号；按退避（3、6、12、24、30 秒）继续查，
// 恢复后换成真实结果；也有手动的「重新查看这一单」。
const recoveryState = { ...flowState, hasEndUser: true }

/** 后端开关：down 时状态接口回 503，up 时回 completed。 */
function registerFlakyJob(api: ApiRouter): { up: () => void; calls: () => number } {
  let up = false
  let calls = 0
  api.respondWith('GET', JOB_PATH, () => {
    calls += 1
    return up
      ? { status: 200, json: { taskId: W2_ORDER.taskId, status: 'completed', completedAt: '2026-07-26T00:00:00.000Z' } }
      : { status: 503, json: { error: { code: 'PRINT_STATUS_UNAVAILABLE', message: 'fixture status down' } } }
  })
  return { up: () => { up = true }, calls: () => calls }
}

/**
 * 假时钟快进：一小步一小步走，每步之后让真实的网络响应落地，再走下一步
 * （一次 runFor 走完全程的话，定时器触发的请求还没回来，后面的定时器是排不上的）。
 */
async function advance(page: Page, totalMs: number, until?: () => Promise<boolean>): Promise<void> {
  const step = 3_000
  for (let spent = 0; spent < totalMs; spent += step) {
    if (until && await until()) return
    await page.clock.runFor(step)
    await page.waitForTimeout(60)
  }
}

/** 进度页轮询连着失败、转到完成页「无法确认」态。时钟用假的，直接快进，不真等 15 秒。 */
async function reachUnknownAfterOutage(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.clock.install()
  await page.goto('/print/progress')
  await setReactRouterState(page, '/print/progress', state)
  await advance(page, 30_000, async () => page.url().includes('/print/done'))
  await page.waitForURL('**/print/done')
  await expect(page.getByTestId('print-fulfill-state-unknown')).toBeVisible()
}

test('I-30 backend drops during printing: the unknown screen shows the order number and a way to look again, and never tells people to doubt the paper @w2', async ({ page, api }) => {
  registerShell(api)
  registerFlakyJob(api)
  await page.addInitScript(() => {
    // 记下「打印没有完成」是否在任何时刻上过屏：读不到状态不是失败，不能闪这一句。
    const seen = () => { if (document.body?.innerText.includes('打印没有完成')) (window as unknown as { __sawFailure?: boolean }).__sawFailure = true }
    new MutationObserver(seen).observe(document, { childList: true, subtree: true, characterData: true })
  })
  await reachUnknownAfterOutage(page, recoveryState)
  const unknown = page.getByTestId('print-fulfill-state-unknown')
  await expect(unknown).toContainText(W2_ORDER.orderNo)
  await expect(page.getByRole('button', { name: '重新查看这一单' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新查看这一单' })).toBeEnabled()
  const whole = page.locator('[data-qx-page]').first()
  await expect(whole).not.toContainText('请勿据此判断已经出纸')
  await expect(whole).toContainText('先看出纸口')
  await expect(whole).toContainText('请不要重新下单')
  // 关联了账号：给出「在这台机器上查看这一单」的出口（小程序未发布，不说手机）。
  await expect(whole).toContainText('点下方「查看打印订单」')
  await expect(unknown.getByRole('button', { name: '查看打印订单', exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/没有订单|没有扣费|没有收款/)
  expect(await page.evaluate(() => (window as unknown as { __sawFailure?: boolean }).__sawFailure === true), '读不到状态时不能闪「打印没有完成」').toBe(false)
  await shot(page, 'i30-unknown-with-order')
})

test('I-30 backend comes back: the unknown screen updates itself to the real result, no tap needed @w2', async ({ page, api }) => {
  registerShell(api)
  const job = registerFlakyJob(api)
  await reachUnknownAfterOutage(page, recoveryState)
  const before = job.calls()
  // 还没恢复：自动重查仍在继续，次数在涨，屏不变。
  await advance(page, 40_000)
  expect(job.calls(), '后端没好时也按退避继续查').toBeGreaterThan(before)
  await expect(page.getByTestId('print-fulfill-state-unknown')).toBeVisible()
  // 恢复：下一次重查读到真实结果，屏自己换成「都打好了」。
  job.up()
  await advance(page, 40_000, async () => (await page.getByTestId('print-fulfill-state-completed').count()) > 0)
  await expect(page.getByTestId('print-fulfill-state-completed')).toBeVisible()
  await expect(page.getByTestId('print-fulfill-state-unknown')).toHaveCount(0)
  await shot(page, 'i30-recovered')
})

test('I-30 the manual 重新查看这一单 asks again right away and shows the real result @w2', async ({ page, api }) => {
  registerShell(api)
  const job = registerFlakyJob(api)
  await reachUnknownAfterOutage(page, recoveryState)
  const before = job.calls()
  job.up()
  await page.getByRole('button', { name: '重新查看这一单' }).click()
  await expect(page.getByTestId('print-fulfill-state-completed')).toBeVisible()
  expect(job.calls()).toBeGreaterThan(before)
})

test('I-30 a hanging initial result read times out, exposes recovery, and later shows only the confirmed result @w2', async ({ page, api }) => {
  registerShell(api)
  let calls = 0
  api.respondWith('GET', JOB_PATH, () => {
    calls += 1
    // A connection can stay open without returning even an error response.
    if (calls === 1) return new Promise(() => {})
    return { status: 200, json: { taskId: W2_ORDER.taskId, status: 'completed', completedAt: '2026-07-26T00:00:00.000Z' } }
  })
  await page.clock.install()
  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', recoveryState)
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByTestId('print-fulfill-state-loading')).toBeVisible()
  await page.clock.runFor(8_001)
  await expect(page.getByTestId('print-fulfill-state-unknown')).toBeVisible()
  await expect(page.getByTestId('print-fulfill-state-completed')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新查看这一单' })).toBeEnabled()
  await expect(page.getByTestId('print-fulfill-state-unknown')).toContainText(W2_ORDER.orderNo)
  await page.clock.runFor(3_001)
  await expect(page.getByTestId('print-fulfill-state-completed')).toBeVisible()
  expect(calls).toBe(2)
})

test('I-30 a guest (order not tied to an account) is told to note the order number, not to look it up on the phone @w2', async ({ page, api }) => {
  registerShell(api)
  registerFlakyJob(api)
  await reachUnknownAfterOutage(page, { ...flowState, hasEndUser: false })
  const whole = page.locator('[data-qx-page]').first()
  await expect(whole).toContainText(`记下订单号 ${W2_ORDER.orderNo}，需要时报给我们`)
  await expect(whole).toContainText('需要帮助？')
  await expect(whole).not.toContainText('在手机上查看这一单')
  await expect(whole).not.toContainText('点下方「查看打印订单」')
})

test('I-30 with the miniapp published, a signed-in person is pointed at 我的 → 打印订单 on the phone @w2', async ({ page, api }) => {
  registerShell(api)
  registerFlakyJob(api)
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: { success: true, data: { servicePhone: '18369161921', serviceHours: '工作日 9:00–18:00', otherOnlineTerminalNearby: false, miniappPublished: true } },
  })
  await reachUnknownAfterOutage(page, recoveryState)
  const whole = page.locator('[data-qx-page]').first()
  await expect(whole).toContainText('在手机上查看这一单')
  await expect(whole).toContainText('「我的 → 打印订单」')
  await expect(whole).toContainText(W2_ORDER.orderNo)
})
