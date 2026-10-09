import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('订单管理（mock 口径：有页数单与未记录页数单）', () => {
  test('筛选、打开详情、取消收款与退款入口', async ({ page }) => {
    const guards = await openAuthed(page, '/orders')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible()

    await page.getByRole('button', { name: '已完成' }).click()
    await expect(page.getByRole('button', { name: '查看订单 ORD-20260625-MOCKREAD', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '全部' }).first().click()

    await page.getByRole('button', { name: '查看订单 ORD-20260625-MOCKREAD', exact: true }).click()
    await expect(page.getByRole('heading', { name: '订单详情 · ORD-20260625-MOCKREAD' })).toBeVisible()
    await expect(page.getByText('取件码过期时间', { exact: true })).toBeVisible()
    await expect(page.getByText('创建时间', { exact: true })).toBeVisible()
    await expect(page.getByText('失败原因', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '确认收款' }).click()
    await expect(page.getByText('确认已在线下收到现金？')).toBeVisible()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByText('确认已在线下收到现金？')).toHaveCount(0)
    await expect(page.getByRole('status', { name: '未支付' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible()
  })

  // M-2（2026-09-18）：待退款入口不得把 payStatus 钉死在「已支付」。
  //
  // 服务端 refundRequired=true 覆盖两类单，其中「渠道已收款但订单未转 paid」
  // 的 payStatus 是 closed/unpaid/paying。旧写法点一下 chip 会连带
  // setPayStatus('paid')，后端只查得到另一类。
  //
  // 这一条不读源码，读的是**点击之后界面上的既成事实**：支付状态那一排里
  // 高亮的必须是「全部支付状态」而不是「已支付」——那正是 payStatus 被清空的
  // 可观察后果。（mock 口径下没有待退款单，因此只断言筛选可达与状态正确，
  // 不断言结果集。）
  test('待退款入口可达，且不会连带选中「已支付」', async ({ page }) => {
    const guards = await openAuthed(page, '/orders')
    await settleAdminPage(page, guards)

    const pendingRefund = page.getByRole('button', { name: '待退款（已收款未出纸）' })
    await expect(pendingRefund).toBeVisible()

    // 触控/点击目标可达：chip 高度与文案都不得被裁切。
    const box = await pendingRefund.boundingBox()
    expect(box, '待退款 chip 没有可点击的盒模型').not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(28)
    const overflow = await pendingRefund.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    )
    expect(overflow, '待退款 chip 文案溢出被裁切').toBeLessThanOrEqual(1)

    await pendingRefund.click()

    const activeClass = /bg-primary-600/
    await expect(pendingRefund).toHaveClass(activeClass)
    await expect(page.getByRole('button', { name: '已支付', exact: true })).not.toHaveClass(activeClass)
    await expect(page.getByRole('button', { name: '全部支付状态' })).toHaveClass(activeClass)

    // 点完仍是正常列表页：无未捕获异常、无英文技术串。
    await settleAdminPage(page, guards)
  })

  // API-20b（2026-09-18）：需运营关注 = 服务端 opsAttention 三支 OR。
  //
  // 与上面待退款 chip 同一类坑，只对一支换了个名字：channel_accepted_unconfirmed
  // 的 payStatus 是 paying/closed 而不是 paid（渠道收了钱、本地没转成已支付）。
  // chip 必须清空 payStatus 与任务状态，否则那最该被看见的一类会被静默挡在
  // 筛选外——页面不报错，只是查不到。
  //
  // 这条与 M-2 一样不读源码，读点击后的界面既成事实：支付状态那一排高亮的
  // 必须是「全部支付状态」、任务状态那一排必须回到「全部」。
  // （mock 口径下没有运营关注单，只断言筛选可达与状态正确，不断言结果集；
  //   mock 也不得伪造运营关注角标，见最后一条断言。）
  test('需运营关注入口可达，且不连带选中任何支付/任务状态', async ({ page }) => {
    const guards = await openAuthed(page, '/orders')
    await settleAdminPage(page, guards)

    const opsChip = page.getByRole('button', { name: '需运营关注' })
    await expect(opsChip).toBeVisible()

    // 触控/点击目标可达：chip 高度与文案都不得被裁切。
    const box = await opsChip.boundingBox()
    expect(box, '需运营关注 chip 没有可点击的盒模型').not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(28)
    const overflow = await opsChip.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    )
    expect(overflow, '需运营关注 chip 文案溢出被裁切').toBeLessThanOrEqual(1)

    // 先点亮一个任务状态 + 一个支付状态，再点 chip —— 都必须被清掉。
    await page.getByRole('button', { name: '已完成' }).click()
    await page.getByRole('button', { name: '已支付', exact: true }).click()
    await opsChip.click()

    const activeClass = /bg-primary-600/
    await expect(opsChip).toHaveClass(activeClass)
    await expect(page.getByRole('button', { name: '已支付', exact: true })).not.toHaveClass(activeClass)
    await expect(page.getByRole('button', { name: '已完成' })).not.toHaveClass(activeClass)
    await expect(page.getByRole('button', { name: '全部支付状态' })).toHaveClass(activeClass)
    await expect(page.getByRole('button', { name: '全部', exact: true })).toHaveClass(activeClass)

    // mock 只读视图刻意不伪造运营关注信号：三类角标一个都不该出现在列表行里。
    // （「退款中」同时是支付状态筛选 chip / StatusBadge 文案；角标断言只圈列表行
    //   内的 warning 角标 span，且按文本内容判，不按样式类判 —— 未支付徽标本身也是 warning 色。）
    await expect(page.getByText('渠道已受理未确认')).toHaveCount(0)
    const tbodyText = await page.locator('tbody').innerText()
    expect(tbodyText).not.toContain('渠道已受理未确认')
    expect(tbodyText).not.toContain('待退款')

    // 点完仍是正常列表页：无未捕获异常、无英文技术串。
    await settleAdminPage(page, guards)
  })
  test('1280/1440/1920 宽编号完整，渠道合在用户列，详情入口可见', async ({ page }) => {
    const guards = await openAuthed(page, '/orders')
    await settleAdminPage(page, guards)
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.locator('thead th')).toHaveText(['订单号', '文件名', '用户', '终端', '金额', '支付状态', '任务状态', '操作'])
      const row = page.locator('tbody tr').first()
      for (const index of [0, 3]) {
        const cell = row.locator('td').nth(index)
        const layout = await cell.evaluate((el) => {
          const content = el.querySelector('button') ?? el.firstElementChild!
          const style = getComputedStyle(content)
          return { overflow: content.scrollWidth - content.clientWidth, height: content.getBoundingClientRect().height,
            lineHeight: parseFloat(style.lineHeight), whiteSpace: style.whiteSpace, textOverflow: style.textOverflow,
            cellOverflow: el.scrollWidth - el.clientWidth }
        })
        expect(layout.overflow, `${width} 下关键编号被裁切`).toBeLessThanOrEqual(1)
        expect(layout.cellOverflow, `${width} 下关键编号挤出单元格`).toBeLessThanOrEqual(1)
        expect(layout.whiteSpace).toBe('nowrap')
        expect(layout.textOverflow).not.toBe('ellipsis')
        expect(layout.height).toBeLessThanOrEqual(layout.lineHeight + 1)
      }
      await expect(row.locator('td').nth(0)).toHaveText('ORD-20260625-MOCKREAD')
      await expect(row.locator('td').nth(3)).toHaveText('KSK-001')
      await expect(row.locator('td').nth(2)).toContainText('未标注')
      await expect(page.getByRole('button', { name: '订单 ORD-20260625-MOCKREAD 详情' })).toBeInViewport()
      expect(await page.locator('table').evaluate((el) => el.scrollWidth - el.parentElement!.clientWidth)).toBeLessThanOrEqual(1)
    }
    await expect(page.locator('tbody')).toContainText('¥0.00（免费）')
    await expect(page.locator('tbody tr').first().locator('td').nth(4)).toContainText('4 页 × 2 份')
    await expect(page.locator('tbody tr').nth(1).locator('td').nth(4)).not.toContainText('页')
    const pageSize = page.getByRole('combobox')
    await expect(pageSize.locator('option')).toHaveText(['10', '20', '50', '100'])
    await pageSize.selectOption('50')
    await settleAdminPage(page, guards)
    await expect(pageSize).toHaveValue('50')
    await page.getByRole('button', { name: '订单 ORD-20260625-MOCKREAD 详情' }).click()
    await expect(page.getByText('文件名', { exact: true }).last()).toBeVisible()
    const pageRange = page.getByText('页范围', { exact: true }).locator('..')
    await expect(pageRange).toContainText('未单独记录（见计费页数）')
    await expect(page.getByText('计费页数', { exact: true }).locator('..')).toContainText('4 页')
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '订单 ORD-20260625-UNRECORDED 详情' }).click()
    await expect(page.getByText('计费页数', { exact: true }).locator('..')).toContainText('—')
    await expect(page.getByText('页范围', { exact: true }).locator('..')).toContainText('未记录')
  })

  test('待到机订单详情用中文状态，0 元单不提供退款', async ({ page }) => {
    const guards = await openAuthed(page, '/orders')
    await settleAdminPage(page, guards)
    await page.getByRole('button', { name: '查看订单 ORD-20261006-RELEASE', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: '订单详情 · ORD-20261006-RELEASE' })).toBeVisible()
    await expect(dialog.getByText('待到机').first()).toBeVisible()
    await expect(dialog.getByText('已支付').first()).toBeVisible()
    await expect(dialog.getByText('0 元订单无需退款')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '退款', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '发起退款' })).toHaveCount(0)
    expect(await dialog.innerText()).not.toContain('pending_release')
  })

})
