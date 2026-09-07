import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { registerW4Api } from '../fixtures/fusion-w4-api'

const TASK_ID = 'n1-career-plan'
const ACCESS_TOKEN = 'n1-career-access'
const MEMBER_TOKEN = 'n1-career-member-token'
const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'

const CAREER_PLAN = {
  taskId: TASK_ID,
  status: 'completed',
  basedOn: { resume: true, jobFit: null, interview: null },
  summary: '根据你的简历整理方向与缺口。',
  currentSnapshot: [{ point: '有项目经历', evidence: '负责过一次活动执行' }],
  directions: [{ title: '运营方向', why: '经历贴近落地执行', firstStep: '把结果写成数字' }],
  skillPlan: [{ skill: '数据分析', action: '补一门入门课', timeframe: '30 天' }],
  actionChecklist: ['把简历结果量化'],
  providerName: 'deepseek',
}

const SAVED_DOCUMENT = {
  id: 'n1-doc-1',
  filename: '求职证明.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 12000,
  purpose: 'print_doc',
  sensitiveLevel: 'normal',
  assetCategory: 'original',
  retentionPolicy: 'months_3',
  allowedRetentionPolicies: ['months_3', 'months_6'],
  createdAt: '2098-03-01T00:00:00.000Z',
  expiresAt: '2099-03-01T00:00:00.000Z',
  downloadUrlPath: '/files/n1-doc-1/download',
  previewUrlPath: '/files/n1-doc-1/preview',
}

function registerCareerPlan(api: ApiRouter): void {
  registerW4Api(api)
  api.respond('GET', `/api/v1/resume/career-plan/${TASK_ID}`, {
    status: 200,
    json: CAREER_PLAN,
  })
}

function registerMemberLogin(api: ApiRouter): void {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', {
    status: 200,
    json: { success: true, data: null },
  })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', {
    status: 200,
    json: { success: true, data: null },
  })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: {
      success: true,
      data: {
        token: MEMBER_TOKEN,
        user: { id: 'member-n1', phoneMasked: '138****8000', nickname: 'N1 验收会员' },
      },
    },
  })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [] } })
}

async function seedResumeSession(page: Page): Promise<void> {
  await page.addInitScript(({ taskId, accessToken }) => {
    window.sessionStorage.setItem(
      'ai-job-print:current-ai-resume',
      JSON.stringify({ taskId, accessToken }),
    )
  }, { taskId: TASK_ID, accessToken: ACCESS_TOKEN })
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of MEMBER_PHONE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

async function expectPlanColumns(page: Page): Promise<void> {
  await expect(page.locator('[data-career-plan-column="directions"]')).toBeVisible()
  await expect(page.locator('[data-career-plan-column="prepare"]')).toBeVisible()
  await expect(page.locator('[data-career-plan-column="actions"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: '目标与方向' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '尚需准备' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '执行计划' })).toBeVisible()
  await expect(page.getByText('运营方向')).toBeVisible()
  await expect(page.getByText('数据分析')).toBeVisible()
  await expect(page.getByText('把简历结果量化')).toBeVisible()
}

test('career plan anonymous materials prompt login and skip member APIs @kiosk', async ({ page, api }) => {
  registerCareerPlan(api)
  await seedResumeSession(page)
  await page.goto('/resume/career-plan')
  await expect(page.locator('[data-kiosk-screen="resume-career-plan"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: '求职方案' })).toBeVisible()
  const materials = page.locator('[data-career-plan-column="materials"]')
  await expect(materials).toContainText('登录后可看到你已保存的材料')
  await expect(materials).not.toContainText('0 份')
  await expect(materials.getByRole('button')).toHaveCount(0)
  await expectPlanColumns(page)
  expect(api.requestCount('GET', '/api/v1/me/resumes')).toBe(0)
  expect(api.requestCount('GET', '/api/v1/me/documents')).toBe(0)
})

test('career plan materials read failure does not collapse the other three columns @kiosk', async ({ page, api }) => {
  registerCareerPlan(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/resumes', {
    status: 503,
    json: { error: { code: 'N1_RESUMES_UNAVAILABLE', message: 'fixture unavailable' } },
  })
  api.respond('GET', '/api/v1/me/documents', {
    status: 503,
    json: { error: { code: 'N1_DOCUMENTS_UNAVAILABLE', message: 'fixture unavailable' } },
  })
  await seedResumeSession(page)
  await loginThroughVisibleUi(page, '/resume/career-plan')
  const materials = page.locator('[data-career-plan-column="materials"]')
  await expect(materials).toContainText('材料列表这次没读到，可以重试')
  await expect(materials).not.toContainText('fixture unavailable')
  await expectPlanColumns(page)
  await expect(page.getByRole('button', { name: '重新读取材料' })).toBeVisible()

  api.respond('GET', '/api/v1/me/resumes', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  api.respond('GET', '/api/v1/me/documents', {
    status: 200,
    json: {
      success: true,
      data: { items: [SAVED_DOCUMENT], nextCursor: null, total: 1 },
    },
  })
  await page.getByRole('button', { name: '重新读取材料' }).click()
  await expect(materials).toContainText('求职证明.pdf')
  await expectPlanColumns(page)
})
