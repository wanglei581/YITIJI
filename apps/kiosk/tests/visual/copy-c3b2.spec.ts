import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { COPY_CONTROL } from './fixtures/copy-c3a'
import { copyDeviceFixture } from './fixtures/copy-c3b1'

const secrets = () => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href })
async function printing(page: Page, api: ApiRouter, options: Parameters<typeof copyDeviceFixture>[2] = {}) {
  const f = await copyDeviceFixture(page, api, options)
  await f.start(); await f.report('scanned')
  await expect(page.locator('.cc-preview img')).toHaveCount(3)
  const preview = await page.locator('.cc-preview img').evaluateAll((nodes) => nodes.map((node) => (node as HTMLImageElement).src))
  await page.getByTestId('copy-confirm').click()
  await expect.poll(() => f.localCalls.filter((c) => c.action === 'print').length).toBe(1)
  return { ...f, preview }
}
async function noReprint(page: Page, f: Awaited<ReturnType<typeof printing>>) {
  await page.clock.fastForward(65_000)
  expect(f.localCalls.filter((c) => c.action === 'print')).toHaveLength(1)
  expect(f.cloudCalls.filter((c) => c.action === 'confirm')).toHaveLength(1)
  expect(f.cloudCalls.filter((c) => c.action === 'cancel')).toHaveLength(0)
}
async function touchFloor(page: Page) {
  for (const button of await page.locator('.copy-touch button:enabled').all()) {
    const box = await button.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(48)
    expect(box!.height).toBeGreaterThanOrEqual(48)
    expect(await button.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(20)
  }
  const primary = page.getByTestId('copy-end')
  if (await primary.count()) expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(56)
}

test('cs-copy-print matches draft words and real stages, with no back, reprint, sheet count or output animation @w2', async ({ page, api }) => {
  const f = await printing(page, api)
  await expect(page.getByRole('heading', { name: '正在打印', exact: true })).toBeVisible()
  await expect(page.getByText('复印件会从出纸口出来，请留在机器旁。', { exact: true })).toBeVisible()
  await expect(page.getByText('出了几张，以出纸口为准', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '停止复印', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '问小青：纸没出来怎么办', exact: true })).toBeVisible()
  for (const phase of ['printing', 'dispatching', 'spooled']) {
    await f.report(phase)
    await expect(page.locator('.qxt-band')).toContainText('正在交给打印机')
    await expect(page.getByTestId('copy-print-progress')).not.toContainText(/正在出纸|已出.*张|第.*张|\d+\s*张/)
  }
  expect(await page.locator('.cc-print-hero *').evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).animationName === 'none'))).toBe(true)
  const print = f.localCalls.find((c) => c.action === 'print')!
  expect(print.body).toEqual({ copyId: print.body.copyId, generation: 1, operationId: expect.any(String) })
  expect(print.headers['x-copy-control']).toBeUndefined()
  expect(await page.evaluate(secrets)).not.toContain(COPY_CONTROL)
  await touchFloor(page)
  await page.screenshot({ path: 'test-results/copy-c3b2-print.png' })
})
test('handed leads to cs-copy-done, pickup/original reminders and explicit end, never claims received paper @w2', async ({ page, api }) => {
  const f = await printing(page, api)
  await f.report('handed')
  await expect(page.getByRole('heading', { name: '请到出纸口取走复印件', exact: true })).toBeVisible()
  await expect(page.locator('.qxt-band')).toContainText('已交给打印机')
  for (const text of ['原件还在玻璃上或进纸器里，请和复印件一起带走', '出纸口在下面', '先看出纸口，再看玻璃台和进纸器。']) {
    await expect(page.getByText(text, { exact: true })).toBeVisible()
  }
  await expect(page.getByText(/没出纸？看打印机屏幕上的提示/)).toContainText('这次不会自动重打，也不会重复收费')
  await touchFloor(page)
  await page.screenshot({ path: 'test-results/copy-c3b2-done.png' })
  await noReprint(page, f)
})
test('unconfirmed leads to cs-copy-unconfirmed with no second print and no repeated charge @w2', async ({ page, api }) => {
  const f = await printing(page, api)
  await f.report('unconfirmed')
  await expect(page.getByRole('heading', { name: '这次没收到打印结果', exact: true })).toBeVisible()
  for (const text of ['先看出纸口；这次不会自动重打', '先看出纸口是否已有纸张', '没收到打印结果，不能确定纸有没有出来。',
    '这次不会自动重打，先别再点复印', '不猜成功也不猜失败，免得多印。', '这次不会自动重打，也不会重复收费',
    '原件还在玻璃上或进纸器里，请和复印件一起带走']) await expect(page.getByText(text, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^纸出来了，结束/ })).toHaveCount(2)
  await touchFloor(page)
  await page.screenshot({ path: 'test-results/copy-c3b2-unconfirmed.png' })
  await noReprint(page, f)
})
test('failed leads to error screen with panel guide/home only, no retry that could reprint @w2', async ({ page, api }) => {
  const f = await printing(page, api)
  await f.report('failed', 3, 'COPY_PRINT_FAILED')
  await expect(page.getByRole('heading', { name: '打印失败', exact: true })).toBeVisible()
  await expect(page.getByTestId('copy-device-error')).toContainText('这次不会自动重打，也不会重复收费')
  await expect(page.getByRole('button', { name: /再试|重新开始|重打/ })).toHaveCount(0)
  await page.getByRole('button', { name: '改用面板复印', exact: true }).click()
  await expect(page).toHaveURL(/\/print-scan\/feature\/copy$/)
  await expect.poll(() => f.localCalls.filter((c) => c.action === 'clear').length).toBeGreaterThan(0)
  expect(f.localCalls.filter((c) => c.action === 'print')).toHaveLength(1)
  expect(f.cloudCalls.some((c) => c.action === 'cancel')).toBe(false)
})
for (const kind of ['print', 'status'] as const) test(`local ${kind} disconnected uses unconfirmed words and queries same cloud order @w2`, async ({ page, api }) => {
  const f = await printing(page, api, kind === 'print' ? { fail: 'print' } : { statusAfterPrintFails: true })
  if (kind === 'status') { await page.clock.fastForward(3100); await page.clock.fastForward(3100) }
  await expect(page.getByRole('heading', { name: '这次没收到打印结果', exact: true })).toBeVisible()
  expect(f.cloudCalls.filter((c) => c.action === 'quote').length).toBeGreaterThanOrEqual(2)
  await noReprint(page, f)
})
for (const [state, label] of [['handed', '拿到了，结束'], ['unconfirmed', '纸出来了，结束']] as const) {
  test(`${state} end clears locally even if clear fails and drops preview/token without cancel @w2`, async ({ page, api }) => {
    const f = await printing(page, api, { fail: 'clear' })
    await f.report(state)
    await page.getByTestId('copy-end').filter({ hasText: label }).click()
    await expect(page.getByRole('heading', { name: '怎么复印？', exact: true })).toBeVisible()
    await expect.poll(() => f.localCalls.filter((c) => c.action === 'clear').length).toBeGreaterThan(0)
    expect(await page.evaluate(secrets)).not.toContain(COPY_CONTROL)
    await expect.poll(() => f.revokedUrls).toEqual(expect.arrayContaining(f.preview))
    expect(f.cloudCalls.some((c) => c.action === 'cancel')).toBe(false)
    expect(f.localCalls.some((c) => c.action === 'abort')).toBe(false)
  })
}
for (const mode of ['home', 'idle', 'logout', 'ask'] as const) test(`after dispatch ${mode} clears and never calls cancel/abort @w2`, async ({ page, api }) => {
  const f = await printing(page, api, { clearDelayed: true })
  if (mode === 'idle') await page.clock.fastForward(181_000)
  else if (mode === 'logout') {
    await page.clock.runFor(151_000)
    await page.getByTestId('session-guard-clear').click()
  } else await page.getByRole('button', { name: mode === 'ask' ? '问小青：纸没出来怎么办' : '首页', exact: true }).click()
  await expect(page.getByTestId('copy-print-progress')).toHaveCount(0)
  await expect.poll(() => f.localCalls.filter((c) => c.action === 'clear').length).toBeGreaterThan(0)
  await expect.poll(() => f.revokedUrls).toEqual(expect.arrayContaining(f.preview))
  expect(f.cloudCalls.some((c) => c.action === 'cancel')).toBe(false)
  expect(f.localCalls.some((c) => c.action === 'abort')).toBe(false)
  expect(await page.evaluate(secrets)).not.toContain(COPY_CONTROL)
  f.releaseClear()
})
test('unconfirmed card end shares cleanup with dock end @w2', async ({ page, api }) => {
  const f = await printing(page, api)
  await f.report('unconfirmed')
  await page.locator('.cc-result-actions').getByRole('button', { name: /^纸出来了，结束/ }).click()
  await expect(page.getByRole('heading', { name: '怎么复印？', exact: true })).toBeVisible()
  await expect.poll(() => f.localCalls.filter((c) => c.action === 'clear').length).toBeGreaterThan(0)
})
test('service phone and hours come from configuration; no demo phone/hours when absent @w2', async ({ page, api }) => {
  const f = await printing(page, api, { noPhone: true })
  await f.report('handed')
  await expect(page.getByText(/拨打服务电话|服务时间：/)).toHaveCount(0)
  // 终态不倒退；独立场景由下一条覆盖未确认电话弹层。
})
test('unconfirmed real contact opens the draft phone dialog @w2', async ({ page, api }) => {
  const f = await printing(page, api)
  await f.report('unconfirmed')
  await page.getByRole('button', { name: /^需要帮助，拨打服务电话/ }).click()
  await expect(page.getByRole('dialog', { name: '服务电话', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('请用自己的手机拨打。')
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('unconfirmed without configured phone hides its phone card and service hours @w2', async ({ page, api }) => {
  const f = await printing(page, api, { noPhone: true })
  await f.report('unconfirmed')
  await expect(page.getByRole('button', { name: /拨打服务电话/ })).toHaveCount(0)
  await expect(page.getByText(/服务时间：/)).toHaveCount(0)
})
for (const [code, title] of [['feeder_empty', '进纸器里没有纸'], ['paper_jam', '卡纸或盖板没合上'], ['COPY_DEVICE_BUSY', '打印机正在忙'],
  ['timeout', '等太久没有结果'], ['too_large', '这次超过了这台机器能收的大小'], ['unknown', '扫描仪没有响应'],
  ['COPY_CAPABILITY_REVOKED', '这台机器暂时只能在打印机面板上复印']] as const) {
  test(`scanner error ${code} uses draft error layout and cannot print @w2`, async ({ page, api }) => {
    const f = await copyDeviceFixture(page, api, { feeder: true })
    await f.start(); await f.report('failed', 0, code)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    expect(f.localCalls.some((c) => c.action === 'print')).toBe(false)
    await expect(page.getByRole('button', { name: /^改用面板复印/ }).first()).toBeVisible()
    await touchFloor(page)
  })
}
test('scanner retry clears and cancels the old job before a new start; never silently rescans @w2', async ({ page, api }) => {
  const f = await copyDeviceFixture(page, api, { feeder: true })
  await f.start(); await f.report('failed', 0, 'feeder_empty')
  await expect(page.getByRole('heading', { name: '进纸器里没有纸', exact: true })).toBeVisible()
  await page.clock.fastForward(6100)
  expect(f.localCalls.filter((c) => c.action === 'start')).toHaveLength(1)
  expect(f.calls.filter((c) => c.path === '/api/v1/copy/jobs')).toHaveLength(1)
  await page.getByRole('button', { name: '放好纸再试', exact: true }).click()
  await expect.poll(() => f.localCalls.filter((c) => c.action === 'start').length).toBe(2)
  expect(f.cloudCalls.filter((c) => c.action === 'cancel')).toHaveLength(1)
  const starts = f.localCalls.filter((c) => c.action === 'start')
  expect(starts.map((c) => c.body.source)).toEqual(['feeder', 'feeder'])
  expect(starts[0].body.copyId).not.toBe(starts[1].body.copyId)
  expect(f.localCalls.findIndex((c) => c.action === 'clear')).toBeLessThan(f.localCalls.lastIndexOf(starts[1]))
  const creates = f.calls.filter((c) => c.path === '/api/v1/copy/jobs')
  expect(creates).toHaveLength(2)
  expect(f.calls.findIndex((c) => c.path.endsWith('/cancel'))).toBeLessThan(
    f.calls.indexOf(creates[1]))
})
