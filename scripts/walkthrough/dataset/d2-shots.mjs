// 收尾截图：管理员四页，每个机构的首页和数据统计。
import { ORGS } from './d2-catalog.mjs'
import { openAdmin, openPartner } from './d2-lib.mjs'
import { accountOf, loadPartnerSecrets } from './d2-secrets.mjs'

async function shotPage(h, page, { nav, path, heading, slug, note }) {
  if (nav) await h.clickNav(nav, path)
  else await h.goto(path)
  await page.getByRole('heading', { name: heading }).waitFor({ timeout: 15000 })
  await page.waitForFunction(() => !/加载中|正在加载/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {})
  await h.pause(500)
  const shot = await h.shot(slug)
  await h.log({ action: '收尾截图', input: heading, result: note, screenshot: shot })
}

export async function finalShots() {
  const admin = await openAdmin()
  try {
    const { page, h } = admin
    await shotPage(h, page, { path: '/', heading: '工作台', slug: 'final-admin-home', note: '管理员工作台' })
    await h.clickNav('合作机构管理', '/partners')
    await page.getByRole('heading', { name: '合作机构管理' }).waitFor({ timeout: 15000 })
    await page.getByPlaceholder('搜索机构名称、联系人...').fill('示例·')
    const pageSize = page.locator('select').filter({ hasText: '100' }).last()
    if (await pageSize.count()) await pageSize.selectOption('100').catch(() => {})
    await h.pause(600)
    const partners = await h.shot('final-admin-partners')
    await h.log({ action: '收尾截图', input: '合作机构列表', result: '筛选示例·', screenshot: partners })

    await h.clickNav('设备管理', '/devices?tab=terminals')
    await page.getByRole('heading', { name: '设备管理' }).waitFor({ timeout: 15000 })
    const tab = page.getByRole('button', { name: '终端', exact: true })
    if (await tab.count()) await tab.click()
    await page.getByRole('button', { name: '预创建设备' }).waitFor({ timeout: 20000 })
    await page.waitForFunction(() => !document.querySelector('tbody .animate-pulse'), null, { timeout: 20000 }).catch(() => {})
    await page.getByPlaceholder('搜索编号、设备名、MAC、位置、IP...').fill('WALK-00')
    await page.getByText('WALK-004').waitFor({ timeout: 15000 })
    await h.pause(400)
    const terminals = await h.shot('final-admin-terminals')
    await h.log({ action: '收尾截图', input: '终端列表', result: '筛选 WALK-00', screenshot: terminals })

    await shotPage(h, page, { nav: '政策信息源', path: '/policy-sources', heading: '政策信息源', slug: 'final-admin-policies', note: '含已发布与紧急下架' })
  } finally {
    await admin.close()
  }

  const secrets = loadPartnerSecrets()
  for (const org of ORGS) {
    const session = await openPartner(accountOf(secrets, org.key))
    try {
      await shotPage(session.h, session.page, { nav: '工作台', path: '/', heading: '工作台', slug: `final-partner-home-${org.key}`, note: org.name })
      await shotPage(session.h, session.page, { nav: '数据统计', path: '/stats', heading: '数据统计', slug: `final-partner-stats-${org.key}`, note: org.name })
    } finally {
      await session.close()
    }
  }
}
