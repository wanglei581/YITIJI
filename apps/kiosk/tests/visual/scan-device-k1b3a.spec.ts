import { expect, test } from '../fixtures/kiosk-test'
import { CONTROL, TASK, STOP_KEY, deviceFixture } from './fixtures/scan-device-k1b3a'

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
