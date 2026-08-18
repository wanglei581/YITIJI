import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { registerW4Api, w4TerminalConfig } from '../fixtures/fusion-w4-api'
import { assertDialogWithinViewport, assertKioskShellFillsViewport, assertNoHorizontalOverflow } from './assert-layout'

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
  ['/smart-campus/freshman-insights', '校园大数据暂未开放'],
  ['/smart-campus/service/campus-card', '校园卡办理'],
  ['/smart-campus/service/all-in-one', '一卡通开通'],
  ['/smart-campus/service/campus-network', '校园网开通'],
  ['/smart-campus/service/luggage', '行李帮运'],
  ['/smart-campus/service/panorama', 'VR校园'],
] as const

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
  await expect(page.getByText('前端工程师').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /线下机构门店/ })).toBeVisible()
  await page.getByRole('button', { name: '城市 / 行业筛选' }).click()
  const jobFilterDialog = page.getByRole('dialog', { name: '城市与行业筛选' })
  await expect(jobFilterDialog).toBeVisible()
  await assertDialogWithinViewport(page)
  await jobFilterDialog.getByRole('button', { name: '青岛市', exact: true }).click()
  await expect(jobFilterDialog.getByRole('button', { name: '青岛市', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await jobFilterDialog.getByRole('button', { name: '完成' }).click()
  await expect(page.getByRole('button', { name: '城市 / 行业筛选 (1)' })).toBeVisible()
  await verifyPage(page, errors)
})

test('/jobs/:id 只提供来源 CTA @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/jobs/job-001')
  await expect(page.getByText(/信息以来源平台为准/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '扫码投递' })).toBeVisible()
  await expect(page.getByText(/一键投递|立即投递/)).toHaveCount(0)
  await verifyPage(page, errors)
})

// G1 #482: /offline-agencies/:id 已注册为真实路由，列表须提供导航入口
test('/offline-agencies 列表可进入真实详情页 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/offline-agencies')
  const agencyRow = page.getByRole('article', { name: '青岛合规人力服务机构' })
  await expect(agencyRow).toBeVisible()
  await expect(page.getByText('岗位咨询', { exact: true })).toBeVisible()
  await expect(page.getByText(/服务时间以机构公示为准/)).toBeVisible()
  // 不得伪造实时指标
  await expect(page.getByText(/营业中|今日服务|在招岗位|距本机|按直线距离/)).toHaveCount(0)
  // 详情路由真实存在，列表页须能通过真实机构行进入详情。
  await agencyRow.click()
  await expect(page).toHaveURL(/\/offline-agencies\/agency-001$/)
  await verifyPage(page, errors)
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
  await page.getByRole('button', { name: '选择类型 (12)' }).click()
  const companyFilterDialog = page.getByRole('dialog', { name: '企业类型与行业' })
  await expect(companyFilterDialog).toBeVisible()
  await assertDialogWithinViewport(page)
  await companyFilterDialog.getByRole('button', { name: '民营企业', exact: true }).click()
  await companyFilterDialog.getByRole('button', { name: '完成' }).click()
  await expect(page.getByRole('button', { name: '民营企业', exact: true })).toBeVisible()
  await page.goto('/companies/company-001')
  await expect(page.getByText(/来源企业与岗位导览/)).toBeVisible()
  await expect(page.getByText('前端工程师')).toBeVisible()
  await verifyPage(page, errors)
})

test('/job-fairs 预约离开平台且 mock 统计为空 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/job-fairs/fair-001')
  await expect(page.getByRole('button', { name: /扫码预约|去来源平台预约/ }).first()).toBeVisible()
  await page.getByRole('button', { name: '数据大屏' }).click()
  await expect(page.getByText(/暂无真实统计/)).toBeVisible()
  await expect(page.getByText(/签到成功|确认签到/)).toHaveCount(0)
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
  await expect(page.getByText(/校园招聘专区/).first()).toBeVisible()
  await page.goto('/smart-campus/freshman-insights')
  await expect(page.getByText('校园大数据暂未开放')).toBeVisible()
  await expect(page.getByText(/学校书面授权/)).toBeVisible()
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
  await expect(page.getByText('校园大数据暂未开放')).toBeVisible()
})

test('smart-campus 刷新开始即卸载旧页面，失败后保持关闭 @w4', async ({ page, api }) => {
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
    await expect(page.locator('[data-capability-state="loading"]')).toBeVisible()
    await expect(page.getByText('办理指引 · 未接线上办理')).toHaveCount(0)
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
