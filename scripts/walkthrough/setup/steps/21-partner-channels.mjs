// B9：合作机构后台 → 机构资料 → 本机构官方渠道 → 添加渠道（两条）。
// 界面没有「小程序」渠道类型，只能填 https 链接；第二条用一个「小程序入口」式的 https 链接代替。
const CHANNELS = [
  { name: '测试·崂山零工之家公众号', url: 'https://example.com/walk-channel-a', order: '1' },
  { name: '测试·崂山零工之家小程序入口', url: 'https://mp.example.com/walk-miniapp-entry', order: '2' },
]

export default async ({ page, h }) => {
  await h.goto('/profile')
  await h.settle(1200)
  let shot = await h.shot('partner-profile')
  await h.log({ action: '打开机构资料', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 900), screenshot: shot })
  const sec = page.locator('[aria-labelledby="official-channels-title"]')
  await sec.scrollIntoViewIfNeeded()

  for (const c of CHANNELS) {
    if ((await sec.getByText(c.name).count()) > 0) { await h.log({ action: '添加渠道', input: c.name, result: '已存在，跳过' }); continue }
    const add = sec.getByRole('button', { name: '添加渠道' })
    if (await add.isDisabled()) {
      shot = await h.shot('partner-channel-add-disabled')
      await h.log({ action: '添加渠道', input: c.name, result: `按钮不可用：${await add.getAttribute('title')}`, screenshot: shot })
      return
    }
    await add.click()
    const dlg = page.locator('[role=dialog]').last()
    await dlg.waitFor()
    await dlg.getByPlaceholder('例如：学校就业信息网').fill(c.name)
    await dlg.getByPlaceholder('https://').fill(c.url)
    const orderInput = dlg.locator('label').filter({ hasText: '排序' }).locator('input')
    await orderInput.fill(c.order)
    const hint = await dlg.getByTestId('channel-url-hint').innerText()
    const enableBox = dlg.locator('label').filter({ hasText: '保存后立即启用' }).locator('input[type=checkbox]')
    const enabledDefault = await enableBox.isChecked().catch(() => null)
    if (enabledDefault === false) await enableBox.check()
    shot = await h.shot(`partner-channel-form-${c.order}`)
    h.clearNet()
    await dlg.getByRole('button', { name: '保存', exact: true }).click()
    await h.settle(1500)
    const stillOpen = await dlg.isVisible().catch(() => false)
    const err = stillOpen ? (await dlg.locator('[role=alert]').allInnerTexts()).join(' ') : ''
    const notice = (await sec.locator('[role=status],[role=alert]').allInnerTexts()).join(' ')
    shot = await h.shot(`partner-channel-saved-${c.order}`)
    await h.log({ action: '本机构官方渠道 → 添加渠道 → 保存', input: `${c.name}｜${c.url}｜排序 ${c.order}｜「保存后立即启用」默认=${enabledDefault}`, result: `${stillOpen ? '失败：' + err : '成功'}；链接提示=${hint}；页面提示=${notice || '无'}；网络=${JSON.stringify(h.net().filter((n) => n.method !== 'GET'))}`, screenshot: shot })
    if (stillOpen) await dlg.getByRole('button', { name: '取消' }).click().catch(() => {})
  }
  shot = await h.shot('partner-channels-list')
  await h.log({ action: '本机构官方渠道列表', result: (await sec.innerText()).replace(/\s+/g, ' ').slice(0, 800), screenshot: shot })
}
