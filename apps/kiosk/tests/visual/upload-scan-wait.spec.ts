import type { Locator, Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { allowLocalBootTicket, registerPrivacyShell } from './fixtures/privacy-clear-shell'

// playwright.w3.config.ts 已接入 testMatch 和 @w3-kiosk；仅用页面时钟，不改隐私时限。
const NOTICE = '等你传文件期间，这台机器不会自动退出。二维码到期后没有操作，就会自动退出。'
const CASES = [
  { label: '简历来源', path: '/resume/source', purpose: 'resume_upload', qr: '.resume-source-phone-session svg[width="150"]', renew: '刷新二维码', leave: '返回 AI 简历服务' },
  { label: '打印上传', path: '/print/upload?source=document&tab=qr', purpose: 'print_doc', qr: '[data-testid="file-source-qr"] svg', renew: '重新出一张码', leave: '返回打印扫描' },
] as const

type Case = typeof CASES[number]

async function openWaiting(page: Page, api: ApiRouter, item: Case) {
  await page.clock.install()
  registerPrivacyShell(api)
  await allowLocalBootTicket(page)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', { status: 200, json: { success: true, data: { capabilities: [{ capabilityKey: 'usb_import', status: 'available', configured: true, note: null }] } } })
  let creates = 0
  const cancelled: { id: string; control: string | undefined }[] = []
  const sessions = new Map<string, string>()
  // URL 函数按 pathname 匹配，兼容查询串；Node 的 Date.now 不参与会话到期计算。
  await page.route((url) => /^\/api\/v1\/upload-sessions(?:\/[^/]+)?$/.test(url.pathname), async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      const id = `scan-wait-${++creates}`
      const expiresAt = await page.evaluate(() => new Date(Date.now() + 600_000).toISOString())
      sessions.set(id, expiresAt)
      await route.fulfill({ json: { success: true, data: { sessionId: id, uploadToken: 'scan-upload', controlToken: `control-${id}`, uploadUrl: '/upload/phone', expiresAt } } })
      return
    }
    const id = new URL(request.url()).pathname.split('/').at(-1)!
    if (request.method() === 'DELETE') cancelled.push({ id, control: request.headers()['x-upload-session-control'] })
    // 即使轮询返回 pending，客户端仍须按真实 expiresAt 到期，不能被迟到的应答重新锁住。
    await route.fulfill({ json: { success: true, data: { sessionId: id, status: request.method() === 'DELETE' ? 'cancelled' : 'pending', purpose: item.purpose, mode: 'temporary', file: null, requiresKioskConfirmation: false, expiresAt: sessions.get(id) } } })
  })
  await page.goto(item.path)
  // 简历来源页要先点「手机扫码上传」这条来源，上传码面板才出现。
  if (item.purpose === 'resume_upload') await page.getByRole('button', { name: /手机扫码上传/ }).click()
  await expect(page.getByText(NOTICE, { exact: true })).toBeVisible()
  await expect(page.locator(item.qr)).toBeVisible()
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000)
  return { cancelled, creates: () => creates }
}

async function expectOriginalPage(page: Page, item: Case) {
  await expect(page).toHaveURL((url) => url.pathname === item.path.split('?')[0])
  await expect(page.locator(item.qr)).toBeVisible()
  await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
}

async function expectTapTarget(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  expect(box.width).toBeGreaterThanOrEqual(48)
  expect(box.height).toBeGreaterThanOrEqual(48)
  expect(await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return hit !== null && (hit === element || element.contains(hit))
  }), '按钮中心可由指针命中').toBe(true)
}

async function expectLayout(page: Page, qr: Locator) {
  expect(await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  })), '提示不造成页面横向溢出').toEqual({ body: 0, root: 0 })
  expect(await page.evaluate(() => ({
    body: document.body.scrollHeight - document.body.clientHeight,
    root: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  })), '提示不造成页面纵向溢出').toEqual({ body: 0, root: 0 })
  const box = await qr.boundingBox()
  expect(box).not.toBeNull()
  if (box) {
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  }
}

for (const item of CASES) {
  test(`${item.label}：等待 200 秒、60 秒提醒、触屏后过期及正常 180 秒清场 @w3-kiosk`, async ({ page, api }) => {
    await openWaiting(page, api, item)
    // a：查询 enabled 和指针命中都不触屏、不导航，证明简历页换来源的出口没被 phoneBusy 锁住。
    await page.clock.runFor(200_000)
    await expectOriginalPage(page, item)
    if (item.purpose === 'resume_upload') {
      // 手机扫码这一屏上换来源的出口是「回到来源选择」；等码期间它不能被锁住（03156ba28c 当初改 received 就为这个）。
      const back = page.getByRole('button', { name: '回到来源选择', exact: true })
      await expect(back).toBeEnabled()
      await expectTapTarget(back)
    }
    const qr = page.locator(item.qr)
    const before = await qr.boundingBox()
    // b：到第 545 秒，真实剩余不到 60 秒。
    await page.clock.runFor(345_000)
    const warning = page.getByRole('status').filter({ hasText: '二维码还剩' })
    await expect(warning).toHaveText(/二维码还剩 0:\d{2}。还在传的话点一下屏幕，到期后可以在这里重新出码。/)
    await expectLayout(page, qr)
    await page.screenshot({ path: test.info().outputPath('scan-wait-warning.png') })
    const after = await qr.boundingBox()
    expect(after?.width, '提示不挤小二维码').toBe(before?.width)
    expect(after?.height, '提示不挤小二维码').toBe(before?.height)
    // c：点提示条算一次真实 pointerdown；到期后原页仍在且重新出码按钮可点。
    await warning.click()
    await page.clock.runFor(56_000)
    await expect(page).toHaveURL((url) => url.pathname === item.path.split('?')[0])
    await expect(page.getByText(item.purpose === 'resume_upload' ? '二维码已过期' : '这张上传码已失效', { exact: true })).toBeVisible()
    const renew = page.getByRole('button', { name: item.renew, exact: true })
    await expect(renew).toBeEnabled()
    await expectTapTarget(renew)
    expect((await renew.boundingBox())!.height).toBeGreaterThanOrEqual(56)
    await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
    // 既有 180 秒包含最后 30 秒预警：150 秒开始预警，180 秒清场；不另加时限。
    await page.clock.runFor(140_000)
    await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
    await page.clock.runFor(15_000)
    await expect(page).toHaveURL(/\/session-timeout$/)
    await expect(page.locator('[data-screen="session-guard"]')).toBeVisible()
    await page.clock.runFor(26_000)
    await expect(page).toHaveURL(/\/$/)
  })

  test(`${item.label}：全程不触屏，码到期释放锁后硬清场回首页 @w3-kiosk`, async ({ page, api }) => {
    await openWaiting(page, api, item)
    await page.clock.runFor(545_000)
    await expectOriginalPage(page, item)
    await expect(page.getByRole('status').filter({ hasText: '二维码还剩' })).toBeVisible()
    await page.clock.runFor(58_000)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
    await expect(page.locator(item.qr)).toHaveCount(0)
  })

  test(`${item.label}：等待中离页只作废一次旧会话 @w3-kiosk`, async ({ page, api }) => {
    const state = await openWaiting(page, api, item)
    expect(state.creates()).toBe(1)
    expect(state.cancelled).toHaveLength(0)
    await page.getByRole('button', { name: item.leave, exact: true }).click()
    await expect(page).not.toHaveURL((url) => url.pathname === item.path.split('?')[0])
    await expect.poll(() => state.cancelled.length).toBe(1)
    await page.clock.runFor(5_000)
    expect(state.cancelled).toEqual([{ id: 'scan-wait-1', control: 'control-scan-wait-1' }])
  })

  test(`${item.label}：过期按钮点击沿用旧码作废再建新码 @w3-kiosk`, async ({ page, api }) => {
    const state = await openWaiting(page, api, item)
    await page.clock.runFor(545_000)
    await page.getByRole('status').filter({ hasText: '二维码还剩' }).click()
    await page.clock.runFor(56_000)
    const renew = page.getByRole('button', { name: item.renew, exact: true })
    await expect(renew).toBeVisible()
    await renew.click()
    await expect(page.getByText(NOTICE, { exact: true })).toBeVisible()
    await expect(page.locator(item.qr)).toBeVisible()
    expect(state.creates()).toBe(2)
    expect(state.cancelled).toHaveLength(1)
  })
}
