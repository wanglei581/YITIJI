import { test, expect } from '@playwright/test'
import { govFull, opsFull } from './fixtures/snapshots'
import { geometry, open, serveByProfile } from './helpers'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 几何与可读性。四项来自 docs/design/ops-screen-2026-09/probe.mjs
 * （无滚动 / 无裁剪 / 无重叠 / 每卡有脚注），另加卡中卡、字号下限、色彩多样性。
 *
 * 截图同时落盘，作为「1920×1080 适合领导展示，同时常规后台宽度可操作」的证据。
 */

const SHOT_DIR = join(process.cwd(), '..', '..', 'test-results', 'console-screen-shots')
mkdirSync(SHOT_DIR, { recursive: true })

for (const profile of ['gov', 'ops'] as const) {
  test(`${profile}：几何、脚注、字号与色彩`, async ({ page }, testInfo) => {
    const wall = testInfo.project.name.includes('wall')
    await serveByProfile(page, { gov: govFull(), ops: opsFull() })
    await open(page, `/screen?profile=${profile}`)
    if (wall) await page.getByRole('button', { name: '全屏演示' }).click()
    await expect(page.locator('.ops-card').first()).toBeVisible()
    await page.waitForTimeout(320)

    const report = await geometry(page, wall ? 13 : 12)

    expect(report.cards, '块数与契约的 profile 指标数一致').toBe(profile === 'ops' ? 12 : 10)
    expect(report.footless, '每块卡片都必须有来源脚注').toEqual([])
    expect(report.nestedCards, '不允许卡片套卡片').toBe(0)
    expect(report.clipped, '卡片内容不得被裁剪').toEqual([])
    expect(report.overlaps, '卡片同级元素不得重叠').toEqual([])
    expect(report.tinyText, `可见文字不得小于 ${wall ? 13 : 12}px`).toEqual([])
    expect(report.scrollW, '任何视口都不得横向滚动').toBeLessThanOrEqual(report.clientW)
    if (wall) {
      expect(report.scrollH, '舞台档不得纵向滚动').toBeLessThanOrEqual(report.clientH + 1)
    }
    // 色彩不能是单一色相：条形 / 点阵 / KPI 强调色合计至少 4 种
    expect(report.hues.length, `色彩需多于 4 种，实际 ${JSON.stringify(report.hues)}`).toBeGreaterThanOrEqual(4)

    const shot = join(SHOT_DIR, `admin-${profile}-${testInfo.project.name}.png`)
    await page.screenshot({ path: shot, fullPage: !wall, animations: 'disabled' })
    await testInfo.attach(`admin-${profile}-${testInfo.project.name}`, { path: shot, contentType: 'image/png' })
  })
}
