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

/** 从零生成：模型回的一份简历。经历描述里新写进了「1500 件」「0.5%」两个数，「负责」是用户自己写过的词。 */
const GENERATED = {
  taskId: 'gen-task-walkfix-1',
  status: 'completed',
  providerName: 'llm:deepseek',
  resume: {
    basic: { name: '周敏', phone: '13800000614', email: 'zhoumin@example.com', city: '青岛' },
    intention: { position: '仓储分拣员', city: '青岛' },
    summary: '求职方向为仓储分拣员。熟悉岗位日常工作，做事细致，能适应夜班。',
    education: [{ school: '青岛西海岸职业中等专业学校', major: '物流服务与管理', period: '2022.09 - 2025.06' }],
    experience: [{ company: '青岛崂山某配送服务有限公司', role: '夜班分拣员', period: '2024.07 - 至今', description: '负责夜班包裹分拣与装车，日均分拣约 1500 件，错分率控制在 0.5% 以内。' }],
    projects: [],
    skills: ['叉车操作', 'Excel 表格'],
    certificates: ['机动车驾驶证 C1'],
  },
  missingHints: [],
}
const GEN_EXPORTED = {
  fileId: 'gen-file-walkfix-1',
  filename: 'AI简历_周敏.pdf',
  sizeBytes: 105472,
  pageCount: 1,
  signedUrl: '/w3-fixtures/gen-walkfix.pdf',
  expiresAt: '2099-01-01T00:30:00.000Z',
  printFileUrl: '/api/v1/files/gen-file-walkfix-1/content?expires=1&sig=walkfix',
}

/** 从首页进「从零生成」之前先把壳层、能力读数备好。 */
function generateShell(api: ApiRouter, configExtras: Record<string, unknown> = {}): void {
  shell(api, configExtras)
  api.respond('POST', '/api/v1/resume/generate', { status: 200, json: GENERATED })
  api.respond('POST', '/api/v1/resume/generate/export', { status: 200, json: GEN_EXPORTED })
}

/** 六步填到「核对」。没填的项不碰；经历描述写的是用户自己的话。 */
async function fillGenerateFormToReview(page: Page): Promise<void> {
  await page.goto('/resume/generate')
  await page.getByRole('textbox', { name: /^姓名/ }).fill('周敏')
  await page.getByRole('button', { name: /^下一步：求职意向/ }).click()
  await page.getByRole('textbox', { name: /^目标岗位/ }).fill('仓储分拣员')
  await page.getByRole('button', { name: /^下一步：教育经历/ }).click()
  await page.getByRole('textbox', { name: /^学校/ }).fill('青岛西海岸职业中等专业学校')
  await page.getByRole('button', { name: /^下一步：工作经历/ }).click()
  await page.getByRole('textbox', { name: /^公司/ }).fill('青岛崂山某配送服务有限公司')
  await page.getByRole('textbox', { name: /^职位/ }).fill('夜班分拣员')
  await page.getByRole('textbox', { name: /^做了什么/ }).fill('负责夜班包裹分拣与装车。')
  await page.getByRole('button', { name: /^下一步：项目经历/ }).click()
  await page.getByRole('button', { name: /^下一步：技能证书/ }).click()
  await page.getByRole('button', { name: '去核对' }).click()
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

// ── I-35 ───────────────────────────────────────────────────────────────────
// 走查实录：后台把「AI 暂停」打开后，简历服务台四个要 AI 的入口照常可点，要点进去才在诊断失败屏知道「AI 服务暂停中」。
// 判据（稿 resume 的 ?ai=down）：写明哪些要 AI、现在不可用；两张大卡置灰并给不用 AI 的出路
// （有简历 → 先打印原件；没有 → 先看简历素材库）；职业规划、简历对照同样置灰；求职材料、自我探索不要 AI，照常能点。
// 没读到暂停状态（配置里没有 ai 字段）时一概不变，不把「没读到」说成「不可用」。
test('AI 暂停时简历服务台预告：要 AI 的置灰写原因，给出不用 AI 的出路 @w3-kiosk', async ({ page, api }) => {
  shell(api, { ai: { paused: true } })
  await page.goto('/resume-service')
  await expect(page.locator('[data-qx-page="resume"]')).toBeVisible()

  // 两张大卡置灰，并写明原因
  const dead = page.locator('.qxt-slab.qxt-slab-off')
  await expect(dead).toHaveCount(2)
  for (const card of await dead.all()) {
    await expect(card).toHaveAttribute('aria-disabled', 'true')
    await expect(card).toContainText('AI能力当前不可用')
  }
  // 要 AI 的两块磁贴置灰；不要 AI 的两块照常能点
  for (const title of ['职业规划', '简历对照']) {
    await expect(page.locator(`[data-hub-title="${title}"]`)).toHaveAttribute('data-hub-reason', 'AI能力当前不可用')
  }
  for (const title of ['求职材料', '自我探索']) {
    await expect(page.locator(`[data-hub-title="${title}"]`)).not.toHaveAttribute('data-hub-reason', /.+/)
  }
  // 两条出路真的能走
  const printOriginal = page.getByRole('button', { name: '可以先打印原件' })
  const seeTemplates = page.getByRole('button', { name: '可以先看简历素材库' })
  await expect(printOriginal).toBeVisible()
  await expect(seeTemplates).toBeVisible()
  await seeTemplates.click()
  await expect(page).toHaveURL(/\/resume\/templates$/)
  await page.goBack()
  await page.getByRole('button', { name: '可以先打印原件' }).click()
  await expect(page).toHaveURL(/\/print\/upload\?source=resume$/)
})

test('AI 没暂停或没读到暂停状态时简历服务台照常，不多出出路条 @w3-kiosk', async ({ page, api }) => {
  shell(api, { ai: { paused: false } })
  await page.goto('/resume-service')
  await expect(page.locator('[data-qx-page="resume"]')).toBeVisible()
  await expect(page.locator('.qxt-slab-off')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '可以先打印原件' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '可以先看简历素材库' })).toHaveCount(0)

  // 配置里压根没有 ai 字段：读不到不等于暂停（重新加载，终端配置的内存缓存随之重来）
  shell(api, {})
  await page.reload()
  await expect(page.locator('[data-qx-page="resume"]')).toBeVisible()
  await expect(page.locator('.qxt-slab-off')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '可以先打印原件' })).toHaveCount(0)
})

// ── I-21 ───────────────────────────────────────────────────────────────────
// 走查实录：预览页橙条写「待本人确认：负责、1500、0.5%」，导出前的核对弹层里也有这一行，普通人读不懂。
// 判据：①「待本人确认」下面写清为什么要本人确认——这几处是 AI 整理时新写进去的、你原来的内容里没有；
//      ② 只列真正新写进去的：用户自己写过的词（这里的「负责」）不算，来源是把本次填的内容带到预览页做对照。
test('预览页与核对弹层把「待本人确认」讲明白，并且只列 AI 新写进去的 @w3-kiosk', async ({ page, api }) => {
  generateShell(api)
  await page.route('**/w3-fixtures/gen-walkfix.pdf', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }))
  await fillGenerateFormToReview(page)
  await page.getByRole('button', { name: /让 AI 整理成新简历/ }).click()
  await expect(page).toHaveURL(/\/resume\/generate\/preview/)

  const banner = page.locator('.qx-rd-pending')
  await expect(banner).toBeVisible()
  // 只列新写进去的两个数；用户自己写的「负责」不算
  await expect(banner).toContainText('待本人确认：1500、0.5%')
  await expect(banner).not.toContainText('负责')
  await expect(banner).toContainText('AI 整理时新写进了这几处，你原来的内容里没有')
  await expect(banner).toContainText('不是，就改掉或删掉再导出')

  // 去导出 → 选格式 → 导出这一份：核对弹层里同样讲明白
  await page.getByRole('button', { name: '内容没问题，去导出' }).click()
  await page.getByRole('button', { name: '导出这一份' }).click()
  const dialog = page.getByRole('dialog', { name: '导出前核对事实' })
  await expect(dialog).toBeVisible()
  const note = dialog.locator('.qx-rd-pending')
  await expect(note).toContainText('待本人确认：1500、0.5%')
  await expect(note).not.toContainText('负责')
  await expect(note).toContainText('AI 整理时新写进了这几处，你原来的内容里没有')
})
