import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { registerW4Api, w4TerminalConfig } from '../fixtures/fusion-w4-api'
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

const SMART_CAMPUS_URLS = [
  ['/smart-campus', '迎新指引'],
  ['/smart-campus/welcome', '迎新流程'],
  ['/smart-campus/freshman-insights', '迎新服务导览'],
  ['/smart-campus/service/campus-card', '校园卡办理'],
  ['/smart-campus/service/all-in-one', '一卡通开通'],
  ['/smart-campus/service/campus-network', '校园网开通'],
  ['/smart-campus/service/luggage', '行李帮运'],
  ['/smart-campus/service/panorama', 'VR校园'],
] as const

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
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

async function captureCapabilityRefresh(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const callbacks: Array<() => void> = []
    const original = window.setInterval.bind(window)
    ;(window as typeof window & { __runCapabilityRefresh?: () => void }).__runCapabilityRefresh = () => {
      callbacks.forEach((callback) => callback())
    }
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 300_000 && typeof handler === 'function') {
        callbacks.push(() => handler(...args))
      }
      return original(handler, timeout, ...args)
    }) as typeof window.setInterval
  })
}

async function runCapabilityRefresh(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as typeof window & { __runCapabilityRefresh?: () => void }).__runCapabilityRefresh?.()
  })
}

test('/jobs 保留线上与线下双轨 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/jobs')
  await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
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
  await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
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
  await expect(page.getByText('全部区域')).toHaveCount(0)
  await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
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
  await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
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

test('/jobs/online-platforms 只提供扫码打开来源平台 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/jobs/online-platforms')
  await expect(page.getByRole('heading', { name: '线上招聘平台' })).toBeVisible()
  await expect(page.getByRole('button', { name: /扫码打开来源平台/ })).toHaveCount(4)
  await expect(page.getByText('一键投递')).toHaveCount(0)
  await expect(page.getByText('立即投递')).toHaveCount(0)
  await expect(page.getByText('一键全网分发')).toHaveCount(0)
  await expect(page.getByText('授权代投')).toHaveCount(0)
  await expect(page.getByText('同步投递')).toHaveCount(0)
  await expect(page.getByText('扫码投递')).toHaveCount(0)
  await page.getByRole('button', { name: /Boss直聘/ }).click()
  await expect(page.getByText('www.zhipin.com')).toBeVisible()
  await expect(page.locator('[data-testid="directory-qr-slot"]')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('qx-b3-online-platforms-qr.png'), fullPage: true })
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
  await expect(page.getByText(/暂无真实统计/)).toBeVisible()
  await page.getByRole('button', { name: '现场统计' }).click()
  await expect(page).toHaveURL(/\/job-fairs\/fair-001\/stats$/)
  await expect(page.getByText(/真实数据正在接入|暂无真实统计/)).toBeVisible()
  await expect(page.getByText(/签到成功|确认签到/)).toHaveCount(0)
  await page.screenshot({ path: '../../docs/progress/evidence/qx-job-fairs-2026-09-07/runtime-stats-empty.png' })
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
  await page.screenshot({ path: '../../docs/progress/evidence/qx-job-fairs-2026-09-07/runtime-checkin-guide.png' })
  await verifyPage(page, errors)
})

test('/campus 与 /smart-campus 语义独立 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/campus')
  await expect(page.getByText(/校园招聘专区/).first()).toBeVisible()
  await page.goto('/smart-campus/freshman-insights')
  await expect(page.getByText('迎新服务导览')).toBeVisible()
  await expect(page.getByText(/本平台没有迎新报到数据/)).toBeVisible()
  await verifyPage(page, errors)
})

test('/campus AI求职「开始模拟」进入 /interview/setup @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/campus')
  await page.getByRole('button', { name: 'AI求职' }).click()
  await page.getByRole('button', { name: '开始模拟' }).click()
  await expect(page).toHaveURL(/\/interview\/setup$/)
  await expect(page.locator('[data-kiosk-screen="interview-setup"]')).toBeVisible()
  await verifyPage(page, errors)
})

test('campus 两个直达容错页诚实返回 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/campus/welcome')
  await expect(page.getByText('当前没有独立迎新招聘内容')).toBeVisible()
  await page.goto('/campus/freshman-insights')
  await expect(page.getByText('暂无经核验的校园招聘统计')).toBeVisible()
  await verifyPage(page, errors)
})

test('smart-campus enabled 与 service 指引可达 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api, { smartCampusEnabled: true })
  await page.goto('/smart-campus')
  await expect(page.getByText('迎新指引')).toBeVisible()
  await page.goto('/smart-campus/service/campus-card')
  await expect(page.getByText('办理指引 · 未接线上办理')).toBeVisible()
  await verifyPage(page, errors)
})

test('smart-campus disabled 诚实为空 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api, { smartCampusEnabled: false })
  await page.goto('/smart-campus')
  await expect(page.getByText('本机暂未开启智慧校园服务')).toBeVisible()
  await verifyPage(page, errors)
})

test('smart-campus 总关闭时 8 条具体 URL 全部 fail-closed @w4', async ({ page, api }) => {
  registerW4Api(api, { smartCampusEnabled: false })
  for (const [url, forbiddenText] of SMART_CAMPUS_URLS) {
    const before = api.requestCount('GET', '/api/v1/terminals/KSK-001/config')
    await page.goto(url)
    await expect.poll(() => api.requestCount('GET', '/api/v1/terminals/KSK-001/config')).toBe(before + 1)
    await expect(page.locator('[data-capability-state="unavailable"]')).toBeVisible()
    await expect(page.getByText(forbiddenText, { exact: false })).toHaveCount(0)
  }
})

for (const scenario of [
  { name: '网络中断', setup: (api: Parameters<typeof registerW4Api>[0]) => api.abort('GET', '/api/v1/terminals/KSK-001/config', 'internetdisconnected') },
  { name: 'HTTP 503', setup: (api: Parameters<typeof registerW4Api>[0]) => api.respond('GET', '/api/v1/terminals/KSK-001/config', { status: 503, json: { error: { code: 'UNAVAILABLE' } } }) },
  { name: '畸形配置', setup: (api: Parameters<typeof registerW4Api>[0]) => api.respond('GET', '/api/v1/terminals/KSK-001/config', { status: 200, json: { ...w4TerminalConfig(), smartCampus: { enabled: 'true', modules: {}, items: [] } } }) },
] as const) {
  test(`smart-campus 首次${scenario.name}不挂载业务子树 @w4`, async ({ page, api }) => {
    registerW4Api(api)
    scenario.setup(api)
    await page.goto('/smart-campus/service/campus-card')
    await expect.poll(() => api.requestCount('GET', '/api/v1/terminals/KSK-001/config')).toBe(1)
    await expect(page.locator('[data-capability-state="unavailable"]')).toBeVisible()
    await expect(page.getByText('办理指引 · 未接线上办理')).toHaveCount(0)
  })
}

for (const scenario of [
  { name: '空配置', items: [] },
  { name: '全部禁用', items: [{ key: 'one', title: '服务', description: '', icon: 'wrench', to: '/help', disabled: true, sortOrder: 1 }] },
  { name: '缺少启动目标', items: [{ key: 'one', title: '服务', description: '', icon: 'wrench', to: null, disabled: false, sortOrder: 1 }] },
] as const) {
  test(`toolbox ${scenario.name}不可进入 @w4`, async ({ page, api }) => {
    registerW4Api(api)
    const config = w4TerminalConfig()
    api.respond('GET', '/api/v1/terminals/KSK-001/config', {
      status: 200,
      json: { ...config, toolbox: { enabled: true, items: scenario.items } },
    })
    await page.goto('/toolbox')
    await expect.poll(() => api.requestCount('GET', '/api/v1/terminals/KSK-001/config')).toBe(1)
    await expect(page.locator('[data-capability-state="unavailable"]')).toBeVisible()
    await expect(page.locator('[data-kiosk-screen="toolbox"]')).toHaveCount(0)
  })
}

test('toolbox 畸形 item fail-closed @w4', async ({ page, api }) => {
  registerW4Api(api)
  const config = w4TerminalConfig()
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: { ...config, toolbox: { enabled: true, items: [{ key: 'broken' }] } },
  })
  await page.goto('/toolbox')
  await expect.poll(() => api.requestCount('GET', '/api/v1/terminals/KSK-001/config')).toBe(1)
  await expect(page.locator('[data-capability-state="unavailable"]')).toBeVisible()
  await expect(page.locator('[data-kiosk-screen="toolbox"]')).toHaveCount(0)
})

test('toolbox 混合安全项与危险外链时危险项不可启动 @w4', async ({ page, api }) => {
  registerW4Api(api)
  const config = w4TerminalConfig()
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      ...config,
      toolbox: {
        enabled: true,
        items: [
          { key: 'safe', title: '使用帮助', description: '', icon: 'help-circle', to: '/help', disabled: false, sortOrder: 1, launchMode: 'internal_route' },
          { key: 'unsafe', title: '危险外链', description: '', icon: 'wrench', to: null, disabled: false, sortOrder: 2, launchMode: 'external_url', externalUrl: 'javascript:alert(1)' },
        ],
      },
    },
  })
  await page.goto('/toolbox')
  await expect(page.getByRole('button', { name: /使用帮助/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /危险外链/ })).toBeDisabled()
})

test('smart-campus 危险扩展外链不可启动 @w4', async ({ page, api }) => {
  registerW4Api(api)
  const config = w4TerminalConfig()
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      ...config,
      smartCampus: {
        ...config.smartCampus,
        items: [{ key: 'unsafe', title: '危险校园外链', description: '', icon: 'wrench', to: null, disabled: false, sortOrder: 1, launchMode: 'external_url', externalUrl: 'javascript:alert(1)' }],
      },
    },
  })
  await page.goto('/smart-campus')
  await expect(page.getByRole('button', { name: /危险校园外链/ })).toBeDisabled()
})

test('smart-campus 子模块关闭不能从深链绕过 @w4', async ({ page, api }) => {
  registerW4Api(api, {
    smartCampusEnabled: true,
    smartCampusModules: { welcome: false, luggage: false, panorama: false },
  })
  for (const url of ['/smart-campus/welcome', '/smart-campus/service/luggage', '/smart-campus/service/panorama']) {
    await page.goto(url)
    await expect(page.getByText('本机暂未开启这项智慧校园服务')).toBeVisible()
  }
  await page.goto('/smart-campus/service/campus-card')
  await expect(page.getByText('办理指引 · 未接线上办理')).toBeVisible()
  await page.goto('/smart-campus/freshman-insights')
  await expect(page.getByText('迎新服务导览')).toBeVisible()
})

// MSC-07（2026-09-07）：5 分钟定时刷新不再先置 loading 卸载子页（用户填到一半会丢状态）；
// 刷新期间保留旧快照，拿到新结果再替换。刷新失败仍 fail-closed 关闭。
test('smart-campus 刷新期间保留旧页面，失败后关闭 @w4', async ({ page, api }) => {
  registerW4Api(api)
  await captureCapabilityRefresh(page)
  let releaseRefresh!: (value: { abort: 'internetdisconnected' }) => void
  api.respondWith('GET', '/api/v1/terminals/KSK-001/config', (requestNumber) => {
    if (requestNumber === 1) return { status: 200, json: w4TerminalConfig() }
    return new Promise((resolve) => { releaseRefresh = resolve })
  })

  try {
    await page.goto('/smart-campus/service/campus-card')
    await expect(page.getByText('办理指引 · 未接线上办理')).toBeVisible()
    await runCapabilityRefresh(page)
    await expect.poll(() => api.requestCount('GET', '/api/v1/terminals/KSK-001/config')).toBe(2)
    await expect(page.locator('[data-capability-state="loading"]')).toHaveCount(0)
    await expect(page.getByText('办理指引 · 未接线上办理')).toBeVisible()
    releaseRefresh({ abort: 'internetdisconnected' })
    await expect(page.locator('[data-capability-state="unavailable"]')).toBeVisible()
    await expect(page.getByText('办理指引 · 未接线上办理')).toHaveCount(0)
  } finally {
    releaseRefresh?.({ abort: 'internetdisconnected' })
  }
})

test('smart-campus 乱序旧 ON 响应不能覆盖新 OFF @w4', async ({ page, api }) => {
  registerW4Api(api)
  await captureCapabilityRefresh(page)
  let releaseLateOn!: (value: { status: number; json: unknown }) => void
  api.respondWith('GET', '/api/v1/terminals/KSK-001/config', (requestNumber) => {
    if (requestNumber === 1) return { status: 200, json: w4TerminalConfig() }
    if (requestNumber === 2) {
      return new Promise((resolve) => { releaseLateOn = resolve })
    }
    return { status: 200, json: w4TerminalConfig({ smartCampusEnabled: false }) }
  })

  try {
    await page.goto('/smart-campus/service/campus-card')
    await expect(page.getByText('办理指引 · 未接线上办理')).toBeVisible()
    await expect.poll(() => api.requestCount('GET', '/api/v1/terminals/KSK-001/config')).toBe(1)
    await runCapabilityRefresh(page)
    await expect.poll(() => api.requestCount('GET', '/api/v1/terminals/KSK-001/config')).toBe(2)
    await runCapabilityRefresh(page)
    await expect.poll(() => api.requestCount('GET', '/api/v1/terminals/KSK-001/config')).toBe(3)
    await expect(page.locator('[data-capability-state="unavailable"]')).toBeVisible()
    const lateResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/terminals/KSK-001/config' && response.status() === 200,
    )
    releaseLateOn({ status: 200, json: w4TerminalConfig() })
    await lateResponse
    await expect(page.locator('[data-capability-state="unavailable"]')).toBeVisible()
    await expect(page.getByText('办理指引 · 未接线上办理')).toHaveCount(0)
  } finally {
    releaseLateOn?.({ status: 200, json: w4TerminalConfig() })
  }
})

test('/renshi 官方信息不承诺代办 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/renshi')
  await expect(page.getByText(/以官方发布为准/).first()).toBeVisible()
  await expect(page.getByText(/保证到账|免申即享/)).toHaveCount(0)
  await verifyPage(page, errors)
})

// 政策库空 ≠ 页面空。内置办事指引常驻 5 条（其中一条 audiences 含 'general'，
// 任何身份筛选都命中），一旦和库内政策并进同一个列表，政策库为空时页面照样满屏：
// 运营录完 30 条种子政策，打开页面无法判断自己录的到底进没进去。
// 这两条断言钉死「两个分区各自成列、政策库有自己的空态」。
test('/renshi 政策库为空时给出明确空态，内置指引不冒充库内政策 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  api.respond('GET', '/api/v1/policies', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 200, total: 0, totalPages: 1 } },
  })
  await page.goto('/renshi')

  const library = page.locator('[data-policy-section="library"]')
  const builtin = page.locator('[data-policy-section="builtin"]')
  await expect(library).toBeVisible()
  await expect(library.getByText('政策库还没有内容')).toBeVisible()
  await expect(library.locator('.k8-policy-list-item')).toHaveCount(0)
  // 指引本身有真实价值（本机通用办事参考），保留但必须落在自己的分区里。
  await expect(builtin.locator('.k8-policy-list-item')).toHaveCount(5)
  await verifyPage(page, errors)
})

test('/renshi 库内政策与内置指引分区渲染 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api) // fixture: 1 条 kind=policy_guide
  await page.goto('/renshi')

  const library = page.locator('[data-policy-section="library"]')
  const builtin = page.locator('[data-policy-section="builtin"]')
  await expect(library.locator('.k8-policy-list-item')).toHaveCount(1)
  await expect(library.getByText('高校毕业生就业服务指引')).toBeVisible()
  await expect(library.getByText('政策库还没有内容')).toHaveCount(0)
  await expect(builtin.locator('.k8-policy-list-item')).toHaveCount(5)
  await expect(builtin.getByText('高校毕业生就业服务指引')).toHaveCount(0)
  await verifyPage(page, errors)
})

const CTA_WHITELIST = [
  '查看岗位',
  '去来源平台投递',
  '扫码投递',
  '查看招聘会',
  '去来源平台预约',
  '扫码预约',
  '复制来源链接',
] as const

async function assertAppointmentCtaClosedWhitelist(page: Page): Promise<void> {
  const labels = await page.locator('button, a[href], [role="button"]').all()
  for (const el of labels) {
    const aria = (await el.getAttribute('aria-label')) ?? ''
    const text = ((await el.innerText().catch(() => '')) || '').replace(/\s+/g, '')
    const name = (aria || text).trim()
    if (!name || !/投递|预约/.test(name)) continue
    expect(CTA_WHITELIST, `CTA 文案越界：${name}`).toContain(name)
  }
}

test('/job-fairs 列表渲染真实场次并在接口失败时落 error @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerW4Api(api)
  await page.goto('/job-fairs')
  await expect(page.getByTestId('list-state-ready')).toBeVisible()
  await expect(page.getByText('2026 青岛高校毕业生招聘会')).toBeVisible()
  await expect(page.getByText('青岛公共就业服务网').first()).toBeVisible()
  await expect(page.getByText(/外部编号/)).toBeVisible()
  await expect(page.getByRole('button', { name: '扫码预约' }).first()).toBeVisible()
  await assertAppointmentCtaClosedWhitelist(page)
  await assertTapTargetPointerHit(page.getByRole('button', { name: '扫码预约' }).first())
  await assertNoElementCrossesViewport(page)
  await page.screenshot({ path: '../../docs/progress/evidence/qx-job-fairs-2026-09-07/runtime-list-ready.png' })

  api.abort('GET', '/api/v1/job-fairs', 'internetdisconnected')
  await page.reload()
  await expect(page.getByTestId('list-state-error')).toBeVisible()
  await expect(page.getByTestId('list-fallback').getByText('场次名单这次没取到')).toBeVisible()
  await expect(page.getByText(/不显示上一次的缓存场次/)).toBeVisible()
  await page.screenshot({ path: '../../docs/progress/evidence/qx-job-fairs-2026-09-07/runtime-list-error.png' })
  await expect(errors).toEqual([])
})

test('/job-fairs/:id 扫码预约只出二维码且不 POST 简历 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerW4Api(api)
  const posts: Array<{ url: string; body: string }> = []
  page.on('request', (request) => {
    if (request.method() === 'POST') {
      posts.push({ url: request.url(), body: request.postData() ?? '' })
    }
  })
  await page.goto('/job-fairs/fair-001')
  await expect(page.getByTestId('detail-state-detail')).toBeVisible()
  await expect(page.getByText('来源机构')).toBeVisible()
  await expect(page.getByText('ext-fair-001')).toBeVisible()
  const book = page.getByRole('button', { name: /扫码预约|去来源平台预约/ }).first()
  await expect(book).toBeVisible()
  await page.screenshot({ path: '../../docs/progress/evidence/qx-job-fairs-2026-09-07/runtime-detail-detail.png' })
  await book.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('扫码预约')).toBeVisible()
  await page.screenshot({ path: '../../docs/progress/evidence/qx-job-fairs-2026-09-07/runtime-detail-qr.png' })
  const dialogText = await dialog.innerText()
  for (const banned of ['一键投递', '立即投递', '立即报名', '签到成功', '确认签到']) {
    expect(dialogText, `禁用文案：${banned}`).not.toContain(banned)
  }
  await assertAppointmentCtaClosedWhitelist(page)
  for (const post of posts) {
    expect(post.body, '预约类 CTA 不得携带简历标识').not.toMatch(/resumeId|documentId/)
    expect(post.url, '预约类 CTA 不得向招聘会提交简历').not.toMatch(/\/job-fairs\/.+\/(apply|submit|register)/)
  }
  await expect(errors).toEqual([])
})

test('/job-fairs/:id/visit-plan 缺简历落 missing-context；物料空态诚实 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerW4Api(api)
  api.respond('GET', '/api/v1/job-fairs/fair-001/materials', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } },
  })
  await page.goto('/job-fairs/fair-001/visit-plan')
  await expect(page.getByTestId('visit-plan-state-missing-context')).toBeVisible()
  await expect(page.getByText('还没有选')).toBeVisible()
  await expect(page.getByRole('button', { name: '选择本人简历' })).toBeVisible()
  await expect(page.getByRole('button', { name: '去上传简历' })).toBeVisible()
  await page.screenshot({ path: '../../docs/progress/evidence/qx-job-fairs-2026-09-07/runtime-visit-plan-missing-context.png' })

  await page.goto('/job-fairs/fair-001/materials')
  await expect(page.getByTestId('materials-state-empty')).toBeVisible()
  await expect(page.getByTestId('materials-fallback').getByText('这场还没有可下载的物料')).toBeVisible()
  await expect(page.getByText(/不生成一份「参考版」/)).toBeVisible()
  await page.screenshot({ path: '../../docs/progress/evidence/qx-job-fairs-2026-09-07/runtime-materials-empty.png' })
  await expect(errors).toEqual([])
})
