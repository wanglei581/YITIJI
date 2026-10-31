import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { RECRUITMENT_HOSTING_ON, RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'
import { assistantReply } from './fixtures/fusion-w3-states'
import { VISIBLE_PDF } from './fixtures/fusion-w2-binary-route'
import { registerPrivacyShell, loginThroughVisibleUi, fillPhoneLogin } from './fixtures/privacy-clear-shell'

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
  await page.route('**/w3-fixtures/gen-walkfix.pdf', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }))
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

// ── I-19 ───────────────────────────────────────────────────────────────────
// 走查实录：诊断出 1 个问题时，左栏六个维度约 660px，右栏「先改这几处」只放一条问题卡，卡被拉到和左栏一样高，
// 卡内下半截约 400px 是空的，空卡在首屏正中占近两成屏高。
// 判据：问题卡按内容定高，不拉长凑高度；问题不足三条时右栏用报告里本来就有的「报告结论」（建议与风险提醒）补满，
// 不留一片空白；三条都有时仍是稿里的样子。
const REPORT_ID = 'rep-walkfix-1'
const SECTIONS = [
  { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
  { key: 'objective', label: '求职目标清晰度', score: 4, maxScore: 10 },
  { key: 'experience', label: '经历表达清晰度', score: 7, maxScore: 10 },
  { key: 'quantification', label: '成果量化程度', score: 4, maxScore: 10 },
  { key: 'keyword', label: '岗位关键词覆盖', score: 6, maxScore: 10 },
  { key: 'readability', label: '版式与可读性', score: 6, maxScore: 10 },
]
const ISSUE_QUANT = {
  id: 'I1', dim: 'quantification', title: '这段经历没有写出规模或结果',
  evidence: [{ blockKey: 'experience', lineIndex: 0, quote: '现居青岛市，本文件为虚构示例。' }],
  impact: '读简历的人只看到做了什么，看不到做到什么程度。',
  fixIt: '在这一行后面补上你实际负责的人数、数量或周期；没有准确数字就写清具体做了哪些环节。',
}
const ISSUE_GOAL = {
  id: 'I2', dim: 'objective', title: '求职目标没有写成具体岗位',
  evidence: [{ blockKey: 'basic', lineIndex: 0, quote: '希望找一份稳定的工作。' }],
  impact: '全篇没有岗位名，后面的经历对不上具体职位。',
  fixIt: '写成目标岗位，并让经历围着它写。',
}
const ISSUE_PROJ = {
  id: 'I3', dim: 'experience', title: '项目只有活动名，没写你做了什么',
  evidence: [{ blockKey: 'project', lineIndex: 0, quote: '参与迎新志愿服务。' }],
  impact: '只有活动名，看不出你具体做了哪一段。',
  fixIt: '补上你负责的那一段，不新加没做过的项目。',
}
function reportRecord(issues: unknown[]) {
  return {
    taskId: REPORT_ID, status: 'completed', providerName: 'llm',
    report: {
      sections: SECTIONS,
      suggestions: ['把目标岗位写在简历第一行。', '每段经历后面补一个可核实的结果。', '技能栏只留你真用过的工具。', '联系方式放在第一屏。'],
      riskNotes: ['「熟悉」「了解」这类词没有事例支撑，读的人容易当作空话。'],
      contentBlocks: [
        { key: 'basic', label: '基本信息', lines: ['希望找一份稳定的工作。'] },
        { key: 'experience', label: '工作经历', lines: ['现居青岛市，本文件为虚构示例。'] },
        { key: 'project', label: '项目经历', lines: ['参与迎新志愿服务。'] },
      ],
      issues,
    },
  }
}
async function openReport(page: Page, api: ApiRouter, issues: unknown[]): Promise<void> {
  shell(api)
  api.respond('GET', `/api/v1/resume/records/${REPORT_ID}`, { status: 200, json: reportRecord(issues) })
  await page.goto(`/resume/report?taskId=${REPORT_ID}`)
  await expect(page.getByTestId('resume-report-priorities')).toBeVisible()
}
/** 右栏有没有「拉长的空卡」：每张问题卡里最后一行字到卡下沿的空白，以及右栏末尾内容到栏下沿的空白，都不许超过 105px。 */
async function rightColumnSlack(page: Page): Promise<{ cards: number[]; columnTail: number; cardTops: number[] }> {
  return page.getByTestId('resume-report-priorities').evaluate((section) => {
    const sectionBox = section.getBoundingClientRect()
    const cards = Array.from(section.querySelectorAll<HTMLElement>('.qxt-issue'))
    const slack = cards.map((card) => {
      const box = card.getBoundingClientRect()
      const last = Array.from(card.children).map((child) => child.getBoundingClientRect().bottom).reduce((max, value) => Math.max(max, value), box.top)
      return Math.round(box.bottom - last)
    })
    const tail = Array.from(section.children).map((child) => child.getBoundingClientRect().bottom).reduce((max, value) => Math.max(max, value), sectionBox.top)
    return { cards: slack, columnTail: Math.round(sectionBox.bottom - tail), cardTops: cards.map((card) => Math.round(card.getBoundingClientRect().top)) }
  })
}

test('诊断报告只有 1 条问题时右栏不留拉长的空卡，用报告结论补满 @w3-kiosk', async ({ page, api }) => {
  await openReport(page, api, [ISSUE_QUANT])
  const slack = await rightColumnSlack(page)
  expect(slack.cards, '问题卡数').toHaveLength(1)
  for (const blank of slack.cards) expect(blank, '问题卡里最后一行字到卡下沿的空白').toBeLessThanOrEqual(105)
  expect(slack.columnTail, '右栏末尾内容到栏下沿的空白').toBeLessThanOrEqual(105)
  // 报告结论补进了右栏（不再只收在下面的折叠里），默认展开，建议与风险提醒都看得见
  const conclusions = page.getByTestId('resume-report-priorities').getByTestId('resume-report-conclusions')
  await expect(conclusions).toBeVisible()
  await expect(conclusions).toHaveAttribute('open', '')
  await expect(conclusions).toContainText('把目标岗位写在简历第一行。')
  await expect(conclusions).toContainText('熟悉')
  // 同一份结论只出现一处，不在下面的折叠里再来一遍
  await expect(page.getByTestId('resume-report-conclusions')).toHaveCount(1)
  await assertReportNoOverflow(page)
})

test('诊断报告有 3 条问题时仍是稿里的样子：三张卡并排左栏，报告结论收在下面 @w3-kiosk', async ({ page, api }) => {
  await openReport(page, api, [ISSUE_QUANT, ISSUE_GOAL, ISSUE_PROJ])
  const slack = await rightColumnSlack(page)
  expect(slack.cards).toHaveLength(3)
  expect(slack.columnTail).toBeLessThanOrEqual(105)
  // 结论仍在右栏之外（下面那条折叠，默认收起）
  await expect(page.getByTestId('resume-report-priorities').getByTestId('resume-report-conclusions')).toHaveCount(0)
  await expect(page.getByTestId('resume-report-conclusions')).not.toHaveAttribute('open', '')
  await assertReportNoOverflow(page)
})

async function assertReportNoOverflow(page: Page): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over, '横向溢出').toBeLessThanOrEqual(0)
}

// I-19：报告本来就没有建议时，不能把一条问题卡撑满六个维度的高度。
test('诊断报告没有补充结论时问题卡仍按真实内容定高 @w3-kiosk', async ({ page, api }) => {
  shell(api)
  const record = reportRecord([ISSUE_QUANT])
  record.report.suggestions = []
  record.report.riskNotes = []
  api.respond('GET', `/api/v1/resume/records/${REPORT_ID}`, { status: 200, json: record })
  await page.goto(`/resume/report?taskId=${REPORT_ID}`)
  await expect(page.getByTestId('resume-report-priorities')).toBeVisible()
  const slack = await rightColumnSlack(page)
  expect(slack.cards[0]).toBeLessThanOrEqual(105)
  await expect(page.getByTestId('resume-report-conclusions')).toHaveCount(0)
})

// I-22：不靠缩字/裁切；四种格式与主操作在竖屏内，窄屏可滚动到全部选项。
test('导出格式主操作可达且不靠四张大空卡撑长页面 @w3-kiosk', async ({ page, api }, testInfo) => {
  generateShell(api)
  await fillGenerateFormToReview(page)
  await page.getByRole('button', { name: '让 AI 整理成新简历' }).click()
  await page.getByRole('button', { name: '内容没问题，去导出' }).click()
  for (const size of [{ width: 1080, height: 1920 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size)
    const formats = page.getByRole('radiogroup', { name: '导出格式' })
    await expect(formats.getByRole('radio')).toHaveCount(4)
    const last = formats.getByRole('radio').last()
    if (size.width === 1080) {
      const box = await last.boundingBox()
      const body = await page.locator('.rtp-fill').boundingBox()
      expect(box!.y + box!.height).toBeLessThanOrEqual(body!.y + body!.height)
    }
    await last.click()
    await expect(last).toHaveAttribute('aria-checked', 'true')
    const exportButton = page.getByRole('button', { name: '导出这一份', exact: true })
    await exportButton.scrollIntoViewIfNeeded()
    await expect(exportButton).toBeInViewport()
    await expect(exportButton).toBeEnabled()
    await exportButton.click({ trial: true })
    if (size.width === 1080) expect((await exportButton.boundingBox())!.height).toBeGreaterThanOrEqual(64)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`export-${size.width}.png`) })
    await formats.getByRole('radio').first().click()
  }
})

test('导出结果的文件与带走操作在首屏，说明可展开 @w3-kiosk', async ({ page, api }, testInfo) => {
  generateShell(api)
  await page.route('**/w3-fixtures/gen-walkfix.pdf', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }))
  await fillGenerateFormToReview(page)
  await page.getByRole('button', { name: '让 AI 整理成新简历' }).click()
  await page.getByRole('button', { name: '内容没问题，去导出' }).click()
  await page.getByRole('button', { name: '导出这一份', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '导出前核对事实' })
  for (const checkbox of await confirm.getByRole('checkbox').all()) await checkbox.check()
  await confirm.getByRole('button', { name: '确认导出', exact: true }).click()
  await page.getByRole('button', { name: '关闭文件预览', exact: true }).click()
  const actions = page.locator('.qx-rg-result-actions')
  await expect(actions).toBeInViewport({ ratio: 1 })
  await actions.getByRole('button', { name: '去打印确认', exact: true }).click({ trial: true })
  await page.getByText('更多格式与帮助', { exact: true }).click()
  await expect(page.getByRole('button', { name: /帮助中心/ }).first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('export-result-1080.png') })
})


// I-29：一次能力故障不能把这位用户锁死在已填完的表单里。
test('resume generation retries after outage without losing this session draft @w3-kiosk', async ({ page, api }) => {
  await page.clock.install()
  shell(api)
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', { status: 200, json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF) })
  let attempts = 0
  const payloads: unknown[] = []
  await page.route('**/api/v1/resume/generate', async (route) => {
    attempts += 1
    payloads.push(route.request().postDataJSON())
    await route.fulfill({ status: attempts <= 2 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(
      attempts <= 2
        ? { error: { code: 'AI_PAUSED', message: 'AI 服务暂停中' } }
        : { taskId: 'retry-result', status: 'completed', providerName: 'fixture', resume: {
          basic: { name: '恢复验证者', city: '青岛' }, intention: { position: '维修工程师' },
          summary: '', education: [], experience: [], projects: [], skills: [], certificates: [],
        }, missingHints: [] },
    ) })
  })
  await page.goto('/resume/generate')
  await page.getByLabel('姓名', { exact: false }).fill('恢复验证者')
  await page.getByRole('button', { name: '下一步：求职意向', exact: true }).click()
  await page.getByLabel('目标岗位', { exact: false }).fill('维修工程师')
  for (const title of ['教育经历', '工作经历', '项目经历', '技能证书']) {
    await page.getByRole('button', { name: `下一步：${title}`, exact: true }).click()
  }
  await page.getByRole('button', { name: '去核对', exact: true }).click()
  await page.getByRole('button', { name: '让 AI 整理成新简历', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新检查并整理', exact: true })).toBeEnabled()
  expect(attempts).toBe(1)
  // 同一标签页离开再回来，应恢复核对页和填写内容；没有把原文放进浏览器持久存储。
  await page.getByRole('button', { name: '首页', exact: true }).click()
  await page.getByRole('button').filter({ has: page.getByRole('heading', { name: '改简历', exact: true }) }).click()
  await page.getByRole('button', { name: /没有，帮我写一份/ }).click()
  await expect(page.getByText('恢复验证者', { exact: true })).toBeVisible()
  await expect(page.getByText('维修工程师', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('恢复验证者')
  await page.getByRole('button', { name: '让 AI 整理成新简历', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新检查并整理', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '重新检查并整理', exact: true }).click()
  await expect(page).toHaveURL(/\/resume\/generate\/preview$/)
  expect(attempts).toBe(3)
  expect(payloads[1]).toEqual(payloads[0])
  expect(payloads[2]).toEqual(payloads[0])
  await page.getByRole('button', { name: '首页', exact: true }).click()
  await page.clock.fastForward(151_000)
  await page.getByTestId('session-guard-clear').click()
  await page.clock.runFor(1000)
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('button').filter({ has: page.getByRole('heading', { name: '改简历', exact: true }) }).click()
  await page.getByRole('button', { name: /没有，帮我写一份/ }).click()
  await expect(page.getByLabel('姓名', { exact: false })).toHaveValue('')
})

test('从零简历会员换号后不继承上一位填写 @w3-kiosk', async ({ page, api }, testInfo) => {
  registerPrivacyShell(api)
  let logins = 0
  await page.route('**/api/v1/member/auth/login', async (route) => {
    logins += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      token: `resume-member-${logins}`, user: { id: `resume-owner-${logins}`, phoneMasked: '138****8000', nickname: `验证会员${logins}` },
    } }) })
  })
  await loginThroughVisibleUi(page, '/resume/generate', '13800138000')
  await page.getByLabel('姓名', { exact: false }).fill('上一位会员的简历')
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的', exact: true }).click()
  await page.getByTestId('profile-account').click()
  await page.getByRole('button', { name: /换一个账号登录/ }).click()
  await page.getByRole('dialog', { name: '换一个账号登录' }).getByRole('button', { name: '结束并去登录', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await fillPhoneLogin(page, '13800138001')
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.locator('body')).toContainText('验证会员2')
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '首页', exact: true }).click()
  await page.getByRole('button').filter({ has: page.getByRole('heading', { name: '改简历', exact: true }) }).click()
  await page.getByRole('button', { name: /没有，帮我写一份/ }).click()
  await expect(page.getByLabel('姓名', { exact: false })).toHaveValue('')
  expect(logins).toBe(2)
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('上一位会员的简历')
  await page.screenshot({ path: testInfo.outputPath('member-switch-cleared.png') })
})

test('诊断报告真实空态不补假问题，短结论不撑成空框 @w3-kiosk', async ({ page, api }) => {
  shell(api)
  const record = reportRecord([])
  record.report.sections = []
  record.report.suggestions = []
  record.report.riskNotes = []
  api.respond('GET', `/api/v1/resume/records/${REPORT_ID}`, { status: 200, json: record })
  await page.goto(`/resume/report?taskId=${REPORT_ID}`)
  await expect(page.getByText('报告回来了，但里面是空的', { exact: true })).toBeVisible()
  await expect(page.locator('.qxt-issue')).toHaveCount(0)
  await expect(page.getByTestId('resume-report-conclusions')).toHaveCount(0)
  const brief = reportRecord([ISSUE_QUANT])
  brief.report.suggestions = ['补上真实职责。']
  brief.report.riskNotes = []
  api.respond('GET', `/api/v1/resume/records/${REPORT_ID}`, { status: 200, json: brief })
  await page.reload()
  const conclusions = page.getByTestId('resume-report-conclusions')
  await expect(conclusions).toHaveAttribute('open', '')
  const slack = await conclusions.evaluate((box) => box.getBoundingClientRect().bottom - box.lastElementChild!.getBoundingClientRect().bottom)
  expect(slack).toBeLessThanOrEqual(105)
})
