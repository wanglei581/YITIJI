import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { RECRUITMENT_HOSTING_ON } from '../fixtures/recruitment-hosting'

function terminalBaseline(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: false, modules: {}, items: [] },
      toolbox: { enabled: false, items: [] },
      ...RECRUITMENT_HOSTING_ON,
      configVersion: 'w3',
      refreshIntervalMs: 300000,
      serverTime: '2026-07-24T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { data: { asrEnabled: false, ttsEnabled: false } } })
}

test('assistant chat probe down locks the composer and keeps manual entries @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  api.respond('GET', '/api/v1/assistant/availability', {
    status: 200,
    json: { success: true, data: { available: false } },
  })

  await page.goto('/assistant')

  await expect(page.getByText('小青这会儿没有接上。下面这些事不用问也能办。')).toBeVisible()
  await expect(page.locator('.qxt-status')).toHaveText('AI 暂不可用')
  await expect(page.locator('.assistant-send')).toHaveCount(0)
  await expect(page.getByLabel('输入咨询问题')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '不依赖 AI 的功能入口' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^打印扫描/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^政策服务/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^AI简历服务/ })).toBeVisible()
  expect(api.requestCount('POST', '/api/v1/assistant/chat')).toBe(0)
  expect(runtimeErrors).toEqual([])
})

test('assistant chat probe unread stays unconfirmed and keeps the composer @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  api.abort('GET', '/api/v1/assistant/availability', 'timedout')

  await page.goto('/assistant')
  await expect.poll(() => api.requestCount('GET', '/api/v1/assistant/availability')).toBeGreaterThan(0)
  // 失败已经回到页面之后再看：不锁输入，也不写成能用。
  await page.evaluate(() => new Promise((resolve) => { window.setTimeout(resolve, 400) }))

  await expect(page.locator('.qxt-status')).toHaveText('AI 状态待本轮返回确认')
  await expect(page.getByLabel('输入咨询问题')).toBeVisible()
  await expect(page.locator('.assistant-send')).toBeVisible()
  await expect(page.getByText('小青这会儿没有接上。下面这些事不用问也能办。')).toHaveCount(0)
  await expect(page.getByText('AI 暂不可用')).toHaveCount(0)
  await expect(page.getByText('真实模型已应答')).toHaveCount(0)
  expect(api.requestCount('POST', '/api/v1/assistant/chat')).toBe(0)
  expect(runtimeErrors).toEqual([])
})
