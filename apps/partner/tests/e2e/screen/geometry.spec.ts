import { test, expect } from '@playwright/test'
import { partnerFull } from './fixtures/snapshots'
import { geometry, open, serveJson } from './helpers'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SHOT_DIR = join(process.cwd(), '..', '..', 'test-results', 'console-screen-shots')
mkdirSync(SHOT_DIR, { recursive: true })

test('机构大屏：几何、脚注、字号与色彩', async ({ page }, testInfo) => {
  const wall = testInfo.project.name.includes('wall')
  await serveJson(page, partnerFull())
  await open(page, '/screen')
  if (wall) await page.getByRole('button', { name: '全屏演示' }).click()
  await expect(page.locator('.ops-card').first()).toBeVisible()
  await page.waitForTimeout(320)

  const report = await geometry(page, wall ? 13 : 12)
  expect(report.cards).toBe(8)
  expect(report.footless, '每块卡片都必须有来源脚注').toEqual([])
  expect(report.nestedCards, '不允许卡片套卡片').toBe(0)
  expect(report.clipped, '卡片内容不得被裁剪').toEqual([])
  expect(report.overlaps, '卡片同级元素不得重叠').toEqual([])
  expect(report.tinyText, `可见文字不得小于 ${wall ? 13 : 12}px`).toEqual([])
  expect(report.scrollW).toBeLessThanOrEqual(report.clientW)
  if (wall) expect(report.scrollH).toBeLessThanOrEqual(report.clientH + 1)
  expect(report.hues.length).toBeGreaterThanOrEqual(4)

  const shot = join(SHOT_DIR, `partner-${testInfo.project.name}.png`)
  await page.screenshot({ path: shot, fullPage: !wall, animations: 'disabled' })
  await testInfo.attach(`partner-${testInfo.project.name}`, { path: shot, contentType: 'image/png' })
})
