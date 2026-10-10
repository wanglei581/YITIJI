// 稿 25：求职材料库十态。运行页不读 ?state=，每态都走页面自己的请求和按钮。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../../fixtures/api-router'
import type { QingxuPairTarget } from '../qingxu-pair-targets'
import { loginThroughVisibleUi, registerAuthenticatedMemberApis, registerMemberLogin } from '../kiosk-p1-evidence-capture-api'
import type { ResumePageFixture, ResumePagesPlan } from './types'

const PLAN = { kind: 'resume-pages' } as const
const PATH = '/resume/materials'
const TEMPLATES = '/api/v1/job-materials/templates'
const GENERATE = '/api/v1/job-materials/generate'
const DRIVEN = new Set(['select', 'signed-out', 'loading', 'error', 'empty', 'submitting', 'failed', 'generated', 'generated-no-print'])

const none = (reason: string): ResumePagesPlan => ({ plan: { kind: 'none' }, reason, marker: null, runtimePath: null })
const paired = (marker: string): ResumePagesPlan => ({ plan: PLAN, reason: null, marker, runtimePath: PATH })

const FIELDS = [
  { key: 'applicantName', label: '姓名', required: true, maxLength: 40, placeholder: '例：孙晓雯' },
  { key: 'targetRole', label: '目标岗位', required: true, maxLength: 60, placeholder: '例：仓储主管' },
  { key: 'targetOrganization', label: '目标单位', required: false, maxLength: 80, placeholder: '例：青岛职业技术学院' },
  { key: 'keyStrengths', label: '核心亮点', required: false, maxLength: 280, multiline: true, placeholder: '例：入库核对与班次交接' },
  { key: 'notes', label: '补充说明', required: false, maxLength: 220, multiline: true, placeholder: '例：语气稳重' },
]
const doc = (id: string, type: string, title: string, description: string, tags: string[], recommendedFor: string, outputFilename: string) => ({
  id, type, title, description, tags, status: 'published', recommendedFor, outputFilename, fields: FIELDS,
})
const DOCS = [
  doc('campus-cover-letter', 'cover_letter', '校招自荐信', '适合应届生在校招现场生成一页自荐材料。', ['校招', '通用'], '应届毕业生、校园招聘会', '校招自荐信.pdf'),
  doc('experienced-cover-letter', 'cover_letter', '社招求职信', '围绕岗位要求与过往成果生成正式求职信。', ['社招', '通用'], '社招求职、线下招聘会沟通', '社招求职信.pdf'),
  doc('interview-thank-you', 'thank_you', '面试感谢信', '面试后整理感谢与补充说明，方便本人自行发送。', ['面试', '通用'], '面试结束后的跟进', '面试感谢信.pdf'),
  doc('portfolio-cover', 'portfolio_cover', '作品集封面', '为运营、仓储展示材料生成封面页。', ['设计岗', '运营岗'], '作品集打印、材料装订首页', '作品集封面.pdf'),
  doc('job-fair-checklist', 'materials_checklist', '招聘会材料清单', '参加招聘会前的材料准备清单。', ['招聘会', '通用'], '招聘会现场打印、材料整理', '招聘会材料清单.pdf'),
]
const templatesOf = (...items: unknown[]) => ({ status: 200, json: { success: true, data: items } })
const FILE = {
  templateId: 'campus-cover-letter', templateTitle: '校招自荐信', documentType: 'cover_letter', fileId: 'jm-sun-xiaowen-001',
  filename: '校招自荐信.pdf', mimeType: 'application/pdf', sizeBytes: 186_368, pageCount: 2,
  signedUrl: '/api/v1/files/jm-sun-xiaowen-001/content?sig=pair', signedUrlExpiresAt: '2026-10-07T10:30:00.000Z',
  fileExpiresAt: '2026-12-07T00:00:00.000Z', previewUrlPath: '/files/jm-sun-xiaowen-001/preview-url',
  downloadUrlPath: '/files/jm-sun-xiaowen-001/download-url', printFileUrl: '/api/v1/files/jm-sun-xiaowen-001/content?sig=pair-print',
}

function registerDocs(api: ApiRouter): void {
  registerMemberLogin(api)
  registerAuthenticatedMemberApis(api)
  api.respond('GET', TEMPLATES, templatesOf(...DOCS))
}

async function finishVisibleLogin(page: Page): Promise<void> {
  const phoneTab = page.getByRole('button', { name: '手机号登录', exact: true })
  if (await phoneTab.count()) await phoneTab.click()
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  const smsTab = page.getByRole('button', { name: '短信验证码', exact: true })
  if (await smsTab.count()) await smsTab.click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === PATH)
}

async function fillSun(page: Page): Promise<void> {
  await page.locator('#material-field-applicantName').fill('孙晓雯')
  await page.locator('#material-field-targetRole').fill('仓储主管')
  await page.locator('#material-field-targetOrganization').fill('青岛职业技术学院')
  await page.locator('#material-field-keyStrengths').fill('在青岛港实习期间负责入库核对，能独立完成班次交接。')
}

async function openSelect(page: Page): Promise<void> {
  await page.goto(PATH, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="material-workshop-state-select"]').waitFor({ state: 'visible' })
}

export const page25: ResumePageFixture = {
  prefix: '25-',
  plan(screen, state) {
    if (screen !== 'main') return none('稿 25 的状态都挂在 main')
    if (DRIVEN.has(state)) {
      const marker = state === 'signed-out'
        ? '[data-testid="material-workshop-draft-restored"]'
        : `[data-testid="material-workshop-state-${state}"]`
      return paired(marker)
    }
    if (state === 'demo-result') {
      return none('演示结果只在非 http 构建出现。并排截图是 http 构建，造一份假文件会显示成已生成')
    }
    if (state === 'illegal') return none('运行页不读地址里的状态，没有「地址非法」这一屏')
    return none('这一态没有对应的运行页画面')
  },
  async prepare(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
    if (target.state === 'loading') {
      api.respondWith('GET', TEMPLATES, () => new Promise(() => undefined))
      await page.goto(PATH, { waitUntil: 'domcontentloaded' })
      return
    }
    if (target.state === 'error') {
      api.respond('GET', TEMPLATES, { status: 503, json: { success: false, error: { code: 'FIXTURE_UNREGISTERED', message: '目录暂时读不到' } } })
      await page.goto(PATH, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-testid="material-workshop-state-error"]').waitFor({ state: 'visible' })
      return
    }
    if (target.state === 'empty') {
      await page.goto(PATH, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-testid="material-workshop-state-empty"]').waitFor({ state: 'visible' })
      return
    }
    registerDocs(api)
    if (target.state === 'signed-out') {
      await openSelect(page)
      await fillSun(page)
      await page.getByRole('button', { name: '登录后生成', exact: true }).click()
      await page.waitForURL((url) => url.pathname === '/login')
      await finishVisibleLogin(page)
      await page.getByTestId('material-workshop-draft-restored').waitFor({ state: 'visible' })
      return
    }
    await loginThroughVisibleUi(page, PATH)
    await page.locator('.qx-pill').filter({ hasText: '固定模板生成 · 内容由你填写' }).waitFor({ state: 'visible' })
    if (target.state === 'select') return
    await fillSun(page)
    if (target.state === 'submitting') {
      api.respondWith('POST', GENERATE, () => new Promise(() => undefined))
    } else if (target.state === 'failed') {
      api.respond('POST', GENERATE, { status: 422, json: { success: false, error: { code: 'FIXTURE_UNREGISTERED', message: '这次没能按模板生成' } } })
    } else if (target.state === 'generated') {
      api.respond('POST', GENERATE, { status: 200, json: { success: true, data: FILE } })
    } else if (target.state === 'generated-no-print') {
      api.respond('POST', GENERATE, { status: 200, json: { success: true, data: { ...FILE, printFileUrl: undefined } } })
    }
    await page.getByRole('button', { name: '生成可打印版', exact: true }).click()
    await page.locator(`[data-testid="material-workshop-state-${target.state}"]`).waitFor({ state: 'visible' })
  },
}
