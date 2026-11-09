import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { fillPhoneLogin } from './fixtures/privacy-clear-shell'
import { CONTROL, TASK, STOP_KEY, deviceFixture, expectScanUnknownChip } from './fixtures/scan-device-k1b3a'

const faults = [
  ['feeder_empty', 'nopaper', '进纸器里没有纸', '放好纸再试', '问小青：进纸器没纸怎么办', 6],
  ['paper_jam', 'jam', '卡纸或盖板没合上', '处理好了，再试', '问小青：卡纸怎么办', 5],
  ['busy', 'busy', '打印机正在忙', '再试', '问小青：打印机忙要等多久', 5],
  ['not_ready', 'noresp', '扫描仪没有响应', '改用面板扫描', '问小青：扫描仪连不上怎么办', 5],
  ['timeout', 'timeout', '等太久没有结果', '重新开始', '问小青：等太久没结果怎么办', 5],
] as const

for (const [code, screen, title, primary, ask, count] of faults) {
  test(`error ${screen} follows the draft and touch dimensions @w2`, async ({ page, api }) => {
    const f = await deviceFixture(page, api)
    await f.start(code)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('scan-device-error-primary')).toHaveText(primary)
    await expect(page.getByRole('button', { name: ask, exact: true })).toBeVisible()
    await expect(page.locator('.qxt-dock button, [data-testid^="scan-device-error-"] .cs-way').filter({ visible: true })).toHaveCount(count)
    const main = page.getByTestId('scan-device-error-primary')
    const box = await main.boundingBox()
    expect(box?.width).toBeCloseTo(screen === 'jam' ? 306 : 300, 0)
    expect(box?.height).toBeGreaterThanOrEqual(56)
    expect(await main.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20)
    if (screen === 'busy') await expect(page.getByTestId('service-phone-line')).toHaveCount(0)
    if (screen === 'noresp') {
      await expect(page.getByText(/已经收到提醒|会尽快处理/)).toHaveCount(0)
      await expect(page.getByTestId('service-phone-line')).toBeVisible()
    }
    if (screen === 'timeout') await expect(page.getByText(/超过 3 分钟/)).toHaveCount(0)
    await page.screenshot({ path: `test-results/k1b3a-${screen}.png` })
  })
}

test('busy illustration fits its frame and reason card matches the other two-option error screens @w2', async ({ page, api }) => {
  const f = await deviceFixture(page, api)
  await f.start('busy')
  const busy = page.getByTestId('scan-device-error-busy')
  await expect(busy).toBeVisible({ timeout: 15000 })
  await page.evaluate(() => document.fonts.ready)
  const frame = await busy.locator('.cs-why .vis').boundingBox()
  expect(frame).not.toBeNull()
  for (const art of [busy.locator('.cs-why .vis .pa'), busy.locator('.cs-why .vis .pa svg')]) {
    const box = await art.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(0)
    expect(box!.height).toBeGreaterThan(0)
    expect(box!.x).toBeGreaterThanOrEqual(frame!.x)
    expect(box!.y).toBeGreaterThanOrEqual(frame!.y)
    expect(box!.x + box!.width).toBeLessThanOrEqual(frame!.x + frame!.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(frame!.y + frame!.height)
  }
  const busyCard = await busy.locator('.cs-why').boundingBox()
  expect(busyCard).not.toBeNull()
  // 比较对象是同为两张操作卡的卡纸屏（无纸屏有三张操作卡，原因卡本来就矮一截，不可比）。
  f.cloud.deviceErrorCode = 'paper_jam'
  const jam = page.getByTestId('scan-device-error-jam')
  await expect(jam).toBeVisible({ timeout: 15000 })
  const jamCard = await jam.locator('.cs-why').boundingBox()
  expect(jamCard).not.toBeNull()
  expect(Math.abs(busyCard!.height - jamCard!.height)).toBeLessThanOrEqual(60)
})

test('noresp without configured phone makes no alert or phone claim @w2', async ({ page, api }) => {
  const f = await deviceFixture(page, api, { noPhone: true })
  await f.start('not_ready')
  await expect(page.getByTestId('scan-device-error-noresp')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(/已经收到提醒/)).toHaveCount(0)
  await expect(page.getByTestId('service-phone-line')).toHaveCount(0)
})

test('glass retries in the same session with only source changed @w2', async ({ page, api }) => {
  const f = await deviceFixture(page, api)
  await f.start('feeder_empty')
  await page.getByRole('button', { name: /^改用玻璃台/ }).click()
  await expect.poll(() => f.posts('/device-settings').length).toBe(1)
  const request = f.posts('/device-settings')[0]
  expect(request.path).toBe(`/api/v1/scan/sessions/${TASK}/device-settings`)
  expect(request.body).toEqual({ source: 'flatbed' })
  expect(request.headers['x-scan-session-control']).toBe(CONTROL)
  await expect.poll(() => f.posts('/start').length).toBe(2)
  expect(f.posts('/scan/sessions')).toHaveLength(1)
  expect(f.calls.filter((r) => r.method === 'DELETE')).toHaveLength(0)
})

test('panel switch preserves session and renders response instructions @w2', async ({ page, api }) => {
  const f = await deviceFixture(page, api)
  await f.start('paper_jam')
  await page.getByRole('button', { name: /^改用面板扫描/ }).click()
  await expect(page.getByTestId('scan-workbench-instructions')).toContainText('使用本次屏幕显示的路径')
  expect(f.posts('/switch-to-panel')[0].headers['x-scan-session-control']).toBe(CONTROL)
  expect(f.posts('/scan/sessions')).toHaveLength(1)
  expect(f.calls.filter((r) => r.method === 'DELETE')).toHaveLength(0)
  await page.reload()
  await expect(page.getByTestId('scan-workbench-instructions')).toContainText('使用本次屏幕显示的路径')
  expect(f.posts('/scan/sessions')).toHaveLength(1)
})

test('panel 409 rereads the same session without pretending to switch @w2', async ({ page, api }) => {
  const f = await deviceFixture(page, api, { panelConflict: true })
  await f.start('paper_jam')
  await page.getByRole('button', { name: /^改用面板扫描/ }).click()
  await expect(page.getByRole('heading', { name: '正在扫描', exact: true })).toBeVisible({ timeout: 15000 })
  const index = f.calls.findIndex((r) => r.path.endsWith('/switch-to-panel'))
  expect(f.calls.slice(index + 1).some((r) => r.method === 'GET' && r.path.endsWith(TASK))).toBe(true)
  await expect(page.getByTestId('scan-workbench-instructions')).toHaveCount(0)
  expect(f.posts('/scan/sessions')).toHaveLength(1)
  expect(f.posts('/start')).toHaveLength(1)
  expect(f.calls.filter((r) => r.method === 'DELETE')).toHaveLength(0)
})

test('stop needs two presses and the first resets after six seconds @w2', async ({ page, api }) => {
  const f = await deviceFixture(page, api)
  await f.start()
  await page.getByTestId('scan-device-stop').click()
  await expect(page.getByTestId('scan-device-stop')).toHaveText('再点一次确认停止')
  expect(f.posts('/abort')).toHaveLength(0)
  await expect(page.getByTestId('scan-device-stop')).toHaveText('停止扫描', { timeout: 8000 })
  expect(f.posts('/abort')).toHaveLength(0)
  await page.getByTestId('scan-device-stop').click()
  await page.getByTestId('scan-device-stop').click()
  await expect(page.getByTestId('scan-device-stopped')).toBeVisible()
  expect(f.posts('/abort')).toHaveLength(1)
  expect(f.calls.filter((r) => r.method === 'DELETE')).toHaveLength(1)
})

for (const fail of ['abort', 'cancel'] as const) {
  test(`${fail} failure records both attempts and remains unknown after reload @w2`, async ({ page, api }) => {
    const f = await deviceFixture(page, api, { abortFailure: fail === 'abort', cancelFailure: fail === 'cancel', purged: true })
    await f.start()
    await page.getByTestId('scan-device-stop').click()
    await page.getByTestId('scan-device-stop').click()
    await expect(page.getByRole('heading', { name: '状态未知' })).toBeVisible()
    await expectScanUnknownChip(page)
    await expect.poll(async () => page.evaluate(({ key, side }) => JSON.parse(sessionStorage.getItem(key) ?? '{}')[side], { key: STOP_KEY, side: fail })).toBe('unknown')
    expect(f.posts('/abort')).toHaveLength(1)
    expect(f.calls.filter((r) => r.method === 'DELETE')).toHaveLength(1)
    await expect(page.getByText(/已扫的页已从这台机器删除/)).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: '状态未知' })).toBeVisible()
    await expect(page.getByTestId('scan-device-stopped')).toHaveCount(0)
  })
}

for (const quiet of [true, false]) for (const purged of [true, false]) {
  test(`stopped quiet=${quiet} purged=${purged} uses only receipt evidence @w2`, async ({ page, api }) => {
    if (!quiet) await page.emulateMedia({ reducedMotion: 'no-preference' })
    const f = await deviceFixture(page, api, { quiet, purged })
    await f.start()
    await page.getByTestId('scan-device-stop').click()
    await page.getByTestId('scan-device-stop').click()
    await expect(page.getByTestId('scan-device-stopped')).toBeVisible()
    await expect(page.getByText(/已扫的页已从这台机器删除/)).toHaveCount(purged ? 1 : 0)
    if (quiet) {
      const counter = page.getByTestId('scan-device-quiet-seconds')
      await expect(counter).toContainText(/8\d|90/)
      const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!).countdownEndsAt, STOP_KEY)
      await expect.poll(async () => Number((await counter.innerText()).replace(/\D/g, ''))).toBeLessThanOrEqual(87)
      const before = Number((await counter.innerText()).replace(/\D/g, ''))
      await page.reload()
      await expect(page.getByTestId('scan-device-stopped')).toBeVisible()
      expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!).countdownEndsAt, STOP_KEY)).toBe(saved)
      expect(Number((await counter.innerText()).replace(/\D/g, ''))).toBeLessThanOrEqual(before)
      expect(f.posts('/abort')).toHaveLength(1)
      expect(f.calls.filter((r) => r.method === 'DELETE')).toHaveLength(1)
    } else {
      await expect(page.getByTestId('scan-device-quiet-seconds')).toHaveCount(0)
      const ring = page.getByTestId('scan-device-quiet-ring')
      await expect(ring).toBeVisible()
      await expect(ring).toHaveText('请稍候')
      expect(await ring.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0)
      await expect(page.getByText('请稍候再开始新的扫描', { exact: true })).toBeVisible()
      await expect(page.getByText('为了不让下一位看到你的材料，过一会儿才能开始新的扫描。', { exact: true })).toBeVisible()
      await expect(page.locator('.qxt-screen')).not.toContainText(/\d+\s*秒/)
      await expect(page.getByTestId('scan-device-stopped')).not.toContainText(/\d/)
    }
  })
}

/* ── 11/09：屏上扫描中断后的结果屏（稿 cs-scan-failed，11/08 产品负责人定第 2 条；11/09 再定四项） ───────────
 * 屏上扫描来的结果换成屏上扫描自己的结果屏：眉题「屏上扫描」、不画面板四步路径线、原因卡单栏居中。
 * 11/09 定：出路「照原设置再扫一次」（回放纸设置，材料和放纸设置照上一场预填，按「开始扫描」才建普通新会话，不带重扫头）
 * 和「返回首页」，没有文件那种只留前一张；删掉「同一张纸原样再扫…（两小时内）」「这是一次普通新会话，不是免查重的重扫…」
 * 两句（屏上扫描每次拼出的 PDF 字节都不同，服务端同字节去重拦不到）。
 * 面板扫描的失败屏不变，见 fusion-w2-scan.spec.ts「failed scan retry strips control fields」。 */
const AGAIN = '照原设置再扫一次'
const AGAIN_DETAIL = '把原件重新放好，可以照原设置再扫一次。'
const AGAIN_WAY = '回到放纸设置，材料和设置照上次填好'
const NO_FILE_DETAIL = '同一份结果里没有带可用的文件信息（结果里允许不带文件，这不是出错）。这份文件此刻还在不在系统里，本机没有依据判断。这次扫描到此结束。'
const ACK_REASON = '系统没有确认这一场能收到扫描件（已过期、被取消或已经结束），本机已经把它撤掉。面板上扫出来的文件不会交到这一场，你手上的纸也不会被谁收走。要继续请重新开始一次扫描。'
const SCAN_KEY = 'ai-job-print:current-scan-workbench'
type DeviceKit = Awaited<ReturnType<typeof deviceFixture>>
type DeviceCloud = DeviceKit['cloud']

async function expectDeviceFailed(page: Page, o: { title: string; chip: string; reason: string; detail?: string; cards?: string[] }): Promise<void> {
  const view = page.getByTestId('scan-device-failed')
  await expect(view).toBeVisible({ timeout: 15000 })
  const band = page.locator('.qxt-band')
  await expect(band.locator('.qxt-eyebrow')).toHaveText('屏上扫描')
  await expect(page.getByRole('heading', { level: 1, name: o.title, exact: true })).toBeVisible()
  await expect(band.locator('.qxt-status')).toHaveText(o.chip)
  await expect(band.locator('.qxt-status')).toHaveClass(/qxt-status-warn/)
  await expect(band.locator('.qxt-rail')).toHaveCount(0)
  await expect(band.locator('.qxt-back')).toHaveCount(0)
  await expect(view.locator('.cs-why b')).toHaveText(o.reason)
  await expect(view.locator('.cs-why p')).toHaveText(o.detail ?? AGAIN_DETAIL)
  await expect(view.locator('.cs-way h3')).toHaveText(o.cards ?? [AGAIN, '返回首页'])
  await expect(view.getByTestId('scan-device-failed-again').locator('p')).toHaveText(AGAIN_WAY)
  // 删掉的两句和「同一份材料」这一屏一个字都不出（原因句里「重新开始一次扫描」是投递被拒那句原文，不在此列）。
  await expect(page.locator('.qxt-screen').getByText(/同一份材料|同一张纸|重复件|免查重/)).toHaveCount(0)
  await expect(page.getByText('这次没扫成的原因', { exact: true })).toHaveCount(0)
  await expect(page.locator('.qxt-dock').getByRole('button', { name: '返回打印扫描', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '问小青：扫描失败怎么办', exact: true })).toBeVisible()
  await expect(page.getByTestId('scan-device-failed-primary')).toHaveText(AGAIN)
  await expect(view.getByTestId('service-phone-line')).toBeVisible()
  // 原因卡单栏居中（照第三轮 nofile 排法）：插画在字上面、水平居中、撑住卡，卡顶卡底都不留大块空白。
  const card = await view.locator('.cs-why').boundingBox()
  const art = await view.locator('.cs-why .vis').boundingBox()
  const words = await view.locator('.cs-why b').boundingBox()
  const detail = await view.locator('.cs-why p').boundingBox()
  expect(art!.y + art!.height).toBeLessThanOrEqual(words!.y)
  expect(Math.abs((art!.x + art!.width / 2) - (card!.x + card!.width / 2))).toBeLessThanOrEqual(2)
  expect(art!.y - card!.y).toBeLessThanOrEqual(80)
  expect(card!.y + card!.height - (detail!.y + detail!.height)).toBeLessThanOrEqual(80)
  expect(art!.height).toBeGreaterThanOrEqual(card!.height * 0.4)
}

/**
 * 「照原设置再扫一次」之后：落在放纸设置，材料和放纸设置照上一场；登记里只剩这几样界面选项，
 * 没有上一场的任务编号、控制凭证、结果、屏上扫描标记、重扫意图，也还没建新会话。
 */
async function expectPrefilled(page: Page, f: DeviceKit, source: 'flatbed' | 'feeder', color: 'gray' | 'color'): Promise<void> {
  await expect(page).toHaveURL(/stage=device-settings/)
  await expect(page.locator('[data-w2-page="scan-set"]')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: '纸放哪？扫成黑白还是彩色？', exact: true })).toBeVisible()
  await expect(page.locator('.qxt-band .qxt-eyebrow')).toHaveText('屏上扫描 · 普通文档')
  await expect(page.getByTestId(`scan-source-${source}`)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId(`scan-color-${color}`)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('scan-device-start')).toBeEnabled()
  const raw = await page.evaluate((key) => sessionStorage.getItem(key) ?? '', SCAN_KEY)
  expect(JSON.parse(raw)).toEqual({ stage: 'device-settings', scanType: 'document', material: 'document', deviceChoice: { source, colorMode: color } })
  expect(raw).not.toContain(TASK)
  expect(raw).not.toContain(CONTROL)
  expect(f.posts('/scan/sessions')).toHaveLength(1)
}

/** 走到放纸设置（普通文档），按参数改纸放哪和颜色，再按开始。 */
async function startWith(page: Page, source: 'flatbed' | 'feeder', color: 'gray' | 'color'): Promise<void> {
  await page.getByTestId(`scan-source-${source}`).click()
  await page.getByTestId(`scan-color-${color}`).click()
  await page.getByTestId('scan-device-start').click()
  await expect(page.getByRole('heading', { name: '正在扫描', exact: true })).toBeVisible({ timeout: 15000 })
}

/** 选普通文档、走到「怎么扫？」。 */
async function openHow(page: Page): Promise<void> {
  await page.goto('/scan?stage=start')
  await page.getByTestId('scan-workbench-type-document').click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByRole('heading', { name: '怎么扫？' })).toBeVisible()
}

/** 清场后会落到首页：首页面板与问小青能力读这几条；形状同 copy-c3a 夹具的空响应。 */
function registerHome(api: ApiRouter): void {
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
  api.respond('GET', '/api/v1/job-fairs', { status: 200, json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { asrEnabled: false, ttsEnabled: false } })
}

const failedCases: readonly [string, (cloud: DeviceCloud) => void, string, string, string][] = [
  ['failed', (c) => { c.status = 'failed' }, '扫描未完成', '扫描未完成', '这次扫描没有完成。'],
  ['aborted', (c) => { c.deviceState = 'aborted' }, '扫描未完成', '扫描未完成', '已停止扫描。这次到这里为止，不会再继续。'],
  ['warming', (c) => { c.deviceState = 'error'; c.deviceErrorCode = 'warming_up' }, '扫描未完成', '扫描未完成', '扫描仪还在预热。这次先停在这里。'],
  ['large', (c) => { c.deviceState = 'error'; c.deviceErrorCode = 'too_large' }, '扫描未完成', '扫描未完成', '这一次超过了这台机器能收的大小。这次先停在这里。'],
  ['expired', (c) => { c.status = 'expired' }, '等待超时', '等待超时 · 没有文件', '等待超时，这次没有拿到文件。'],
]
for (const [name, apply, title, chip, reason] of failedCases) {
  test(`on-screen scan ${name} lands on its own result screen, not the panel one @w2`, async ({ page, api }) => {
    const f = await deviceFixture(page, api)
    await f.start()
    apply(f.cloud)
    await expectDeviceFailed(page, { title, chip, reason })
    await page.screenshot({ path: `test-results/align-1109-scan-failed-${name}.png` })
  })
}

test('again with the same settings lands on paper settings prefilled and creates a plain session only on start @w2', async ({ page, api }) => {
  const f = await deviceFixture(page, api)
  await openHow(page)
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await startWith(page, 'flatbed', 'color')
  f.cloud.status = 'failed'
  await expectDeviceFailed(page, { title: '扫描未完成', chip: '扫描未完成', reason: '这次扫描没有完成。' })
  await page.getByTestId('scan-device-failed-again').click()
  await expectPrefilled(page, f, 'flatbed', 'color')
  // 不重载、直接按开始：内存里要是还挂着上一场的重扫授权，这一次就会带出去，下面的断言要能看见。
  f.cloud.status = 'waiting'
  await page.getByTestId('scan-device-start').click()
  await expect(page.getByRole('heading', { name: '正在扫描', exact: true })).toBeVisible({ timeout: 15000 })
  const creates = f.posts('/scan/sessions')
  expect(creates).toHaveLength(2)
  // 普通创建：和第一次逐字一样（类型、终端、屏上扫描三项），不带 retryOfScanTaskId，也没有重扫凭证头。
  expect(creates[1].body).toEqual(creates[0].body)
  expect(creates[1].body).toMatchObject({ scanType: 'document', startMode: 'device', source: 'flatbed', colorMode: 'color' })
  expect(creates[1].body).not.toHaveProperty('retryOfScanTaskId')
  for (const request of creates) expect(request.headers['x-scan-retry-control']).toBeUndefined()
})

test('completed without a file keeps one way, and the dock button goes back to paper settings too @w2', async ({ page, api }) => {
  const f = await deviceFixture(page, api)
  await f.start()
  f.cloud.status = 'completed'
  await expectDeviceFailed(page, {
    title: '已完成 · 结果里没有文件', chip: '已完成 · 结果里没有文件',
    reason: '系统说已完成，但这次结果里没有可用文件', detail: NO_FILE_DETAIL, cards: [AGAIN],
  })
  await expect(page.getByTestId('scan-device-failed')).toHaveClass(/cs-solo/)
  await expect(page.getByTestId('scan-device-failed-home')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/align-1109-scan-failed-nofile.png' })
  await page.getByTestId('scan-device-failed-primary').click()
  await expectPrefilled(page, f, 'feeder', 'gray')
})

test('a refused delivery ack lands on the on-screen result screen with the ack reason @w2', async ({ page, api }) => {
  const f = await deviceFixture(page, api)
  api.respond('POST', `/api/v1/scan/sessions/${TASK}/ack`, { status: 404, json: { success: false, error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' } } })
  await openHow(page)
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByTestId('scan-device-start').click()
  await expectDeviceFailed(page, { title: '扫描未完成', chip: '扫描未完成', reason: ACK_REASON })
  expect(f.posts('/start')).toHaveLength(0)
  await page.screenshot({ path: 'test-results/align-1109-scan-failed-ack.png' })
})

test('on-screen failure survives a watchdog reload and goes back to paper settings, never on the panel @w2', async ({ page, api }) => {
  const f = await deviceFixture(page, api)
  await f.start()
  f.cloud.status = 'failed'
  await expect(page.getByTestId('scan-device-failed')).toBeVisible({ timeout: 15000 })
  // 判「这次是屏上扫描」靠本机登记里的 deviceFlow，整页重载之后照样走这一屏。
  await page.reload()
  await expectDeviceFailed(page, { title: '扫描未完成', chip: '扫描未完成', reason: '这次扫描没有完成。' })
  await page.getByTestId('scan-device-failed-primary').click()
  await expectPrefilled(page, f, 'feeder', 'gray')
  await expect(page.locator('[data-w2-page="scan-settings"]')).toHaveCount(0)
  // 和别的本机登记一样：在放纸设置上再整页重载一次，预填照旧在，仍然不建会话。
  await page.reload()
  await expectPrefilled(page, f, 'feeder', 'gray')
})

test('on-screen failure home card leaves the scan flow and clears the record @w2', async ({ page, api }) => {
  const f = await deviceFixture(page, api)
  registerHome(api)
  await f.start()
  f.cloud.status = 'expired'
  await page.getByTestId('scan-device-failed-home').click()
  await expect(page).toHaveURL(/\/$/)
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SCAN_KEY)).toBeNull()
  expect(f.posts('/scan/sessions')).toHaveLength(1)
})

/* 预填和别的本机登记同在一份记录里：游客闲置到点清场、登录用户在会话提醒里结束使用，都连预填一起清掉。
 * 清场后整页重载落回首页；同一页签再用地址进扫描会被隐私守卫当成旧历史再清一次，所以这里只核登记本身。 */
async function expectPrefillCleared(page: Page, f: DeviceKit): Promise<void> {
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), SCAN_KEY)).toBeNull()
  await expect(page.locator('[data-w2-page="scan-set"]')).toHaveCount(0)
  expect(f.posts('/scan/sessions')).toHaveLength(1)
}

test('a guest idle timeout clears the prefill with the rest of the scan record @w2', async ({ page, api }) => {
  await page.clock.install()
  const f = await deviceFixture(page, api)
  registerHome(api)
  await f.start()
  f.cloud.status = 'failed'
  await expectDeviceFailed(page, { title: '扫描未完成', chip: '扫描未完成', reason: '这次扫描没有完成。' })
  await page.getByTestId('scan-device-failed-primary').click()
  await expectPrefilled(page, f, 'feeder', 'gray')
  const reloaded = page.waitForEvent('load')
  await page.clock.fastForward(181_000)
  await reloaded
  await expectPrefillCleared(page, f)
})

test('a member who ends use from the session reminder loses the prefill too @w2', async ({ page, api }) => {
  await page.clock.install()
  const f = await deviceFixture(page, api)
  registerHome(api)
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200, json: { success: true, data: { token: 'k1b3a-member-token', user: { id: 'member-k1b3a', phoneMasked: '138****8000', nickname: '屏上扫描' } } },
  })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('POST', '/api/v1/member/auth/logout', { status: 200, json: { success: true, data: { loggedOut: true } } })
  await openHow(page)
  await page.getByTestId('scan-how-login').click()
  await fillPhoneLogin(page, '13800138000')
  await expect(page.getByRole('heading', { name: '怎么扫？' })).toBeVisible()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await startWith(page, 'flatbed', 'gray')
  f.cloud.status = 'expired'
  await expectDeviceFailed(page, { title: '等待超时', chip: '等待超时 · 没有文件', reason: '等待超时，这次没有拿到文件。' })
  await page.getByTestId('scan-device-failed-again').click()
  await expectPrefilled(page, f, 'flatbed', 'gray')
  expect(f.posts('/scan/sessions')[0].headers.authorization).toBe('Bearer k1b3a-member-token')
  await page.clock.runFor(151_000)
  const reloaded = page.waitForEvent('load')
  await page.getByTestId('session-guard-clear').click()
  await reloaded
  await expectPrefillCleared(page, f)
})

/* 胶囊橙色只认屏上扫描那几屏：「扫什么」等面板也走的屏上，状态未知色调照旧是灰的。 */
test('panel-side unknown chips stay grey; only on-screen scan screens use the reminder colour @w2', async ({ page, api }) => {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200, json: { data: { printerStatus: 'ready', isOnline: true, scanInputHealth: 'healthy' } },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', { status: 503, json: { success: false } })
  await page.goto('/scan?stage=start')
  const chip = page.locator('.qxt-band .qxt-status')
  await expect(chip).toHaveText('能力状态暂不可用')
  await expect(chip).toHaveClass(/qxt-status-unknown/)
  await expect(chip).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.08)')
  await expect(chip.locator('.qxt-dot')).toHaveCSS('background-color', 'rgb(159, 177, 170)')
})

/* 手机宽度（兼容浏览器访问）：原因卡单栏、插画在字上面，字留在卡里，横向不出屏。 */
for (const name of ['failed', 'nofile'] as const) {
  test(`on-screen failure ${name} stays readable at phone width @w2`, async ({ page, api }) => {
    const f = await deviceFixture(page, api)
    await f.start()
    f.cloud.status = name === 'failed' ? 'failed' : 'completed'
    const view = page.getByTestId('scan-device-failed')
    await expect(view).toBeVisible({ timeout: 15000 })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(390)
    const card = await view.locator('.cs-why').boundingBox()
    const art = await view.locator('.cs-why .vis').boundingBox()
    const words = await view.locator('.cs-why b').boundingBox()
    const detail = await view.locator('.cs-why p').boundingBox()
    expect(art!.y + art!.height).toBeLessThanOrEqual(words!.y)
    expect(art!.x).toBeGreaterThanOrEqual(card!.x)
    expect(art!.x + art!.width).toBeLessThanOrEqual(card!.x + card!.width)
    expect(words!.y).toBeGreaterThanOrEqual(card!.y)
    expect(detail!.y + detail!.height).toBeLessThanOrEqual(card!.y + card!.height + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  })
}
