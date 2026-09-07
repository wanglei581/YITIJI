import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { registerW6Api } from './fixtures/fusion-w6-api'

const TASK_ID = 'l2-draft-2099'
const DRAFT_UPDATED_AT = '2099-03-15T08:30:00.000Z'
const W6_MEMBER_PHONE = '13800138000'
const W6_MEMBER_CODE = '123456'

const OPTIMIZE_RESUME = {
  basic: { name: '优化样本', phone: '13800000000', city: '青岛' },
  intention: { position: '前端开发', city: '青岛' },
  summary: '这是优化结果摘要，不是草稿。',
  education: [{ school: '优化大学', major: '计算机', degree: '本科', period: '2018-2022' }],
  experience: [],
  projects: [],
  skills: ['TypeScript'],
  certificates: [],
}

const DRAFT_RESUME = {
  basic: { name: '草稿样本', phone: '13800000000', city: '青岛' },
  intention: { position: '前端开发', city: '青岛' },
  summary: '这是上次编辑留下的草稿内容。',
  education: [{ school: '草稿大学', major: '计算机', degree: '本科', period: '2018-2022' }],
  experience: [],
  projects: [],
  skills: ['TypeScript'],
  certificates: [],
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of W6_MEMBER_PHONE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of W6_MEMBER_CODE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/resume/optimize' && url.searchParams.get('taskId') === TASK_ID)
}

test('member draft banner asks before rendering editor and continue restores draft @kiosk', async ({ page, api }) => {
  test.setTimeout(60_000)
  registerW6Api(api)
  api.respond('GET', '/api/v1/me/ai-consents/status', {
    status: 200,
    json: { success: true, data: [{ scope: 'resume_ai', granted: true }] },
  })
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}/optimize`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      status: 'completed',
      providerName: 'llm',
      modules: [{ title: '经历表达', before: '参与前端开发。', after: '参与前端开发并完成交付。' }],
      optimizedResume: OPTIMIZE_RESUME,
    },
  })
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}/draft`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      draft: {
        resume: DRAFT_RESUME,
        decisions: { 'm0:经历表达': 'original' },
        updatedAt: DRAFT_UPDATED_AT,
      },
    },
  })
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}/versions`, {
    status: 200,
    json: { taskId: TASK_ID, latestVersion: null, items: [] },
  })

  await loginThroughVisibleUi(page, `/resume/optimize?taskId=${TASK_ID}`)
  await expect(page.locator('[data-kiosk-screen="resume-optimize"]')).toBeVisible()
  await expect(page.locator('[data-draft-banner="choice"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /继续上次编辑/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '从优化结果重新开始' })).toBeVisible()
  await expect(page.getByText('草稿样本')).toHaveCount(0)
  await expect(page.getByText('优化样本')).toHaveCount(0)
  await expect(page.locator('textarea')).toHaveCount(0)

  await page.getByRole('button', { name: /继续上次编辑/ }).click()
  await expect(page.locator('[data-draft-banner="choice"]')).toHaveCount(0)
  await expect(page.getByText('草稿样本')).toBeVisible()
  await expect(page.getByText('这是上次编辑留下的草稿内容。')).toBeVisible()
  await expect(page.getByText('优化样本')).toHaveCount(0)
})
