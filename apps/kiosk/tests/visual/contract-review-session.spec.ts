import { expect, test, type Page } from '@playwright/test'
import { assertDialogWithinViewport } from './assert-layout'

async function expectScreenFillsViewport(page: Page): Promise<void> {
  const box = await page.locator('.qxt-screen').boundingBox()
  const viewport = page.viewportSize()
  expect(box, '触屏页必须有尺寸').not.toBeNull()
  expect(viewport, '视口必须固定').not.toBeNull()
  if (!box || !viewport) return
  expect(Math.round(box.height)).toBe(viewport.height)
  const dock = page.locator('.qxt-dock')
  const dockBox = await dock.boundingBox()
  expect(dockBox, '底栏必须可见').not.toBeNull()
  if (!dockBox) return
  expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(viewport.height + 1)
}

async function startReview(page: Page): Promise<void> {
  await page.goto('/contract-review')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'contract.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF'),
  })
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '开始风险分析' }).click()
  await expect(page).toHaveURL(/\/contract-review\/processing$/)
}

test('合同凭证不进 history，刷新后无法恢复 @contract', async ({ page }) => {
  await startReview(page)

  await expect(page.getByText(/刷新、关闭页面或切换用户会结束本次查看/)).toBeVisible()
  const serializedHistory = await page.evaluate(() => JSON.stringify(window.history.state))
  expect(serializedHistory).not.toContain('mock-contract-review-access-token')
  expect(serializedHistory).not.toContain('mock-task-001')

  await page.reload()
  await expect(page).toHaveURL(/\/contract-review$/)
  await expect(page.getByRole('button', { name: '开始风险分析' })).toBeVisible()
})

test('完成结果只存易失内存，结束后直接访问不能恢复 @contract', async ({ page }) => {
  test.setTimeout(45_000)
  await startReview(page)

  await expect(page.getByText('确认文件提取结果')).toBeVisible({ timeout: 12_000 })
  await page.getByRole('button', { name: '确认，开始分析' }).click()
  await expect(page).toHaveURL(/\/contract-review\/result$/, { timeout: 18_000 })
  await expect(page.getByText('审查结果', { exact: true })).toBeVisible()
  await expect(page.getByText(/当前合同和结果无法从此终端恢复/)).toBeVisible()

  const serializedHistory = await page.evaluate(() => JSON.stringify(window.history.state))
  expect(serializedHistory).not.toContain('mock-contract-review-access-token')
  expect(serializedHistory).not.toContain('试用期为六个月')

  await page.getByRole('button', { name: '结束并删除' }).click()
  await expect(page).toHaveURL(/\/resume-service$/)
  await page.goto('/contract-review/result')
  await expect(page.getByText('未找到审查结果')).toBeVisible()
  await expect(page.getByText('试用期时长可能超过法定上限')).toHaveCount(0)
})

test('风险提示报告可保存到我的文档且不进入打印链路 @contract', async ({ page }) => {
  test.setTimeout(45_000)
  await startReview(page)
  await expect(page.getByText('确认文件提取结果')).toBeVisible({ timeout: 12_000 })
  await page.getByRole('button', { name: '确认，开始分析' }).click()
  await expect(page).toHaveURL(/\/contract-review\/result$/, { timeout: 18_000 })

  await expect(page.getByRole('button', { name: '保存到我的文档' })).toBeVisible()
  await expect(page.getByRole('button', { name: '打印风险提示报告' })).toHaveCount(0)
  await expect(page.getByText(/需要先登录本人会员账号|保存后仅本人/)).toBeVisible()
})

test('结果页每一条风险项都能看到：条目数等于三类计数之和，滚轮滚到底后最后一条在视口内 @contract', async ({ page }) => {
  test.setTimeout(45_000)
  await startReview(page)
  await expect(page.getByText('确认文件提取结果')).toBeVisible({ timeout: 12_000 })
  await page.getByRole('button', { name: '确认，开始分析' }).click()
  await expect(page).toHaveURL(/\/contract-review\/result$/, { timeout: 18_000 })

  const counts = await page.locator('.cr-summary-stat__num').allTextContents()
  const expected = counts.map((text) => Number(text.trim())).reduce((sum, n) => sum + n, 0)
  expect(counts, '优先核查 / 关注 / 信息不足三个计数').toHaveLength(3)
  expect(expected, '计数之和必须大于 0，否则这条断言没有量到东西').toBeGreaterThan(0)
  const headers = page.locator('.cr-finding-card__header')
  await expect(headers, '条目数必须等于三类计数之和').toHaveCount(expected)

  // 溢出的那个容器（条目的祖先里第一个内容比盒子高的）必须能滚：计算样式 overflow-y 是 auto 或 scroll。
  const overflowY = await headers.last().evaluate((el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 1) return getComputedStyle(node).overflowY
    }
    return 'none'
  })
  expect(['auto', 'scroll'], '溢出的容器必须能滚动，不能裁切').toContain(overflowY)

  // 像用户那样用滚轮滚（程序设 scrollTop 或 scrollIntoView 对 overflow:hidden 也有效，测不出裁切）
  const body = page.locator('.qxt-body')
  const box = await body.boundingBox()
  expect(box, '正文必须有尺寸').not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.wheel(0, 600)
  }
  await expect(headers.last(), '滚到底后最后一条必须在视口里').toBeInViewport()
})

test('三条合同路由铺满视口，底栏贴在视口内 @contract', async ({ page }) => {
  await page.goto('/contract-review')
  await expectScreenFillsViewport(page)
  const selected = page.locator('.cr-type-btn--active').first()
  const idle = page.locator('.cr-type-btn:not(.cr-type-btn--active)').first()
  const selectedBg = await selected.evaluate((el) => getComputedStyle(el).backgroundColor)
  const idleBg = await idle.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(selectedBg).not.toBe(idleBg)

  await startReview(page)
  await expectScreenFillsViewport(page)
  await expect(page.getByText('确认文件提取结果')).toBeVisible({ timeout: 12_000 })
  await assertDialogWithinViewport(page)
  const dialog = page.getByRole('dialog')
  for (const name of ['取消审查', '确认，开始分析']) {
    const button = dialog.getByRole('button', { name })
    const box = await button.boundingBox()
    expect(box, `${name} 必须可见`).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(64)
  }

  await page.getByRole('button', { name: '确认，开始分析' }).click()
  await expect(page).toHaveURL(/\/contract-review\/result$/, { timeout: 18_000 })
  await expectScreenFillsViewport(page)
})
