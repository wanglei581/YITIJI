import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { registerW4Api } from '../fixtures/fusion-w4-api'
import { registerW6Api } from './fixtures/fusion-w6-api'

/** 本机看图才存截图：设了 F25_SHOTS_DIR 才存，CI 和别的机器上不存。 */
const SHOTS = process.env.F25_SHOTS_DIR ?? ''
const NOTE = '已带入你简历里的内容，请逐项核对'

const EDU_LINES = ['青岛职业技术学院物流管理', '在校做过仓库理货实训']
const EXP_LINES = ['在成品仓理货和拣货', '一天大约处理 80 单', '按货位把货配齐再交给复核']
const PROJ_LINES = ['和同学轮班收发快递', '登记取件码，把滞留件单独放到一边']
const SKILL_LINES = ['Excel', '仓储理货']
const INTRO_LINES = ['想找仓储或客服的工作', '做事按单核对']
const MASKED_LINE = '联系电话 [手机号_1]'

const EDU_TEXT = EDU_LINES.join('\n')
const EXP_TEXT = EXP_LINES.join('\n')
const PROJ_TEXT = PROJ_LINES.join('\n')
const SKILL_TEXT = SKILL_LINES.join('\n')
const INTRO_TEXT = INTRO_LINES.join('\n')

type Block = { key: string; label: string; lines: string[] }

function block(key: string, label: string, lines: string[]): Block {
  return { key, label, lines }
}

function carriedBlocks(experienceLines: string[] = EXP_LINES): Block[] {
  return [
    block('basic', '基础信息', ['孙晓雯', '13800001111', 'sun@example.com', '青岛']),
    block('objective', '求职目标', ['仓储管理员', '全职']),
    block('education', '教育经历', EDU_LINES),
    block('experience', '工作经历', experienceLines),
    block('project', '项目经历', PROJ_LINES),
    block('skill', '技能', SKILL_LINES),
    block('selfintro', '自我评价', INTRO_LINES),
  ]
}

function recordBody(taskId: string, blocks?: Block[]) {
  return {
    taskId,
    status: 'completed',
    report: {
      sections: [],
      suggestions: [],
      ...(blocks ? { contentBlocks: blocks } : {}),
    },
  }
}

function registerOptimizeShell(api: Parameters<typeof registerW6Api>[0]): void {
  registerW6Api(api)
  api.respond('GET', '/api/v1/job-materials/templates', {
    status: 200,
    json: { success: true, data: [] },
  })
}

function registerFailedOptimize(api: Parameters<typeof registerW6Api>[0], taskId: string): void {
  api.respond('GET', `/api/v1/resume/records/${taskId}/optimize`, {
    status: 200,
    json: {
      taskId,
      status: 'failed',
      failCode: 'AI_OPTIMIZE_INVALID_OUTPUT',
      failReason: '优化结果没能用上',
    },
  })
}

async function openFailedOptimize(page: Page, taskId: string): Promise<void> {
  await page.goto(`/resume/optimize?taskId=${taskId}`)
  await expect(page.locator('[data-kiosk-screen="resume-optimize"]')).toHaveAttribute('data-optimize-state', 'optimize-failed')
  await expect(page.getByText('这次没有生成出来', { exact: true })).toBeVisible()
}

async function expectInViewport(locator: Locator): Promise<void> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(1920)
  expect(box.height).toBeGreaterThan(0)
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  await page.locator('[data-kiosk-screen="resume-generate"]').evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: join(SHOTS, name) })
}

test('优化没生成出来时手动修改把已读出的内容带进第 1 步 @kiosk', async ({ page, api }) => {
  test.setTimeout(90_000)
  const taskId = 'carry-a-2099'
  registerOptimizeShell(api)
  registerFailedOptimize(api, taskId)
  api.respond('GET', `/api/v1/resume/records/${taskId}`, {
    status: 200,
    json: recordBody(taskId, carriedBlocks()),
  })

  await openFailedOptimize(page, taskId)
  await page.getByTestId('resume-optimize-empty-manual').click()
  await expect(page).toHaveURL(/\/resume\/generate$/)
  await expect(page.getByTestId('resume-generate-entry')).toHaveCount(0)
  await expect(page.locator('[data-generate-state="input-basic"]')).toBeVisible()

  const note = page.getByTestId('resume-generate-carried-note')
  await expect(note).toBeVisible()
  await expect(note).toHaveText(NOTE)
  await expect(note).toHaveAttribute('role', 'status')
  const noteBox = await note.boundingBox()
  const progress = page.getByRole('list', { name: /填写进度/ })
  const progressBox = await progress.boundingBox()
  expect(noteBox && progressBox && noteBox.y < progressBox.y).toBe(true)
  await expectInViewport(note)
  await expectInViewport(page.getByRole('textbox', { name: '姓名' }))
  await expect(page.getByRole('textbox', { name: '姓名' })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: '联系电话' })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: '邮箱' })).toHaveValue('')
  await expect(page.getByText('孙晓雯')).toHaveCount(0)
  await expect(page.getByText('13800001111')).toHaveCount(0)
  await shot(page, 'f25-step1-basic.png')

  await page.getByRole('textbox', { name: '姓名' }).fill('孙晓雯')
  await page.getByRole('button', { name: '下一步：求职意向' }).click()
  await page.getByTestId('resume-generate-chip-position-仓储管理员').click()
  await page.getByRole('button', { name: '下一步：经历' }).click()
  await expect(page.locator('[data-generate-state="input-history"]')).toBeVisible()
  await expect(page.getByTestId('resume-generate-seg-exp')).toHaveAttribute('aria-selected', 'true')
  const exp = page.getByTestId('resume-generate-exp-0')
  await expect(exp.locator('textarea')).toHaveValue(EXP_TEXT)
  await expect(exp.getByText('不会提交 · 缺公司')).toBeVisible()
  await expect(exp.getByLabel('公司 / 单位')).toHaveValue('')
  await expect(exp.getByLabel('职位')).toHaveValue('')
  await shot(page, 'f25-step-history.png')

  await page.getByTestId('resume-generate-seg-edu').click()
  const edu = page.getByTestId('resume-generate-edu-0')
  await expect(edu.locator('textarea')).toHaveValue(EDU_TEXT)
  await expect(edu.getByText('不会提交 · 缺学校')).toBeVisible()
  await expect(edu.getByLabel('学校')).toHaveValue('')

  await page.getByTestId('resume-generate-seg-proj').click()
  const proj = page.getByTestId('resume-generate-proj-0')
  await expect(proj.locator('textarea')).toHaveValue(PROJ_TEXT)
  await expect(proj.getByText('不会提交 · 缺项目名称')).toBeVisible()
  await expect(proj.getByLabel('项目名称')).toHaveValue('')

  await page.getByRole('button', { name: '下一步：技能与自评' }).click()
  await expect(page.locator('[data-generate-state="input-strengths"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^技能/ })).toHaveValue(SKILL_TEXT)
  await expect(page.getByRole('textbox', { name: /^自我评价/ })).toHaveValue(INTRO_TEXT)
  await expect(note).toBeVisible()
  await shot(page, 'f25-step-skills.png')

  await page.getByRole('button', { name: '去核对' }).click()
  await expect(page.locator('[data-generate-state="review"]')).toBeVisible()
  await expect(page.getByText('另有 3 条半空条目会被跳过')).toBeVisible()
  await expect(note).toBeVisible()
  await shot(page, 'f25-step-review.png')

  const stored = await page.evaluate(() => {
    const parts: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key) parts.push(localStorage.getItem(key) ?? '')
    }
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i)
      if (key) parts.push(sessionStorage.getItem(key) ?? '')
    }
    return parts.join('\n')
  })
  for (const piece of [...EDU_LINES, ...EXP_LINES, ...PROJ_LINES, '仓储理货', ...INTRO_LINES, NOTE]) {
    expect(stored.includes(piece), `浏览器存储里不该有：${piece}`).toBe(false)
  }
})

test('取报告失败时仍进第 0 屏且没有带入提示 @kiosk', async ({ page, api }) => {
  const taskId = 'carry-b-2099'
  registerOptimizeShell(api)
  registerFailedOptimize(api, taskId)
  api.respond('GET', `/api/v1/resume/records/${taskId}`, {
    status: 500,
    json: { error: { code: 'INTERNAL', message: 'report failed' } },
  })
  await openFailedOptimize(page, taskId)
  await page.getByTestId('resume-optimize-empty-manual').click()
  await expect(page).toHaveURL(/\/resume\/generate$/)
  await expect(page.getByTestId('resume-generate-entry')).toBeVisible()
  await expect(page.getByTestId('resume-generate-carried-note')).toHaveCount(0)
})

test('报告没有内容块时仍进第 0 屏且没有带入提示 @kiosk', async ({ page, api }) => {
  const taskId = 'carry-c-2099'
  registerOptimizeShell(api)
  registerFailedOptimize(api, taskId)
  api.respond('GET', `/api/v1/resume/records/${taskId}`, {
    status: 200,
    json: recordBody(taskId),
  })
  await openFailedOptimize(page, taskId)
  await page.getByTestId('resume-optimize-empty-manual').click()
  await expect(page).toHaveURL(/\/resume\/generate$/)
  await expect(page.getByTestId('resume-generate-entry')).toBeVisible()
  await expect(page.getByTestId('resume-generate-carried-note')).toHaveCount(0)
})

test('工作经历里被遮盖的那一行不会进表单 @kiosk', async ({ page, api }) => {
  const taskId = 'carry-d-2099'
  registerOptimizeShell(api)
  registerFailedOptimize(api, taskId)
  api.respond('GET', `/api/v1/resume/records/${taskId}`, {
    status: 200,
    json: recordBody(taskId, carriedBlocks([EXP_LINES[0], MASKED_LINE, EXP_LINES[1], EXP_LINES[2]])),
  })
  await openFailedOptimize(page, taskId)
  await page.getByTestId('resume-optimize-empty-manual').click()
  await expect(page.locator('[data-generate-state="input-basic"]')).toBeVisible()
  await page.getByRole('textbox', { name: '姓名' }).fill('孙晓雯')
  await page.getByRole('button', { name: '下一步：求职意向' }).click()
  await page.getByTestId('resume-generate-chip-position-仓储管理员').click()
  await page.getByRole('button', { name: '下一步：经历' }).click()
  const exp = page.getByTestId('resume-generate-exp-0')
  await expect(exp.locator('textarea')).toHaveValue(EXP_TEXT)
  await expect(exp.locator('textarea')).not.toHaveValue(new RegExp('手机号_1'))
  await expect(page.getByText(MASKED_LINE)).toHaveCount(0)
})

test('连点两下只取一次报告，请求没回来时按钮停用 @kiosk', async ({ page, api }) => {
  const taskId = 'carry-e-2099'
  const recordPath = `/api/v1/resume/records/${taskId}`
  registerOptimizeShell(api)
  registerFailedOptimize(api, taskId)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  api.respondWith('GET', recordPath, async () => {
    await gate
    return { status: 200, json: recordBody(taskId, carriedBlocks()) }
  })
  await openFailedOptimize(page, taskId)
  const button = page.getByTestId('resume-optimize-empty-manual')
  await expect(button).toBeEnabled()
  await expect(button).toHaveText(/手动逐项修改/)
  await button.evaluate((element) => {
    let reentered = false
    element.addEventListener('click', () => {
      if (reentered) return
      reentered = true
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }, true)
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await expect.poll(() => api.requestCount('GET', recordPath)).toBe(1)
  await expect(button).toBeDisabled()
  await expect(button).toHaveAttribute('aria-busy', 'true')
  await expect(button).toHaveText(/手动逐项修改/)
  release()
  await expect(page).toHaveURL(/\/resume\/generate$/)
  await expect(page.getByTestId('resume-generate-carried-note')).toBeVisible()
})

test('从第 0 屏正常填写时没有带入提示 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await page.goto('/resume/generate')
  await expect(page.getByTestId('resume-generate-entry')).toBeVisible()
  await expect(page.getByTestId('resume-generate-carried-note')).toHaveCount(0)
  await page.getByTestId('resume-generate-primary').click()
  await expect(page.locator('[data-generate-state="input-basic"]')).toBeVisible()
  await expect(page.getByTestId('resume-generate-carried-note')).toHaveCount(0)
})

const OPTIMIZED_RESUME = {
  basic: { name: '孙晓雯', phone: '', city: '青岛' },
  intention: { position: '仓储管理员', city: '青岛' },
  summary: '三年成品仓理货经验，熟悉按单拣货与复核。',
  education: [{ school: '青岛职业技术学院', major: '物流管理', degree: '大专', period: '2019-2022' }],
  experience: [],
  projects: [],
  skills: ['Excel', '仓储理货'],
  certificates: [],
}

test('取报告还没回来时同一页重试出了结果，报告回来后不再把人带走 @kiosk', async ({ page, api }) => {
  const taskId = 'carry-g-2099'
  const recordPath = `/api/v1/resume/records/${taskId}`
  registerOptimizeShell(api)
  registerFailedOptimize(api, taskId)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  api.respondWith('GET', recordPath, async () => {
    await gate
    return { status: 200, json: recordBody(taskId, carriedBlocks()) }
  })
  await openFailedOptimize(page, taskId)
  const manual = page.getByTestId('resume-optimize-empty-manual')
  await manual.click()
  await expect.poll(() => api.requestCount('GET', recordPath)).toBe(1)
  await expect(manual).toBeDisabled()

  api.respond('GET', `/api/v1/resume/records/${taskId}/optimize`, {
    status: 200,
    json: { taskId, status: 'completed', providerName: 'llm', modules: [], optimizedResume: OPTIMIZED_RESUME },
  })
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByTestId('resume-optimize-empty-paths')).toHaveCount(0)

  // 对照：「连点两下」那条同样放行后会跳到生成页；这里退路区已收起，放行后必须留在原页。
  const recordDone = page.waitForResponse((response) => new URL(response.url()).pathname === recordPath)
  release()
  await recordDone
  await page.waitForTimeout(400)
  await expect(page).toHaveURL(/\/resume\/optimize/)
  await expect(page.getByTestId('resume-generate-carried-note')).toHaveCount(0)
})
