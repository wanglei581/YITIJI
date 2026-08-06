import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { registerW4Api } from '../fixtures/fusion-w4-api'
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
  await expect(page.getByText('青岛合规人力服务机构').first()).toBeVisible()
  await expect(page.getByText('岗位咨询', { exact: true })).toBeVisible()
  await expect(page.getByText(/服务时间以机构公示为准/)).toBeVisible()
  // 不得伪造实时指标
  await expect(page.getByText(/营业中|今日服务|在招岗位|距本机|按直线距离/)).toHaveCount(0)
  // 详情路由真实存在，列表页须有进入详情的可点击元素
  await expect(page.locator('a[href^="/offline-agencies/"], button[aria-label^="查看青岛合规"]')).not.toHaveCount(0)
  await verifyPage(page, errors)
})

test('/offline-agencies/:id 详情页加载机构信息 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/offline-agencies/agency-001')
  await expect(page.getByText('青岛合规人力服务机构').first()).toBeVisible()
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
  await expect(page.getByText('迎新系统')).toBeVisible()
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

test('/renshi 官方信息不承诺代办 @w4', async ({ page, api }) => {
  const errors = runtimeErrors(page); registerW4Api(api)
  await page.goto('/renshi')
  await expect(page.getByText(/以官方发布为准/).first()).toBeVisible()
  await expect(page.getByText(/保证到账|免申即享/)).toHaveCount(0)
  await verifyPage(page, errors)
})
