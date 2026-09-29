// A2：设备管理 → 终端 → 预创建设备（绑定机构 A）→ 生成绑定码（写入 secret/bind-code.txt，不打印）
//     → 打印扫描运维 → 设备能力：只查看，不开启彩色/双面/签名。
const CODE = 'WALK-001'
const NAME = '测试·崂山零工之家 1 号机'
const LOC = '测试·崂山区某街道 1 楼'
const ORG = '测试·青岛市崂山区零工之家'

export default async ({ page, h }) => {
  await h.goto('/devices?tab=terminals')
  let shot = await h.shot('terminals-before')
  await h.log({ action: '打开设备管理 → 终端', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 200), screenshot: shot })

  if ((await page.getByText(CODE, { exact: true }).count()) === 0) {
    await page.getByRole('button', { name: '预创建设备' }).click()
    const dlg = page.locator('[role=dialog][aria-labelledby="planned-terminal-title"]')
    await dlg.waitFor()
    await dlg.locator('label').filter({ hasText: '终端编号' }).locator('input').fill(CODE)
    await dlg.locator('label').filter({ hasText: '设备名称' }).locator('input').fill(NAME)
    await dlg.locator('label').filter({ hasText: '摆放位置' }).locator('input').fill(LOC)
    const orgOpts = await dlg.locator('select option').allInnerTexts()
    await dlg.locator('select').selectOption({ label: ORG })
    shot = await h.shot('terminal-create-form')
    await h.log({ action: '预创建设备：填写', input: `${CODE} / ${NAME} / ${LOC} / 机构=${ORG}`, result: `所属机构可选：${orgOpts.join('、')}`, screenshot: shot })
    h.clearNet()
    await dlg.getByRole('button', { name: '创建设备' }).click()
    await h.settle(1500)
    shot = await h.shot('terminal-created')
    const post = h.net().find((n) => n.method === 'POST')
    const alert = await dlg.locator('[role=alert]').allInnerTexts().catch(() => [])
    await h.log({ action: '点击「创建设备」', input: CODE, result: `${post ? post.method + ' ' + post.url + ' ' + post.status : '未见请求'}；弹窗报错=${alert.join(' ') || '无'}；页面提示=${(await h.text('main')).match(/已预创建设备[^。]*。[^。]*。?/)?.[0] ?? '无'}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })
  }

  // 生成绑定码
  const row = page.locator('tr, li, div.rounded-xl, article').filter({ hasText: CODE }).filter({ has: page.getByRole('button', { name: /生成.*绑定码/ }) }).last()
  const btn = page.getByRole('button', { name: `为 ${CODE} 生成一次性绑定码` })
  const disabled = await btn.isDisabled()
  const title = await btn.getAttribute('title')
  await h.log({ action: '查看「生成绑定码」按钮', input: CODE, result: `disabled=${disabled}；提示=${title ?? '无'}；行内容=${(await row.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}` })
  if (!disabled) {
    await btn.click()
    const dlg = page.locator('[role=dialog]').filter({ hasText: '绑定码' }).last()
    await dlg.waitFor()
    const ttlDefault = await dlg.locator('input[type=number]').inputValue()
    shot = await h.shot('bindcode-dialog')
    await h.log({ action: '打开生成绑定码弹窗', result: `有效时长默认 ${ttlDefault} 分钟（最长 60）；说明：${(await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 240)}`, screenshot: shot })
    await dlg.locator('input[type=number]').fill('60')
    h.clearNet()
    await dlg.getByRole('button', { name: '生成绑定码' }).click()
    await h.settle(1200)
    const code = (await dlg.locator('code').first().innerText().catch(() => '')).trim()
    const expires = (await dlg.innerText()).match(/过期时间：([^\n]+)/)?.[1] ?? '?'
    const countdown = (await dlg.innerText()).match(/请在\s*([^\s]+)\s*内复制/)?.[1] ?? '?'
    if (code) h.writeSecret('bind-code.txt', code + '\n')
    // 截图前遮住绑定码本身，避免证据截图里带码
    await dlg.locator('code').first().evaluate((el) => { el.dataset.raw = el.textContent; el.textContent = '●●●●（已写入 secret/bind-code.txt）' }).catch(() => {})
    shot = await h.shot('bindcode-generated-masked')
    const pre = (await dlg.locator('pre').first().innerText().catch(() => '')).replace(code, '<绑定码>')
    await h.log({ action: '点击「生成绑定码」（有效时长填 60 分钟）', input: CODE, result: code ? `成功：码长度 ${code.length}，已写入 secret/bind-code.txt（600）；倒计时 ${countdown}；过期时间 ${expires}；推荐安装命令：${pre.slice(0, 200)}` : `失败：${(await dlg.innerText()).slice(0, 200)}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })
    await dlg.getByRole('button', { name: '我已经复制，关闭' }).click().catch(() => {})
    await h.settle(600)
  }
  shot = await h.shot('terminals-after')
  await h.log({ action: '终端列表（绑定码生成后）', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 400), screenshot: shot })

  // 设备能力（只看）
  await h.goto('/print-scan')
  await page.getByRole('button', { name: '设备能力' }).click()
  await h.settle(1200)
  shot = await h.shot('capabilities-view')
  await h.log({ action: '打印扫描运维 → 设备能力（只查看，不修改）', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 1500), screenshot: shot })
}
