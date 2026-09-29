// 记录合作机构后台左侧导航（托管 a 下岗位/招聘会/数据源类入口是否仍可见）。
export default async ({ page, h }) => {
  await h.goto('/')
  await h.settle(1000)
  const nav = await page.locator('nav a, aside a').allInnerTexts()
  const shot = await h.shot(`partner-nav-${h.side}`)
  await h.log({ action: '合作机构后台左侧导航', result: nav.map((s) => s.trim()).filter(Boolean).join('、'), screenshot: shot })
  for (const p of ['/jobs', '/fairs', '/sources']) {
    await h.goto(p); await h.settle(800)
    await h.log({ action: `直接打开 ${p}`, result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 300) })
  }
}
