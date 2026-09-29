// A1 续：机构详情抽屉 → 内容可信（标记为 active，填核验依据）→ 官方域名（入驻核验）登记 example.com。
// 用法：WALK_ORG=<机构名> WALK_DOMAIN=example.com node run.mjs steps/02-... admin
const ORG = process.env.WALK_ORG ?? '测试·青岛市崂山区零工之家'
const DOMAIN = process.env.WALK_DOMAIN ?? 'example.com'
const REASON = process.env.WALK_REASON ?? '测试·走查用：合作协议编号 WALK-TEST-001（本地走查，非真实协议）'

export default async ({ page, h }) => {
  await h.goto('/partners')
  const row = page.locator('tr').filter({ hasText: ORG })
  h.clearNet()
  await row.getByRole('button', { name: '详情/账号' }).click()
  const drawer = page.locator('[role=dialog]').filter({ hasText: '机构详情' }).last()
  await drawer.waitFor()
  await h.settle(1200)
  const detailReq = h.net().find((n) => /\/orgs\/[^/?]+$/.test(n.url.split('?')[0]))
  let shot = await h.shot('org-detail-open')
  await h.log({ action: '打开机构详情抽屉', input: ORG, result: `详情接口 ${detailReq?.url ?? '?'}；${(await drawer.innerText()).slice(0, 300).replace(/\s+/g, ' ')}`, screenshot: shot })

  // —— 内容可信 ——
  const trust = drawer.locator('section').filter({ hasText: '变更内容信任状态' }).first()
  await trust.scrollIntoViewIfNeeded()
  await trust.locator('select').selectOption('active')
  await trust.locator('textarea').fill(REASON)
  h.clearNet()
  await trust.getByRole('button', { name: /标记为「内容可信」/ }).click()
  await h.settle(1200)
  shot = await h.shot('org-content-trust-active')
  const trustTxt = (await trust.innerText()).replace(/\s+/g, ' ')
  await h.log({ action: '内容可信 → 标记为「内容可信」', input: `依据：${REASON}`, result: `${/已提交/.test(trustTxt) ? '成功' : '未见成功提示'}；面板：${trustTxt.slice(0, 220)}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })

  // —— 官方域名 ——
  const dom = drawer.locator('section[aria-label="官方域名（入驻核验）"]')
  await dom.scrollIntoViewIfNeeded()
  const domBefore = (await dom.innerText()).replace(/\s+/g, ' ')
  if (!domBefore.includes(DOMAIN)) {
    await dom.getByRole('button', { name: '编辑域名' }).click()
    const addBtn = dom.getByRole('button', { name: /添加|新增/ }).first()
    if ((await dom.locator('input[aria-label^="官方域名"]').count()) === 0) await addBtn.click()
    await dom.locator('input[aria-label^="官方域名"]').last().fill(DOMAIN)
    await page.waitForTimeout(300)
    shot = await h.shot('org-domain-edit')
    const hint = (await dom.innerText()).replace(/\s+/g, ' ')
    await h.log({ action: '官方域名 → 编辑域名，填写', input: DOMAIN, result: `编辑态提示：${hint.slice(0, 260)}`, screenshot: shot })
    await dom.getByRole('button', { name: /保存|下一步|核对/ }).last().click()
    await page.waitForTimeout(400)
    shot = await h.shot('org-domain-confirm')
    await h.log({ action: '官方域名 → 进入确认替换', result: (await dom.innerText()).replace(/\s+/g, ' ').slice(0, 260), screenshot: shot })
    h.clearNet()
    await dom.getByRole('button', { name: /确认/ }).last().click()
    await h.settle(1200)
  }
  shot = await h.shot('org-domain-after')
  await h.log({ action: '官方域名登记结果', input: DOMAIN, result: `${(await dom.innerText()).replace(/\s+/g, ' ').slice(0, 260)}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })

  // 记下账号区与熔断区现状
  const acct = drawer.locator('section, div').filter({ hasText: '机构后台账号' }).last()
  await h.log({ action: '查看机构后台账号区', result: (await drawer.innerText()).replace(/\s+/g, ' ').split('机构后台账号')[1]?.slice(0, 260) ?? '?' })
}
