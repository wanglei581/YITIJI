// 收尾（管理员）：机构 A 详情里的「官方渠道」是否看到机构自建的两条；政策信息源页能看到什么；工作台最终数字；合作机构列表。
export default async ({ page, h }) => {
  await h.goto('/partners')
  await h.settle(1000)
  let shot = await h.shot('admin-partners-final')
  await h.log({ action: '合作机构列表（全部配置后）', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 900), screenshot: shot })

  await page.locator('tr').filter({ hasText: '测试·青岛市崂山区零工之家' }).getByRole('button', { name: '详情/账号' }).click()
  const drawer = page.locator('[role=dialog]').filter({ hasText: '机构详情' }).last()
  await drawer.waitFor()
  await h.settle(1200)
  const ch = drawer.locator('section[aria-label="官方渠道"]')
  await ch.scrollIntoViewIfNeeded()
  shot = await h.shot('admin-org-a-channels')
  await h.log({ action: '机构 A 详情 → 官方渠道（管理员只读 + 紧急下架）', result: (await ch.innerText()).replace(/\s+/g, ' ').slice(0, 800), screenshot: shot })
  await page.keyboard.press('Escape')

  h.clearNet()
  await h.goto('/policy-sources')
  await h.settle(1500)
  shot = await h.shot('admin-policy-sources')
  await h.log({ action: '打开政策信息源（管理员）', result: `${(await h.text('main')).replace(/\s+/g, ' ').slice(0, 1500)}；失败请求=${JSON.stringify(h.netErrors())}`, screenshot: shot })

  await h.goto('/')
  await h.settle(2000)
  shot = await h.shot('admin-dashboard-final')
  await h.log({ action: '工作台（全部配置完成后，最终）', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 2500), screenshot: shot })

  const nav = await page.locator('nav a, aside a').allInnerTexts()
  await h.log({ action: '管理员左侧导航项', result: nav.map((s) => s.trim()).filter(Boolean).join('、') })
}
