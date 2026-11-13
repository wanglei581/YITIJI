import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { expectInterviewDirectionUnselected, chooseInterviewExperience } from './fixtures/direction-selection'
import { registerW4Api } from '../fixtures/fusion-w4-api'
import { assertDialogWithinViewport, assertKioskShellFillsViewport, assertNoElementCrossesViewport, assertNoHorizontalOverflow, assertTapTargetPointerHit } from './assert-layout'

function runtimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function verifyPage(page: Page, errors: string[]): Promise<void> {
  await assertNoHorizontalOverflow(page)
  await assertKioskShellFillsViewport(page)
  expect(errors).toEqual([])
}

const JOB_MEMBER_TOKEN = 'jobs-w4-browser-memory-token'
const JOB_CTA_WHITELIST = [
  '查看岗位',
  '去来源平台投递',
  '扫码投递',
  '查看招聘会',
  '去来源平台预约',
  '扫码预约',
  '复制来源链接',
] as const
const JOB_BANNED_COPY = [
  '一键投递', '立即投递', '平台投递', '企业收简历', '候选人管理',
  '我要应聘', '递交简历', '直投', '争取面试', '立即报名', '投递展位企业', '确认投递',
] as const

async function expectJobsComplianceCopy(scope: Locator): Promise<void> {
  await expect(scope.getByText(/^(一键投递|立即投递|平台投递|我要应聘|递交简历|直投\s*HR|争取面试|立即报名|投递展位企业|确认投递)$/)).toHaveCount(0)

  const controls = scope.locator('button, a[href], [role="button"]')
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index)
    const label = (
      await control.getAttribute('aria-label')
      ?? await control.getAttribute('title')
      ?? await control.innerText()
    ).trim()
    if (!label || !/投递|预约|应聘|报名|候选人|复制来源链接/.test(label)) continue
    expect(JOB_CTA_WHITELIST, `岗位 CTA 文案越界：${label}`).toContain(label as typeof JOB_CTA_WHITELIST[number])
  }
}

async function expectOpenedComplianceSurface(scope: Locator): Promise<void> {
  let flattened = await scope.innerText()
  for (const allowed of JOB_CTA_WHITELIST) flattened = flattened.replaceAll(allowed, '')
  for (const banned of JOB_BANNED_COPY) {
    expect(flattened, `已打开的岗位弹层出现违禁文案：${banned}`).not.toContain(banned)
  }
}

async function loginForJobs(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

test('/jobs 保留线上与线下双轨 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/jobs')
  await expect(page.locator('[data-qxt-screen]')).toHaveCount(1)
  await expect(page.getByText('前端工程师').first()).toBeVisible()
  await expect(page.getByText('青岛公共就业服务网').first()).toBeVisible()
  await expect(page.getByText('ext-job-001').first()).toBeVisible()
  await expect(page.getByText(/7月24日更新/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '查看岗位' })).toBeVisible()
  await expect(page.getByRole('button', { name: /线下机构门店/ })).toBeVisible()
  const filteredRequest = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.pathname === '/api/v1/jobs' && url.searchParams.get('category') === 'fulltime'
  })
  await page.getByRole('button', { name: '全职', exact: true }).click()
  const requestUrl = new URL((await filteredRequest).url())
  expect(requestUrl.searchParams.get('category')).toBe('fulltime')
  expect(requestUrl.searchParams.get('page')).toBe('1')
  expect(requestUrl.searchParams.get('pageSize')).toBe('100')
  await page.getByRole('button', { name: '城市 / 行业筛选' }).click()
  const jobFilterDialog = page.getByRole('dialog', { name: '城市与行业筛选' })
  await expect(jobFilterDialog).toBeVisible()
  await assertDialogWithinViewport(page)
  await jobFilterDialog.getByRole('button', { name: '青岛市', exact: true }).click()
  await expect(jobFilterDialog.getByRole('button', { name: '青岛市', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await jobFilterDialog.getByRole('button', { name: '完成' }).click()
  await expect(page.getByRole('button', { name: '城市 / 行业筛选 (1)' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('jobs-list-1080x1920.png') })
  await assertNoElementCrossesViewport(page)
  await verifyPage(page, errors)
})

test('/jobs/:id 只提供来源 CTA @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', {
    status: 200,
    json: { success: true, data: null },
  })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', {
    status: 200,
    json: { success: true, data: null },
  })
  api.respond('POST', '/api/v1/member/auth/sms-code', { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: { success: true, data: { token: JOB_MEMBER_TOKEN, user: { id: 'member-jobs-w4', phoneMasked: '138****8000', nickname: '岗位验收会员' } } },
  })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [] } })
  api.respond('POST', '/api/v1/activity/browse', { status: 200, json: { success: true, data: { recorded: true } } })
  let externalJumpBody: unknown = null
  api.respondWith('POST', '/api/v1/activity/external-jump', async () => ({ status: 200, json: { success: true, data: { recorded: true } } }))
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/activity/external-jump') {
      externalJumpBody = request.postDataJSON()
    }
  })
  await loginForJobs(page, '/jobs/job-001')
  await expect(page.locator('[data-qxt-screen]')).toHaveCount(1)
  await expect(page.getByText(/信息以来源平台为准/).first()).toBeVisible()
  await expect(page.getByText('青岛公共就业服务网').first()).toBeVisible()
  await expect(page.getByText('ext-job-001').first()).toBeVisible()
  await expect(page.getByText('https://jobs.example.gov.cn/jobs/job-001')).toBeVisible()
  await expect(page.getByText('数据来源说明：信息来自官方来源平台，以来源平台为准。')).toBeVisible()
  const applyGuide = page.getByRole('heading', { name: '投递怎么走' }).locator('..')
  await expect(applyGuide).toContainText('先核对岗位原文与来源四要素')
  await expect(applyGuide).toContainText('去来源平台自行操作')
  await expect(applyGuide).toContainText('结果以来源平台为准')
  await expect(applyGuide).toContainText('本终端不接收或转交简历')
  const primary = page.getByRole('button', { name: '去来源平台投递' })
  await assertTapTargetPointerHit(primary)
  const primaryBox = await primary.boundingBox()
  expect(primaryBox?.height).toBeGreaterThanOrEqual(56)
  await page.screenshot({ path: test.info().outputPath('job-detail-1080x1920.png') })
  await page.getByRole('button', { name: '扫码投递' }).last().click()
  const qrDialog = page.getByRole('dialog', { name: '扫码投递' })
  await expect(qrDialog).toBeVisible()
  await expect(qrDialog.getByText('请使用手机扫码前往来源平台自行操作')).toBeVisible()
  await expectOpenedComplianceSurface(qrDialog)
  await expect.poll(() => externalJumpBody).toEqual({ targetType: 'job', targetId: 'job-001', action: 'external_apply' })
  expect(JSON.stringify(externalJumpBody)).not.toMatch(/resumeId|documentId|resumeText|简历正文/)
  await expectJobsComplianceCopy(page.locator('body'))
  await assertNoElementCrossesViewport(page)
  await verifyPage(page, errors)
})

test('/jobs 接口失败显示真实异常态且不回填岗位 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  api.abort('GET', '/api/v1/jobs', 'internetdisconnected')
  await page.goto('/jobs')
  await expect(page.getByTestId('jobs-state-error')).toBeVisible()
  await expect(page.getByText('岗位名单这次没取到')).toBeVisible()
  await expect(page.getByText('前端工程师')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()
  await assertNoElementCrossesViewport(page)
  await verifyPage(page, errors)
})

test('/jobs 挂起请求显示加载态，空回执显示空态 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  let releaseJobs!: () => void
  const jobsGate = new Promise<void>((resolve) => { releaseJobs = resolve })
  api.respondWith('GET', '/api/v1/jobs', async () => {
    await jobsGate
    return {
      status: 200,
      json: { success: true, data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } },
    }
  })
  await page.goto('/jobs')
  await expect(page.getByTestId('jobs-state-loading')).toBeVisible()
  await expect(page.getByText('正在取岗位名单')).toBeVisible()
  releaseJobs()
  await expect(page.getByTestId('jobs-state-empty')).toBeVisible()
  // 本场景没设任何筛选（新机器开机常态：服务端 total=0）。
  // 这时必须说「本机暂未上架」，不能说「这组条件下」——
  // 对一个筛选都没设过的用户说「这组条件下」，等于暗示他设过筛选。
  await expect(page.getByText('本机暂未上架已审核的岗位')).toBeVisible()
  await expect(page.getByText('这组条件下没有已发布的岗位')).toHaveCount(0)
  await expect(page.getByText('前端工程师')).toHaveCount(0)

  // 反过来：设了关键词再筛空，就必须说「这组条件下」，不能说「本机暂未上架」——
  // 明明有岗位，只是不符合这次条件。两个方向都钉住，避免修好一头掉进另一头。
  await page.getByPlaceholder('搜索职位 / 公司').fill('不存在的岗位关键词')
  await expect(page.getByText('这组条件下没有已发布的岗位')).toBeVisible()
  await expect(page.getByText('本机暂未上架已审核的岗位')).toHaveCount(0)

  await assertNoElementCrossesViewport(page)
  await verifyPage(page, errors)
})

test('/jobs 来源不完整仍可读详情，但详情停发外部动作 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  const incompleteJob = {
    id: 'job-incomplete', title: '来源待补岗位', company: '来源机构公开企业', city: '青岛市',
    salary: '', salaryDisplay: '', category: 'fulltime', tags: [], description: '来源岗位原文。', requirements: '',
    sourceOrgId: 'source-001', externalId: '', sourceName: '青岛公共就业服务网', sourceUrl: '',
    syncTime: '2026-07-24T08:00:00.000Z', reviewStatus: 'approved', publishStatus: 'published',
    dataSourceNote: '信息来自官方来源平台，以来源平台为准。',
  }
  api.respond('GET', '/api/v1/jobs', {
    status: 200,
    json: { success: true, data: [incompleteJob], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } },
  })
  await page.goto('/jobs')
  await expect(page.getByText('来源要素待补齐')).toBeVisible()
  await expect(page.getByText('详情可读，外部入口待来源补全')).toBeVisible()
  await page.getByRole('button', { name: '查看岗位' }).click()
  await expect(page).toHaveURL(/\/jobs\/job-incomplete$/)
  await expect(page.getByTestId('job-detail-state-source-unavailable')).toBeVisible()
  await expect(page.getByRole('button', { name: '去来源平台投递' })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('button', { name: '扫码投递' }).last()).toHaveAttribute('aria-disabled', 'true')
  await assertNoElementCrossesViewport(page)
  await verifyPage(page, errors)
})

test('/jobs/:id 来源四要素缺失时停发外跳与扫码 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  api.respond('GET', '/api/v1/jobs/job-001', {
    status: 200,
    json: {
      success: true,
      data: {
        id: 'job-001', title: '前端工程师', company: '青岛示例制造有限公司', city: '青岛市',
        salary: '8000-12000', salaryDisplay: '8,000–12,000 元/月', category: 'fulltime', tags: ['React'],
        description: '负责来源岗位信息系统前端开发。', requirements: '熟悉 TypeScript。',
        sourceOrgId: 'source-001', externalId: '', sourceName: '青岛公共就业服务网', sourceUrl: '',
        syncTime: '2026-07-24T08:00:00.000Z', reviewStatus: 'approved', publishStatus: 'published',
        dataSourceNote: '信息来自官方来源平台，以来源平台为准。',
      },
    },
  })
  await page.goto('/jobs/job-001')
  await expect(page.getByTestId('job-detail-state-source-unavailable')).toBeVisible()
  await expect(page.getByText(/来源要素不完整，前往来源平台与扫码已停用/)).toBeVisible()
  await expect(page.getByText('来源平台未提供', { exact: true }).first()).toBeVisible()
  const sourceButton = page.getByRole('button', { name: '去来源平台投递' })
  const qrButtons = page.getByRole('button', { name: '扫码投递' })
  await expect(sourceButton).toHaveAttribute('aria-disabled', 'true')
  // 底栏主按钮「去来源平台投递」是 ariaDisabled：只写 aria-disabled、不写原生 disabled，
  // 点击照常交给页面自己的 onClick（触屏共享底栏 10/28 统一后的语义）。所以「点了不打开」
  // 要由页面自己守。先单独点它、再点下面的扫码按钮，这样它自己的守卫被拿掉时，红在这一步，
  // 不会被后面扫码按钮的断言抢先或遮住。终端上它走扫码，非终端上才 window.open，两条出口都要没发生。
  let popups = 0
  page.on('popup', () => { popups += 1 })
  await sourceButton.dispatchEvent('click')
  await expect(page.getByText('请使用手机扫码前往来源平台自行操作'), '底栏主按钮缺项时点了不得出码').toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '扫码投递' })).toHaveCount(0)
  expect(popups, '来源要素缺失时点「去来源平台投递」不得打开新窗口').toBe(0)
  // 来源四要素缺失时，页面上**每一个**扫码投递都必须停发——不是只停最后一个。
  const qrCount = await qrButtons.count()
  expect(qrCount).toBeGreaterThan(0)
  for (let index = 0; index < qrCount; index += 1) {
    await expect(qrButtons.nth(index)).toHaveAttribute('aria-disabled', 'true')
  }
  // 合规红线不能只靠 aria-disabled 属性挡，**处理函数本身**也必须不开二维码。
  // 用 dispatchEvent 直接在元素上派发 click，绕过命中测试：
  // 试过 click({ force: true }) —— 一体机是 1080×1920 舞台等比缩放，
  // force 的坐标落不到这个按钮上，处理函数压根没被调到，反向变异（去掉
  // openSourceQr 里的 sourceCanApply 守卫）时用例照样绿，等于断言是空的。
  for (let index = 0; index < qrCount; index += 1) {
    await qrButtons.nth(index).dispatchEvent('click')
  }
  await expect(page.getByText('请使用手机扫码前往来源平台自行操作')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '扫码投递' })).toHaveCount(0)
  await assertNoElementCrossesViewport(page)
  await verifyPage(page, errors)
})

// 阳性对照：与上一条配对。来源四要素齐全时，同一颗底栏主按钮点了要真的出码；
// 否则上一条里「点了没出码」可能只是这颗按钮根本接不到点击，断言就是空的。
test('/jobs/:id 底栏主按钮「去来源平台投递」：来源齐全时点了出码 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/jobs/job-001')
  await expect(page.getByTestId('job-detail-state-default')).toBeVisible()
  const sourceButton = page.getByRole('button', { name: '去来源平台投递' })
  await expect(sourceButton).not.toHaveAttribute('aria-disabled', 'true')
  await sourceButton.dispatchEvent('click')
  const qrDialog = page.getByRole('dialog', { name: '扫码投递' })
  await expect(qrDialog).toBeVisible()
  await expect(qrDialog.getByText('请使用手机扫码前往来源平台自行操作')).toBeVisible()
  expect(errors).toEqual([])
})

// G1 #482: /offline-agencies/:id 已注册为真实路由，列表须提供导航入口
test('/offline-agencies 列表可进入真实详情页 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  const districtRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/kiosk/offline-agencies') {
      districtRequests.push(request.url())
    }
  })
  await page.goto('/offline-agencies')
  const agencyRow = page.getByRole('article', { name: '青岛合规人力服务机构' })
  await expect(agencyRow).toBeVisible()
  await expect(page.getByText('岗位咨询', { exact: true })).toBeVisible()
  await expect(page.getByText(/服务时间以机构公示为准/)).toBeVisible()
  await expect(page.getByText(/正常收录|已核验|暂停收录/)).toHaveCount(0)
  await expect(page.locator('[data-qxt-screen]')).toHaveCount(1)
  await expect(page.getByText('全部区域')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('qx-b3-offline-agencies.png'), fullPage: true })
  await expect(page.getByText('一键投递')).toHaveCount(0)
  await expect(page.getByText('立即投递')).toHaveCount(0)
  await expect(page.getByText('我要应聘')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '市南区' })).toBeVisible()
  await page.getByRole('button', { name: '市南区' }).click()
  await expect.poll(() => districtRequests.at(-1)).toContain('district=')
  // 不得伪造实时指标
  await expect(page.getByText(/营业中|今日服务|在招岗位|距本机|按直线距离/)).toHaveCount(0)
  // 详情路由真实存在，列表页须能通过真实机构行进入详情。
  await agencyRow.click()
  await expect(page).toHaveURL(/\/offline-agencies\/agency-001$/)
  await verifyPage(page, errors)
  await page.screenshot({ path: test.info().outputPath('qx-b3-offline-agencies-detail.png'), fullPage: true })
})

test('/offline-agencies/:id 详情页加载机构信息 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/offline-agencies/agency-001')
  await expect(page.getByRole('heading', { name: '青岛合规人力服务机构' })).toBeVisible()
  await expect(page.getByText(/市南区示例路|09:00|服务时间以机构公示为准/).first()).toBeVisible()
  // 不得伪造实时运营状态
  await expect(page.getByText(/营业中|今日服务|在招岗位|按直线距离/)).toHaveCount(0)
  await verifyPage(page, errors)
})

test('/jobs/:id/offline 适配 raw 岗位与字符串字段 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/jobs/offline-job-001/offline')
  await expect(page.getByRole('heading', { name: '现场咨询岗位' })).toBeVisible()
  await expect(page.getByText('8,000–12,000 元/月')).toBeVisible()
  await expect(page.getByText('熟悉 TypeScript')).toBeVisible()
  await expect(page.getByText('以机构公示为准', { exact: true })).toBeVisible()
  await expect(page.getByText(/到店咨询/).first()).toBeVisible()
  await verifyPage(page, errors)
})

test('companies 列表与详情保持来源导览 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/companies')
  await expect(page.getByText('青岛示例制造有限公司').first()).toBeVisible()
  await expect(page.locator('[data-qxt-screen]')).toHaveCount(1)
  await page.getByRole('button', { name: '选择类型 (12)' }).click()
  const companyFilterDialog = page.getByRole('dialog', { name: '企业类型与行业' })
  await expect(companyFilterDialog).toBeVisible()
  await assertDialogWithinViewport(page)
  await companyFilterDialog.getByRole('button', { name: '民营企业', exact: true }).click()
  await companyFilterDialog.getByRole('button', { name: '完成' }).click()
  await expect(page.getByRole('button', { name: '民营企业', exact: true })).toBeVisible()
  await page.goto('/companies/company-001')
  await expect(page.getByText(/来源企业与岗位导览/).first()).toBeVisible()
  await expect(page.getByText('前端工程师')).toBeVisible()
  await expect(page.getByText('来源机构', { exact: true })).toBeVisible()
  await expect(page.getByText('同步时间', { exact: true })).toBeVisible()
  await expect(page.getByText('外部ID', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看岗位' })).toBeVisible()
  await expect(page.getByRole('button', { name: '去来源平台投递' })).toBeVisible()
  await expect(page.getByRole('button', { name: '投递企业' })).toHaveCount(0)
  await expect(page.getByText('一键投递')).toHaveCount(0)
  await expect(page.getByText(/HR 30|候选人筛选|已收/)).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('qx-b3-company-detail.png'), fullPage: true })
  await verifyPage(page, errors)
})

// 底栏主按钮「查看在招岗位」是 ariaDisabled：不写原生 disabled，点了照常交给页面的 onClick。
// 企业确实没有在招岗位（接口回了 0 条）时，点了也不能跳。先做阳性对照：有岗位时同一颗按钮真的会跳。
test('companies/:id 底栏「查看在招岗位」：有岗位才跳，没有在招岗位时点了也不跳 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/companies/company-001')
  const jobsButton = page.getByRole('button', { name: '查看在招岗位' })
  await expect(jobsButton).toBeVisible()
  await expect(jobsButton).not.toHaveAttribute('aria-disabled', 'true')
  await jobsButton.dispatchEvent('click')
  await expect(page).toHaveURL((url) => url.pathname === '/jobs/job-001')

  api.respond('GET', '/api/v1/companies/company-001/jobs', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  await page.goto('/companies/company-001')
  await expect(page.getByTestId('company-directory-state-company-sparse')).toBeVisible()
  const blocked = page.getByRole('button', { name: '查看在招岗位' })
  await expect(blocked).toHaveAttribute('aria-disabled', 'true')
  await blocked.dispatchEvent('click')
  await page.waitForTimeout(400)
  await expect(page).toHaveURL((url) => url.pathname === '/companies/company-001')
  await verifyPage(page, errors)
})

// 3.14：线上平台目录并入本机构官方渠道。旧地址重定向；平台目录不再写死在前端，b 版本由服务端 legacyPlatforms 下发。
// 守的东西没变——目录页只给「扫码去来源平台」，不出现任何代投 / 平台内投递说法；而且现在连可点的外链都没有，只有二维码。
test('/jobs/online-platforms 重定向到本机构官方渠道，只给二维码不代投 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/jobs/online-platforms')
  await page.waitForURL((url) => url.pathname === '/official-channels')
  await expect(page.getByRole('heading', { level: 1, name: '扫码，在手机上看' })).toBeVisible()
  await expect(page.getByText('本机构官方渠道').first()).toBeVisible()
  const org = page.getByTestId('official-channels-org')
  const legacy = page.getByTestId('official-channels-legacy')
  await expect(org.getByTestId('official-channel-card')).toHaveCount(1)
  await expect(legacy.getByTestId('official-channel-card')).toHaveCount(2)
  await expect(page.locator('[data-testid="official-channel-qr-code"] svg')).toHaveCount(3)
  await expect(legacy.getByText('jobs.example.com', { exact: true })).toBeVisible()
  await expect(legacy.getByText('本渠道由示例招聘平台运营公司提供，信息以其官网为准', { exact: true })).toBeVisible()
  await expect(page.locator('[data-qx-frame="true"]')).toHaveCount(1)
  await expect(page.locator('[data-qx-frame="true"] a[href]'), '一体机不打开外部网页：整页没有可点的链接').toHaveCount(0)
  for (const word of ['一键投递', '立即投递', '一键全网分发', '授权代投', '同步投递', '扫码投递', '去来源平台投递']) {
    await expect(page.getByText(word)).toHaveCount(0)
  }
  await page.screenshot({ path: test.info().outputPath('qx-b3-official-channels-b.png'), fullPage: true })
  await verifyPage(page, errors)
})

test('/job-fairs/:id/companies/:companyId 来源 CTA 与禁词 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/job-fairs/fair-001/companies/fair-company-001')
  await expect(page.getByText('青岛示例制造有限公司').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '去来源平台投递' }).first()).toBeVisible()
  await expect(page.getByText('前端工程师')).toBeVisible()
  await expect(page.getByText('一键投递')).toHaveCount(0)
  await expect(page.getByText('立即投递')).toHaveCount(0)
  await expect(page.getByText('投递企业')).toHaveCount(0)
  await expect(page.getByText(/HR 30|候选人筛选|已收/)).toHaveCount(0)
  await page.getByRole('button', { name: '去来源平台投递' }).first().click()
  await expect(page.locator('[data-testid="directory-qr-slot"]')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('qx-b3-fair-company-qr.png'), fullPage: true })
  await verifyPage(page, errors)
})

test('/job-fairs 预约离开平台且 mock 统计为空 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/job-fairs/fair-001')
  await expect(page.getByRole('button', { name: /扫码预约|去来源平台预约/ }).first()).toBeVisible()
  await expect(page.locator('iframe[src*="openstreetmap"]')).toHaveCount(0)
  await expect(page.getByText('暂无地图，请以场馆地址为准')).toBeVisible()
  // 2026-09-20：详情页的「数据大屏」Tab 随四 Tab 壳退休，统计成了独立路由。
  // 入口从 Tab 变成 subnav 的一行，但**判据不变**：夹具 isMockData=true，
  // 这一路走完必须落到诚实空态，而不是把演示数字端上来。
  const statsRow = page.getByTestId('fair-detail-stats')
  await expect(statsRow).toContainText('主办方还没有回传统计')
  await statsRow.click()
  await expect(page).toHaveURL(/\/job-fairs\/fair-001\/stats$/)
  await expect(page.getByTestId('fair-stats-empty')).toContainText('真实数据正在接入')
  await expect(page.getByText(/签到成功|确认签到/)).toHaveCount(0)
  await verifyPage(page, errors)
})

test('/job-fairs/:id/companies 无 syncTime 显示同步时间未知 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  api.respond('GET', '/api/v1/job-fairs/fair-001', {
    status: 200,
    json: {
      success: true,
      data: {
        id: 'fair-001', name: '2026 青岛高校毕业生招聘会', organizer: '青岛市公共就业服务中心',
        startTime: '2026-08-01T01:00:00.000Z', endTime: '2026-08-01T08:00:00.000Z', venue: '青岛国际会展中心',
        status: 'upcoming', theme: 'campus', city: '青岛市', address: '崂山区苗岭路9号', boothCount: 1, jobCount: 2,
        sourceOrgId: 'source-001', externalId: 'ext-fair-001', sourceName: '青岛公共就业服务网',
        sourceUrl: 'https://jobs.example.gov.cn/fairs/fair-001',
        reviewStatus: 'approved', publishStatus: 'published',
        hasManagedData: true, managedCompanyCount: 1, managedMaterialCount: 0,
        dataSourceNote: '活动信息来自主办方，以来源平台和现场公告为准。',
      },
    },
  })
  await page.goto('/job-fairs/fair-001/companies')
  await expect(page.getByText('同步时间未知')).toBeVisible()
  await expect(page.getByText('2026-08-01')).toHaveCount(0)
  await verifyPage(page, errors)
})

test('/job-fairs/checkin 只展示来源签到 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/job-fairs/checkin')
  const sourceCheckinNote = page.locator('p').filter({
    hasText: '请使用手机扫码前往来源平台签到。本系统不记录签到结果，请以来源平台显示为准。',
  })
  await expect(sourceCheckinNote).toHaveCount(1)
  await expect(sourceCheckinNote).toContainText('本系统不记录签到结果')
  await expect(page.getByText(/签到成功|确认签到/)).toHaveCount(0)
  await verifyPage(page, errors)
})

test('/campus 与 /smart-campus 语义独立 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/campus')
  await expect(page.getByRole('heading', { name: '挑一场校园招聘会' })).toBeVisible()
  // 2026-11-04 产品负责人定停放：智慧校园旧链回首页，不再打开校园服务页。
  await page.goto('/smart-campus')
  await expect(page.getByTestId('qx-home')).toBeVisible()
  await expect(page.locator('[data-kiosk-screen="route-error"]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '选一项校园服务', exact: true })).toHaveCount(0)
  await verifyPage(page, errors)
})

test('/smart-campus/freshman-insights 停放后回到首页 @w4', async ({ page, api }) => {
  // 2026-11-04 产品负责人定停放：这条深链走 smart-campus/*，回到首页，不出报错页。
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/smart-campus/freshman-insights')
  await expect(page).toHaveURL((url) => url.pathname === '/')
  await expect(page.getByTestId('qx-home')).toBeVisible()
  await expect(page.locator('[data-kiosk-screen="route-error"]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '页面不存在', exact: true })).toHaveCount(0)
  await verifyPage(page, errors)
})

test('/campus AI求职「开始模拟」进入面试设置 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/campus')
  await page.getByRole('button', { name: /2026 青岛高校毕业生招聘会/ }).click()
  await page.getByRole('button', { name: 'AI求职' }).click()
  await page.getByRole('button', { name: '开始模拟' }).click()
  // /interview/setup 现在是带状态的重定向（→ /interview?stage=setup）。
  // 入口行为没变：仍然落到面试设置这一步。
  // 只认重定向**之后**的最终落点：toHaveURL 会重试到稳定态，
  // 两种都认等于「重定向没发生也算过」，那是放松断言。
  await expect(page).toHaveURL(/\/interview\?stage=setup$/)
  await expect(page.locator('[data-kiosk-screen="interview-setup"]')).toBeVisible()
  await expectInterviewDirectionUnselected(page)
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const dialog = page.getByRole('dialog', { name: '选择面试行业' })
  await expect(dialog.getByText('当前：尚未选择', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { pressed: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: '制造业', exact: true }).click()
  await dialog.getByRole('button', { name: '完成' }).click()
  await chooseInterviewExperience(page)
  await verifyPage(page, errors)
})

test('campus 两个直达容错页诚实返回 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/campus/welcome')
  await expect(page.locator('.rt-state').getByText('当前没有独立迎新招聘内容')).toHaveCount(1)
  await page.goto('/campus/freshman-insights')
  await expect(page.locator('.rt-state').getByText('暂无经核验的校园招聘统计')).toHaveCount(1)
  await expect(page.locator('.rt-state').getByText('不会展示示例数据')).toHaveCount(1)
  await verifyPage(page, errors)
})

// 2026-11-05 政策最小闭环：查政策改成「六类首页 /policy-service → 类别列表 /renshi?audience= →
// 按编号读的详情 /renshi?policy=」。/renshi 不带参数是旧链接，回政策首页。
// 与 fusion-w4-api.ts 登记的那一条政策同一份数据（应届高校毕业生，原文链接未核对属于登记官网）。
const W4_POLICY = {
  id: 'policy-001',
  kind: 'policy_guide',
  title: '高校毕业生就业服务指引',
  summary: '请通过官方入口查看办理条件。',
  audience: 'graduate',
  sourceName: '青岛市人力资源和社会保障局',
  syncTime: '2026-07-24T08:00:00.000Z',
  externalUrl: 'https://hrss.example.gov.cn/policy/001',
}
/** 停放前常驻政策页的 5 条本机整理办事指引（源码已停放）。停放后哪一屏都不该再出现。 */
const BUILTIN_GUIDE_TITLES = [
  '一次性求职创业补贴',
  '灵活就业社保补贴',
  '高校毕业生住房 / 安家政策',
  '职业技能培训 / 技能提升补贴',
  '创业担保贷款 / 创业补贴',
] as const

/**
 * 政策首页按类别各读一次条数（?kind=policy_guide&audience=…&pageSize=1）。ApiRouter 只按路径应答，
 * 同一份列表会被算进每一类、连公告都算上；glob 路由又连查询串一起比对。这里按路径接住，再按 kind / audience 过滤、按页切。
 */
async function routeW4PolicyList(page: Page, items: readonly (typeof W4_POLICY)[], seen: URL[] = []): Promise<void> {
  await page.route((url) => url.pathname === '/api/v1/policies', async (route) => {
    const url = new URL(route.request().url())
    seen.push(url)
    const kind = url.searchParams.get('kind')
    const audience = url.searchParams.get('audience')
    const pageNo = Math.max(1, Number(url.searchParams.get('page')) || 1)
    const pageSize = Math.max(1, Number(url.searchParams.get('pageSize')) || 200)
    const hits = items.filter((item) => (!kind || item.kind === kind) && (!audience || item.audience === audience))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: hits.slice((pageNo - 1) * pageSize, pageNo * pageSize),
        pagination: { page: pageNo, pageSize, total: hits.length, totalPages: Math.max(1, Math.ceil(hits.length / pageSize)) },
      }),
    })
  })
}

test('/renshi 官方信息不承诺代办 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await routeW4PolicyList(page, [W4_POLICY])
  api.respond('GET', '/api/v1/policies/policy-001', { status: 200, json: { success: true, data: W4_POLICY } })
  await page.goto('/renshi')
  await expect(page).toHaveURL((url) => url.pathname === '/policy-service')
  await expect(page.getByTestId('policy-touch-hub')).toBeVisible()
  await expect(page.getByText(/以官方原文为准/).first()).toBeVisible()
  await expect(page.getByText(/保证到账|免申即享/)).toHaveCount(0)
  await verifyPage(page, errors)

  await page.goto('/renshi?policy=policy-001')
  await expect(page.getByRole('heading', { level: 1, name: '高校毕业生就业服务指引' })).toBeVisible()
  // 每条写明发布机构；机构没填办事三栏就照实写没提供，不从摘要里猜条件；
  // 原文链接没核对过属于发布机构登记的官方网站，就不给扫码。
  await expect(page.locator('.qxt-band .qxt-eyebrow')).toContainText('青岛市人力资源和社会保障局发布')
  await expect(page.getByText('发布机构没有提供这部分，请以原文为准')).toHaveCount(3)
  await expect(page.getByText('原文链接不在发布机构登记的官方网站内，暂不提供扫码')).toBeVisible()
  await expect(page.locator('.policy-min-qr svg')).toHaveCount(0)
  await expect(page.getByText(/保证到账|免申即享/)).toHaveCount(0)
  await verifyPage(page, errors)
})

// 政策库空 ≠ 页面空。旧版把 5 条本机整理的办事指引常驻在政策页（其中一条 audiences 含 'general'，
// 任何身份筛选都命中），政策库为空时页面照样满屏：运营录完 30 条种子政策，打开页面无法判断自己录的到底进没进去。
// 2026-11-05 起这 5 条指引停放、不再上屏：全库为 0 时整屏换成空态，类别列表照实写 0 条，不拿指引补位。
test('/renshi 政策库为空时给出明确空态，内置指引不冒充库内政策 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  api.respond('GET', '/api/v1/policies', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 200, total: 0, totalPages: 1 } },
  })
  await page.goto('/renshi')
  await expect(page).toHaveURL((url) => url.pathname === '/policy-service')

  const hub = page.getByTestId('policy-touch-hub')
  await expect(hub).toHaveAttribute('data-qxt-state', 'empty')
  await expect(page.getByRole('heading', { level: 1, name: '这里还没有发布的政策' })).toBeVisible()
  await expect(page.getByText('本机不自己编写政策，也不拿别处的内容顶替')).toBeVisible()
  await expect(hub.locator('[data-testid^="policy-category-"]')).toHaveCount(0)
  for (const title of BUILTIN_GUIDE_TITLES) await expect(page.getByText(title)).toHaveCount(0)
  await verifyPage(page, errors)

  await page.goto('/renshi?audience=general')
  await expect(page.getByRole('heading', { level: 1, name: '0 条政策' })).toBeVisible()
  await expect(page.getByTestId('renshi-policy-list').locator('[data-policy-id]')).toHaveCount(0)
  await expect(page.getByText('这个类别还没有机构发布政策。')).toBeVisible()
  for (const title of BUILTIN_GUIDE_TITLES) await expect(page.getByText(title)).toHaveCount(0)
  await verifyPage(page, errors)
})

// 库内政策按适用人群分六类，条数按类别向服务端要 total（不拿取回的一条推断全类条数）；
// 本机整理的指引已停放，不混进任何一类。
test('/renshi 库内政策按类别真实条数渲染，不混入内置指引 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api) // fixture: 1 条 kind=policy_guide（应届高校毕业生）
  const listRequests: URL[] = []
  await routeW4PolicyList(page, [W4_POLICY], listRequests)
  await page.goto('/policy-service')

  const graduate = page.getByTestId('policy-category-graduate')
  await expect(graduate).toContainText('1 条 · 最近：高校毕业生就业服务指引')
  for (const audience of ['startup', 'flexible', 'hardship', 'migrant', 'general'] as const) {
    const tile = page.getByTestId(`policy-category-${audience}`)
    await expect(tile).toContainText('还没有机构发布')
    await expect(tile).toHaveAttribute('aria-disabled', 'true')
  }
  expect(listRequests.some((url) => url.searchParams.get('kind') === 'policy_guide'
    && url.searchParams.get('audience') === 'graduate' && url.searchParams.get('pageSize') === '1')).toBe(true)
  // 机构公告只在有公告时出现。
  await expect(page.getByRole('button', { name: /^机构公告/ })).toHaveCount(0)
  for (const title of BUILTIN_GUIDE_TITLES) await expect(page.getByText(title)).toHaveCount(0)
  await verifyPage(page, errors)

  await graduate.click()
  await expect(page).toHaveURL((url) => url.pathname === '/renshi' && url.searchParams.get('audience') === 'graduate')
  const list = page.getByTestId('renshi-policy-list')
  await expect(list.locator('[data-policy-id]')).toHaveCount(1)
  await expect(list.locator('[data-policy-id="policy-001"]')).toContainText('高校毕业生就业服务指引')
  await expect(list.locator('[data-policy-id="policy-001"]')).toContainText('青岛市人力资源和社会保障局')
  for (const title of BUILTIN_GUIDE_TITLES) await expect(page.getByText(title)).toHaveCount(0)
  await verifyPage(page, errors)
})
