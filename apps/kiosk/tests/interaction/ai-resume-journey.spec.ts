/**
 * 包 Q-AI · AI 简历 → 我的 交互走查（青序流光 · 触屏版）
 *
 * 模拟数据 = 本地真实后端 + 种子（AI_PROVIDER=mock 是服务端配置，不是前端假数据）。
 * 每条旅程独立 browser.newContext()，禁止复用 page。
 *
 * 运行（apps/kiosk）：
 *   node node_modules/@playwright/test/cli.js test tests/interaction/ai-resume-journey.spec.ts --config playwright.interaction.config.ts
 *
 * 不塞进 visual/，不走默认 playwright.config.ts（那会起 4177 preview 并 mock API）。
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  API_ORIGIN,
  appendOperation,
  attachCollectors,
  clickMeTab,
  clickNamed,
  clickProfileEntry,
  closePreviewIfOpen,
  confirmAiConsent,
  confirmFactsIfOpen,
  failJourneySteps,
  fillDiagnosisDirection,
  gotoHome,
  listVisibleControls,
  loginMemberViaSms,
  newSweepContext,
  operateControl,
  recordStep,
  scanForbiddenCopy,
  shot,
  uploadResumePdf,
  waitForOptimizeReady,
  waitReady,
  waitReport,
  writeSummary,
  readOperations,
  type ControlOp,
} from './sweep-harness'

test.describe.configure({ mode: 'default' })

test.beforeEach(() => {
  // 只让这一份走查的步骤失败变红。开关默认关着，别的旧走查不受影响。
  failJourneySteps(true)
})

test.afterAll(() => {
  writeSummary(readOperations())
})

async function assertNotProduction(collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  expect(collectors.productionHits, '禁止访问生产 zyidai.cn / 120.48.13.190').toEqual([])
}

type ExportedFile = { fileId: string; filename: string; signedUrl: string }

function asExportFile(body: unknown): ExportedFile {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const nested = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record
  const fileId = typeof nested.fileId === 'string' ? nested.fileId : ''
  const filename = typeof nested.filename === 'string' ? nested.filename : ''
  const signedUrl = typeof nested.signedUrl === 'string' ? nested.signedUrl : ''
  expect(fileId, '导出响应应带本次文件编号').not.toBe('')
  expect(filename, '导出响应应带本次文件名').not.toBe('')
  expect(signedUrl, '导出响应应带本次取回链接').not.toBe('')
  expect(signedUrl, '取回链接应指向本次文件').toContain(fileId)
  return { fileId, filename, signedUrl }
}

function localRetrievalUrl(signedUrl: string): string {
  const parsed = signedUrl.startsWith('http') ? new URL(signedUrl) : new URL(signedUrl, API_ORIGIN)
  if (signedUrl.startsWith('http')) expect(parsed.hostname, '取回地址应是本机 API').toBe('127.0.0.1')
  const path = `${parsed.pathname}${parsed.search}`
  expect(path, '取回地址应是本机 API 签发的签名链接').toMatch(
    /^\/api\/v1\/files\/[^/?#]+\/content\?expires=\d+&sig=[0-9a-fA-F]+$/,
  )
  return new URL(path, API_ORIGIN).href
}

function qrPathData(value: string): string[] {
  const html = renderToStaticMarkup(createElement(QRCodeSVG, {
    value,
    size: 160,
    level: 'M',
    marginSize: 0,
  }))
  const paths = [...html.matchAll(/\sd="([^"]*)"/g)].map((match) => match[1])
  if (paths.length < 2) throw new Error(`对照二维码应有背景和内容两条 path，实际 ${paths.length} 条`)
  return paths
}

async function assertQrEncodes(page: Page, signedUrl: string, filename: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: filename })
  await expect(dialog, '应弹出这份文件的二维码').toBeVisible()
  const actual = await dialog.locator('aside svg[role="img"] path').evaluateAll((els) => els.map((el) => el.getAttribute('d')))
  expect(actual, '二维码应逐字编码这次的取回链接').toEqual(qrPathData(signedUrl))
}

async function assertDownloaded(page: Page, signedUrl: string, mime: RegExp, pdfHeader: boolean): Promise<void> {
  const response = await page.request.get(localRetrievalUrl(signedUrl))
  expect(response.status(), '取回本次文件应成功').toBe(200)
  expect(response.headers()['content-type'] ?? '', '内容类型应对上这次的格式').toMatch(mime)
  const body = await response.body()
  expect(body.byteLength, '文件不应是空的').toBeGreaterThan(0)
  if (pdfHeader) expect(body.subarray(0, 4).toString('latin1'), 'PDF 文件头应是 %PDF').toBe('%PDF')
}

async function readEditorValues(page: Page): Promise<string[]> {
  const paper = page.locator('.qxt-paperbox textarea, .qxt-paperbox input')
  const locator = (await paper.count()) > 0 ? paper : page.locator('textarea')
  return locator.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
}

async function returnFromPrintToReport(page: Page): Promise<void> {
  for (let i = 0; i < 4 && new URL(page.url()).pathname.startsWith('/print'); i += 1) {
    const before = page.url()
    const back = page.getByRole('button', { name: /^(返回修改|上一步|回到上一步)$/ }).first()
    await expect(back, '打印页应能用屏上的返回离开').toBeVisible({ timeout: 15_000 })
    await back.click()
    await page.waitForURL((url) => url.href !== before, { timeout: 15_000 })
  }
  await page.waitForURL((url) => url.pathname === '/resume/report', { timeout: 15_000 })
  await waitReady(page)
}

async function dismissHubSheet(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: '收起', exact: true })
  if (await close.isVisible().catch(() => false)) await close.click()
}

async function enterResumeHub(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  await recordStep({
    page, journey, step: 'home', control: '(open /)', selectorHint: 'goto /', kind: 'click', collectors,
    act: async () => { await gotoHome(page) },
  })
  await shot(page, journey, 'home')
  await recordStep({
    page, journey, step: 'home-resume-hub', control: '改简历', selectorHint: '[data-action=resume-hub]',
    kind: 'click', collectors,
    act: async () => {
      const card = page.locator('[data-action="resume-hub"]')
      if (await card.count()) await card.click()
      else await clickNamed(page, /改简历/)
      await page.waitForURL((url) => url.pathname === '/resume-service', { timeout: 15_000 })
    },
  })
  await dismissHubSheet(page)
}

async function enterDiagnoseSource(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  await dismissHubSheet(page)
  await recordStep({
    page, journey, step: 'hub-diagnose', control: '有，帮我改一改', selectorHint: 'button:有，帮我改一改',
    kind: 'click', collectors,
    act: async () => {
      await page.getByRole('button', { name: '有，帮我改一改' }).click()
      await page.waitForURL((url) => url.pathname === '/resume/source', { timeout: 15_000 })
    },
  })
}

async function startDiagnosis(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  await uploadResumePdf(page, journey, collectors)
  await fillDiagnosisDirection(page, journey, collectors)
  await recordStep({
    page, journey, step: 'start-diagnosis', control: '开始 AI 诊断', selectorHint: 'button:开始 AI 诊断',
    kind: 'click', collectors,
    act: async () => {
      const start = page.getByRole('button', { name: '开始 AI 诊断', exact: true })
      if (!(await start.isVisible().catch(() => false))) {
        await page.getByRole('button', { name: '下一步：诊断方向', exact: true }).click()
      }
      await start.click()
      await page.waitForURL((url) => url.pathname === '/resume/parse' || url.pathname === '/resume/report', { timeout: 20_000 })
    },
  })
  await confirmAiConsent(page, journey, collectors)
  if (page.url().includes('/resume/parse')) {
    await shot(page, journey, 'parse-waiting')
    await waitReport(page)
  }
}

async function sweepVisible(
  page: Page,
  journey: string,
  stepPrefix: string,
  collectors: ReturnType<typeof attachCollectors>,
  extraSkip: string[] = [],
): Promise<ControlOp[]> {
  const controls = await listVisibleControls(page)
  const ops: ControlOp[] = []
  const originPath = new URL(page.url()).pathname
  for (const control of controls) {
    const op = await operateControl(page, control, journey, stepPrefix, collectors, extraSkip)
    ops.push(op)
    const nowPath = new URL(page.url()).pathname
    if (nowPath !== originPath) {
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
      await waitReady(page)
      if (new URL(page.url()).pathname !== originPath) break
    }
    await closePreviewIfOpen(page)
  }
  return ops
}

async function openOptimize(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>, step: string): Promise<void> {
  await recordStep({
    page, journey, step, control: '查看优化建议', selectorHint: '[data-testid=resume-report-primary]',
    kind: 'click', collectors,
    act: async () => {
      const cta = page.getByTestId('resume-report-primary')
      if (await cta.count()) await cta.click()
      else await page.getByRole('button', { name: /查看优化建议|继续生成优化版简历/ }).click()
      await page.waitForURL((url) => url.pathname === '/resume/optimize', { timeout: 30_000 })
    },
  })
  await confirmAiConsent(page, journey, collectors, page.getByRole('button', { name: '逐条看（从第 1 条）' }))
  await waitForOptimizeReady(page)
}

async function clickReportButton(
  page: Page,
  journey: string,
  collectors: ReturnType<typeof attachCollectors>,
  name: RegExp,
  label: string,
): Promise<void> {
  const locator = page.getByRole('button', { name }).first()
  await expect(locator, label).toBeVisible({ timeout: 20_000 })
  await recordStep({
    page, journey, step: `report-${label}`, control: label,
    selectorHint: `button:${label}`, kind: 'click', collectors,
    act: async () => {
      await locator.click()
      await confirmFactsIfOpen(page, journey, collectors)
      if (/打印/.test(label)) {
        await page.waitForURL((url) => url.pathname.startsWith('/print'), { timeout: 12_000 })
        await shot(page, journey, 'report-print-landed')
        await returnFromPrintToReport(page)
      }
      await closePreviewIfOpen(page)
    },
  })
}

async function exportReport(
  page: Page,
  journey: string,
  collectors: ReturnType<typeof attachCollectors>,
  label: string,
  name: RegExp,
): Promise<ExportedFile> {
  const held: { file: ExportedFile | null } = { file: null }
  await recordStep({
    page, journey, step: `report-${label}`, control: label,
    selectorHint: `button:${label}`, kind: 'click', collectors,
    act: async () => {
      const pending = page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url().includes('/resume/records/') && res.url().includes('/export'),
        { timeout: 30_000 },
      )
      await page.getByRole('button', { name }).first().click()
      await confirmFactsIfOpen(page, journey, collectors)
      const response = await pending
      expect(response.ok(), `${label}应返回成功`).toBeTruthy()
      held.file = asExportFile(await response.json())
      await expect(page.getByTestId('resume-report-export-result')).toContainText(held.file.filename)
    },
  })
  if (!held.file) throw new Error(`${label}没有拿到文件`)
  return held.file
}

test('J1 匿名 · 首页→诊断→报告页按钮 @interaction', async ({ browser }) => {
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j1-anon'
  try {
    await enterResumeHub(page, journey, collectors)
    await sweepVisible(page, journey, 'hub', collectors, [
      '有，帮我改一改', '没有，帮我写一份', '简历打印', '去打印', 'U盘', '我的简历', 'AI服务记录',
    ])
    await enterDiagnoseSource(page, journey, collectors)
    await startDiagnosis(page, journey, collectors)
    await shot(page, journey, 'report')
    expect(page.url(), '诊断未走到报告页').toContain('/resume/report')
    const body = await page.locator('body').innerText()
    expect(scanForbiddenCopy(body), '合规禁词').toEqual([])

    const reportPdf = await exportReport(page, journey, collectors, '导出 PDF', /导出 PDF/)
    const reportResult = page.getByTestId('resume-report-export-result')
    await expect(reportResult).toContainText(reportPdf.filename)
    await assertDownloaded(page, reportPdf.signedUrl, /application\/pdf/, true)
    await expect(page.getByRole('button', { name: '打印这份报告' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '生成二维码带走' }).click()
    await assertQrEncodes(page, reportPdf.signedUrl, reportPdf.filename)
    await closePreviewIfOpen(page)
    await clickReportButton(page, journey, collectors, /打印这份报告/, '打印这份报告')
    await expect(page).toHaveURL(/\/resume\/report/)
    await expect(reportResult, '从打印页回来，这份报告的导出结果还在').toContainText(reportPdf.filename)
    await expect(page.getByRole('button', { name: '生成二维码带走' })).toBeVisible()
    await recordStep({
      page, journey, step: 'report-生成二维码带走', control: '生成二维码带走',
      selectorHint: 'button:生成二维码带走', kind: 'click', collectors,
      act: async () => {
        await page.getByRole('button', { name: '生成二维码带走' }).click()
        const dialog = page.getByRole('dialog', { name: reportPdf.filename })
        await expect(dialog, '应弹出这份文件的二维码').toBeVisible()
        await expect(dialog.locator('aside svg[role="img"]'), '弹层里应有二维码').toBeVisible()
        await expect(dialog.getByText('手机扫码保存')).toBeVisible()
      },
    })
    await assertQrEncodes(page, reportPdf.signedUrl, reportPdf.filename)
    await assertDownloaded(page, reportPdf.signedUrl, /application\/pdf/, true)
    await closePreviewIfOpen(page)
    const beforeChangeList = await reportResult.innerText()
    const changeList = await exportReport(page, journey, collectors, '导出修改清单', /导出修改清单/)
    const afterChangeList = await reportResult.innerText()
    expect(afterChangeList, '修改清单应是这次新导出的结果').not.toBe(beforeChangeList)
    expect(afterChangeList).toContain(changeList.filename)
    expect(afterChangeList).toContain('修改清单')
    await assertDownloaded(page, changeList.signedUrl, /application\/pdf/, true)
    const renamedPrint = page.getByRole('button', { name: '打印修改清单' })
    if (await renamedPrint.count()) {
      await clickReportButton(page, journey, collectors, /打印修改清单/, '打印修改清单')
      await expect(reportResult, '修改清单打印回来，这次的结果还在').toContainText(changeList.filename)
      await page.getByRole('button', { name: '生成二维码带走' }).click()
      await assertQrEncodes(page, changeList.signedUrl, changeList.filename)
      await closePreviewIfOpen(page)
    }

    // 停放：docs/product/feature-scope.md:12 一体机只留四个核心，覆盖简历对照、自我探索。
    // 停放：docs/progress/current-progress.md:176 报告页去「简历对照」「自我探索」（同日条目见 :171）。
    await expect(page.getByRole('button', { name: '简历对照', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '自我探索', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '简历对照', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '自我探索', exact: true })).toHaveCount(0)

    await openOptimize(page, journey, collectors, 'report-optimize')
    await shot(page, journey, 'after-optimize-cta')
    await assertNotProduction(collectors)
  } finally {
    await context.close()
  }
})

async function confirmCompareFacts(page: Page): Promise<void> {
  const boxes = page.locator('[aria-label="新增事实核对"] input[type="checkbox"]')
  const total = await boxes.count()
  for (let i = 0; i < total; i += 1) {
    const box = boxes.nth(i)
    if (await box.isVisible().catch(() => false)) await box.check()
  }
}

async function chooseCompare(page: Page, name: '用改写' | '保留原文'): Promise<void> {
  await confirmCompareFacts(page)
  const choice = page.getByRole('group', { name: '这一条用哪一版' }).getByRole('button', { name, exact: true })
  await choice.click()
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
}

async function openCompareFromOverview(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>, step: string): Promise<void> {
  const overview = page.getByRole('button', { name: '逐条看（从第 1 条）' })
  const backToOverview = page.getByRole('button', { name: /返回建议总览/ })
  await expect(overview.or(backToOverview).first()).toBeVisible({ timeout: 15_000 })
  if (!(await overview.isVisible().catch(() => false)) && await backToOverview.count()) {
    await backToOverview.first().scrollIntoViewIfNeeded()
    await backToOverview.first().click()
    const leave = page.getByRole('button', { name: '确认离开', exact: true })
    const overviewWait = overview.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'overview' as const).catch(() => 'absent' as const)
    const leaveWait = leave.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'leave' as const).catch(() => 'absent' as const)
    const leaving = await Promise.race([overviewWait, leaveWait])
    if (leaving === 'leave') {
      await leave.click()
      await expect(overview).toBeVisible({ timeout: 10_000 })
    }
  }
  await recordStep({
    page, journey, step, control: '逐条看（从第 1 条）', selectorHint: 'button:逐条看（从第 1 条）',
    kind: 'click', collectors,
    act: async () => {
      await page.getByRole('button', { name: '逐条看（从第 1 条）' }).click()
      const leave = page.getByRole('button', { name: '确认离开', exact: true })
      if (await leave.isVisible().catch(() => false)) await leave.click()
      await page.waitForURL((url) => url.pathname === '/resume/optimize/compare', { timeout: 20_000 })
    },
  })
}

/**
 * 页面只在优化稿里有唯一原句时，才把这一条改写换进编辑区。
 * 假模型给出的原句不在稿里，应用会停在「没能自动放进稿里」。
 * 这里不改接口：只把第一条原句放进简介，让「应用 / 暂不应用」走页面自己的替换。
 */
async function plantUniqueOriginalForFirstRewrite(page: Page): Promise<void> {
  await page.route('**/api/v1/resume/records/*/optimize**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    let payload: Record<string, unknown>
    try {
      payload = await response.json() as Record<string, unknown>
    } catch {
      await route.fulfill({ response })
      return
    }
    const nested = payload['data']
    const body = (payload['optimizedResume'] ? payload : nested) as {
      optimizedResume?: { summary?: string }
      modules?: Array<{ before?: string; after?: string }>
    } | undefined
    const first = body?.modules?.[0]
    const resume = body?.optimizedResume
    const before = first?.before?.trim() ?? ''
    const after = first?.after?.trim() ?? ''
    if (resume && before && after && before !== after && !JSON.stringify(resume).includes(before)) {
      resume.summary = before
    }
    await route.fulfill({ response, json: payload })
  })
}

test('J2 匿名 · 诊断→对照→应用弹层两分支→四种导出 @interaction', async ({ browser }) => {
  test.setTimeout(360_000)
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j2-anon'
  try {
    await plantUniqueOriginalForFirstRewrite(page)
    await enterResumeHub(page, journey, collectors)
    await enterDiagnoseSource(page, journey, collectors)
    await startDiagnosis(page, journey, collectors)
    await openOptimize(page, journey, collectors, 'to-optimize')
    await expect(page.getByRole('button', { name: '逐条看（从第 1 条）' })).toBeVisible({ timeout: 30_000 })
    await shot(page, journey, 'optimize-ready')

    await openCompareFromOverview(page, journey, collectors, 'open-compare-1')
    await shot(page, journey, 'compare')
    await chooseCompare(page, '用改写')
    const rewrite = (await page.getByLabel('逐字差异').locator('section').nth(1).locator('p').textContent()) ?? ''
    expect(rewrite.length, '这一条应有改写正文').toBeGreaterThan(0)
    await recordStep({
      page, journey, step: 'compare-next-1', control: '下一条', selectorHint: 'button:下一条',
      kind: 'click', collectors,
      act: async () => { await page.getByRole('button', { name: '下一条', exact: true }).click() },
    })
    await chooseCompare(page, '保留原文')
    await page.getByRole('button', { name: '下一条', exact: true }).click()
    for (let i = 0; i < 4 && page.url().includes('/resume/optimize/compare'); i += 1) {
      const finish = page.getByRole('button', { name: '去编辑', exact: true })
      const next = page.getByRole('button', { name: '下一条', exact: true })
      await chooseCompare(page, '保留原文')
      if (await finish.isVisible().catch(() => false)) {
        await finish.click()
        break
      }
      await next.click()
    }
    await page.waitForURL((url) => url.pathname === '/resume/optimize', { timeout: 15_000 })
    await shot(page, journey, 'apply-dialog-1')
    const applyDialog = page.getByRole('dialog', { name: /对照页有/ })
    await expect(applyDialog, '对照页带回裁决后应出现应用弹层').toBeVisible()
    const beforeApply = await readEditorValues(page)
    await recordStep({
      page, journey, step: 'apply-to-editor', control: '应用到编辑区', selectorHint: 'dialog >> 应用到编辑区',
      kind: 'click', collectors,
      act: async () => { await applyDialog.getByRole('button', { name: '应用到编辑区' }).click() },
    })
    await expect(applyDialog).toBeHidden()
    const afterApply = await readEditorValues(page)
    expect(afterApply.some((value) => value.includes(rewrite)), '编辑区应换上这一条的改写').toBe(true)
    expect(afterApply, '应用后编辑区应和点之前不同').not.toEqual(beforeApply)

    await openCompareFromOverview(page, journey, collectors, 'open-compare-2')
    await chooseCompare(page, '用改写')
    await recordStep({
      page, journey, step: 'compare-back', control: '返回优化页', selectorHint: 'button:返回优化页',
      kind: 'click', collectors,
      act: async () => { await page.getByRole('button', { name: '返回优化页', exact: true }).click() },
    })
    await page.waitForURL((url) => url.pathname === '/resume/optimize', { timeout: 15_000 })
    await shot(page, journey, 'apply-dialog-2')
    const skipDialog = page.getByRole('dialog', { name: /对照页有/ })
    await expect(skipDialog, '第二次带回裁决仍应出现应用弹层').toBeVisible()
    const beforeSkip = await readEditorValues(page)
    await recordStep({
      page, journey, step: 'apply-skip', control: '暂不应用', selectorHint: 'dialog >> 暂不应用',
      kind: 'click', collectors,
      act: async () => { await skipDialog.getByRole('button', { name: '暂不应用' }).click() },
    })
    await expect(skipDialog).toBeHidden()
    const afterSkip = await readEditorValues(page)
    expect(afterSkip, '暂不应用后正文应与应用前逐字相同').toEqual(beforeSkip)
    expect(afterSkip.join('\n'), '暂不应用后正文不应含这一条的改写').not.toContain(rewrite)

    await recordStep({
      page, journey, step: 'to-export', control: '去导出', selectorHint: '[data-testid=resume-optimize-to-export]',
      kind: 'click', collectors,
      act: async () => {
        const toExport = page.getByRole('button', { name: '去导出', exact: true })
        if (!(await toExport.isVisible().catch(() => false))) {
          const toEditor = page.getByRole('button', { name: '编辑简历', exact: true })
          await toEditor.click()
        }
        await page.getByRole('button', { name: '去导出', exact: true }).click()
        await confirmFactsIfOpen(page, journey, collectors, { wait: true })
      },
    })
    await expect(page.getByRole('group', { name: '导出格式' })).toBeVisible()
    const formats = [
      { format: 'PDF', label: 'PDF', mime: /application\/pdf/, pdf: true },
      { format: 'DOCX', label: 'Word', mime: /wordprocessingml/, pdf: false },
      { format: 'TXT', label: 'TXT', mime: /text\/plain/, pdf: false },
      { format: 'MD', label: 'Markdown', mime: /text\/markdown/, pdf: false },
    ] as const
    for (const item of formats) {
      await closePreviewIfOpen(page)
      await recordStep({
        page, journey, step: `format-${item.format}`, control: item.format, selectorHint: `[aria-label=导出格式] >> ${item.format}`,
        kind: 'click', collectors,
        act: async () => {
          const btn = page.getByRole('group', { name: '导出格式' }).getByRole('button', { name: new RegExp(`^${item.format}`) })
          await btn.first().click()
        },
      })
      const beforeResult = await page.locator('[aria-label="导出结果"]').innerText().catch(() => '')
      const held: { file: ExportedFile | null } = { file: null }
      await recordStep({
        page, journey, step: `export-${item.format}`, control: `导出 ${item.format}`, selectorHint: 'button:导出',
        kind: 'click', collectors,
        act: async () => {
          const pending = page.waitForResponse(
            (res) => res.request().method() === 'POST' && res.url().includes('/resume/generate/export'),
            { timeout: 30_000 },
          )
          const exportBtn = page.getByRole('button', { name: '导出', exact: true })
          await expect(exportBtn).toBeVisible()
          await exportBtn.click()
          const response = await pending
          expect(response.ok(), `${item.format} 导出应返回成功`).toBeTruthy()
          held.file = asExportFile(await response.json())
          await expect(page.locator('[aria-label="导出结果"]')).toBeVisible({ timeout: 30_000 })
        },
      })
      if (!held.file) throw new Error(`${item.format} 没有拿到文件`)
      const exported = held.file
      const afterResult = await page.locator('[aria-label="导出结果"]').innerText()
      expect(afterResult, `${item.format} 应出现这次的新结果`).not.toBe(beforeResult)
      expect(afterResult).toContain(item.label)
      expect(afterResult).toContain(exported.filename)
      await assertDownloaded(page, exported.signedUrl, item.mime, item.pdf)
      await closePreviewIfOpen(page)
    }
    await assertNotProduction(collectors)
  } finally {
    await context.close()
  }
})

async function fillLabeled(page: Page, name: RegExp, value: string): Promise<void> {
  await page.getByRole('textbox', { name }).fill(value)
}

async function clickStep(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click()
  await waitReady(page)
}

async function openGenerate(
  page: Page,
  journey: string,
  collectors: ReturnType<typeof attachCollectors>,
  step: string,
): Promise<void> {
  await dismissHubSheet(page)
  await recordStep({
    page, journey, step, control: '没有，帮我写一份', selectorHint: 'button:没有，帮我写一份',
    kind: 'click', collectors,
    act: async () => {
      await page.getByRole('button', { name: '没有，帮我写一份' }).click()
      await page.waitForURL((url) => url.pathname === '/resume/generate', { timeout: 15_000 })
    },
  })
}

async function generatePdf(
  page: Page,
  journey: string,
  collectors: ReturnType<typeof attachCollectors>,
): Promise<ExportedFile> {
  await shot(page, journey, 'generate-step0')
  await fillLabeled(page, /^姓名/, '林晓舟')
  await fillLabeled(page, /^联系电话/, '13900001234')
  await fillLabeled(page, /^所在城市/, '青岚市')
  await fillLabeled(page, /^邮箱/, 'linxiaozhou.example@example.com')
  await recordStep({
    page, journey, step: 'gen-next-intention', control: '下一步：求职意向', selectorHint: 'button:下一步：求职意向',
    kind: 'click', collectors,
    act: async () => { await clickStep(page, '下一步：求职意向') },
  })
  await fillLabeled(page, /^目标岗位/, '仓储管理员')
  await page.getByRole('combobox', { name: /^工作类型/ }).selectOption('全职')
  await clickStep(page, '下一步：教育经历')
  await fillLabeled(page, /^学校/, '青岚市海风职业学校')
  await fillLabeled(page, /^专业/, '物流管理')
  await clickStep(page, '下一步：工作经历')
  await fillLabeled(page, /^公司 \/ 单位/, '青岚市北区晨配服务站')
  await fillLabeled(page, /^职位/, '夜班分拣员')
  await fillLabeled(page, /^做了什么/, '核对运单、分拣包裹，并协助把当班的货装上车。')
  await clickStep(page, '下一步：项目经历')
  await clickStep(page, '下一步：技能证书')
  await fillLabeled(page, /^技能/, '手持终端扫码，库位核对，夜班交接')
  await page.getByRole('button', { name: '去核对', exact: true }).click()
  await recordStep({
    page, journey, step: 'generate-submit', control: '让 AI 整理成新简历', selectorHint: 'button:让 AI 整理成新简历',
    kind: 'click', collectors,
    act: async () => {
      await page.getByRole('button', { name: '让 AI 整理成新简历' }).click()
      await confirmAiConsent(
        page, journey, collectors,
        page.locator('[data-kiosk-screen="resume-generate-preview"]'),
      )
      await page.waitForURL((url) => url.pathname === '/resume/generate/preview', { timeout: 60_000 })
    },
  })
  await shot(page, journey, 'generate-preview')
  const held: { file: ExportedFile | null } = { file: null }
  await recordStep({
    page, journey, step: 'preview-export-pdf', control: '内容没问题，去导出', selectorHint: '[data-testid=resume-generate-preview-cta-export]',
    kind: 'click', collectors,
    act: async () => {
      const pending = page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url().includes('/resume/generate/export'),
        { timeout: 30_000 },
      )
      await page.getByTestId('resume-generate-preview-cta-export').click()
      await page.getByTestId('resume-generate-preview-fmt-pdf').click()
      await page.getByTestId('resume-generate-preview-cta-confirm-export').click()
      await confirmFactsIfOpen(page, journey, collectors, { wait: true })
      const response = await pending
      expect(response.ok(), '生成页 PDF 导出应返回成功').toBeTruthy()
      held.file = asExportFile(await response.json())
      await expect(page.getByText('文件已好')).toBeVisible({ timeout: 30_000 })
    },
  })
  if (!held.file) throw new Error('生成页没有拿到 PDF')
  await assertDownloaded(page, held.file.signedUrl, /application\/pdf/, true)
  await expect(page.getByRole('dialog', { name: held.file.filename }), '预览层应是这一份 PDF').toBeVisible()
  await shot(page, journey, 'generate-exported')
  return held.file
}

test('J3 匿名 · AI 帮你生成一份 → 预览 → 导出 PDF @interaction', async ({ browser }) => {
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j3-anon'
  try {
    await enterResumeHub(page, journey, collectors)
    await openGenerate(page, journey, collectors, 'hub-generate')
    await recordStep({
      page, journey, step: 'back-to-resume-service', control: '返回简历服务', selectorHint: 'button.qxt-back',
      kind: 'click', collectors,
      act: async () => {
        await page.locator('button.qxt-back').click()
      },
    })
    await page.waitForURL((url) => url.pathname === '/resume-service', { timeout: 15_000 })
    expect(new URL(page.url()).pathname, '顶栏返回简历服务应回到简历服务页').toBe('/resume-service')
    await expect(page.getByRole('button', { name: '有，帮我改一改' }), '应回到首页卡片打开的简历服务页').toBeVisible()
    await openGenerate(page, journey, collectors, 'hub-generate-dock')
    await recordStep({
      page, journey, step: 'back-to-resume-service-dock', control: '返回简历服务',
      selectorHint: 'footer.qxt-dock >> 返回简历服务', kind: 'click', collectors,
      act: async () => {
        await page.locator('footer.qxt-dock').getByRole('button', { name: '返回简历服务', exact: true }).click()
      },
    })
    await page.waitForURL((url) => url.pathname === '/resume-service', { timeout: 15_000 })
    expect(new URL(page.url()).pathname, '底栏返回简历服务应回到简历服务页').toBe('/resume-service')
    await expect(page.getByRole('button', { name: '有，帮我改一改' }), '底栏返回后应仍是简历服务页').toBeVisible()
    await openGenerate(page, journey, collectors, 'hub-generate-again')
    await generatePdf(page, journey, collectors)
    await assertNotProduction(collectors)
  } finally {
    await context.close()
  }
})

async function visitGuestProfile(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  await recordStep({
    page, journey, step: 'home', control: '(open /)', selectorHint: 'goto /', kind: 'click', collectors,
    act: async () => { await gotoHome(page) },
  })
  await recordStep({
    page, journey, step: 'home-profile', control: '我的', selectorHint: 'nav:我的',
    kind: 'click', collectors,
    act: async () => { await clickMeTab(page) },
  })
  await shot(page, journey, 'profile')
  appendOperation({
    journey, step: 'profile-guest-entries', route: '/profile', control: '(page-body)', selectorHint: 'body',
    kind: 'click', disabled: false, dead: false, skipped: 'guest-profile-has-no-asset-grid',
    observations: {
      urlChanged: false, apiRequests: [], domChanged: false, overlayOrToastOrError: false,
      beforeUrl: '/profile', afterUrl: '/profile', beforeTextLen: 0, afterTextLen: 0,
    },
    runtimeErrors: [], forbiddenCopy: [], screenshot: await shot(page, journey, 'profile-guest'),
    note: '游客「我的」不再有简历 / 文档 / AI 记录三个入口（旧 kp-entry）。这三个登录门改从简历服务台和打印扫描进入。',
  })
}

async function expectLoginHeading(page: Page, title: string): Promise<void> {
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  const text = await page.locator('body').innerText()
  expect(text).toMatch(/登录后/)
}

test('J4 匿名 · /me/ai-records 登录门与全部按钮 @interaction', async ({ browser }) => {
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j4-anon-ai-records'
  try {
    await visitGuestProfile(page, journey, collectors)
    await enterResumeHub(page, journey, collectors)
    await recordStep({
      page, journey, step: 'hub-ai-records', control: 'AI服务记录', selectorHint: 'button:AI服务记录',
      kind: 'click', collectors,
      act: async () => {
        await page.getByRole('button', { name: /AI服务记录/ }).click()
        await page.waitForURL((url) => url.pathname === '/me/ai-records', { timeout: 15_000 })
      },
    })
    await shot(page, journey, 'ai-records-gate')
    await expectLoginHeading(page, '登录后看你的AI 服务记录')
    await sweepVisible(page, journey, 'ai-records', collectors)
    await assertNotProduction(collectors)
  } finally {
    await context.close()
  }
})

test('J4 匿名 · /me/resumes 登录门与全部按钮 @interaction', async ({ browser }) => {
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j4-anon-resumes'
  try {
    await visitGuestProfile(page, journey, collectors)
    await enterResumeHub(page, journey, collectors)
    await recordStep({
      page, journey, step: 'hub-resumes', control: '我的简历', selectorHint: 'button:我的简历',
      kind: 'click', collectors,
      act: async () => {
        await page.getByRole('button', { name: /我的简历/ }).click()
        await page.waitForURL((url) => url.pathname === '/me/resumes', { timeout: 15_000 })
      },
    })
    await shot(page, journey, 'resumes-gate')
    await expectLoginHeading(page, '登录后看你的简历')
    await sweepVisible(page, journey, 'resumes', collectors)
    await assertNotProduction(collectors)
  } finally {
    await context.close()
  }
})

test('J4 匿名 · /me/documents 登录门与全部按钮 @interaction', async ({ browser }) => {
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j4-anon-documents'
  try {
    await visitGuestProfile(page, journey, collectors)
    await recordStep({
      page, journey, step: 'home-print', control: '打印 · 扫描', selectorHint: '[data-action=print-hub]',
      kind: 'click', collectors,
      act: async () => {
        await gotoHome(page)
        const card = page.locator('[data-action="print-hub"]')
        if (await card.count()) await card.click()
        else await page.getByRole('button', { name: /打印 · 扫描/ }).click()
        await page.waitForURL((url) => url.pathname === '/print-scan', { timeout: 15_000 })
      },
    })
    await recordStep({
      page, journey, step: 'print-documents', control: '我的文档', selectorHint: '[data-testid=print-hub-quick-documents]',
      kind: 'click', collectors,
      act: async () => {
        await page.getByTestId('print-hub-quick-documents').click()
        await page.waitForURL((url) => url.pathname === '/me/documents', { timeout: 15_000 })
      },
    })
    await shot(page, journey, 'documents-gate')
    await expectLoginHeading(page, '登录后看你的文档')
    await sweepVisible(page, journey, 'documents', collectors)
    await assertNotProduction(collectors)
  } finally {
    await context.close()
  }
})

async function openMemberRow(page: Page, kind: string, action: string): Promise<void> {
  const line = page.locator(`[data-record-kind="${kind}"]`).first()
  await expect(line).toBeVisible()
  await line.locator('button.me-open').click()
  await line.getByRole('button', { name: action, exact: true }).click()
}

async function returnToMemberResumes(page: Page): Promise<void> {
  await goProfile(page)
  if (new URL(page.url()).pathname !== '/profile') {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的', exact: true }).click()
    await page.waitForURL((url) => url.pathname === '/profile', { timeout: 15_000 })
    await waitReady(page)
  }
  await clickProfileEntry(page, '我的简历', '/me/resumes')
}

async function goProfile(page: Page): Promise<void> {
  await closePreviewIfOpen(page)
  const tab = page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的', exact: true })
  if (await tab.count()) await tab.click()
  else await page.getByTestId('resume-optimize-nav-profile').click()
  await page.waitForURL((url) => url.pathname === '/profile' || url.pathname.startsWith('/me/'), { timeout: 15_000 })
  await waitReady(page)
}

test('会员态 · 真短信 log 登录后 J1–J4 闭环（非桩） @interaction', async ({ browser }) => {
  test.setTimeout(360_000)
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'member'
  try {
    await gotoHome(page)
    await shot(page, journey, 'home')
    await recordStep({
      page, journey, step: 'home-login', control: '登录后查看本人记录', selectorHint: '[data-testid=home-identity]',
      kind: 'click', collectors,
      act: async () => {
        const loginEntry = page.getByRole('button', { name: /登录后查看本人记录/ })
        if (await loginEntry.count()) await loginEntry.first().click()
        else await page.getByTestId('home-identity').click()
        await page.waitForURL((url) => url.pathname === '/login', { timeout: 15_000 })
      },
    })
    const login = await loginMemberViaSms(page, journey, collectors)
    expect(login.codeSource, '假短信应能读到验证码，读不到就是失败').toBeTruthy()
    await shot(page, journey, 'logged-in')

    await enterResumeHub(page, journey, collectors)
    await enterDiagnoseSource(page, journey, collectors)
    await startDiagnosis(page, journey, collectors)
    expect(page.url(), '会员诊断未走到报告页').toContain('/resume/report')
    await openOptimize(page, journey, collectors, 'member-optimize')
    expect(page.url(), '会员未走到优化页').toContain('/resume/optimize')
    const toEditor = page.getByRole('button', { name: '编辑简历', exact: true })
    const toExport = page.getByRole('button', { name: '去导出', exact: true })
    await expect(toEditor.or(toExport).first()).toBeVisible({ timeout: 15_000 })
    if (await toEditor.isVisible()) await toEditor.click()
    await expect(toExport, '优化页没有导出入口').toBeVisible()
    const optimizeHeld: { file: ExportedFile | null } = { file: null }
    await recordStep({
      page, journey, step: 'member-export', control: '导出', selectorHint: 'button:导出',
      kind: 'click', collectors,
      act: async () => {
        const pending = page.waitForResponse(
          (res) => res.request().method() === 'POST' && res.url().includes('/resume/generate/export'),
          { timeout: 30_000 },
        )
        await toExport.click()
        await confirmFactsIfOpen(page, journey, collectors, { wait: true })
        await page.getByRole('button', { name: '导出', exact: true }).click()
        const response = await pending
        expect(response.ok(), '会员优化导出应返回成功').toBeTruthy()
        optimizeHeld.file = asExportFile(await response.json())
        await expect(page.locator('[aria-label="导出结果"]')).toBeVisible({ timeout: 30_000 })
      },
    })
    if (!optimizeHeld.file) throw new Error('会员优化导出没有拿到文件')
    const optimizeFile = optimizeHeld.file
    await expect(page.locator('[aria-label="导出结果"]')).toContainText(optimizeFile.filename)
    await assertDownloaded(page, optimizeFile.signedUrl, /application\/pdf/, true)
    await closePreviewIfOpen(page)

    await enterResumeHub(page, journey, collectors)
    await openGenerate(page, journey, collectors, 'member-generate')
    const generatedFile = await generatePdf(page, journey, collectors)
    await closePreviewIfOpen(page)

    await goProfile(page)
    await shot(page, journey, 'profile-member')
    await expect(page.getByRole('button', { name: '结束使用', exact: true })).toBeVisible()
    const diagnosisTaskId = await page.evaluate(() => {
      try {
        const raw = sessionStorage.getItem('ai-job-print:current-ai-resume')
        if (!raw) return ''
        const parsed = JSON.parse(raw) as { taskId?: unknown }
        return typeof parsed.taskId === 'string' ? parsed.taskId : ''
      } catch {
        return ''
      }
    })
    expect(diagnosisTaskId, '本次诊断的任务编号应在会话里').not.toBe('')
    for (const [label, path] of [
      ['AI服务记录', '/me/ai-records'],
      ['我的简历', '/me/resumes'],
      ['我的文档', '/me/documents'],
    ] as const) {
      if (new URL(page.url()).pathname !== '/profile') {
        const back = page.getByRole('button', { name: '返回我的', exact: true })
        if (await back.count()) await back.click()
        else await goProfile(page)
        await waitReady(page)
      }
      const pendingAiRecords = path === '/me/ai-records'
        ? page.waitForResponse(
          (res) => res.request().method() === 'GET' && res.url().includes('/api/v1/me/ai-records'),
          { timeout: 20_000 },
        )
        : null
      await recordStep({
        page, journey, step: `me-${path}`, control: label, selectorHint: `profile-asset:${label}`,
        kind: 'click', collectors,
        act: async () => { await clickProfileEntry(page, label, path) },
      })
      await shot(page, journey, label)
      await expect(page.getByRole('heading', { name: /登录后/ }), `${label}不应再弹登录门`).toHaveCount(0)
      if (path === '/me/ai-records') {
        const response = await pendingAiRecords
        if (!response) throw new Error('没有截到本次 AI 记录')
        expect(response.ok(), '本次 AI 记录接口应成功').toBeTruthy()
        const body = await response.json() as {
          data?: { items?: Array<{ kind?: string; taskId?: string }> }
          items?: Array<{ kind?: string; taskId?: string }>
        }
        const items = body.data?.items ?? body.items ?? []
        expect(
          items.some((item) => item.kind === 'parse' && item.taskId === diagnosisTaskId),
          'AI 记录应有这次诊断的任务编号',
        ).toBe(true)
        await expect(page.locator('[data-record-kind="parse"]').first(), '应有这次的简历诊断').toBeVisible()
        await expect(page.locator('[data-record-kind="optimize"]').first(), '应有这次的简历优化').toBeVisible()
        await expect(page.locator('[data-record-kind="generate"]').first(), '应有这次的 AI 简历生成').toBeVisible()
        await expect(page.getByText('简历诊断', { exact: true }).first()).toBeVisible()
        await expect(page.getByText('简历优化', { exact: true }).first()).toBeVisible()
        await expect(page.getByText('AI 简历生成', { exact: true }).first()).toBeVisible()
      } else if (path === '/me/resumes') {
        await expect(page.getByText(/上传诊断简历/).first(), '应有这次上传诊断的简历').toBeVisible()
        await expect(page.getByText(/AI 生成简历/).first(), '应有这次生成的简历').toBeVisible()
        await openMemberRow(page, 'generate', '查看并打印')
        await page.waitForURL((url) => url.pathname === '/resume/generate/preview', { timeout: 20_000 })
        await expect(page.getByText('林晓舟').first(), '这次生成的简历应写着林晓舟').toBeVisible({ timeout: 20_000 })
        await expect(page.getByText('仓储管理员').first(), '这次生成的简历应写着目标岗位').toBeVisible()
        await returnToMemberResumes(page)
        await page.evaluate(() => sessionStorage.removeItem('ai-job-print:current-ai-resume'))
        await openMemberRow(page, 'parse', '查看报告')
        await page.waitForURL((url) => url.pathname === '/resume/report', { timeout: 20_000 })
        await waitReady(page)
        const historyPdf = await exportReport(page, journey, collectors, '历史报告导出 PDF', /导出 PDF/)
        await clickReportButton(page, journey, collectors, /打印这份报告/, '历史报告打印这份报告')
        await expect(page.getByTestId('resume-report-export-result'), '从我的简历打开的报告，打印回来结果还在').toContainText(historyPdf.filename)
        await page.getByRole('button', { name: '生成二维码带走' }).click()
        await assertQrEncodes(page, historyPdf.signedUrl, historyPdf.filename)
        await closePreviewIfOpen(page)
        const stored = await page.evaluate(() => ({
          session: sessionStorage.getItem('ai-job-print:current-ai-resume'),
          local: localStorage.getItem('ai-job-print:current-ai-resume'),
        }))
        expect(stored.local, '回执不得写入 localStorage').toBeNull()
        const sessionText = stored.session ?? ''
        expect(sessionText, '回执不得写进简历会话').not.toContain('reportTakeaway')
        expect(sessionText, '带姓名的文件名不得进会话').not.toContain(historyPdf.filename)
        expect(sessionText, '取回链接不得进会话').not.toContain(historyPdf.signedUrl)
        await returnToMemberResumes(page)
      } else {
        await expect(page.getByText(optimizeFile.filename, { exact: true }), '我的文档应有这次优化导出的文件').toBeVisible()
        await expect(page.getByText(generatedFile.filename, { exact: true }), '我的文档应有这次生成的文件').toBeVisible()
      }
      const del = page.getByRole('button', { name: /删除/ })
      if (await del.count()) {
        await recordStep({
          page, journey, step: `${label}-delete`, control: '删除', selectorHint: 'button:删除',
          kind: 'click', collectors,
          act: async () => {
            await del.first().click()
            const confirm = page.getByRole('button', { name: /确认删除/ })
            if (await confirm.count()) {
              await confirm.first().click()
              await confirm.first().waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
            }
          },
        })
        await shot(page, journey, `${label}-after-delete`)
      }
    }
    await assertNotProduction(collectors)
  } finally {
    await context.close()
  }
})
