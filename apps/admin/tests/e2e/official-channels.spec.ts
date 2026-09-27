import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

/**
 * 3.14 合作机构管理 → 机构详情抽屉：「官方域名（入驻核验）」与「官方渠道」（mock 口径）。
 *
 * mock 数据：市人才交流中心(演示) 登记了 rencai-demo.gov.cn、hrss.demo-city.gov.cn，
 * 有两条渠道，其中「线上业务大厅（旧入口）」已被紧急下架；某大学就业指导中心(演示) 没有登记域名、没有渠道。
 * 托管开关读 localStorage['mock:recruitment-hosting']；这两节与托管无关，开或关都一样。
 * localStorage['mock:org-official-channels'] = 'error' 让两节的读取都失败。
 *
 * 设置 OFFICIAL_CHANNELS_SCREENSHOT_DIR 时按 1440×900 存评审截图；CI 不设，不写文件。
 */
const SHOT_DIR = process.env.OFFICIAL_CHANNELS_SCREENSHOT_DIR

const CITY_CENTER = '市人才交流中心(演示)'
const UNIVERSITY = '某大学就业指导中心(演示)'

async function openOrg(
  page: Page,
  orgName: string,
  storage: Record<string, string> = {},
): Promise<{ domains: Locator; channels: Locator }> {
  await page.addInitScript((entries) => {
    try {
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value)
    } catch {
      /* ignore */
    }
  }, { 'mock:recruitment-hosting': 'off', ...storage })
  if (SHOT_DIR) await page.setViewportSize({ width: 1440, height: 900 })
  const guards = await openAuthed(page, '/partners')
  await settleAdminPage(page, guards)
  await page.getByRole('row', { name: new RegExp(orgName.replace(/[()]/g, '\\$&')) }).getByRole('button', { name: '详情/账号' }).click()
  const drawer = page.getByRole('dialog', { name: `机构详情 — ${orgName}` })
  await expect(drawer).toBeVisible()
  return {
    domains: drawer.getByRole('region', { name: '官方域名（入驻核验）' }),
    channels: drawer.getByRole('region', { name: '官方渠道', exact: true }),
  }
}

async function shot(page: Page, name: string, anchor?: Locator): Promise<void> {
  if (!SHOT_DIR) return
  mkdirSync(SHOT_DIR, { recursive: true })
  if (anchor) await anchor.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: join(SHOT_DIR, `admin-${name}.png`) })
}

function channelItem(channels: Locator, name: string): Locator {
  return channels.getByRole('listitem').filter({ hasText: name })
}

test.describe('机构详情：官方域名（入驻核验）', () => {
  test('查看：写明是身份核验不是内容审核，列出登记时间与登记人', async ({ page }) => {
    const { domains } = await openOrg(page, CITY_CENTER)
    await expect(domains).toContainText('依据机构入驻时提交的盖章确认函')
    await expect(domains).toContainText('这是机构身份核验，不是内容审核')
    const list = domains.getByRole('list', { name: '已登记的官方域名' })
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await expect(list.getByRole('listitem').first()).toContainText('rencai-demo.gov.cn')
    await expect(list.getByRole('listitem').first()).toContainText('登记于 2026-09-20 10:30')
    await expect(list.getByRole('listitem').first()).toContainText('登记人 mock-admin-001（管理员账号 ID）')
    await expect(list.getByRole('listitem').nth(1)).toContainText('hrss.demo-city.gov.cn')
    await shot(page, 'domains-view', domains)
  })

  test('编辑：整体替换前先确认新增与移除；服务端确认后才写「已保存」', async ({ page }) => {
    const { domains } = await openOrg(page, CITY_CENTER)
    await domains.getByRole('button', { name: '编辑域名' }).click()
    await expect(domains).toContainText('优先登记本机构自己的子域名')
    await expect(domains).toContainText('hrss.qingdao.gov.cn')
    await expect(domains).toContainText('保存会整体替换现有列表')
    await domains.getByRole('button', { name: '添加一个域名' }).click()
    await domains.getByRole('textbox', { name: '官方域名 3' }).fill('jobs.rencai-demo.gov.cn')
    await domains.getByRole('button', { name: '移除第 2 个域名' }).click()
    await shot(page, 'domains-edit', domains)

    await domains.getByRole('button', { name: '检查并保存' }).click()
    const confirm = domains.getByRole('group', { name: '确认替换官方域名' })
    await expect(confirm).toContainText('将新增jobs.rencai-demo.gov.cn')
    await expect(confirm).toContainText('将移除hrss.demo-city.gov.cn')
    await expect(confirm).toContainText('保持不变rencai-demo.gov.cn')
    await expect(confirm).toContainText('链接落在被移除域名下的官方渠道不再在终端显示')
    await expect(domains.getByText(/^已保存/), '确认之前不能说已保存').toHaveCount(0)
    await shot(page, 'domains-confirm', domains)

    await confirm.getByRole('button', { name: '返回修改' }).click()
    await expect(domains.getByRole('textbox', { name: '官方域名 2' })).toHaveValue('jobs.rencai-demo.gov.cn')
    await domains.getByRole('button', { name: '检查并保存' }).click()
    await domains.getByRole('button', { name: '确认替换' }).click()

    await expect(domains.getByRole('status').filter({ hasText: '已保存' })).toHaveText('已保存：服务端现在登记了 2 个官方域名（新增 1 个，移除 1 个）。')
    const list = domains.getByRole('list', { name: '已登记的官方域名' })
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await expect(list).toContainText('jobs.rencai-demo.gov.cn')
    await expect(list).not.toContainText('hrss.demo-city.gov.cn')
    await expect(list.getByRole('listitem').first(), '保留的域名沿用原登记时间').toContainText('登记于 2026-09-20 10:30')
    await shot(page, 'domains-saved', domains)
  })

  test('录入预检：网址形式、商业招聘网站、空行拦在本地；服务端拒绝的原样显示，不写「已保存」', async ({ page }) => {
    const { domains } = await openOrg(page, CITY_CENTER)
    await domains.getByRole('button', { name: '编辑域名' }).click()
    const save = domains.getByRole('button', { name: '检查并保存' })
    await domains.getByRole('button', { name: '添加一个域名' }).click()
    await expect(domains).toContainText('空行：请填写域名')
    await expect(save).toBeDisabled()
    const third = domains.getByRole('textbox', { name: '官方域名 3' })
    await third.fill('https://jobs.rencai-demo.gov.cn/list')
    await expect(domains).toContainText('只填域名本身，不要带 https:// 或路径（服务端会把网址截成整个注册域')
    await expect(save).toBeDisabled()
    await third.fill('zhipin.com')
    await expect(domains).toContainText('zhipin.com 属于商业招聘网站')
    await expect(save).toBeDisabled()
    await third.fill('gov.cn')
    await expect(save).toBeEnabled()
    await save.click()
    await domains.getByRole('button', { name: '确认替换' }).click()
    await expect(domains.getByRole('alert')).toContainText('没有保存：不是可核验的官方注册域：gov.cn')
    await expect(domains.getByRole('textbox', { name: '官方域名 3' }), '被拒后留在编辑态').toHaveValue('gov.cn')
    await expect(domains.getByText(/^已保存/), '服务端拒绝时不能说已保存').toHaveCount(0)
    await shot(page, 'domains-rejected', domains)

    await domains.getByRole('button', { name: '取消编辑' }).click()
    const items = domains.getByRole('list', { name: '已登记的官方域名' }).getByRole('listitem')
    await expect(items, '被拒的替换没有改动已登记的列表').toHaveCount(2)
    await expect(items.first()).toContainText('rencai-demo.gov.cn')
    await expect(items.nth(1)).toContainText('hrss.demo-city.gov.cn')
  })

  test('没有登记域名的机构：如实说明，官方渠道为空', async ({ page }) => {
    const { domains, channels } = await openOrg(page, UNIVERSITY)
    await expect(domains.getByText('尚未登记官方域名。登记之前，这家机构不能添加官方渠道。')).toBeVisible()
    await expect(domains.getByRole('status', { name: '已登记 0 个' })).toBeVisible()
    await expect(channels.getByText('这家机构还没有添加官方渠道。')).toBeVisible()
    await shot(page, 'no-domains', domains)
  })
})

test.describe('机构详情：官方渠道（只读 + 紧急下架）', () => {
  test('只读列表：没有新增与编辑；已下架的一行写明事由与说明、没有按钮', async ({ page }) => {
    const { channels } = await openOrg(page, CITY_CENTER)
    await expect(channels).toContainText('管理员这里只能查看与紧急下架，不能新增、编辑或恢复')
    await expect(channels).toContainText('官方渠道不属于招聘内容托管，托管开关开或关，这里都一样')
    await expect(channels).toContainText('共 2 条，其中 1 条已紧急下架')

    const live = channelItem(channels, '人才交流中心官网')
    await expect(live.getByRole('status', { name: '机构已启用' })).toBeVisible()
    await expect(live).toContainText('https://www.rencai-demo.gov.cn/')
    await expect(live.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()

    const held = channelItem(channels, '线上业务大厅（旧入口）')
    await expect(held.getByRole('status', { name: '平台已紧急下架' })).toBeVisible()
    await expect(held).toContainText('事由：权利人投诉')
    await expect(held).toContainText('页面冒用第三方机构标识，权利人投诉编号 TS-2026-0921')
    await expect(held.getByRole('button'), '已下架的一行不再有任何操作').toHaveCount(0)

    await expect(channels.getByRole('button', { name: /新增|添加|编辑|恢复/ })).toHaveCount(0)
    await shot(page, 'channels', channels)
  })

  test('紧急下架：事由与说明都必填；服务端确认后这一行变为已下架且不再有按钮', async ({ page }) => {
    const { channels } = await openOrg(page, CITY_CENTER)
    await channelItem(channels, '人才交流中心官网').getByRole('button', { name: '紧急下架', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '紧急下架机构官方渠道' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('「人才交流中心官网」')
    await expect(dialog).toContainText(`所属机构：${CITY_CENTER}`)
    await expect(dialog).toContainText('这是单向操作，提交后不能撤销')
    await expect(dialog).toContainText('二维码会立即从该机构的一体机上撤下并锁定，机构不能再启用它；平台没有恢复入口')
    await expect(dialog).toContainText('系统会自动通知所属机构')

    const reason = dialog.getByRole('combobox', { name: /事由/ })
    const note = dialog.getByRole('textbox', { name: /说明/ })
    const confirm = dialog.getByRole('button', { name: '确认紧急下架（不可恢复）' })
    await expect(confirm).toBeDisabled()
    await reason.selectOption('rights_complaint')
    await expect(confirm, '只有事由、没有说明时不能提交').toBeDisabled()
    await note.fill('   ')
    await expect(confirm, '说明只有空白时不能提交').toBeDisabled()
    await reason.selectOption('')
    await note.fill('官网首页被篡改，挂出与机构无关的收费培训广告')
    await expect(confirm, '只有说明、没有事由时不能提交').toBeDisabled()
    await reason.selectOption('illegal_content')
    await expect(confirm).toBeEnabled()
    await shot(page, 'takedown-dialog')

    await confirm.click()
    await expect(dialog.getByText('服务端已确认处置')).toBeVisible()
    await expect(dialog).toContainText('机构官方渠道（oc-mock-a1）')
    await expect(dialog).toContainText('不能恢复（单向下架）')
    await shot(page, 'takedown-result')
    await dialog.getByRole('button', { name: '完成' }).click()
    await expect(dialog).toHaveCount(0)

    const taken = channelItem(channels, '人才交流中心官网')
    await expect(taken.getByRole('status', { name: '平台已紧急下架' })).toBeVisible()
    await expect(taken).toContainText('事由：违法违规内容')
    await expect(taken).toContainText('官网首页被篡改，挂出与机构无关的收费培训广告')
    await expect(channels.getByRole('button', { name: '紧急下架', exact: true })).toHaveCount(0)
    await expect(channels).toContainText('共 2 条，其中 2 条已紧急下架')
    await shot(page, 'channels-after-takedown', channels)
  })

  test('紧急下架被服务端拒绝时如实报错，这一行不变；Escape 只关弹窗不关抽屉', async ({ page }) => {
    const { channels } = await openOrg(page, CITY_CENTER, { 'mock:recruitment-emergency': 'fail' })
    const live = channelItem(channels, '人才交流中心官网')
    await live.getByRole('button', { name: '紧急下架', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '紧急下架机构官方渠道' })
    await dialog.getByRole('combobox', { name: /事由/ }).selectOption('authority_order')
    await dialog.getByRole('textbox', { name: /说明/ }).fill('主管部门通知，文号 2026-09-27-03')
    await dialog.getByRole('button', { name: '确认紧急下架（不可恢复）' }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(dialog.getByText('服务端已确认处置')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(channels, '抽屉不应被同一次 Escape 关掉').toBeVisible()
    await expect(live.getByRole('status', { name: '机构已启用' })).toBeVisible()
    await expect(live.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
  })
})

test.describe('与招聘内容托管无关', () => {
  for (const hosting of ['off', 'on'] as const) {
    test(`托管${hosting === 'on' ? '打开' : '关闭'}时两节行为一样`, async ({ page }) => {
      const { domains, channels } = await openOrg(page, CITY_CENTER, { 'mock:recruitment-hosting': hosting })
      await expect(domains.getByRole('button', { name: '编辑域名' })).toBeVisible()
      await expect(domains.getByRole('list', { name: '已登记的官方域名' }).getByRole('listitem')).toHaveCount(2)
      await expect(channels.getByRole('button', { name: '紧急下架', exact: true })).toHaveCount(1)
      await expect(channelItem(channels, '线上业务大厅（旧入口）').getByRole('status', { name: '平台已紧急下架' })).toBeVisible()
      await expect(domains).not.toContainText('本平台已关闭招聘内容托管')
      await expect(channels).not.toContainText('本平台已关闭招聘内容托管')
    })
  }

  test('读取失败：两节都写明没读到并给重试，不冒充「未登记」或「没有渠道」', async ({ page }) => {
    const { domains, channels } = await openOrg(page, CITY_CENTER, { 'mock:org-official-channels': 'error' })
    await expect(domains.getByRole('alert')).toContainText('官方域名没有读到：网络连接失败，请检查网络后重试')
    await expect(channels.getByRole('alert')).toContainText('官方渠道没有读到：网络连接失败，请检查网络后重试')
    await expect(domains.getByRole('button', { name: '重试' })).toBeVisible()
    await expect(domains.getByText('尚未登记官方域名')).toHaveCount(0)
    await expect(channels.getByText('还没有添加官方渠道')).toHaveCount(0)
    await expect(domains.getByRole('button', { name: '编辑域名' })).toHaveCount(0)
  })
})
