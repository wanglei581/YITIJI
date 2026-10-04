import { test, expect } from '@playwright/test'
import { terminalTwin, usageSnapshot } from './fixtures/snapshots'
import { adminApi, open, panel, serve, uncaughtPageErrors } from './helpers'

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page)).toEqual([])
})

test('第六批：任何打印单数下状态带无打印色块及图例，固定说明保留', async ({ page }) => {
  let count = 0
  const twin = (id: string) => {
    const base = terminalTwin(id)
    if (!base) return base
    base.today.printTasks = count > 0 && count < 5 ? null : count
    // 专门注入旧版本打印段，验证兼容响应也只表达在线空闲。
    base.timeline24h = { available: true, source: 'TerminalHeartbeat', window: '24h', value: [{ from: '2026-10-03T04:00Z', to: '2026-10-04T04:00Z', state: 'printing' }] } as unknown as typeof base.timeline24h
    return base
  }
  await serve(page, adminApi({ twin }))
  await open(page, '/screen/terminal?id=t-gz-th-005')
  const band = page.getByRole('img', { name: '近 24 小时状态', exact: true })
  for (count of [0, 3, 4, 5, 12]) {
    if (count !== 0) await page.reload()
    await expect(band).toBeVisible()
    const status = panel(page, /^24 小时状态$/)
    await expect(status).toContainText('打印时段不在状态带上单独标出，今日打印单数见上方。')
    await expect(status.locator('.twin-legend')).not.toContainText('打印中')
    expect(await band.locator('div').evaluateAll((nodes) => nodes.filter((n) => getComputedStyle(n).backgroundColor === 'rgb(114, 214, 255)').length)).toBe(0)
  }
})

test('第六批：热力与脉冲null均画最浅档、不写数字，峰值只来自可见格', async ({ page }) => {
  await serve(page, adminApi({ usage: (range) => {
    const snapshot = usageSnapshot(range)
    snapshot.metrics.heat7d = { available: true, source: 'mixed', window: '7d', value: {
      days: [{ date: snapshot.generatedAt.slice(0, 10), hours: Array.from({ length: 24 }, (_, i) => i === 0 ? 5 : null) }], peakHour: 0,
    } }
    snapshot.metrics.pulse2h = { available: true, source: 'mixed', window: '2h', value: { bucketMinutes: 5,
      buckets: [{ start: snapshot.generatedAt, info: null, ai: 5, print: null }],
    } }
    return snapshot
  } }))
  await open(page, '/screen/usage?range=today')
  const heat = panel(page, /^使用时段热力$/)
  await expect(heat).toContainText('不足 5 次的时段不写数字')
  await expect(heat).toContainText('高峰在 0–1 时')
  await expect(heat.locator('.twin-heat i.is-hidden')).toHaveCount(23)
  await expect(heat.locator('.twin-heat i.is-hidden').first()).toHaveCSS('background-color', 'rgba(46, 230, 168, 0.12)')
  expect((await heat.locator('.twin-heat i.is-hidden').allTextContents()).every((t) => t === '')).toBe(true)
  const pulse = panel(page, /^实时调用脉冲$/)
  await expect(pulse).toContainText('不足 5 次的时段不写数字')
  await expect(pulse).toContainText('信息 —')
  await expect(pulse).toContainText('AI 5')
  await expect(pulse).toContainText('打印 —')
  await expect(pulse.locator('.twin-pulse i.is-hidden')).toHaveCount(2)
  await expect(pulse.locator('.twin-pulse i.is-hidden').first()).toHaveCSS('background-color', 'rgba(46, 230, 168, 0.12)')
})
