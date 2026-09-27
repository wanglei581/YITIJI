import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { assertPageHonest, collectPageFaults, gotoPartner, injectPartnerAuth } from './helpers'

/**
 * 3.14 本机构官方渠道 —— 机构资料页里的一节（mock 口径）。
 *
 * mock 数据：已登记官方域名 demo-university.edu.cn、career-demo.cn；两条渠道，
 * 其中「就业指导中心旧版网站」已被平台紧急下架。mock 复刻服务端的链接校验与中文原因。
 * localStorage['mock:official-channels']：'no-domains' 未登记域名；'empty' 有域名没渠道；
 * 'error' 读取失败；'loading' 一直读取中。
 *
 * 设置 OFFICIAL_CHANNELS_SCREENSHOT_DIR 时按 1440×900 存评审截图；CI 不设，不写文件。
 */
const SHOT_DIR = process.env.OFFICIAL_CHANNELS_SCREENSHOT_DIR

const OFF_DOMAIN_REASON = '链接或跳转目标不在该机构已核验的官方域名内'

async function openProfile(page: Page, variant?: string): Promise<{ section: Locator; errors: string[] }> {
  if (variant) {
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('mock:official-channels', value)
      } catch {
        /* ignore */
      }
    }, variant)
  }
  if (SHOT_DIR) await page.setViewportSize({ width: 1440, height: 900 })
  const { errors } = collectPageFaults(page)
  await injectPartnerAuth(page)
  await gotoPartner(page, '/profile', '机构资料')
  const section = page.getByRole('region', { name: '本机构官方渠道' })
  await expect(section).toBeVisible()
  return { section, errors }
}

async function shot(page: Page, name: string, anchor?: Locator): Promise<void> {
  if (!SHOT_DIR) return
  mkdirSync(SHOT_DIR, { recursive: true })
  if (anchor) await anchor.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: join(SHOT_DIR, `partner-${name}.png`) })
}

function channelRow(section: Locator, name: string): Locator {
  return section.getByRole('row', { name: new RegExp(name) })
}

test.describe('本机构官方渠道（机构资料页，mock 口径）', () => {
  test('列表：域名只读；正常渠道可启停与编辑；平台已紧急下架的一行冻结，只剩归档', async ({ page }) => {
    const { section, errors } = await openProfile(page)
    await expect(section).toContainText('这里维护的二维码只出现在本机构自己的一体机终端上，用户扫码后打开本机构的官方网站或官方账号。')
    await expect(section).toContainText('对应一体机「本机构官方渠道」页')

    const domains = section.getByRole('list', { name: '可用官方域名' })
    await expect(domains.getByRole('listitem')).toHaveText(['demo-university.edu.cn', 'career-demo.cn'])
    await expect(section).toContainText('机构端只读')
    await expect(section.getByRole('button', { name: '添加渠道' })).toBeEnabled()

    const live = channelRow(section, '学校就业信息网')
    await expect(live).toContainText('https://career.demo-university.edu.cn/')
    await expect(live.getByRole('switch', { name: '启用「学校就业信息网」' })).toHaveAttribute('aria-checked', 'true')
    await expect(live.getByRole('button', { name: '编辑', exact: true })).toBeVisible()
    await expect(live.getByRole('button', { name: '归档', exact: true })).toBeVisible()

    const held = channelRow(section, '就业指导中心旧版网站')
    await expect(held.getByRole('status', { name: '平台已紧急下架' })).toBeVisible()
    await expect(held).toContainText('事由：虚假或误导信息')
    await expect(held).toContainText('页面上的招聘会时间与主办方公告不一致，投诉编号 TS-2026-0927')
    await expect(held).toContainText('已冻结：不能再启用或修改，只能归档')
    await expect(held.getByRole('switch'), '已下架的一行不能再启停').toHaveCount(0)
    await expect(held.getByRole('button', { name: '编辑', exact: true }), '已下架的一行不能编辑').toHaveCount(0)
    await expect(held.getByRole('button', { name: '归档', exact: true })).toBeVisible()
    await shot(page, 'list', section)
    await assertPageHonest(page, errors)
  })

  test('添加被拒：链接不在已登记域名内，预检先提示，服务端拒绝后原样显示原因，不显示已保存', async ({ page }) => {
    const { section, errors } = await openProfile(page)
    await section.getByRole('button', { name: '添加渠道' }).click()
    const dialog = page.getByRole('dialog', { name: '添加官方渠道' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('域名必须是已登记的官方域名或它的子域名：demo-university.edu.cn、career-demo.cn')

    await dialog.getByPlaceholder('例如：学校就业信息网').fill('其他网站')
    const url = dialog.getByPlaceholder('https://')
    const hint = dialog.getByTestId('channel-url-hint')

    await url.fill('http://career.demo-university.edu.cn/')
    await expect(hint).toContainText('只能保存 https:// 开头的链接')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog.getByRole('alert')).toContainText('链接必须是不带账号的 https 地址')

    await url.fill('https://career.demo-university.edu.cn/go?target=https://jobs.other-site.cn/')
    await expect(hint).toContainText('跳转参数指向 jobs.other-site.cn')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog.getByRole('alert')).toContainText(OFF_DOMAIN_REASON)

    await url.fill('https://www.other-site.cn/jobs')
    await expect(hint).toContainText('www.other-site.cn 不在已登记的官方域名')
    await shot(page, 'dialog-off-domain-hint')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog.getByRole('alert')).toContainText(`没有保存：${OFF_DOMAIN_REASON}`)
    await expect(dialog, '被拒后弹窗不关').toBeVisible()
    await expect(dialog.getByRole('button', { name: '保存' })).toBeEnabled()
    await expect(section.getByText(/^已保存/), '服务端没确认就不能说已保存').toHaveCount(0)
    await shot(page, 'dialog-rejected')

    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(section.getByRole('row')).toHaveCount(3)
    await expect(section.getByText('其他网站')).toHaveCount(0)
    await assertPageHonest(page, errors)
  })

  test('添加成功：服务端返回后才关弹窗、写「已保存」，新渠道按排序进列表', async ({ page }) => {
    const { section, errors } = await openProfile(page)
    await section.getByRole('button', { name: '添加渠道' }).click()
    const dialog = page.getByRole('dialog', { name: '添加官方渠道' })
    await dialog.getByPlaceholder('例如：学校就业信息网').fill('毕业生就业服务站')
    await dialog.getByPlaceholder('https://').fill('https://jobs.career-demo.cn/service')
    await expect(dialog.getByTestId('channel-url-hint')).toContainText('jobs.career-demo.cn 属于已登记的官方域名 career-demo.cn')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(section.getByRole('status').filter({ hasText: '已保存「毕业生就业服务站」' })).toBeVisible()
    const added = channelRow(section, '毕业生就业服务站')
    await expect(added).toContainText('https://jobs.career-demo.cn/service')
    await expect(added.getByRole('switch', { name: '启用「毕业生就业服务站」' })).toHaveAttribute('aria-checked', 'true')
    await expect(section.getByRole('row').nth(3)).toContainText('毕业生就业服务站')
    await shot(page, 'saved', section)
    await assertPageHonest(page, errors)
  })

  test('编辑：只提交改过的字段；没改动时不能保存', async ({ page }) => {
    const { section, errors } = await openProfile(page)
    await channelRow(section, '学校就业信息网').getByRole('button', { name: '编辑', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑官方渠道' })
    await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled()
    await expect(dialog).toContainText('还没有改动')
    await dialog.getByPlaceholder('例如：学校就业信息网').fill('学校就业信息网（新版）')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(section.getByRole('status').filter({ hasText: '已保存「学校就业信息网（新版）」' })).toBeVisible()
    await expect(channelRow(section, '学校就业信息网（新版）')).toContainText('https://career.demo-university.edu.cn/')
    await assertPageHonest(page, errors)
  })

  test('启停：每次以服务端返回为准，结果写在列表上方', async ({ page }) => {
    const { section, errors } = await openProfile(page)
    const toggle = channelRow(section, '学校就业信息网').getByRole('switch', { name: '启用「学校就业信息网」' })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(toggle).toContainText('已停用')
    await expect(section.getByRole('status').filter({ hasText: '已停用「学校就业信息网」' })).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(section.getByRole('status').filter({ hasText: '已启用「学校就业信息网」' })).toBeVisible()
    await assertPageHonest(page, errors)
  })

  test('归档：先确认；取消不改数据；确认后从列表移除，已下架的一行同样可以归档', async ({ page }) => {
    const { section, errors } = await openProfile(page)
    await channelRow(section, '学校就业信息网').getByRole('button', { name: '归档', exact: true }).click()
    const confirm = page.getByRole('alertdialog', { name: '归档「学校就业信息网」？' })
    await expect(confirm).toContainText('本机构终端上不再显示它的二维码')
    await shot(page, 'archive-confirm')
    await confirm.getByRole('button', { name: '取消' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(channelRow(section, '学校就业信息网')).toBeVisible()

    await channelRow(section, '学校就业信息网').getByRole('button', { name: '归档', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '确认归档' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(section.getByRole('status').filter({ hasText: '已归档「学校就业信息网」' })).toBeVisible()
    await expect(channelRow(section, '学校就业信息网')).toHaveCount(0)

    await channelRow(section, '就业指导中心旧版网站').getByRole('button', { name: '归档', exact: true }).click()
    const heldConfirm = page.getByRole('alertdialog', { name: '归档「就业指导中心旧版网站」？' })
    await expect(heldConfirm).toContainText('归档不会撤销那条下架记录')
    await heldConfirm.getByRole('button', { name: '确认归档' }).click()
    await expect(section.getByText('还没有添加官方渠道')).toBeVisible()
    await assertPageHonest(page, errors)
  })

  test('未登记官方域名：如实说明并关掉「添加渠道」', async ({ page }) => {
    const { section, errors } = await openProfile(page, 'no-domains')
    await expect(section.getByText('尚未登记官方域名，请联系平台完成入驻核验')).toBeVisible()
    await expect(section.getByRole('button', { name: '添加渠道' })).toBeDisabled()
    await expect(section.getByText('还没有添加官方渠道')).toBeVisible()
    await expect(section.getByRole('list', { name: '可用官方域名' })).toHaveCount(0)
    await shot(page, 'no-domains', section)
    await assertPageHonest(page, errors)
  })

  test('有域名、还没有渠道：空态给出下一步', async ({ page }) => {
    const { section, errors } = await openProfile(page, 'empty')
    await expect(section.getByText('还没有添加官方渠道')).toBeVisible()
    await expect(section.getByText('点右上角「添加渠道」')).toBeVisible()
    await expect(section.getByRole('button', { name: '添加渠道' })).toBeEnabled()
    await shot(page, 'empty', section)
    await assertPageHonest(page, errors)
  })

  test('读取失败：写明没读到并给重试，不冒充空列表、不开放添加', async ({ page }) => {
    const { section, errors } = await openProfile(page, 'error')
    await expect(section.getByText('官方渠道没有读到')).toBeVisible()
    await expect(section).toContainText('网络连接失败，请检查网络后重试')
    await expect(section.getByRole('button', { name: '重试' })).toBeVisible()
    await expect(section.getByText('还没有添加官方渠道')).toHaveCount(0)
    await expect(section.getByRole('button', { name: '添加渠道' })).toBeDisabled()
    await shot(page, 'error', section)
    await assertPageHonest(page, errors)
  })

  test('读取中：只显示读取状态，不开放添加', async ({ page }) => {
    const { section } = await openProfile(page, 'loading')
    await expect(section.getByText('正在读取本机构官方渠道…')).toBeVisible()
    await expect(section.getByRole('button', { name: '添加渠道' })).toBeDisabled()
    await shot(page, 'loading', section)
  })
})
