// B11：合作机构后台 → 工作台 / 终端数据 / 数据统计（截图 + 文字）；顺带从页面自身的列表请求里记下政策 ID 与官方渠道 ID。
export default async ({ page, h }) => {
  const captured = {}
  page.on('response', async (r) => {
    const u = r.url()
    if (r.request().method() !== 'GET') return
    if (/\/partner\/policies(\?|$)/.test(u)) { try { captured.policies = await r.json() } catch {} }
    if (/\/partner\/official-channels(\?|$)/.test(u)) { try { captured.channels = await r.json() } catch {} }
  })
  for (const [path, name] of [['/', '工作台'], ['/terminals', '终端数据'], ['/stats', '数据统计'], ['/policy', '政策公告'], ['/profile', '机构资料']]) {
    h.clearNet()
    await h.goto(path)
    await h.settle(1800)
    const shot = await h.shot(`partner-${h.side}-${name}`)
    await h.log({ action: `打开「${name}」`, result: `${(await h.text('main')).replace(/\s+/g, ' ').slice(0, 1500)}；失败请求=${JSON.stringify(h.netErrors())}`, screenshot: shot })
  }
  const list = (x) => x?.data?.items ?? x?.data ?? []
  const pol = list(captured.policies).map((p) => `${p.id}｜${p.title}｜${p.reviewStatus}/${p.publishStatus}`)
  const ch = list(captured.channels).map((c) => `${c.id}｜${c.name}`)
  await h.log({ action: '记录 ID（取自页面自身的列表请求）', result: `政策：${pol.join('；') || '无'}；官方渠道：${ch.join('；') || '无'}` })
}
