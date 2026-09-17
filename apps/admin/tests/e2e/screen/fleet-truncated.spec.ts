import { test, expect } from '@playwright/test'
import { govFull, opsFull } from './fixtures/snapshots'
import { geometry, open, serveByProfile } from './helpers'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 机队被截断时的样本口径。
 *
 * 服务端对机队列表有取数上限，`healthy/degraded/offline` 全是**样本内**计数，
 * `matchedCount` 才是全量。既有夹具一律 `truncated:false`，于是
 * OpsGrid / GovGrid 的「（分母为样本台数）」分支**一次都没被渲染过** ——
 * 属于「写了但从不运行」。这条专门把它跑起来。
 *
 * 顺带量几何：该后缀让 KPI 副行明显变长，而卡片是定高的，
 * 加一行就可能把 `.ops-body` 挤到溢出。所以不止断言文案，也跑一遍 geometry。
 */

const SHOT_DIR = join(process.cwd(), '..', '..', 'test-results', 'console-screen-shots')
mkdirSync(SHOT_DIR, { recursive: true })

/** ops profile 没有 fleetWall 卡，只有 terminalsOnline；逐个判在不在，别假设两端同构。 */
function truncate<T extends { metrics: Record<string, unknown> }>(snap: T): T {
  for (const key of ['terminalsOnline', 'fleetWall']) {
    const metric = snap.metrics[key] as { value?: Record<string, unknown> } | undefined
    if (!metric?.value) continue
    metric.value = { ...metric.value, matchedCount: 640, sampleCap: 42, truncated: true }
  }
  return snap
}

for (const profile of ['gov', 'ops'] as const) {
  test(`${profile}：机队截断时标明分母为样本台数，且不撑破定高卡`, async ({ page }, testInfo) => {
    const wall = testInfo.project.name.includes('wall')
    await serveByProfile(page, { gov: truncate(govFull()), ops: truncate(opsFull()) })
    await open(page, `/screen?profile=${profile}`)
    if (wall) await page.getByRole('button', { name: '全屏演示' }).click()
    await expect(page.locator('.ops-card').first()).toBeVisible()
    await page.waitForTimeout(350)

    // 样本 ≠ 全量：33 台正常是**样本内**的，绝不能读成「640 台里只有 33 台正常」
    const online = page.locator('.ops-card').filter({ hasText: '在网终端' })
    await expect(online).toContainText('分母为样本台数')
    await expect(online).toContainText('以下分类基于前 42 台样本')
    await expect(online).toContainText('共 640 台')

    const report = await geometry(page, wall ? 13 : 12)
    expect(report.clipped, '截断分支下卡片内容不得被裁剪').toEqual([])
    expect(report.overlaps, '截断分支下卡片同级元素不得重叠').toEqual([])
    expect(report.tinyText, `截断分支下可见文字不得小于 ${wall ? 13 : 12}px`).toEqual([])
    expect(report.scrollW, '任何视口都不得横向滚动').toBeLessThanOrEqual(report.clientW)
    if (wall) {
      expect(report.scrollH, '舞台档不得纵向滚动').toBeLessThanOrEqual(report.clientH + 1)
    }

    const shot = join(SHOT_DIR, `admin-${profile}-truncated-${testInfo.project.name}.png`)
    await page.screenshot({ path: shot, animations: 'disabled' })
    await testInfo.attach(`admin-${profile}-truncated-${testInfo.project.name}`, {
      path: shot,
      contentType: 'image/png',
    })
  })
}
