import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

/**
 * 3.13 招聘内容托管开关 × 管理员招聘类页面（mock 口径）。
 *
 * 托管状态由 mock 适配器读 localStorage['mock:recruitment-hosting']：'off' 我们云上默认关闭，
 * 'on' 私有化部署（b）打开，'error' 模拟读取失败（页面应按关闭处理）。
 * localStorage['mock:recruitment-emergency'] = 'fail' 让下架 / 熔断按服务端「已被紧急下架」拒绝。
 *
 * 断言「某按钮不存在」之前，先等一个两种状态都会出现的元素（行上的「紧急下架」或托管说明），
 * 否则列表还没渲染时计数为 0 会假通过。
 *
 * 设置 CONSOLE_HOSTING_SCREENSHOT_DIR 时把每页的两种状态存成截图；CI 不设，不写文件。
 */
const SHOT_DIR = process.env.CONSOLE_HOSTING_SCREENSHOT_DIR

type HostingMode = 'on' | 'off' | 'error'

async function openAs(page: Page, path: string, mode: HostingMode, extra: Record<string, string> = {}): Promise<void> {
  await page.addInitScript(({ hosting, entries }) => {
    try {
      localStorage.setItem('mock:recruitment-hosting', hosting)
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value)
    } catch {
      /* ignore */
    }
  }, { hosting: mode, entries: extra })
  const guards = await openAuthed(page, path)
  await settleAdminPage(page, guards)
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return
  mkdirSync(SHOT_DIR, { recursive: true })
  // 1280 宽下操作列在表格的横向滚动区里，截图前滚到最右，让「紧急下架」等按钮入镜。
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.overflow-x-auto').forEach((el) => { el.scrollLeft = el.scrollWidth })
  })
  await page.screenshot({ path: join(SHOT_DIR, `admin-${name}.png`), fullPage: true })
}

async function expectAbsent(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    await expect(page.getByRole('button', { name: label, exact: true }), `不应出现「${label}」`).toHaveCount(0)
  }
}

const HOSTING_OFF_NOTICE = '本平台已关闭招聘内容托管'
const REVIEW_PUBLISH = ['审核通过', '拒绝', '发布', '下架', '批量发布']

test.describe('托管关闭（我们云上默认）：只留查看与紧急下架', () => {
  test('岗位信息源：无审核发布；紧急下架要事由与说明，结果按服务端返回展示', async ({ page }) => {
    await openAs(page, '/job-sources', 'off')
    await expect(page.getByText(HOSTING_OFF_NOTICE)).toBeVisible()
    const row = page.getByRole('row', { name: /前端开发工程师/ })
    await expect(row.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
    await expect(row.getByText('已发布')).toBeVisible()
    await expectAbsent(page, REVIEW_PUBLISH)
    await shot(page, 'job-sources-hosting-off')

    await row.getByRole('button', { name: '紧急下架', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '紧急下架岗位' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('这是单向操作，提交后不能撤销')
    await expect(dialog).toContainText('平台没有恢复入口')
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
    await note.fill('权利人投诉，投诉编号 TS-2026-0926')
    await expect(confirm, '只有说明、没有事由时不能提交').toBeDisabled()
    await reason.selectOption('rights_complaint')
    await expect(confirm).toBeEnabled()
    await shot(page, 'takedown-dialog')

    await confirm.click()
    await expect(dialog.getByText('服务端已确认处置')).toBeVisible()
    await expect(dialog).toContainText('已下架')
    await expect(dialog).toContainText('不能恢复（单向下架）')
    await shot(page, 'takedown-result')
    await dialog.getByRole('button', { name: '完成' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(row.getByText('已下架')).toBeVisible()
  })

  test('紧急下架被服务端拒绝时如实报错，不显示成功', async ({ page }) => {
    await openAs(page, '/job-sources', 'off', { 'mock:recruitment-emergency': 'fail' })
    const row = page.getByRole('row', { name: /前端开发工程师/ })
    await row.getByRole('button', { name: '紧急下架', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '紧急下架岗位' })
    await dialog.getByRole('combobox', { name: /事由/ }).selectOption('illegal_content')
    await dialog.getByRole('textbox', { name: /说明/ }).fill('岗位描述含违法表述')
    await dialog.getByRole('button', { name: '确认紧急下架（不可恢复）' }).click()
    await expect(dialog.getByRole('alert')).toContainText('不能再发布')
    await expect(dialog.getByText('服务端已确认处置')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '确认紧急下架（不可恢复）' })).toBeEnabled()
    await shot(page, 'takedown-server-refused')
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(row.getByText('已发布')).toBeVisible()
  })

  test('招聘会信息源：无审核发布，逐条紧急下架', async ({ page }) => {
    await openAs(page, '/fair-sources', 'off')
    await expect(page.getByText(HOSTING_OFF_NOTICE)).toBeVisible()
    const row = page.getByRole('row', { name: /2026年春季大型招聘会/ })
    await expect(row.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
    await expectAbsent(page, REVIEW_PUBLISH)
    await shot(page, 'fair-sources-hosting-off')
    await row.getByRole('button', { name: '紧急下架', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '紧急下架招聘会' })).toBeVisible()
    await page.getByRole('dialog', { name: '紧急下架招聘会' }).getByRole('button', { name: '取消' }).click()
  })

  test('政策信息源：管理员不审核不发布，只有紧急下架', async ({ page }) => {
    await openAs(page, '/policy-sources', 'off')
    await expect(page.getByText('政策由发布机构自己审核、发布')).toBeVisible()
    await expect(page.getByRole('button', { name: '紧急下架', exact: true }).first()).toBeVisible()
    await expectAbsent(page, REVIEW_PUBLISH)
    await shot(page, 'policy-sources-hosting-off')
    await page.getByRole('button', { name: '紧急下架', exact: true }).first().click()
    await expect(page.getByRole('dialog', { name: '紧急下架政策' })).toBeVisible()
  })

  test('招聘会管理：整页只读，基本信息与资料都可紧急下架', async ({ page }) => {
    await openAs(page, '/fairs', 'off')
    await expect(page.getByText(HOSTING_OFF_NOTICE)).toBeVisible()
    await expect(page.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
    await expectAbsent(page, ['编辑基本信息', '新增企业'])
    await shot(page, 'fairs-hosting-off')

    await page.getByRole('button', { name: '展区管理' }).click()
    await expect(page.getByText(/个展区/)).toBeVisible()
    await expectAbsent(page, ['新增展区'])
    await page.getByRole('button', { name: '场馆导览' }).click()
    await expect(page.getByText(/当前只读：场馆导览/)).toBeVisible()
    await expectAbsent(page, ['开始配置', '保存导览配置'])

    await page.getByRole('button', { name: '活动资料' }).click()
    const material = page.getByRole('row', { name: /活动日程/ })
    await expect(material.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
    await expectAbsent(page, ['上传资料', '发布', '下架'])
    await shot(page, 'fairs-materials-hosting-off')
    await material.getByRole('button', { name: '紧急下架', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '紧急下架招聘会资料' })).toBeVisible()
  })

  test('企业展示与线下机构：不新增、不编辑，空态如实说明只读', async ({ page }) => {
    await openAs(page, '/companies', 'off')
    await expect(page.getByText(HOSTING_OFF_NOTICE)).toBeVisible()
    await expect(page.getByText('当前只读：只能查看与紧急下架。')).toBeVisible()
    await expectAbsent(page, ['新增企业'])
    await shot(page, 'companies-hosting-off')

    await openAs(page, '/offline-agencies', 'off')
    await expect(page.getByText(HOSTING_OFF_NOTICE)).toBeVisible()
    await expect(page.getByText('当前只读：只能查看与紧急下架')).toBeVisible()
    await expectAbsent(page, ['新建机构'])
    await shot(page, 'offline-agencies-hosting-off')
  })

  test('Excel 导入记录：导入已停止的说明与处置去向', async ({ page }) => {
    await openAs(page, '/import-batches', 'off')
    await expect(page.getByText(HOSTING_OFF_NOTICE)).toBeVisible()
    await expect(page.getByText(/导入已停止，只读/)).toBeVisible()
    await expect(page.getByText(/本页只保留历史批次/)).toBeVisible()
    await expect(page.getByText(/到「数据接入通道」按来源熔断/)).toBeVisible()
    await shot(page, 'import-batches-hosting-off')
  })

  test('数据接入通道：只有按来源熔断，必须勾选不可撤销', async ({ page }) => {
    await openAs(page, '/sync-sources', 'off')
    await expect(page.getByText(HOSTING_OFF_NOTICE)).toBeVisible()
    const breaker = page.getByRole('button', { name: '按来源熔断', exact: true })
    await expect(breaker).toBeVisible()
    await expectAbsent(page, ['mappings', '审批并启用', '停用通道', '批量下架内容'])
    await expect(page.getByRole('button', { name: /立即同步/ })).toHaveCount(0)
    await shot(page, 'sync-sources-hosting-off')

    await breaker.click()
    const dialog = page.getByRole('dialog', { name: '按来源熔断' })
    await expect(dialog).toContainText('熔断不可撤销，平台没有恢复入口')
    await expect(dialog).toContainText('不是日常批量工具')
    const confirm = dialog.getByRole('button', { name: '确认熔断（不可撤销）' })
    await dialog.getByRole('combobox', { name: /事由/ }).selectOption('authority_order')
    await dialog.getByRole('textbox', { name: /说明/ }).fill('主管部门通知，文号 2026-09-26-01')
    await expect(confirm, '没勾不可撤销确认时不能提交').toBeDisabled()
    await dialog.getByRole('checkbox').check()
    await expect(confirm).toBeEnabled()
    await shot(page, 'circuit-break-source-dialog')
    await confirm.click()
    await expect(dialog.getByText('服务端已确认熔断')).toBeVisible()
    await expect(dialog).toContainText('0 条内容')
    await expect(dialog).toContainText('不能撤销')
    await shot(page, 'circuit-break-source-result')
  })

  test('合作机构详情：按机构熔断；Escape 只关弹窗不关抽屉', async ({ page }) => {
    await openAs(page, '/partners', 'off')
    await page.getByRole('button', { name: '详情/账号' }).first().click()
    const panel = page.getByRole('region', { name: '按机构熔断' })
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '按机构熔断…' }).click()
    const dialog = page.getByRole('dialog', { name: '按机构熔断' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(panel, '抽屉不应被同一次 Escape 关掉').toBeVisible()

    await panel.getByRole('button', { name: '按机构熔断…' }).click()
    await dialog.getByRole('combobox', { name: /事由/ }).selectOption('illegal_content')
    await dialog.getByRole('textbox', { name: /说明/ }).fill('机构批量发布违法内容，紧急处置')
    await expect(dialog.getByRole('button', { name: '确认熔断（不可撤销）' })).toBeDisabled()
    await dialog.getByRole('checkbox').check()
    await shot(page, 'circuit-break-org-dialog')
    await dialog.getByRole('button', { name: '确认熔断（不可撤销）' }).click()
    await expect(dialog.getByText('服务端已确认熔断')).toBeVisible()
  })
})

test.describe('托管状态读不到：按关闭处理并说明', () => {
  test('岗位信息源：写按钮不出现，提示读不到，紧急下架仍可用', async ({ page }) => {
    await openAs(page, '/job-sources', 'error')
    await expect(page.getByText('暂时无法确认招聘内容托管状态')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新读取' })).toBeVisible()
    const row = page.getByRole('row', { name: /前端开发工程师/ })
    await expect(row.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
    await expectAbsent(page, REVIEW_PUBLISH)
    await expect(page.getByText(HOSTING_OFF_NOTICE)).toHaveCount(0)
    await shot(page, 'job-sources-hosting-unknown')
  })
})

test.describe('托管打开（私有化部署 b）：原有控件保留，另加紧急下架', () => {
  test('岗位信息源：审核 / 发布 / 下架 / 批量发布都在，每行另有紧急下架', async ({ page }) => {
    await openAs(page, '/job-sources', 'on')
    await expect(page.getByRole('row', { name: /UI 设计师/ }).getByRole('button', { name: '审核通过', exact: true })).toBeVisible()
    await expect(page.getByRole('row', { name: /行政专员/ }).getByRole('button', { name: '发布', exact: true })).toBeVisible()
    const published = page.getByRole('row', { name: /前端开发工程师/ })
    await expect(published.getByRole('button', { name: '下架', exact: true })).toBeVisible()
    await expect(published.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '批量发布', exact: true })).toBeVisible()
    await expect(page.getByText(HOSTING_OFF_NOTICE)).toHaveCount(0)
    await shot(page, 'job-sources-hosting-on')
  })

  test('招聘会信息源与政策信息源', async ({ page }) => {
    await openAs(page, '/fair-sources', 'on')
    const fair = page.getByRole('row', { name: /2026年春季大型招聘会/ })
    await expect(fair.getByRole('button', { name: '下架', exact: true })).toBeVisible()
    await expect(fair.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '批量发布', exact: true })).toBeVisible()
    await shot(page, 'fair-sources-hosting-on')

    await openAs(page, '/policy-sources', 'on')
    await expect(page.getByRole('button', { name: '紧急下架', exact: true }).first()).toBeVisible()
    await expectAbsent(page, REVIEW_PUBLISH)
    await shot(page, 'policy-sources-hosting-on')
  })

  test('招聘会管理：编辑与各页签写入照旧，另有紧急下架', async ({ page }) => {
    await openAs(page, '/fairs', 'on')
    await expect(page.getByRole('button', { name: '编辑基本信息' })).toBeVisible()
    await expect(page.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '新增企业' })).toBeVisible()
    await shot(page, 'fairs-hosting-on')
    await page.getByRole('button', { name: '活动资料' }).click()
    const material = page.getByRole('row', { name: /活动日程/ })
    await expect(page.getByRole('button', { name: '上传资料' })).toBeVisible()
    await expect(material.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
    await shot(page, 'fairs-materials-hosting-on')
  })

  test('企业展示：新增照旧，新建的企业行上有管理与紧急下架', async ({ page }) => {
    await openAs(page, '/companies', 'on')
    await page.getByRole('button', { name: '新增企业' }).click()
    const orgSelect = page.getByRole('combobox', { name: /来源机构/ }).first()
    await expect(orgSelect).toBeEnabled({ timeout: 10_000 })
    await orgSelect.selectOption({ index: 1 })
    await page.getByRole('textbox', { name: /外部编号/ }).fill('EXT-E2E-HOSTING-001')
    await page.getByRole('textbox', { name: '企业名称*' }).fill('青岛演示科技有限公司')
    await page.getByRole('button', { name: '创建（待审核）' }).click()
    const row = page.getByRole('row', { name: /青岛演示科技有限公司/ })
    await expect(row.getByRole('button', { name: '管理', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await shot(page, 'companies-hosting-on')
    await row.getByRole('button', { name: '紧急下架', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '紧急下架企业资料' })).toBeVisible()
  })

  test('线下机构：新建照旧，行上有编辑 / 审核 / 删除与紧急下架', async ({ page }) => {
    await openAs(page, '/offline-agencies', 'on')
    await page.getByRole('button', { name: '新建机构' }).click()
    await page.getByRole('textbox', { name: '机构名称*', exact: true }).fill('市南区就业服务站（演示）')
    await page.getByRole('textbox', { name: '地址*', exact: true }).fill('青岛市市南区演示路 1 号')
    await page.getByRole('button', { name: '创建' }).click()
    const row = page.getByRole('row', { name: /市南区就业服务站/ })
    await expect(row.getByRole('button', { name: '编辑', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: '审核', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: '紧急下架', exact: true })).toBeVisible()
    await shot(page, 'offline-agencies-hosting-on')
  })

  test('数据接入通道与导入记录', async ({ page }) => {
    await openAs(page, '/sync-sources', 'on')
    await expect(page.getByRole('button', { name: '批量下架内容' })).toBeVisible()
    await expect(page.getByRole('button', { name: /立即同步/ })).toBeVisible()
    await expect(page.getByRole('button', { name: '按来源熔断', exact: true })).toBeVisible()
    await shot(page, 'sync-sources-hosting-on')

    await openAs(page, '/import-batches', 'on')
    await expect(page.getByText(/确认后进入审核队列/)).toBeVisible()
    await expect(page.getByText(HOSTING_OFF_NOTICE)).toHaveCount(0)
    await shot(page, 'import-batches-hosting-on')

    await openAs(page, '/partners', 'on')
    await page.getByRole('button', { name: '详情/账号' }).first().click()
    await expect(page.getByRole('region', { name: '按机构熔断' })).toBeVisible()
    await shot(page, 'partners-drawer-hosting-on')
  })
})
