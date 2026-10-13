import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
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
  await expect(page.getByRole('button', { name: '不用 AI，导出原样草稿', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('resume-generate-draft-export')).toHaveCount(0)
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

test('AI 不可用过一次之后恢复了，同一页再点一次就能整理 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('POST', '/api/v1/resume/generate', {
    status: 200,
    json: {
      taskId: 'gen-outage-2',
      status: 'failed',
      failCode: 'AI_PROVIDER_NOT_CONFIGURED',
      failReason: '模型账户不可用',
    },
  })
  await page.goto('/resume/generate')
  await fillRequired(page)
  const primary = page.getByRole('button', { name: '让 AI 整理成新简历' })
  await primary.click()
  await expect(page.getByText('AI 暂时不可用，你可以先导出并打印已填的内容')).toBeVisible()
  // 手动那条路照旧在；AI 那颗钮不灰，但页面不自己去重探。
  await expect(page.getByRole('button', { name: '导出并打印我填的内容（未经 AI 润色）' })).toBeEnabled()
  await expect(primary).toBeEnabled()
  await expectNoStaff(page)

  // 还没恢复时再点：照实再问一次，仍然落回同一条手动出路，不卡死。
  await primary.click()
  await expect(page.getByText('AI 暂时不可用，你可以先导出并打印已填的内容')).toBeVisible()
  await expect(primary).toBeEnabled()

  api.respond('POST', '/api/v1/resume/generate', {
    status: 200,
    json: {
      taskId: 'gen-recovered-1',
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
  await primary.click()
  await expect(page).toHaveURL(/\/resume\/generate\/preview$/)
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
  await expect(page.getByTestId('resume-generate-carried-note')).toHaveCount(0)
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

test('输入超长技能时最多只进得去 40 字 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await page.goto('/resume/generate')
  await page.getByTestId('resume-generate-plan-4').click()
  const skills = page.getByRole('textbox', { name: /^技能/ })
  await skills.fill('仓'.repeat(80))
  await expect(skills).toHaveValue('仓'.repeat(40))
  await expect(page.getByText('最多 40 字', { exact: true })).toBeVisible()
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

function allowResumeHub(api: ApiRouter) {
  api.respond('GET', '/api/v1/health', {
    status: 200,
    json: { success: true, data: { status: 'ok' } },
  })
}

function allowDraftPrint(api: ApiRouter) {
  api.respond('POST', '/api/v1/resume/generate/export', {
    status: 200,
    json: {
      fileId: 'draft-plain-1',
      filename: '简历草稿_孙晓雯.pdf',
      sizeBytes: 2048,
      pageCount: 1,
      signedUrl: '/e2e-fixtures/draft-resume.pdf',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      printFileUrl: '/api/v1/files/draft-plain-1/content?expires=1&sig=test',
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
}

async function stageScaleOf(page: Page): Promise<number> {
  const transform = await page.locator('.kiosk-stage').evaluate((element) => getComputedStyle(element).transform)
  return transform === 'none' ? 1 : Number(transform.match(/^matrix\(([^,]+)/)?.[1] ?? 1)
}

async function expectSameRow(page: Page, locators: Locator[]) {
  const scale = await stageScaleOf(page)
  const boxes = []
  for (const locator of locators) {
    const box = await locator.boundingBox()
    expect(box).not.toBeNull()
    boxes.push(box!)
    expect(box!.height / scale).toBeGreaterThanOrEqual(56)
  }
  for (let i = 1; i < boxes.length; i += 1) {
    const left = boxes[i - 1]
    const right = boxes[i]
    expect(left.y < right.y + right.height && right.y < left.y + left.height).toBe(true)
    expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1)
  }
  // 稿 24 核对底栏三颗按字宽起步、平分剩下的宽度：中间那颗和主按钮差不多宽，「上一步」最窄。
  // 中间那颗字多一个，运行页约 410 对 367（0.89）。防的是主次反过来——主按钮缩成字宽、
  // 次要按钮被撑开，那时只有约 0.70，所以线划在 0.85。
  const [first, middle, primary] = [boxes[0], boxes[1], boxes[boxes.length - 1]]
  expect(primary.width).toBeGreaterThanOrEqual(middle.width * 0.85)
  expect(first.width).toBeLessThan(middle.width)
}

test('核对步可以不用 AI 导出原样草稿 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  allowDraftPrint(api)
  await page.goto('/resume/generate')
  await fillRequired(page)
  const draft = page.getByTestId('resume-generate-draft-export')
  const primary = page.getByRole('button', { name: '让 AI 整理成新简历' })
  const back = page.locator('.qx-rg-review-bar').getByRole('button', { name: '上一步' })
  await expect(draft).toHaveText('不用 AI，导出原样草稿')
  await expect(primary).toBeVisible()
  await expectSameRow(page, [back, draft, primary])
  const lines = await draft.evaluate((element) => {
    const text = [...element.childNodes].reverse().find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
    if (!text) return 0
    const range = document.createRange()
    range.selectNodeContents(text)
    return range.getClientRects().length
  })
  expect(lines).toBe(1)

  const exported = page.waitForRequest((request) => (
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/resume/generate/export'
  ))
  await draft.click()
  await expect(page.getByRole('dialog', { name: '确认使用简历 AI' })).toHaveCount(0)
  expect(api.requestCount('POST', '/api/v1/resume/generate')).toBe(0)
  const posted = await exported
  const body = posted.postDataJSON() as { draft?: boolean; basic?: { name?: string } }
  expect(body.draft).toBe(true)
  expect(body.basic?.name).toBe('孙晓雯')
  await expect(page).toHaveURL(/\/print\//)
})

test('核对步原样导出失败不算 AI 失败 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('POST', '/api/v1/resume/generate/export', {
    status: 500,
    json: { error: { code: 'INTERNAL', message: 'boom' } },
  })
  await page.goto('/resume/generate')
  await fillRequired(page)
  const draft = page.getByTestId('resume-generate-draft-export')
  await draft.click()
  await expect(page.locator('.qx-pill')).toHaveText('原样草稿 · 导出失败')
  await expect(page.locator('.qx-pill')).toHaveAttribute('data-tone', 'bad')
  const alert = page.getByTestId('resume-generate-draft-error')
  await expect(alert).toBeVisible()
  await expect(alert).toBeInViewport()
  await expect(alert).toHaveAttribute('role', 'alert')
  await expect(alert).toContainText('服务暂时不可用，请稍后重试')
  await expect(page.getByText('AI 服务本身是通的')).toHaveCount(0)
  await expect(page.getByText('这次没整理出来')).toHaveCount(0)
  await expect(page.locator('.kiosk-ai-fallback')).toHaveCount(0)
  await expect(draft).toBeVisible()
  await expect(draft).toBeEnabled()
  // 导出结束后另两颗也要回到可点，不能锁死在导出中的状态。
  await expect(page.getByRole('button', { name: '让 AI 整理成新简历' })).toBeEnabled()
  await expect(page.locator('.qx-rg-review-bar').getByRole('button', { name: '上一步' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '导出并打印我填的内容（未经 AI 润色）' })).toHaveCount(0)
  expect(api.requestCount('POST', '/api/v1/resume/generate')).toBe(0)
})

test('核对步导出原样草稿没完成时，另两颗按钮也不能点 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  allowDraftPrint(api)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  api.respondWith('POST', '/api/v1/resume/generate/export', async () => {
    await gate
    return {
      status: 200,
      json: {
        fileId: 'draft-held-1',
        filename: '简历草稿_孙晓雯.pdf',
        sizeBytes: 2048,
        pageCount: 1,
        signedUrl: '/e2e-fixtures/draft-resume.pdf',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        printFileUrl: '/api/v1/files/draft-held-1/content?expires=1&sig=test',
      },
    }
  })
  await page.goto('/resume/generate')
  await fillRequired(page)
  const draft = page.getByTestId('resume-generate-draft-export')
  const primary = page.getByRole('button', { name: '让 AI 整理成新简历' })
  const back = page.locator('.qx-rg-review-bar').getByRole('button', { name: '上一步' })
  await draft.click()
  await expect.poll(() => api.requestCount('POST', '/api/v1/resume/generate/export')).toBe(1)
  await expect(draft).toBeDisabled()
  await expect(primary).toBeDisabled()
  await expect(back).toBeDisabled()
  release()
  await expect(page).toHaveURL(/\/print\//)
})

test('AI 已经失败后再导出原样草稿失败，失败区不收起 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('POST', '/api/v1/resume/generate', {
    status: 200,
    json: {
      taskId: 'gen-fail-draft',
      status: 'failed',
      failReason: 'AI 简历生成失败，请稍后重试',
    },
  })
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  api.respondWith('POST', '/api/v1/resume/generate/export', async () => {
    await gate
    return { status: 500, json: { error: { code: 'INTERNAL', message: 'boom' } } }
  })
  await page.goto('/resume/generate')
  await fillRequired(page)
  await page.getByRole('button', { name: '让 AI 整理成新简历' }).click()
  const fallback = page.locator('.kiosk-ai-fallback')
  await expect(fallback).toBeVisible()
  await expect(page.getByText('AI 简历生成失败，请稍后重试').first()).toBeVisible()
  await expect(page.getByTestId('resume-generate-draft-export')).toHaveCount(0)
  await page.getByRole('button', { name: '导出并打印我填的内容（未经 AI 润色）' }).click()
  await expect.poll(() => api.requestCount('POST', '/api/v1/resume/generate/export')).toBe(1)
  await expect(fallback).toBeVisible()
  await expect(page.getByText('AI 简历生成失败，请稍后重试').first()).toBeVisible()
  await expect(page.getByTestId('resume-generate-draft-export')).toHaveCount(0)
  release()
  const alert = page.getByTestId('resume-generate-draft-error')
  await expect(alert).toBeVisible()
  await expect(alert).toBeInViewport()
  await expect(alert).toContainText('服务暂时不可用，请稍后重试')
  // 两件都失败时胶囊说最近这一件；AI 那件仍由兜底区和它的原因写着。
  await expect(page.locator('.qx-pill')).toHaveText('原样草稿 · 导出失败')
  await expect(fallback).toBeVisible()
  await expect(page.getByText('AI 简历生成失败，请稍后重试').first()).toBeVisible()
  await expect(page.getByTestId('resume-generate-draft-export')).toHaveCount(0)
})

test('生成页返回简历服务去简历中心 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  allowResumeHub(api)
  await page.goto('/resume/generate')
  await page.locator('.qx-topbar-back').click({ force: true })
  await expect(page).toHaveURL(/\/resume-service$/)
  await expect(page.locator('[data-hub="resume"]')).toBeVisible()

  await page.goto('/resume/generate')
  await page.getByTestId('resume-generate-primary').click()
  await page.locator('.qx-ctabar').getByRole('button', { name: '返回简历服务', exact: true }).click()
  await expect(page).toHaveURL(/\/resume-service$/)
  await expect(page.locator('[data-hub="resume"]')).toBeVisible()
})

test('生成预览返回简历服务去简历中心 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  allowResumeHub(api)
  await page.goto('/resume/generate/preview')
  await page.getByTestId('resume-generate-preview-exit-source').click()
  await expect(page).toHaveURL(/\/resume-service$/)
  await expect(page.locator('[data-hub="resume"]')).toBeVisible()

  await page.goto('/resume/generate/preview?state=preview-no-result&capture=1')
  await expect(page.getByTestId('resume-generate-preview-cta-source')).toHaveText('返回简历服务')
  await page.getByTestId('resume-generate-preview-cta-source').click()
  await expect(page).toHaveURL(/\/resume-service$/)
  await expect(page.locator('[data-hub="resume"]')).toBeVisible()
})
