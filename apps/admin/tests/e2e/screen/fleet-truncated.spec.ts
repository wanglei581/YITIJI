import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ScreenFleetWallValue, ScreenSnapshot } from '@ai-job-print/shared'
import { govFull, opsFull } from './fixtures/snapshots'
import { adminApi, open, panel, serve, uncaughtPageErrors } from './helpers'
import { geometry } from './measure'

/**
 * 机队被截断时的样本口径。
 *
 * 服务端对机队列表有取数上限，`healthy/degraded/offline` 全是**样本内**计数，
 * `matchedCount` 才是全量。默认夹具一律 `truncated:false`，于是「样本台数」那一支
 * 一次都不会被渲染 —— 属于「写了但从不运行」。这条专门把它跑起来。
 *
 * 顺带量几何：截断说明让副行明显变长，而块位是定高的，加一行就可能把面板挤到溢出。
 */

const SHOT_DIR = join(process.cwd(), '..', '..', 'test-results', 'console-screen-shots')
mkdirSync(SHOT_DIR, { recursive: true })

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page), '页面不得有未捕获异常').toEqual([])
})

/** ops 没有 fleetWall，只有 terminalsOnline；逐个判在不在，别假设两端同构。 */
function truncate(snap: ScreenSnapshot): ScreenSnapshot {
  for (const key of ['terminalsOnline', 'fleetWall'] as const) {
    const metric = snap.metrics[key]
    if (!metric || metric.available !== true) continue
    const value = metric.value as ScreenFleetWallValue
    ;(metric as { value: ScreenFleetWallValue }).value = { ...value, matchedCount: 640, sampleCap: 42, truncated: true }
  }
  return snap
}

test('gov：机队截断时写明「显示前 42 台」，环的分母是样本台数，面板不被撑破', async ({ page }, testInfo) => {
  const wall = testInfo.project.name.includes('wall')
  await serve(page, adminApi({ gov: () => truncate(govFull()), ops: () => truncate(opsFull()) }))
  await open(page, wall ? '/screen/gov?display=1' : '/screen/gov')
  // 样本 ≠ 全量：33 台正常是样本内的，绝不能读成「640 台里只有 33 台正常」
  await expect(page.locator('.twin-overlay.is-tl')).toContainText('终端分布 · 640 台')
  await expect(page.locator('.twin-overlay.is-tl')).toContainText('（显示前 42 台）')
  const summary = panel(page, /^终端与服务$/)
  await expect(summary.locator('.twin-big')).toHaveText('33')
  await expect(summary).toContainText('正常 · 共 42 台')
  await expect(summary).not.toContainText('共 640 台')
  await summary.getByRole('button', { name: '终端与服务的口径说明' }).click()
  await expect(summary.locator('.twin-pop')).toContainText('以下分类基于前 42 台样本，共 640 台')
  await summary.getByRole('button', { name: '终端与服务的口径说明' }).click()

  const floor = wall ? 13 : 12
  const report = await geometry(page, floor)
  expect(report.overlaps, '截断分支下面板不得重叠').toEqual([])
  expect(report.textEscapes, '截断分支下文字不得跑出面板').toEqual([])
  expect(report.textCut, '截断分支下文字不得被裁切').toEqual([])
  expect(report.squeezed, '截断分支下文字不得被压扁').toEqual([])
  expect(report.tinyText, `截断分支下可见文字不得小于 ${floor}px`).toEqual([])
  expect(report.scroll.w, '任何视口都不得横向滚动').toBeLessThanOrEqual(report.scroll.clientW)
  if (wall) {
    expect(report.outsideViewport).toEqual([])
    expect(report.scroll.h, '舞台档不得纵向滚动').toBeLessThanOrEqual(report.scroll.clientH)
  }

  const shot = join(SHOT_DIR, `admin-gov-truncated-${testInfo.project.name}.png`)
  await page.screenshot({ path: shot, animations: 'disabled' })
  await testInfo.attach(`admin-gov-truncated-${testInfo.project.name}`, { path: shot, contentType: 'image/png' })
})

test('ops：机队截断时标明分母为样本台数，且不撑破定高卡', async ({ page }, testInfo) => {
  const wall = testInfo.project.name.includes('wall')
  await serve(page, adminApi({ gov: () => truncate(govFull()), ops: () => truncate(opsFull()) }))
  await open(page, wall ? '/screen/ops?display=1' : '/screen/ops')
  const online = page.locator('.ops-card').filter({ hasText: '在网终端' })
  await expect(online).toContainText('分母为样本台数')
  await expect(online).toContainText('以下分类基于前 42 台样本')
  await expect(online).toContainText('共 640 台')
  await expect(online.locator('.ops-u')).toHaveText('/ 42 台')

  const floor = wall ? 13 : 12
  const report = await geometry(page, floor)
  expect(report.cards).toBe(12)
  expect(report.overlaps, '截断分支下卡片不得重叠').toEqual([])
  expect(report.cardChildOverlaps, '截断分支下卡片同级元素不得重叠').toEqual([])
  expect(report.textEscapes, '截断分支下文字不得跑出卡片').toEqual([])
  expect(report.textCut, '截断分支下卡片内容不得被裁剪').toEqual([])
  expect(report.squeezed, '截断分支下文字不得被压扁').toEqual([])
  expect(report.tinyText, `截断分支下可见文字不得小于 ${floor}px`).toEqual([])
  expect(report.scroll.w, '任何视口都不得横向滚动').toBeLessThanOrEqual(report.scroll.clientW)
  if (wall) {
    expect(report.outsideViewport).toEqual([])
    expect(report.scroll.h, '舞台档不得纵向滚动').toBeLessThanOrEqual(report.scroll.clientH)
  }

  const shot = join(SHOT_DIR, `admin-ops-truncated-${testInfo.project.name}.png`)
  await page.screenshot({ path: shot, animations: 'disabled' })
  await testInfo.attach(`admin-ops-truncated-${testInfo.project.name}`, { path: shot, contentType: 'image/png' })
})
