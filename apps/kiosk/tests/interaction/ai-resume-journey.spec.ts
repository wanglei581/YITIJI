/**
 * 包 Q-AI · AI 简历 → 我的 交互走查
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
  clickNamed,
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
  resetEvidence,
  scanForbidden,
  shot,
  uploadResumePdf,
  waitReady,
  waitReport,
  writeSummary,
  readOperations,
  type ControlOp,
} from './sweep-harness'

test.describe.configure({ mode: 'serial' })

const PRINT_OR_JOBS = ['去打印扫描', '查看岗位', '打印扫描', '岗位信息', 'U盘', '手机扫码']

test.beforeAll(() => {
  resetEvidence()
})

test.afterAll(() => {
  writeSummary(readOperations())
})

async function assertNotProduction(collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  expect(collectors.productionHits, '禁止访问生产 zyidai.cn / 120.48.13.190').toEqual([])
}

async function enterResumeHub(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  await recordStep({
    page, journey, step: 'home', control: '(open /)', selectorHint: 'goto /', kind: 'click', collectors,
    act: async () => { await gotoHome(page) },
  })
  await shot(page, journey, 'home')
  await recordStep({
    page, journey, step: 'home-resume-hub', control: 'AI 简历服务', selectorHint: '[data-domain-id=resume] .v6-home-domain__main',
    kind: 'click', collectors,
    act: async () => {
      const card = page.locator('[data-domain-id="resume"] .v6-home-domain__main')
      if (await card.count()) await card.click()
      else await clickNamed(page, /AI 简历服务/)
      await page.waitForURL((url) => url.pathname === '/resume-service', { timeout: 15_000 })
    },
  })
}

async function enterDiagnoseSource(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  await recordStep({
    page, journey, step: 'hub-diagnose', control: 'AI简历诊断', selectorHint: 'button:AI简历诊断',
    kind: 'click', collectors,
    act: async () => {
      await page.getByRole('button', { name: /AI简历诊断/ }).click()
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
      await page.getByRole('button', { name: /开始 AI 诊断/ }).click()
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
    if (extraSkip.some((item) => control.text.includes(item))) {
      ops.push(await operateControl(page, control, journey, stepPrefix, collectors, extraSkip))
      continue
    }
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

test('J1 匿名 · 首页→诊断→报告页按钮 @interaction', async ({ browser }) => {
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j1-anon'
  try {
    await enterResumeHub(page, journey, collectors)
    await sweepVisible(page, journey, 'hub', collectors, [
      'AI简历诊断', '简历打印', '去打印', 'U盘',
    ])
    await enterDiagnoseSource(page, journey, collectors)
    await startDiagnosis(page, journey, collectors)
    await shot(page, journey, 'report')
    const body = await page.locator('body').innerText()
    expect(body.replace(/去来源平台投递|来源平台投递/g, ''), '合规禁词').not.toMatch(/一键投递|立即投递|平台投递/)

    const reportButtons = [
      { name: /导出 PDF/, skip: false },
      { name: /导出修改清单/, skip: false },
      { name: /生成二维码带走/, skip: false },
      { name: /打印这份报告/, skip: false },
      { name: /重新诊断/, skip: true },
      { name: /查看优化建议|继续生成优化版简历/, skip: true },
      { name: /目标岗位匹配参考/, skip: true },
      { name: /做一次自我探索/, skip: true },
      { name: /首页/, skip: true },
      { name: /AI 顾问/, skip: true },
      { name: /我的/, skip: true },
    ]
    for (const item of reportButtons) {
      const locator = page.getByRole('button', { name: item.name })
      if (!(await locator.count())) continue
      if (item.skip) {
        appendOperation({
          journey, step: `report-listed-${item.name}`, route: '/resume/report',
          control: String(item.name), selectorHint: `button:${String(item.name)}`,
          kind: 'click', disabled: false, dead: false, skipped: 'kept-for-j1-continue-or-out-of-scope',
          observations: { urlChanged: false, apiRequests: [], domChanged: false, overlayOrToastOrError: false, beforeUrl: '/resume/report', afterUrl: '/resume/report', beforeTextLen: 0, afterTextLen: 0 },
          runtimeErrors: [], forbiddenCopy: [], screenshot: await shot(page, journey, 'report-skip'),
        })
        continue
      }
      await recordStep({
        page, journey, step: `report-${String(item.name)}`, control: String(item.name),
        selectorHint: `button:${String(item.name)}`, kind: 'click', collectors,
        act: async () => {
          await locator.first().click()
          await confirmFactsIfOpen(page, journey, collectors)
          await page.waitForTimeout(800)
          if (page.url().includes('/print/')) {
            await shot(page, journey, 'report-print-landed')
            await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
            await waitReady(page)
          }
          await closePreviewIfOpen(page)
        },
      })
    }

    await recordStep({
      page, journey, step: 'report-optimize', control: '查看优化建议', selectorHint: '[data-testid=resume-report-primary]',
      kind: 'click', collectors,
      act: async () => {
        const cta = page.getByTestId('resume-report-primary')
        if (await cta.count()) await cta.click()
        else await page.getByRole('button', { name: /查看优化建议|继续生成优化版简历/ }).click()
      },
    })
    await confirmAiConsent(page, journey, collectors)
    await shot(page, journey, 'after-optimize-cta')
    await assertNotProduction(collectors)
  } finally {
    await context.close()
  }
})

test('J2 匿名 · 诊断→对照→应用弹层两分支→四种导出 @interaction', async ({ browser }) => {
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j2-anon'
  try {
    await enterResumeHub(page, journey, collectors)
    await enterDiagnoseSource(page, journey, collectors)
    await startDiagnosis(page, journey, collectors)
    await recordStep({
      page, journey, step: 'to-optimize', control: '查看优化建议', selectorHint: '[data-testid=resume-report-primary]',
      kind: 'click', collectors,
      act: async () => {
        const cta = page.getByTestId('resume-report-primary')
        if (await cta.count()) await cta.click()
        else await page.getByRole('button', { name: /查看优化建议|继续生成优化版简历/ }).click()
        await page.waitForURL((url) => url.pathname === '/resume/optimize', { timeout: 30_000 })
      },
    })
    await confirmAiConsent(page, journey, collectors)
    await page.locator('[data-kiosk-screen="resume-optimize"]').waitFor({ timeout: 30_000 })
    await shot(page, journey, 'optimize-ready')

    const openCompare = async (label: string) => {
      await recordStep({
        page, journey, step: label, control: '逐条看完整对照', selectorHint: 'button:逐条看完整对照',
        kind: 'click', collectors,
        act: async () => {
          const leaveStay = page.getByRole('button', { name: /留在本页|继续编辑/ })
          await page.getByRole('button', { name: /逐条看完整对照/ }).click()
          if (await page.getByRole('dialog').count()) {
            const leave = page.getByRole('button', { name: /离开|放弃|仍要离开/ })
            if (await leave.count()) await leave.first().click()
            else if (await leaveStay.count()) { /* ignore */ }
          }
          await page.waitForURL((url) => url.pathname === '/resume/optimize/compare', { timeout: 20_000 })
        },
      })
    }

    await openCompare('open-compare-1')
    await shot(page, journey, 'compare')

    const confirmAdds = async () => {
      const boxes = page.locator('.qxc-facts input[type="checkbox"]')
      const total = await boxes.count()
      for (let i = 0; i < total; i += 1) {
        await boxes.nth(i).check().catch(() => undefined)
      }
    }
    await confirmAdds()
    await recordStep({
      page, journey, step: 'compare-rewrite', control: '用改写', selectorHint: 'button:用改写',
      kind: 'click', collectors,
      act: async () => { await page.getByRole('button', { name: '用改写' }).click() },
    })
    await recordStep({
      page, journey, step: 'compare-next-1', control: '下一条', selectorHint: 'button:下一条',
      kind: 'click', collectors,
      act: async () => { await page.getByRole('button', { name: '下一条' }).click() },
    })
    await confirmAdds()
    await recordStep({
      page, journey, step: 'compare-keep', control: '保留原文', selectorHint: 'button:保留原文',
      kind: 'click', collectors,
      act: async () => { await page.getByRole('button', { name: '保留原文' }).click() },
    })
    await recordStep({
      page, journey, step: 'compare-next-2', control: '下一条', selectorHint: 'button:下一条',
      kind: 'click', collectors,
      act: async () => { await page.getByRole('button', { name: '下一条' }).click() },
    })
    while (page.url().includes('/resume/optimize/compare')) {
      if (await page.getByRole('button', { name: '下一条' }).isEnabled().catch(() => false)) {
        await confirmAdds()
        const keep = page.getByRole('button', { name: '保留原文' })
        if (await keep.count()) await keep.click()
        await page.getByRole('button', { name: '下一条' }).click()
        await page.waitForTimeout(300)
      } else {
        const back = page.getByRole('button', { name: /返回优化页/ })
        if (await back.count()) await back.first().click()
        else break
      }
    }
    await page.waitForURL((url) => url.pathname === '/resume/optimize', { timeout: 15_000 }).catch(() => undefined)
    await shot(page, journey, 'apply-dialog-1')
    if (await page.getByRole('dialog', { name: /对照页有/ }).count()) {
      await recordStep({
        page, journey, step: 'apply-to-editor', control: '应用到编辑区', selectorHint: 'dialog >> 应用到编辑区',
        kind: 'click', collectors,
        act: async () => { await page.getByRole('button', { name: '应用到编辑区' }).click() },
      })
    }

    await openCompare('open-compare-2')
    await confirmAdds()
    if (await page.getByRole('button', { name: '保留原文' }).count()) {
      await page.getByRole('button', { name: '保留原文' }).click()
    }
    const back2 = page.getByRole('button', { name: /返回优化页/ })
    if (await back2.count()) await back2.first().click()
    await page.waitForURL((url) => url.pathname === '/resume/optimize', { timeout: 15_000 }).catch(() => undefined)
    await shot(page, journey, 'apply-dialog-2')
    if (await page.getByRole('dialog', { name: /对照页有/ }).count()) {
      await recordStep({
        page, journey, step: 'apply-skip', control: '暂不应用', selectorHint: 'dialog >> 暂不应用',
        kind: 'click', collectors,
        act: async () => { await page.getByRole('button', { name: '暂不应用' }).click() },
      })
    }

    const formats = ['PDF', 'Word', 'TXT', 'Markdown'] as const
    for (const format of formats) {
      await recordStep({
        page, journey, step: `format-${format}`, control: format, selectorHint: `.qx-rd-fmt >> ${format}`,
        kind: 'click', collectors,
        act: async () => {
          const btn = page.locator('.qx-rd-fmt button', { hasText: format })
          if (await btn.count()) await btn.first().click()
        },
      })
      await recordStep({
        page, journey, step: `export-${format}`, control: `导出 ${format}`, selectorHint: `button:导出 ${format}|确认优化版`,
        kind: 'click', collectors,
        act: async () => {
          const exportBtn = page.getByRole('button', { name: new RegExp(`导出 ${format}|确认优化版，导出`) })
          await exportBtn.first().click()
          await confirmFactsIfOpen(page, journey, collectors)
          await page.waitForTimeout(1200)
          await closePreviewIfOpen(page)
        },
      })
    }
    await assertNotProduction(collectors)
  } finally {
    await context.close()
  }
})

test('J3 匿名 · AI 帮你生成一份 → 预览 → 导出 PDF @interaction', async ({ browser }) => {
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j3-anon'
  try {
    await enterResumeHub(page, journey, collectors)
    await recordStep({
      page, journey, step: 'hub-generate', control: '简历生成', selectorHint: 'button:简历生成',
      kind: 'click', collectors,
      act: async () => {
        await page.getByRole('button', { name: /简历生成/ }).click()
        await page.waitForURL((url) => url.pathname === '/resume/generate', { timeout: 15_000 })
      },
    })
    await shot(page, journey, 'generate-step0')
    await page.locator('input').first().fill('测试用户')
    const phone = page.getByPlaceholder(/联系方式/)
    if (await phone.count()) await phone.fill('13800000000')
    await recordStep({
      page, journey, step: 'gen-next-1', control: '下一步：求职意向', selectorHint: 'button:下一步',
      kind: 'click', collectors,
      act: async () => { await page.getByRole('button', { name: /下一步/ }).click() },
    })
    await page.getByPlaceholder(/前端开发工程师/).fill('前端工程师')
    const jobType = page.locator('select').first()
    if (await jobType.count()) await jobType.selectOption({ index: 1 }).catch(() => undefined)
    await page.getByRole('button', { name: /下一步/ }).click()
    await waitReady(page)
    await page.locator('input').first().fill('测试大学')
    const major = page.getByText('专业', { exact: true }).locator('..').locator('input')
    if (await major.count()) await major.fill('计算机科学与技术')
    await page.getByRole('button', { name: /下一步/ }).click()
    await waitReady(page)
    const inputs = page.locator('input')
    if (await inputs.count() >= 2) {
      await inputs.nth(0).fill('测试科技')
      await inputs.nth(1).fill('前端实习生')
    }
    const desc = page.locator('textarea').first()
    if (await desc.count()) await desc.fill('负责页面开发与组件维护，这是交互走查填写的中文内容')
    await page.getByRole('button', { name: /下一步/ }).click()
    await waitReady(page)
    await page.getByRole('button', { name: /下一步/ }).click()
    await waitReady(page)
    const skills = page.locator('textarea').first()
    if (await skills.count()) await skills.fill('TypeScript, React')
    await recordStep({
      page, journey, step: 'generate-submit', control: '生成我的简历', selectorHint: 'button:生成我的简历',
      kind: 'click', collectors,
      act: async () => {
        await page.getByRole('button', { name: /生成我的简历/ }).click()
        await confirmAiConsent(page, journey, collectors)
        await page.waitForURL((url) => url.pathname === '/resume/generate/preview', { timeout: 60_000 })
      },
    })
    await shot(page, journey, 'generate-preview')
    await recordStep({
      page, journey, step: 'preview-export-pdf', control: '内容没问题，去导出 / 导出 PDF', selectorHint: '[data-testid=resume-generate-preview-cta-export]',
      kind: 'click', collectors,
      act: async () => {
        const cta = page.getByTestId('resume-generate-preview-cta-export')
        if (await cta.count()) await cta.click()
        else await page.getByRole('button', { name: /去导出|导出 PDF/ }).click()
        await confirmFactsIfOpen(page, journey, collectors)
        await page.waitForTimeout(1500)
      },
    })
    await shot(page, journey, 'generate-exported')
    await assertNotProduction(collectors)
  } finally {
    await context.close()
  }
})

async function openMePage(
  page: Page,
  journey: string,
  collectors: ReturnType<typeof attachCollectors>,
  entry: string,
  path: string,
): Promise<void> {
  await recordStep({
    page, journey, step: 'home', control: '(open /)', selectorHint: 'goto /', kind: 'click', collectors,
    act: async () => { await gotoHome(page) },
  })
  await recordStep({
    page, journey, step: 'home-profile', control: '我的', selectorHint: 'home profile / nav 我的',
    kind: 'click', collectors,
    act: async () => {
      const profileBtn = page.getByRole('button', { name: /^我的$|个人中心/ })
      const header = page.locator('button', { hasText: /^我的$/ })
      if (await page.locator('[data-action="profile"], [data-testid="home-profile"]').count()) {
        await page.locator('[data-action="profile"], [data-testid="home-profile"]').first().click()
      } else if (await profileBtn.count()) {
        await profileBtn.first().click()
      } else if (await header.count()) {
        await header.first().click()
      } else {
        await page.goto(`${page.url().replace(/\/$/, '')}/profile`.replace(/\/profile\/profile/, '/profile'), { waitUntil: 'domcontentloaded' }).catch(async () => {
          await page.evaluate(() => { window.location.assign('/profile') })
        })
      }
      await page.waitForURL((url) => url.pathname === '/profile', { timeout: 15_000 })
    },
  })
  await shot(page, journey, 'profile')
  await recordStep({
    page, journey, step: `profile-${entry}`, control: entry, selectorHint: `text=${entry}`,
    kind: 'click', collectors,
    act: async () => {
      await page.getByRole('button', { name: new RegExp(entry) }).first().click()
      await page.waitForURL((url) => url.pathname === path, { timeout: 15_000 })
    },
  })
}

test('J4 匿名 · /me/ai-records 登录门与全部按钮 @interaction', async ({ browser }) => {
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'j4-anon-ai-records'
  try {
    await openMePage(page, journey, collectors, 'AI服务记录', '/me/ai-records')
    await shot(page, journey, 'ai-records-gate')
    const text = await page.locator('body').innerText()
    expect(text).toMatch(/登录后/)
    await sweepVisible(page, journey, 'ai-records', collectors, PRINT_OR_JOBS)
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
    await openMePage(page, journey, collectors, '我的简历', '/me/resumes')
    await shot(page, journey, 'resumes-gate')
    await sweepVisible(page, journey, 'resumes', collectors, PRINT_OR_JOBS)
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
    await openMePage(page, journey, collectors, '我的文档', '/me/documents')
    await shot(page, journey, 'documents-gate')
    await sweepVisible(page, journey, 'documents', collectors, PRINT_OR_JOBS)
    await assertNotProduction(collectors)
  } finally {
    await context.close()
  }
})

test('会员态 · 真短信 log 登录后 J1–J4 闭环（非桩） @interaction', async ({ browser }) => {
  const { context, page } = await newSweepContext(browser)
  const collectors = attachCollectors(page)
  const journey = 'member'
  try {
    await gotoHome(page)
    await shot(page, journey, 'home')
    const loginEntry = page.getByRole('button', { name: /登录|会员/ })
    if (await loginEntry.count()) {
      await recordStep({
        page, journey, step: 'home-login', control: '登录', selectorHint: 'button:登录',
        kind: 'click', collectors,
        act: async () => {
          await loginEntry.first().click()
        },
      })
    } else {
      await page.evaluate(() => { window.location.assign('/login?from=/') })
      await waitReady(page)
    }
    const login = await loginMemberViaSms(page, journey, collectors)
    expect(login.codeSource, '未能从 Redis / sweep-api.log 读到开发短信验证码，会员态未走通（不是桩）').toBeTruthy()
    await page.waitForTimeout(1500)
    await shot(page, journey, 'logged-in')

    if (!page.url().includes('/resume')) {
      await enterResumeHub(page, journey, collectors)
      await enterDiagnoseSource(page, journey, collectors)
    }
    if (page.url().includes('/resume-service')) await enterDiagnoseSource(page, journey, collectors)
    if (page.url().includes('/resume/source') || new URL(page.url()).pathname === '/') {
      if (new URL(page.url()).pathname === '/') {
        await enterResumeHub(page, journey, collectors)
        await enterDiagnoseSource(page, journey, collectors)
      }
      await startDiagnosis(page, journey, collectors)
    }
    if (page.url().includes('/resume/report')) {
      await recordStep({
        page, journey, step: 'member-optimize', control: '查看优化建议', selectorHint: '[data-testid=resume-report-primary]',
        kind: 'click', collectors,
        act: async () => {
          const cta = page.getByTestId('resume-report-primary')
          if (await cta.count()) await cta.click()
        },
      })
      await confirmAiConsent(page, journey, collectors)
    }
    if (page.url().includes('/resume/optimize')) {
      const exportBtn = page.getByRole('button', { name: /确认优化版，导出 PDF|导出 PDF/ })
      if (await exportBtn.count()) {
        await exportBtn.first().click()
        await confirmFactsIfOpen(page, journey, collectors)
        await page.waitForTimeout(1200)
        await closePreviewIfOpen(page)
      }
    }

    await page.evaluate(() => { window.location.assign('/profile') })
    await waitReady(page)
    await shot(page, journey, 'profile-member')
    for (const [label, path] of [
      ['AI服务记录', '/me/ai-records'],
      ['我的简历', '/me/resumes'],
      ['我的文档', '/me/documents'],
    ] as const) {
      await page.evaluate((target) => { window.location.assign(target) }, '/profile')
      await waitReady(page)
      await recordStep({
        page, journey, step: `me-${path}`, control: label, selectorHint: `button:${label}`,
        kind: 'click', collectors,
        act: async () => {
          await page.getByRole('button', { name: new RegExp(label) }).first().click()
          await page.waitForURL((url) => url.pathname === path, { timeout: 15_000 })
        },
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
            if (await confirm.count()) await confirm.first().click()
            else await del.first().click()
            await page.waitForTimeout(800)
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
