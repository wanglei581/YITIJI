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
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  appendOperation,
  attachCollectors,
  clickMeTab,
  clickNamed,
  clickProfileEntry,
  closePreviewIfOpen,
  confirmAiConsent,
  confirmFactsIfOpen,
  fillDiagnosisDirection,
  gotoHome,
  listVisibleControls,
  loginMemberViaSms,
  newSweepContext,
  operateControl,
  recordStep,
  scanForbidden,
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

test.afterAll(() => {
  writeSummary(readOperations())
})

async function assertNotProduction(collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  expect(collectors.productionHits, '禁止访问生产 zyidai.cn / 120.48.13.190').toEqual([])
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
        const wentToPrint = await page.waitForURL((url) => url.pathname.startsWith('/print'), { timeout: 12_000 }).then(() => true).catch(() => false)
        if (wentToPrint) {
          await shot(page, journey, 'report-print-landed')
          await page.goBack({ waitUntil: 'domcontentloaded' })
          await page.waitForURL((url) => url.pathname === '/resume/report', { timeout: 15_000 })
          await waitReady(page)
        }
      }
      await closePreviewIfOpen(page)
    },
  })
}

function noteMissing(journey: string, label: string, why: string): void {
  appendOperation({
    journey, step: `report-absent-${label}`, route: '/resume/report',
    control: label, selectorHint: `button:${label}`,
    kind: 'click', disabled: false, dead: false,
    skipped: 'not-on-touch-report',
    observations: {
      urlChanged: false, apiRequests: [], domChanged: false, overlayOrToastOrError: false,
      beforeUrl: '/resume/report', afterUrl: '/resume/report', beforeTextLen: 0, afterTextLen: 0,
    },
    runtimeErrors: [], forbiddenCopy: [], screenshot: '',
    note: why,
  })
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

    await clickReportButton(page, journey, collectors, /导出 PDF/, '导出 PDF')
    await expect(page.getByRole('button', { name: '生成二维码带走' })).toBeVisible({ timeout: 30_000 })
    await clickReportButton(page, journey, collectors, /生成二维码带走/, '生成二维码带走')
    await expect(page.getByRole('button', { name: '打印这份报告' })).toBeVisible({ timeout: 15_000 })
    await clickReportButton(page, journey, collectors, /打印这份报告/, '打印这份报告')
    await clickReportButton(page, journey, collectors, /导出修改清单/, '导出修改清单')
    const renamedPrint = page.getByRole('button', { name: '打印修改清单' })
    if (await renamedPrint.count()) {
      await clickReportButton(page, journey, collectors, /打印修改清单/, '打印修改清单')
    }

    noteMissing(journey, '重新诊断', '触屏报告页只有空报告才显示「重新诊断」（ResumeReportActions.tsx）；有建议时主按钮是「查看优化建议」。')
    noteMissing(journey, '目标岗位匹配参考', '触屏诊断报告页没有这个按钮。岗位匹配在简历对照页，不在这份报告的带走区。')
    noteMissing(journey, '做一次自我探索', '触屏诊断报告页没有这个按钮。自我探索在职业规划页（CareerPlanPage.tsx），不在报告带走区。')

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

test('J2 匿名 · 诊断→对照→应用弹层两分支→四种导出 @interaction', async ({ browser }) => {
  test.setTimeout(360_000)
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j2-anon'
  try {
    await enterResumeHub(page, journey, collectors)
    await enterDiagnoseSource(page, journey, collectors)
    await startDiagnosis(page, journey, collectors)
    await openOptimize(page, journey, collectors, 'to-optimize')
    await expect(page.getByRole('button', { name: '逐条看（从第 1 条）' })).toBeVisible({ timeout: 30_000 })
    await shot(page, journey, 'optimize-ready')

    await openCompareFromOverview(page, journey, collectors, 'open-compare-1')
    await shot(page, journey, 'compare')
    await chooseCompare(page, '用改写')
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
    await recordStep({
      page, journey, step: 'apply-to-editor', control: '应用到编辑区', selectorHint: 'dialog >> 应用到编辑区',
      kind: 'click', collectors,
      act: async () => { await applyDialog.getByRole('button', { name: '应用到编辑区' }).click() },
    })
    await expect(applyDialog).toBeHidden()

    await openCompareFromOverview(page, journey, collectors, 'open-compare-2')
    await chooseCompare(page, '保留原文')
    await recordStep({
      page, journey, step: 'compare-back', control: '返回优化页', selectorHint: 'button:返回优化页',
      kind: 'click', collectors,
      act: async () => { await page.getByRole('button', { name: '返回优化页', exact: true }).click() },
    })
    await page.waitForURL((url) => url.pathname === '/resume/optimize', { timeout: 15_000 })
    await shot(page, journey, 'apply-dialog-2')
    const skipDialog = page.getByRole('dialog', { name: /对照页有/ })
    await expect(skipDialog, '第二次带回裁决仍应出现应用弹层').toBeVisible()
    await recordStep({
      page, journey, step: 'apply-skip', control: '暂不应用', selectorHint: 'dialog >> 暂不应用',
      kind: 'click', collectors,
      act: async () => { await skipDialog.getByRole('button', { name: '暂不应用' }).click() },
    })
    await expect(skipDialog).toBeHidden()

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
    const formats = ['PDF', 'DOCX', 'TXT', 'MD'] as const
    for (const format of formats) {
      await closePreviewIfOpen(page)
      await recordStep({
        page, journey, step: `format-${format}`, control: format, selectorHint: `[aria-label=导出格式] >> ${format}`,
        kind: 'click', collectors,
        act: async () => {
          const btn = page.getByRole('group', { name: '导出格式' }).getByRole('button', { name: new RegExp(`^${format}`) })
          await btn.first().click()
        },
      })
      await recordStep({
        page, journey, step: `export-${format}`, control: `导出 ${format}`, selectorHint: 'button:导出',
        kind: 'click', collectors,
        act: async () => {
          const exportBtn = page.getByRole('button', { name: '导出', exact: true })
          await expect(exportBtn).toBeVisible()
          await exportBtn.click()
          await expect(page.locator('[aria-label="导出结果"]')).toBeVisible({ timeout: 30_000 })
          await closePreviewIfOpen(page)
        },
      })
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

test('J3 匿名 · AI 帮你生成一份 → 预览 → 导出 PDF @interaction', async ({ browser }) => {
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j3-anon'
  try {
    await enterResumeHub(page, journey, collectors)
    await recordStep({
      page, journey, step: 'hub-generate', control: '没有，帮我写一份', selectorHint: 'button:没有，帮我写一份',
      kind: 'click', collectors,
      act: async () => {
        await page.getByRole('button', { name: '没有，帮我写一份' }).click()
        await page.waitForURL((url) => url.pathname === '/resume/generate', { timeout: 15_000 })
      },
    })
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
    await recordStep({
      page, journey, step: 'preview-export-pdf', control: '内容没问题，去导出', selectorHint: '[data-testid=resume-generate-preview-cta-export]',
      kind: 'click', collectors,
      act: async () => {
        await page.getByTestId('resume-generate-preview-cta-export').click()
        await page.getByTestId('resume-generate-preview-fmt-pdf').click()
        await page.getByTestId('resume-generate-preview-cta-confirm-export').click()
        await confirmFactsIfOpen(page, journey, collectors, { wait: true })
        await expect(page.getByText('文件已好')).toBeVisible({ timeout: 30_000 })
      },
    })
    await shot(page, journey, 'generate-exported')
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
    if (!login.codeSource) {
      appendOperation({
        journey, step: 'member-login-failed', route: new URL(page.url()).pathname, control: '确认登录',
        selectorHint: 'sms-log/redis', kind: 'click', disabled: false, dead: false,
        observations: { urlChanged: false, apiRequests: [], domChanged: false, overlayOrToastOrError: true, beforeUrl: '/login', afterUrl: new URL(page.url()).pathname, beforeTextLen: 0, afterTextLen: 0 },
        runtimeErrors: [], forbiddenCopy: [], screenshot: await shot(page, journey, 'login-no-code'),
        note: '未覆盖：未能从 Redis 或短信日志读到开发验证码。会员态未走通，未使用 ApiRouter 桩。',
      })
      await assertNotProduction(collectors)
      test.skip(true, '未能读到开发验证码（Redis 或短信日志），会员态未覆盖 —— 不是通过')
      return
    }
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
    await toExport.click()
    await confirmFactsIfOpen(page, journey, collectors, { wait: true })
    await page.getByRole('button', { name: '导出', exact: true }).click()
    await expect(page.locator('[aria-label="导出结果"]')).toBeVisible({ timeout: 30_000 })
    await closePreviewIfOpen(page)

    await goProfile(page)
    await shot(page, journey, 'profile-member')
    await expect(page.getByRole('button', { name: '结束使用', exact: true })).toBeVisible()
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
      await recordStep({
        page, journey, step: `me-${path}`, control: label, selectorHint: `profile-asset:${label}`,
        kind: 'click', collectors,
        act: async () => { await clickProfileEntry(page, label, path) },
      })
      await shot(page, journey, label)
      const body = await page.locator('body').innerText()
      appendOperation({
        journey, step: `${label}-presence`, route: path, control: '(page-body)', selectorHint: 'body',
        kind: 'click', disabled: false, dead: false,
        observations: {
          urlChanged: false, apiRequests: collectors.takeApiSince(),
          domChanged: true, overlayOrToastOrError: false,
          beforeUrl: path, afterUrl: path, beforeTextLen: 0, afterTextLen: body.length,
        },
        runtimeErrors: [...collectors.runtimeErrors],
        forbiddenCopy: await scanForbidden(page),
        screenshot: await shot(page, journey, `${label}-body`),
        note: body.includes('还没有') || body.includes('登录后')
          ? `empty-or-gate: ${body.slice(0, 180)}`
          : `has-content: ${body.slice(0, 180)}`,
      })
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
