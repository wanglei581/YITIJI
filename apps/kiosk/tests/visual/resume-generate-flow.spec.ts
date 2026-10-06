import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { registerW4Api } from '../fixtures/fusion-w4-api'

const HELP_LINE = /需要帮助？/

async function expectNoStaff(page: Page) {
  await expect(page.getByText('工作人员')).toHaveCount(0)
  await expect(page.getByText('找工作人员')).toHaveCount(0)
  await expect(page.getByText('服务台')).toHaveCount(0)
}

async function expectHelpLine(page: Page) {
  const line = page.getByTestId('resume-generate-help-line')
  await expect(line).toBeVisible()
  await expect(line).toContainText(HELP_LINE)
  await expect(line).not.toContainText('工作人员')
}

async function backToReview(page: Page) {
  for (let i = 0; i < 4; i += 1) {
    if (await page.getByTestId('resume-generate-review').count()) return
    await page.getByTestId('resume-generate-primary').click()
  }
  await expect(page.getByTestId('resume-generate-review')).toBeVisible()
}

/** 四步都写上能核对的内容。不写本机存储。 */
async function fillStory(page: Page) {
  await page.getByTestId('resume-generate-primary').click()
  await page.getByRole('textbox', { name: '姓名' }).fill('孙晓雯')
  await page.getByTestId('resume-generate-chip-city-青岛').click()
  await page.getByRole('button', { name: '下一步：求职意向' }).click()
  await page.getByTestId('resume-generate-chip-position-仓储管理员').click()
  await page.getByRole('button', { name: '下一步：经历' }).click()
  await page.getByTestId('resume-generate-seg-edu').click()
  await page.getByLabel('学校').fill('青岛职业技术学院')
  await page.getByLabel('专业').fill('物流管理')
  await page.getByTestId('resume-generate-seg-exp').click()
  await page.getByLabel('公司 / 单位').fill('青岛港联物流')
  await page.getByLabel('职位').fill('仓储实习')
  await page.getByTestId('resume-generate-seg-proj').click()
  await page.getByRole('button', { name: /添加一段项目/ }).click()
  await page.getByLabel('项目名称').fill('校园快递代收点')
  await page.getByRole('button', { name: '下一步：技能与自评' }).click()
  await page.getByTestId('resume-generate-chip-skill-Excel').click()
  await page.getByRole('textbox', { name: /^自我评价/ }).fill('想找仓储或客服的工作，做事按单核对。')
  await page.getByRole('button', { name: '去核对' }).click()
  await expect(page.getByTestId('resume-generate-review')).toBeVisible()
}

async function storedText(page: Page): Promise<string> {
  return page.evaluate(() => {
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
}

async function fillRequired(page: Page) {
  await page.getByTestId('resume-generate-primary').click()
  await page.getByRole('textbox', { name: '姓名' }).fill('孙晓雯')
  await page.getByRole('button', { name: '下一步：求职意向' }).click()
  await page.getByTestId('resume-generate-chip-position-仓储管理员').click()
  await page.getByRole('button', { name: '下一步：经历' }).click()
  await page.getByRole('button', { name: '下一步：技能与自评' }).click()
  await page.getByRole('button', { name: '去核对' }).click()
  await expect(page.getByTestId('resume-generate-review')).toBeVisible()
}

test('第 0 屏四行都能进对应步骤，四步走完到核对 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await page.goto('/resume/generate')
  await expect(page.getByTestId('resume-generate-entry')).toBeVisible()
  await expectNoStaff(page)

  await page.getByTestId('resume-generate-plan-1').click()
  await expect(page.locator('[data-generate-state="input-basic"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '姓名' })).toBeVisible()

  await page.goto('/resume/generate')
  await page.getByTestId('resume-generate-plan-2').click()
  await expect(page.locator('[data-generate-state="input-intention"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^目标岗位/ })).toBeVisible()

  await page.goto('/resume/generate')
  await page.getByTestId('resume-generate-plan-3').click()
  await expect(page.locator('[data-generate-state="input-history"]')).toBeVisible()
  await expect(page.getByTestId('resume-generate-seg-exp')).toHaveAttribute('aria-selected', 'true')

  await page.goto('/resume/generate')
  await page.getByTestId('resume-generate-plan-4').click()
  await expect(page.locator('[data-generate-state="input-strengths"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^技能/ })).toBeVisible()

  await page.goto('/resume/generate')
  await fillRequired(page)
  await expect(page.locator('[data-generate-state="review"]')).toBeVisible()
  await expectNoStaff(page)
})

test('第 3 步三个页签来回切换不丢已填内容 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await page.goto('/resume/generate')
  await page.getByTestId('resume-generate-plan-3').click()
  await page.getByTestId('resume-generate-seg-edu').click()
  await page.getByLabel('学校').fill('青岛职业技术学院')
  await page.getByTestId('resume-generate-seg-exp').click()
  await page.getByLabel('公司 / 单位').fill('青岛港联物流')
  await page.getByTestId('resume-generate-seg-proj').click()
  await page.getByRole('button', { name: /添加一段项目/ }).click()
  await page.getByLabel('项目名称').fill('校园快递代收点')
  await page.getByTestId('resume-generate-seg-edu').click()
  await expect(page.getByLabel('学校')).toHaveValue('青岛职业技术学院')
  await page.getByTestId('resume-generate-seg-exp').click()
  await expect(page.getByLabel('公司 / 单位')).toHaveValue('青岛港联物流')
  await page.getByTestId('resume-generate-seg-proj').click()
  await expect(page.getByLabel('项目名称')).toHaveValue('校园快递代收点')
})

test('点城市候选填进格子，再点一次取消 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await page.goto('/resume/generate')
  await page.getByTestId('resume-generate-primary').click()
  const city = page.getByRole('textbox', { name: '所在城市' })
  const chip = page.getByTestId('resume-generate-chip-city-青岛')
  await chip.click()
  await expect(city).toHaveValue('青岛')
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await chip.click()
  await expect(city).toHaveValue('')
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await expectNoStaff(page)
})

test('AI 不可用时按原样导出仍能走到打印交接 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('POST', '/api/v1/resume/generate', {
    status: 200,
    json: {
      taskId: 'gen-outage-1',
      status: 'failed',
      failCode: 'AI_PROVIDER_NOT_CONFIGURED',
      failReason: '模型账户不可用',
    },
  })
  api.respond('POST', '/api/v1/resume/generate/export', {
    status: 200,
    json: {
      fileId: 'draft-1',
      filename: '简历草稿_孙晓雯.pdf',
      sizeBytes: 2048,
      pageCount: 1,
      signedUrl: '/e2e-fixtures/draft-resume.pdf',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      printFileUrl: '/api/v1/files/draft-1/content?expires=1&sig=test',
    },
  })
  api.respond('POST', '/api/v1/orders/quote', {
    status: 200,
    json: {
      amountCents: 100,
      billablePages: 1,
      billingPageSource: 'detected',
      priceLines: [{ serviceKey: 'print_bw_page', description: '黑白打印', unitCents: 100, quantity: 1, amountCents: 100 }],
    },
  })
  await page.goto('/resume/generate')
  await fillRequired(page)
  await page.getByRole('button', { name: '让 AI 整理成新简历' }).click()
  await expect(page.getByText('AI 暂时不可用，你可以先导出并打印已填的内容')).toBeVisible()
  await expectNoStaff(page)
  const exported = page.waitForRequest((request) => (
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/resume/generate/export'
  ))
  await page.getByRole('button', { name: '导出并打印我填的内容（未经 AI 润色）' }).click()
  const posted = await exported
  const body = posted.postDataJSON() as { draft?: boolean; basic?: { name?: string } }
  expect(body.draft).toBe(true)
  expect(body.basic?.name).toBe('孙晓雯')
  await expect(page).toHaveURL(/\/print\//)
})

test('带着已填内容从预览回来，跳过第 0 屏 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('POST', '/api/v1/resume/generate', {
    status: 200,
    json: {
      taskId: 'gen-ok-1',
      status: 'completed',
      providerName: 'deepseek',
      resume: {
        basic: { name: '孙晓雯', city: '青岛' },
        intention: { position: '仓储管理员', city: '青岛' },
        summary: '想找仓储或客服的工作。',
        education: [],
        experience: [],
        projects: [],
        skills: [],
        certificates: [],
      },
      missingHints: [],
    },
  })
  await page.goto('/resume/generate')
  await fillRequired(page)
  await page.getByRole('button', { name: '让 AI 整理成新简历' }).click()
  await expect(page).toHaveURL(/\/resume\/generate\/preview$/)
  await page.getByTestId('resume-generate-preview-cta-refill').click()
  await expect(page).toHaveURL(/\/resume\/generate$/)
  await expect(page.getByTestId('resume-generate-entry')).toHaveCount(0)
  await expect(page.locator('[data-generate-state="input-basic"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '姓名' })).toHaveValue('孙晓雯')
})

test('核对页点一行修改，落到对应的步和页签 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await page.goto('/resume/generate')
  await fillStory(page)
  await expectHelpLine(page)

  await page.getByTestId('resume-generate-rv-basic').click()
  await expect(page.locator('[data-generate-state="input-basic"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '姓名' })).toHaveValue('孙晓雯')
  await expect(page.getByRole('textbox', { name: '所在城市' })).toHaveValue('青岛')
  await backToReview(page)

  await page.getByTestId('resume-generate-rv-intent').click()
  await expect(page.locator('[data-generate-state="input-intention"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^目标岗位/ })).toHaveValue('仓储管理员')
  await backToReview(page)

  await page.getByTestId('resume-generate-rv-edu').click()
  await expect(page.locator('[data-generate-state="input-history"]')).toBeVisible()
  await expect(page.getByTestId('resume-generate-seg-edu')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('学校')).toHaveValue('青岛职业技术学院')
  await expect(page.getByLabel('专业')).toHaveValue('物流管理')
  await backToReview(page)

  await page.getByTestId('resume-generate-rv-exp').click()
  await expect(page.locator('[data-generate-state="input-history"]')).toBeVisible()
  await expect(page.getByTestId('resume-generate-seg-exp')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('公司 / 单位')).toHaveValue('青岛港联物流')
  await expect(page.getByLabel('职位')).toHaveValue('仓储实习')
  await backToReview(page)

  await page.getByTestId('resume-generate-rv-proj').click()
  await expect(page.locator('[data-generate-state="input-history"]')).toBeVisible()
  await expect(page.getByTestId('resume-generate-seg-proj')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('项目名称')).toHaveValue('校园快递代收点')
  await backToReview(page)

  await page.getByTestId('resume-generate-rv-skill').click()
  await expect(page.locator('[data-generate-state="input-strengths"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^技能/ })).toHaveValue(/Excel/)
  await backToReview(page)

  await page.getByTestId('resume-generate-rv-intro').click()
  await expect(page.locator('[data-generate-state="input-strengths"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^自我评价/ })).toHaveValue('想找仓储或客服的工作，做事按单核对。')
  await expectNoStaff(page)
})

test('回去改资料把已填内容原样带回对应那一步，不经过第 0 屏，也不写入本机存储 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('POST', '/api/v1/resume/generate', {
    status: 200,
    json: {
      taskId: 'gen-ok-story',
      status: 'completed',
      providerName: 'deepseek',
      resume: {
        basic: { name: '孙晓雯', city: '青岛' },
        intention: { position: '仓储管理员', city: '青岛' },
        summary: '想找仓储或客服的工作，做事按单核对。',
        education: [{ school: '青岛职业技术学院', major: '物流管理' }],
        experience: [{ company: '青岛港联物流', role: '仓储实习', description: '' }],
        projects: [{ name: '校园快递代收点', description: '' }],
        skills: ['Excel'],
        certificates: [],
      },
      missingHints: [],
    },
  })
  await page.goto('/resume/generate')
  await fillStory(page)
  await page.getByRole('button', { name: '让 AI 整理成新简历' }).click()
  await expect(page).toHaveURL(/\/resume\/generate\/preview$/)
  await expect(page.getByTestId('resume-generate-preview-cta-refill')).toHaveText('回去改资料')
  await expect(page.getByText('找工作人员')).toHaveCount(0)
  await page.getByTestId('resume-generate-preview-cta-refill').click()
  await expect(page).toHaveURL(/\/resume\/generate$/)
  await expect(page.getByTestId('resume-generate-entry')).toHaveCount(0)
  await expect(page.locator('[data-generate-state="input-basic"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '姓名' })).toHaveValue('孙晓雯')
  await expect(page.getByRole('textbox', { name: '所在城市' })).toHaveValue('青岛')

  await page.getByRole('button', { name: '下一步：求职意向' }).click()
  await expect(page.getByRole('textbox', { name: /^目标岗位/ })).toHaveValue('仓储管理员')

  await page.getByRole('button', { name: '下一步：经历' }).click()
  await page.getByTestId('resume-generate-seg-edu').click()
  await expect(page.getByLabel('学校')).toHaveValue('青岛职业技术学院')
  await expect(page.getByLabel('专业')).toHaveValue('物流管理')
  await page.getByTestId('resume-generate-seg-exp').click()
  await expect(page.getByLabel('公司 / 单位')).toHaveValue('青岛港联物流')
  await expect(page.getByLabel('职位')).toHaveValue('仓储实习')
  await page.getByTestId('resume-generate-seg-proj').click()
  await expect(page.getByLabel('项目名称')).toHaveValue('校园快递代收点')

  await page.getByRole('button', { name: '下一步：技能与自评' }).click()
  await expect(page.getByRole('textbox', { name: /^技能/ })).toHaveValue(/Excel/)
  await expect(page.getByRole('textbox', { name: /^自我评价/ })).toHaveValue('想找仓储或客服的工作，做事按单核对。')

  const stored = await storedText(page)
  expect(stored).not.toContain('孙晓雯')
  expect(stored).not.toContain('青岛职业技术学院')
  expect(stored).not.toContain('校园快递代收点')
  await expectNoStaff(page)
})

test('四个没有结果的预览屏各自成文，且没有工作人员 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await page.goto('/resume/generate/preview')
  await expect(page.getByText('这一份要从头填')).toBeVisible()
  await expect(page.getByText('重新填只要四步')).toBeVisible()
  await expect(page.getByTestId('resume-generate-preview-refill-steps')).toBeVisible()
  await expect(page.getByText('基本信息')).toBeVisible()
  await expect(page.getByText('求职意向')).toBeVisible()
  await expect(page.getByText('技能与自评')).toBeVisible()
  await expect(page.getByText('AI 生成，仅供参考')).toHaveCount(0)
  await expectNoStaff(page)

  await page.goto('/resume/generate/preview?state=preview-no-result&capture=1')
  await expect(page.getByText('没有可预览的结果')).toBeVisible()
  await expect(page.getByText('这次进来没有带结果')).toBeVisible()
  await expect(page.getByText('AI 生成，仅供参考')).toHaveCount(0)

  await page.goto('/resume/generate/preview?state=preview-failed&capture=1')
  await expect(page.getByText('这条记录没读回来')).toBeVisible()
  await expect(page.getByText('读不回这次的生成结果')).toBeVisible()
  await expect(page.getByText('AI 生成，仅供参考')).toHaveCount(0)

  await page.goto('/resume/generate/preview?state=not-a-real-state&capture=1')
  await expect(page.locator('[data-generate-state="illegal"]')).toBeVisible()
  await expect(page.getByText('认不出这个页面状态')).toBeVisible()
  await expect(page.getByText('地址里的状态没有登记')).toBeVisible()
  await expect(page.getByTestId('resume-generate-preview-exit-help')).toHaveText('问小青')
  await expect(page.getByText('AI 生成，仅供参考')).toHaveCount(0)
  await expectHelpLine(page)
  await expectNoStaff(page)
})
