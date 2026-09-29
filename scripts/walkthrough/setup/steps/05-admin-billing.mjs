// A3：计费与对账 → 查看价目表。首发口径：黑白/彩色 0 元「免费试运营」，resume_export 0 元启用。
// 先只查看现状；有对应行才改（按行内「单价」「说明」输入框 + 保存按钮，window.confirm 自动确认）。
const TARGETS = [
  { key: 'print_bw_page', price: '0', desc: '免费试运营' },
  { key: 'print_color_page', price: '0', desc: '免费试运营' },
  { key: 'resume_export', price: '0', desc: null },
]

export default async ({ page, h }) => {
  page.on('dialog', async (d) => { await h.log({ action: '浏览器确认框', result: d.message().replace(/\s+/g, ' ') }); await d.accept() })
  h.clearNet()
  await h.goto('/billing')
  await h.settle(1000)
  let shot = await h.shot('billing-before')
  const listReq = h.net().filter((n) => /billing|price/.test(n.url))
  const body = (await h.text('main')).replace(/\s+/g, ' ')
  await h.log({ action: '打开计费与对账', result: `价目请求=${JSON.stringify(listReq)}；页面：${body.slice(0, 700)}`, screenshot: shot })
  const createBtn = await page.getByRole('button', { name: /新增|新建|添加|创建/ }).count()
  await h.log({ action: '查找新增价目入口', result: createBtn ? `找到 ${createBtn} 个疑似新增按钮` : '页面上没有任何「新增/新建/添加/创建」按钮' })

  for (const t of TARGETS) {
    const row = page.locator('tr').filter({ hasText: t.key })
    if ((await row.count()) === 0) {
      await h.log({ action: `查找价目行 ${t.key}`, result: '无此行（无法在界面上新建）' })
      continue
    }
    const priceInput = row.locator('input[type=number]')
    const cur = await priceInput.inputValue()
    if (Number(cur) !== Number(t.price)) {
      await priceInput.fill(t.price)
      h.clearNet()
      await row.getByRole('button', { name: '保存改价' }).click()
      await h.settle(1000)
      await h.log({ action: `改价 ${t.key}`, input: `${cur} → ${t.price}`, result: `网络=${JSON.stringify(h.net().filter((n) => n.method !== 'GET'))}` })
    }
    if (t.desc !== null) {
      const d = row.locator('input[type=text]')
      if ((await d.inputValue()) !== t.desc) {
        await d.fill(t.desc)
        h.clearNet()
        await row.getByRole('button', { name: '保存说明' }).click()
        await h.settle(1000)
        await h.log({ action: `改说明 ${t.key}`, input: t.desc, result: `网络=${JSON.stringify(h.net().filter((n) => n.method !== 'GET'))}` })
      }
    }
    const active = (await row.innerText()).includes('启用') && (await row.getByRole('button', { name: '停用' }).count()) > 0
    await h.log({ action: `价目行 ${t.key} 现状`, result: `${(await row.innerText()).replace(/\s+/g, ' ')}；启用=${active}` })
  }
  shot = await h.shot('billing-after')
  await h.log({ action: '价目表最终状态', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 700), screenshot: shot })
}
