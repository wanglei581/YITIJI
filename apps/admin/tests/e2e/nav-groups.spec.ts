import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

const MENUS = [
  { label: '工作台', href: '/' },
  { label: '数据大屏', href: '/screen' },
  { label: '合作机构管理', href: '/partners' },
  { label: '设备管理', href: '/devices' },
  { label: '打印扫描运维', href: '/print-scan' },
  { label: '告警与反馈', href: '/alerts' },
  { label: '终端应用与展示', href: '/screensaver' },
  { label: '求职材料库', href: '/job-materials' },
  { label: 'AI服务', href: '/ai-services' },
  { label: '订单与计费', href: '/orders' },
  { label: '会员权益', href: '/member-benefits' },
  { label: '政策信息源', href: '/policy-sources' },
  { label: '招聘紧急下架', href: '/job-sources' },
  { label: '用户管理', href: '/users' },
  { label: '权限管理', href: '/permissions' },
  { label: '文件管理', href: '/files' },
  { label: '法务与数据权利', href: '/legal-docs' },
  { label: '日志审计', href: '/audit' },
] as const

const TAB_GROUPS = [
  {
    menu: '告警与反馈',
    tabs: [
      { path: '/alerts', label: '告警中心' },
      { path: '/member-feedback', label: '意见反馈' },
      { path: '/member-notifications', label: '消息通知' },
    ],
  },
  {
    menu: '终端应用与展示',
    tabs: [
      { path: '/screensaver', label: '宣传屏' },
      { path: '/toolbox', label: '百宝箱' },
      { path: '/smart-campus', label: '智慧校园' },
    ],
  },
  {
    menu: 'AI服务',
    tabs: [
      { path: '/ai-services', label: 'AI服务管理' },
      { path: '/ai-config', label: 'AI大模型' },
    ],
  },
  {
    menu: '订单与计费',
    tabs: [
      { path: '/orders', label: '订单管理' },
      { path: '/billing', label: '计费与对账' },
    ],
  },
  {
    menu: '会员权益',
    tabs: [
      { path: '/member-benefits', label: '会员权益' },
      { path: '/benefit-activities', label: '权益活动' },
    ],
  },
  {
    menu: '招聘紧急下架',
    tabs: [
      { path: '/job-sources', label: '岗位' },
      { path: '/fair-sources', label: '招聘会' },
      { path: '/fairs', label: '招聘会详情' },
      { path: '/companies', label: '企业' },
      { path: '/sync-sources', label: '接入通道' },
    ],
  },
  {
    menu: '法务与数据权利',
    tabs: [
      { path: '/legal-docs', label: '法务文档版本' },
      { path: '/privacy-requests', label: '数据权利工单' },
    ],
  },
  {
    menu: '日志审计',
    tabs: [
      { path: '/audit', label: '日志审计' },
      { path: '/import-batches', label: 'Excel 导入记录' },
    ],
  },
] as const

test('侧栏恰好 18 个菜单，名字和顺序与合并方案一致', async ({ page }) => {
  const guards = await openAuthed(page, '/')
  await settleAdminPage(page, guards)
  const links = page.getByRole('navigation', { name: '侧边导航' }).getByRole('link')
  await expect(links).toHaveCount(MENUS.length)
  const seen = await links.evaluateAll((els) => els.map((el) => ({
    label: (el.textContent ?? '').replace(/\s+/g, ''),
    href: el.getAttribute('href'),
  })))
  expect(seen).toEqual(MENUS.map((item) => ({ label: item.label, href: item.href })))
})

test('点合并菜单落到该组第一个地址', async ({ page }) => {
  const guards = await openAuthed(page, '/partners')
  await settleAdminPage(page, guards)
  await page.getByRole('navigation', { name: '侧边导航' }).getByRole('link', { name: '订单与计费', exact: true }).click()
  await expect(page).toHaveURL(/\/orders$/)
  const strip = page.getByRole('navigation', { name: '订单与计费' })
  await expect(strip.getByRole('link', { name: '订单管理', exact: true })).toHaveAttribute('aria-current', 'page')
})

for (const group of TAB_GROUPS) {
  test(`${group.menu}：组内每个地址都有标签条，当前页和侧栏一起高亮`, async ({ page }) => {
    for (const tab of group.tabs) {
      const guards = await openAuthed(page, tab.path)
      await settleAdminPage(page, guards)
      const strip = page.getByRole('navigation', { name: group.menu })
      await expect(strip).toBeVisible()
      await expect(strip.getByRole('link', { name: tab.label, exact: true })).toHaveAttribute('aria-current', 'page')
      const side = page.getByRole('navigation', { name: '侧边导航' }).getByRole('link', { name: group.menu, exact: true })
      await expect(side).toHaveAttribute('aria-current', 'page')
    }
    const guards = await openAuthed(page, group.tabs[0].path)
    await settleAdminPage(page, guards)
    const strip = page.getByRole('navigation', { name: group.menu })
    await strip.getByRole('link', { name: group.tabs[1].label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${group.tabs[1].path}$`))
    await expect(strip.getByRole('link', { name: group.tabs[1].label, exact: true })).toHaveAttribute('aria-current', 'page')
  })
}

test('账号设置、合作机构和大屏政务页不出现标签条', async ({ page }) => {
  for (const path of ['/account-settings', '/partners', '/screen/gov']) {
    const guards = await openAuthed(page, path)
    await settleAdminPage(page, guards)
    for (const group of TAB_GROUPS) {
      await expect(page.getByRole('navigation', { name: group.menu })).toHaveCount(0)
    }
  }
})

test('390 宽下标签条不撑出页面横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  const guards = await openAuthed(page, '/job-sources')
  await settleAdminPage(page, guards)
  await expect(page.getByRole('navigation', { name: '招聘紧急下架' })).toBeVisible()
  const fit = await page.evaluate(() => {
    const root = document.documentElement
    const main = document.querySelector('main')
    return {
      pageFits: root.scrollWidth <= root.clientWidth,
      mainFits: !main || main.scrollWidth <= main.clientWidth,
    }
  })
  expect(fit.pageFits).toBe(true)
  expect(fit.mainFits).toBe(true)
})
