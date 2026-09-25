import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import {
  assertPageHonest,
  collectPageFaults,
  gotoPartner,
  injectPartnerAuth,
  waitForMockList,
} from './helpers'

/**
 * 3.13 招聘内容托管开关 × 机构后台（mock 口径）。
 *
 * mock 能力接口读 localStorage['mock:recruitment-hosting']：'off' 我们云上默认关闭，其余按打开；
 * 处置通知读 localStorage['mock:org-notices']：'truncated' 截断态、'empty' 空态。
 * 设置 CONSOLE_HOSTING_SCREENSHOT_DIR 时把每页的两种状态存成截图；CI 不设，不写文件。
 */
const SHOT_DIR = process.env.CONSOLE_HOSTING_SCREENSHOT_DIR

const RECRUITMENT_NAV = ['岗位信息管理', '企业资料管理', '招聘会信息管理', '数据源管理', '同步日志']

const HOSTED_ROUTES: Array<{ path: string; title: string }> = [
  { path: '/jobs', title: '岗位信息管理' },
  { path: '/companies', title: '企业资料管理' },
  { path: '/fairs', title: '招聘会信息管理' },
  { path: '/sources', title: '数据源管理' },
  { path: '/sync-logs', title: '同步日志' },
]

async function loginWith(page: Page, storage: Record<string, string>): Promise<void> {
  await injectPartnerAuth(page)
  await page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value)
  }, storage)
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: join(SHOT_DIR, `partner-${name}.png`), fullPage: true })
}

function sideNav(page: Page) {
  return page.getByRole('navigation', { name: '侧边导航' })
}

test.describe('托管关闭（我们云上默认）', () => {
  test.beforeEach(async ({ page }) => {
    await loginWith(page, { 'mock:recruitment-hosting': 'off' })
  })

  test('侧栏隐藏岗位 / 企业 / 招聘会 / 数据源 / 同步日志，政策归到「内容管理」', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/', '工作台')
    await waitForMockList(page)
    const nav = sideNav(page)
    await expect(nav.getByRole('link', { name: '政策公告管理' })).toBeVisible()
    await expect(nav.getByText('内容管理', { exact: true })).toBeVisible()
    for (const label of RECRUITMENT_NAV) {
      await expect(nav.getByRole('link', { name: label }), `托管关闭时侧栏不应有「${label}」`).toHaveCount(0)
    }
    await assertPageHonest(page, errors)
  })

  for (const route of HOSTED_ROUTES) {
    test(`直接打开 ${route.path}：页头照常，给出如实说明而不是报错页`, async ({ page }) => {
      const { errors } = collectPageFaults(page)
      await gotoPartner(page, route.path, route.title)
      const state = page.getByRole('status', { name: '本平台未开放此功能' })
      await expect(state).toBeVisible()
      await expect(state).toContainText('本平台已关闭岗位、招聘会与企业资料的托管')
      await expect(state).toContainText('这不是故障')
      await expect(page.getByRole('table')).toHaveCount(0)
      await expect(page.getByText('加载失败')).toHaveCount(0)
      if (route.path === '/jobs') await shot(page, 'jobs-direct-url-hosting-off')
      await state.getByRole('button', { name: '去政策公告管理' }).click()
      await page.waitForURL(/\/policy$/)
      await expect(page.getByRole('heading', { level: 1, name: '政策公告' })).toBeVisible()
      await assertPageHonest(page, errors)
    })
  }

  test('工作台：只留政策指标与平台处置通知，不展示岗位类卡片与同步记录', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/', '工作台')
    await waitForMockList(page)
    const overview = page.getByRole('region', { name: '数据概览' })
    await expect(overview.getByText('政策公告', { exact: true })).toBeVisible()
    await expect(overview.getByText('待审核政策', { exact: true })).toBeVisible()
    for (const label of ['已上传岗位', '已上传招聘会', '已发布数据', '数据源']) {
      await expect(overview.getByText(label, { exact: true })).toHaveCount(0)
    }
    await expect(page.getByRole('heading', { name: '最近同步记录' })).toHaveCount(0)
    const notices = page.getByRole('region', { name: '平台处置通知' })
    await expect(notices.getByText('政策已紧急下架')).toBeVisible()
    await expect(notices.getByText('岗位已紧急下架')).toBeVisible()
    await expect(notices.getByText('权利人投诉', { exact: true }).first()).toBeVisible()
    // 本机构内容可信未生效（mock 为 pending）：横幅只提政策、并说明政策由本机构发布
    await expect(page.getByText(/政策由本机构自行审核发布，发布前要先通过核验/)).toBeVisible()
    await shot(page, 'dashboard-hosting-off')
    await assertPageHonest(page, errors)
  })

  test('数据统计：去掉在架岗位 / 招聘会 / 企业 / 数据源与同步概况', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/stats', '数据统计')
    await waitForMockList(page)
    await expect(page.getByText('在架政策')).toBeVisible()
    for (const label of ['在架岗位', '在架招聘会', '在架企业', '启用数据源']) {
      await expect(page.getByText(label, { exact: true }), `托管关闭时不应展示「${label}」`).toHaveCount(0)
    }
    await expect(page.getByRole('heading', { name: '同步概况' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: '统计周期' })).toHaveCount(0)
    await expect(page.getByText('暂无归因数据')).toBeVisible()
    await shot(page, 'stats-hosting-off')
    await assertPageHonest(page, errors)
  })

  test('政策：审核通过 → 确认发布责任并发布，发布责任写明机构与内容版本', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/policy', '政策公告')
    await waitForMockList(page)
    const row = page.getByRole('row', { name: /就业见习岗位补贴申领/ })
    await expect(row.getByText('待审核')).toBeVisible()
    await expect(row.getByRole('button', { name: '发布', exact: true })).toHaveCount(0)
    await row.getByRole('button', { name: '审核通过' }).click()
    await expect(page.getByText(/已审核通过。发布前还需确认发布责任/)).toBeVisible()

    await row.getByRole('button', { name: '发布', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '发布政策' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('发布机构')
    await expect(dialog).toContainText('测试机构')
    await expect(dialog).toContainText('内容版本')
    await expect(dialog).toContainText('v1')
    const ack = dialog.getByRole('checkbox', { name: /我代表「测试机构」确认/ })
    await expect(ack).toBeVisible()
    await expect(ack).not.toBeChecked()
    const confirm = dialog.getByRole('button', { name: '确认发布' })
    await expect(confirm, '没勾发布责任确认时不能发布').toBeDisabled()
    await ack.check()
    await expect(confirm).toBeEnabled()
    await shot(page, 'policy-release-dialog')
    await confirm.click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText(/已发布\(v1\),发布责任确认已记录/)).toBeVisible()
    await expect(row.getByText('已发布')).toBeVisible()
    await expect(row.getByText(/已由本机构确认发布 v1/)).toBeVisible()
    await shot(page, 'policy-after-release')
    await assertPageHonest(page, errors)
  })

  test('政策：修改已发布的政策会生成新版本并回到待审核，页面说清楚', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/policy', '政策公告')
    await waitForMockList(page)
    const row = page.getByRole('row', { name: /关于就业服务月活动的通知/ })
    await expect(row.getByText('内容版本 v1')).toBeVisible()
    await row.getByRole('button', { name: '编辑' }).click()
    const drawer = page.getByRole('dialog', { name: '编辑政策内容' })
    await expect(drawer).toContainText('这条政策已发布(v1)')
    await expect(drawer).toContainText('保存修改会生成新的内容版本,并立即从终端撤下、回到待审核')
    await shot(page, 'policy-edit-published-warning')
    await drawer.getByRole('button', { name: '保存并重新提审' }).click()
    await expect(page.getByText(/修改已保存,内容版本更新为 v2/)).toBeVisible()
    await expect(row.getByText('内容版本 v2')).toBeVisible()
    await expect(row.getByText('待审核')).toBeVisible()
    await expect(row.getByRole('button', { name: '审核通过' })).toBeVisible()
    await assertPageHonest(page, errors)
  })

  test('平台处置通知：服务端截断时写出总数；空时如实说没有', async ({ page }) => {
    await page.evaluate(() => window.localStorage.setItem('mock:org-notices', 'truncated'))
    await gotoPartner(page, '/', '工作台')
    await waitForMockList(page)
    const notices = page.getByRole('region', { name: '平台处置通知' })
    await expect(notices.getByText(/共\s*57\s*条处置通知，这里只显示最新 2 条/)).toBeVisible()
    await shot(page, 'org-notices-truncated')

    await page.evaluate(() => window.localStorage.setItem('mock:org-notices', 'empty'))
    await gotoPartner(page, '/', '工作台')
    await waitForMockList(page)
    await expect(page.getByRole('region', { name: '平台处置通知' }).getByText('暂无平台处置通知')).toBeVisible()
  })
})

test.describe('托管打开（私有化部署 b）', () => {
  test.beforeEach(async ({ page }) => {
    await loginWith(page, { 'mock:recruitment-hosting': 'on' })
  })

  test('侧栏与各招聘页照旧；工作台有岗位类指标、同步记录与平台处置通知', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/', '工作台')
    await waitForMockList(page)
    const nav = sideNav(page)
    for (const label of RECRUITMENT_NAV) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible()
    }
    await expect(page.getByText('已上传岗位')).toBeVisible()
    await expect(page.getByRole('heading', { name: '最近同步记录' })).toBeVisible()
    await expect(page.getByRole('region', { name: '平台处置通知' })).toBeVisible()
    await shot(page, 'dashboard-hosting-on')

    await gotoPartner(page, '/jobs', '岗位信息管理')
    await waitForMockList(page)
    await expect(page.getByRole('status', { name: '本平台未开放此功能' })).toHaveCount(0)
    await shot(page, 'jobs-hosting-on')

    await gotoPartner(page, '/stats', '数据统计')
    await waitForMockList(page)
    await expect(page.getByText('在架岗位')).toBeVisible()
    await expect(page.getByRole('heading', { name: '同步概况' })).toBeVisible()
    await shot(page, 'stats-hosting-on')

    await gotoPartner(page, '/policy', '政策公告')
    await waitForMockList(page)
    await expect(page.getByRole('row', { name: /就业见习岗位补贴申领/ }).getByRole('button', { name: '审核通过' })).toBeVisible()
    await shot(page, 'policy-hosting-on')
    await assertPageHonest(page, errors)
  })
})
