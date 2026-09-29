// A1：合作机构管理 → 新增合作机构（两家），同时开通机构后台登录账号。
// 初始密码从 secret/partners.json 读取（本脚本生成，不打印）。
const ORGS = [
  { key: 'walk_partner_a', name: '测试·青岛市崂山区零工之家', typeLabel: '公共就业服务机构', contact: '测试·联系人甲', contactPhone: '13800000111', accountName: '测试·零工之家管理员' },
  { key: 'walk_partner_b', name: '测试·青岛理工大学就业指导中心（走查）', typeLabel: '高校就业中心', contact: '测试·联系人乙', contactPhone: '13800000112', accountName: '测试·高校就业中心管理员' },
]

export default async ({ page, h }) => {
  const secrets = h.readSecret('partners.json')
  await h.goto('/partners')
  let shot = await h.shot('partners-empty')
  await h.log({ action: '打开合作机构管理', result: (await h.text('main')).slice(0, 160).replace(/\s+/g, ' '), screenshot: shot })

  for (const o of ORGS) {
    if ((await page.getByText(o.name, { exact: true }).count()) > 0) {
      await h.log({ action: '新增合作机构', input: o.name, result: '已存在，跳过' })
      continue
    }
    const acct = secrets[o.key]
    await page.getByRole('button', { name: /新增合作机构|新增机构/ }).first().click()
    const drawer = page.locator('[role=dialog]').filter({ hasText: '新增合作机构' }).last()
    await drawer.waitFor()
    const field = (label) => drawer.locator('label').filter({ hasText: label }).first()
    await field('机构名称').locator('input').fill(o.name)
    // 记录类型下拉里有哪些选项（有没有「零工之家/就业服务站」）
    const opts = await field('机构类型').locator('option').allInnerTexts()
    await field('机构类型').locator('select').selectOption({ label: o.typeLabel })
    await field('联系人').locator('input').fill(o.contact)
    await field('联系电话').locator('input').fill(o.contactPhone)
    const scene = (await field('场景模板').innerText()).replace(/\s+/g, ' ')
    const modules = await drawer.locator('label:has(input[type=checkbox])').evaluateAll((els) => els.map((e) => `${e.textContent.trim()}${e.querySelector('input').checked ? '✓' : ''}`))
    await drawer.getByText('同时开通机构后台登录账号').click()
    await field('登录用户名').locator('input').fill(acct.username)
    await field('账号姓名').locator('input').fill(o.accountName)
    await field('登录手机号').locator('input').fill(acct.phone)
    await field('初始密码').locator('input').fill(acct.initialPassword)
    shot = await h.shot(`create-org-form-${o.key}`)
    await h.log({ action: '填写新增合作机构表单', input: `${o.name}；类型=${o.typeLabel}；账号 ${acct.username}/${acct.phone}（密码略）`, result: `类型可选项=${opts.join('、')}；场景模板=${scene}；启用模块=${modules.join('、')}`, screenshot: shot })
    h.clearNet()
    await drawer.getByRole('button', { name: '创建机构' }).click()
    await h.settle(1500)
    const err = await drawer.locator('.text-error-fg, [role=alert]').allInnerTexts().catch(() => [])
    const stillOpen = await drawer.isVisible().catch(() => false)
    shot = await h.shot(`create-org-result-${o.key}`)
    const created = h.net().find((n) => n.method === 'POST' && /orgs/.test(n.url))
    await h.log({ action: '点击「创建机构」', input: o.name, result: stillOpen ? `失败：${err.join(' ')} 网络=${JSON.stringify(h.netErrors())}` : `成功（${created?.status ?? '?'}），抽屉已关闭`, screenshot: shot })
  }
  await h.goto('/partners')
  shot = await h.shot('partners-list-after-create')
  await h.log({ action: '查看机构列表', result: (await h.text('table').catch(() => '')).slice(0, 400).replace(/\s+/g, ' '), screenshot: shot })
}
