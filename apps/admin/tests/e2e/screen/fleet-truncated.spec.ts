import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { govFull, opsFull } from './fixtures/snapshots'
import { geometry, open, serveByProfile } from './helpers'

/**
 * 机队被截断时，分类计数是样本内的。
 * 运营看板卡片仍写「分母为样本台数」；政务总览写「显示前 N 台」并在口径说明里写全句。
 */

const SHOT_DIR = join(process.cwd(), '..', '..', 'test-results', 'console-screen-shots')
mkdirSync(SHOT_DIR, { recursive: true })

function truncate<T extends { metrics: Record<string, { value?: Record<string, unknown> }> }>(snap: T): T {
  for (const key of ['terminalsOnline', 'fleetWall']) {
    const metric = snap.metrics[key]
    if (!metric?.value) continue
    metric.value = { ...metric.value, matchedCount: 640, sampleCap: 42, truncated: true }
  }
  return snap
}

test('gov：截断时写明样本，面板不被撑破', async ({ page }, testInfo) => {
  const wall = testInfo.project.name.includes('wall')
  await serveByProfile(page, { gov: truncate(govFull()), ops: truncate(opsFull()) })
  await open(page, wall ? '/screen/gov?display=1' : '/screen/gov')
  await expect(page.getByText(/显示前 42 台/)).toBeVisible()
  await page.getByRole('button', { name: '终端与服务的口径说明' }).click()
  await expect(page.getByText('以下分类基于前 42 台样本，共 640 台')).toBeVisible()
  const report = await geometry(page, wall ? 13 : 12, wall)
  expect(report.childOverflow, '截断分支下面板内容不得溢出').toEqual([])
  expect(report.panelOverlaps).toEqual([])
  expect(report.tinyText).toEqual([])
  expect(report.scrollW).toBeLessThanOrEqual(report.clientW + 1)
  if (wall) {
    expect(report.outsideViewport).toEqual([])
    expect(report.scrollH).toBeLessThanOrEqual(report.clientH + 1)
  }
  const shot = join(SHOT_DIR, `admin-gov-truncated-${testInfo.project.name}.png`)
  await page.screenshot({ path: shot, animations: 'disabled' })
  await testInfo.attach('gov-truncated', { path: shot, contentType: 'image/png' })
})

test('ops：截断时标明分母为样本台数，且不撑破定高卡', async ({ page }, testInfo) => {
  const wall = testInfo.project.name.includes('wall')
  await serveByProfile(page, { gov: truncate(govFull()), ops: truncate(opsFull()) })
  await open(page, wall ? '/screen/ops?display=1' : '/screen/ops')
  const online = page.locator('.ops-card').filter({ hasText: '在网终端' })
  await expect(online).toContainText('分母为样本台数')
  await expect(online).toContainText('以下分类基于前 42 台样本，共 640 台')
  const report = await geometry(page, wall ? 13 : 12, wall)
  expect(report.childOverflow, '截断分支下卡片内容不得溢出').toEqual([])
  expect(report.panelOverlaps).toEqual([])
  expect(report.tinyText).toEqual([])
  expect(report.scrollW).toBeLessThanOrEqual(report.clientW + 1)
  if (wall) {
    expect(report.outsideViewport).toEqual([])
    expect(report.scrollH).toBeLessThanOrEqual(report.clientH + 1)
  }
  const shot = join(SHOT_DIR, `admin-ops-truncated-${testInfo.project.name}.png`)
  await page.screenshot({ path: shot, animations: 'disabled' })
  await testInfo.attach('ops-truncated', { path: shot, contentType: 'image/png' })
})
