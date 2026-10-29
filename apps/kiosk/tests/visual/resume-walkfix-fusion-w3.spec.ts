import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { RECRUITMENT_HOSTING_ON } from '../fixtures/recruitment-hosting'
import { assistantReply } from './fixtures/fusion-w3-states'

// ── 本机全链路走查（2026-10-29）C2 路：简历、练面试、AI 相关问题的回归用例 ─────────────
// 每条用例自带夹具：ApiRouter 未登记的 /api/v1 请求一律中断，并在收尾时判红（fail-closed）。
// 文件名以 fusion-w3.spec.ts 结尾，由 W3 配置（playwright.w3.config.ts）接进 CI。

function shell(api: ApiRouter, configExtras: Record<string, unknown> = {}): void {
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
      ...configExtras,
      configVersion: 'walkfix-c2',
      refreshIntervalMs: 300000,
      serverTime: '2026-10-29T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { data: { asrEnabled: false, ttsEnabled: false } } })
  // 服务台挂载时探后端就绪（useApiReadiness）。
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
}

/** 在小青页用屏上键盘问一句，等回答出来。 */
async function askXiaoqing(page: Page, api: ApiRouter): Promise<void> {
  shell(api)
  api.respond('POST', '/api/v1/assistant/chat', { status: 200, json: assistantReply })
  await page.goto('/assistant')
  await page.getByLabel('输入咨询问题').fill('如何整理项目经历？')
  await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('[data-message-kind="ai"]')).toHaveCount(1)
}

// ── I-02 ───────────────────────────────────────────────────────────────────
// 走查实录：小青回答卡顶部的标签写「E3 AI 判断 · 仅供参考」。「E3」是内部证据等级编号，求职者看不懂。
// 判据：编号不上屏，只留「AI 判断 · 仅供参考」；data-evidence 属性（给测试和样式用）照旧。
test('小青回答上方的标记只写「AI 判断 · 仅供参考」，不露内部编号 @w3-kiosk', async ({ page, api }) => {
  await askXiaoqing(page, api)
  const badge = page.locator('[data-message-kind="ai"] [data-evidence="E3"]')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText('AI 判断 · 仅供参考')
  await expect(badge).toHaveAttribute('aria-label', 'AI 判断 · 仅供参考')
  // 整个回答卡里看得见的字都不许带 E1 / E2 / E3 这类编号
  const cardText = await page.locator('[data-message-kind="ai"]').innerText()
  expect(cardText).not.toMatch(/\bE[123]\b/)
})

// ── I-03 ───────────────────────────────────────────────────────────────────
// 走查实录：用屏上键盘右下角「发送」问完，回答出来了键盘仍停着，占下方约 350px，盖住底部导航；
// 键盘外的透明遮罩还拦着页面上的按钮，要回首页得先点「收起」。
// 判据：用键盘「发送」把话发出去之后键盘收起，回答和底部导航露出来，没有遮罩挡着。
test('小青：用屏上键盘发送后键盘收起，回答与底部导航露出来 @w3-kiosk', async ({ page, api }) => {
  await askXiaoqing(page, api)
  await expect(page.getByRole('group', { name: '虚拟键盘' })).toHaveCount(0)
  await expect(page.locator('.kkb-backdrop')).toHaveCount(0)
  // 底部导航没被盖住：它的中心点命中的就是导航自己的按钮
  const hit = await page.locator('.qxt-nav').evaluate((nav) => {
    const box = nav.getBoundingClientRect()
    const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return { inside: Boolean(at && nav.contains(at)), top: Math.round(box.top), bottom: Math.round(box.bottom), vh: window.innerHeight }
  })
  expect(hit.inside, '底部导航中心点应命中导航自己').toBe(true)
  expect(hit.bottom).toBeLessThanOrEqual(hit.vh + 1)
  // 再点输入框，键盘能重新弹出（收起不是锁死）
  await page.getByLabel('输入咨询问题').click()
  await expect(page.getByRole('group', { name: '虚拟键盘' })).toBeVisible()
})

