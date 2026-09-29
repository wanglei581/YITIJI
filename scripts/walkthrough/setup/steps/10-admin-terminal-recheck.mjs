// A2 复查：绑定码被一体机侧兑换后，终端列表里的设备名称/位置/心跳是否与管理员预创建时一致；顺带取终端 ID。
export default async ({ page, h }) => {
  let listBody = null
  page.on('response', async (r) => { if (/\/admin\/terminals(\?|$)/.test(r.url()) && r.request().method() === 'GET') { try { listBody = await r.json() } catch {} } })
  await h.goto('/devices?tab=terminals')
  await h.settle(1500)
  const shot = await h.shot('terminals-after-bind')
  const row = page.locator('tr').filter({ hasText: 'WALK-001' }).first()
  const items = listBody?.data?.items ?? listBody?.data ?? []
  const t = Array.isArray(items) ? items.find((x) => x.terminalCode === 'WALK-001') : null
  await h.log({ action: '终端列表复查（绑定码已被兑换后）', result: `行=${(await row.innerText().catch(() => '')).replace(/\s+/g, ' ')}；终端 ID=${t?.id ?? t?.terminalId ?? '?'}；接口 displayName=${t?.displayName}；locationLabel=${t?.locationLabel}`, screenshot: shot })
}
