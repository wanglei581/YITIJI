// 青序壳顶栏时钟：任一 QxPageFrame 页（这里用 /help）右上角只有一只 HH:MM，
// 跨过整分钟后更新。首页和待机屏不走这个壳，本页不应再出现它们的时钟。
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
}

test('help topbar shows one HH:MM clock and advances on the minute', async ({ page, api }) => {
  registerShell(api)
  await page.clock.install({ time: new Date('2026-10-06T01:30:20.000Z') })
  await page.goto('/help', { waitUntil: 'domcontentloaded' })

  const clock = page.locator('.qx-topbar time.qx-topbar-clock')
  await expect(clock).toHaveCount(1)
  await expect(page.locator('.qx-home-clock')).toHaveCount(0)
  await expect(page.locator('.sb-clock')).toHaveCount(0)
  await expect(page.getByRole('time')).toHaveCount(1)

  const before = ((await clock.textContent()) ?? '').trim()
  expect(before).toMatch(/^\d{2}:\d{2}$/)
  await expect(clock).toHaveAccessibleName(`当前时间 ${before}`)

  const waitMs = await page.evaluate(() => 60_000 - (Date.now() % 60_000))
  await page.clock.fastForward(waitMs + 50)

  await expect(clock).not.toHaveText(before)
  const after = ((await clock.textContent()) ?? '').trim()
  expect(after).toMatch(/^\d{2}:\d{2}$/)
  await expect(clock).toHaveAccessibleName(`当前时间 ${after}`)
})
