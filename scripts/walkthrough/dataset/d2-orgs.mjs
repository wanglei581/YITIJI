// 管理员后台：把已有机构改成示例名，缺的新建，并补账号、内容可信、官方域名。
import { ORGS } from './d2-catalog.mjs'
import { accountOf, loadPartnerSecrets, savePartnerSecrets } from './d2-secrets.mjs'

const TRUST_REASON = '示例：数据集走查入驻核验记录 D2-2026-09-29。这不是真实合作协议，也不是授权函。'

async function exactOrgVisible(page, name) {
  const search = page.getByPlaceholder('搜索机构名称、联系人...')
  await search.fill(name)
  await page.waitForTimeout(400)
  const rows = page.locator('tbody tr')
  const count = await rows.count()
  for (let i = 0; i < count; i += 1) {
    const cell = (await rows.nth(i).locator('td').first().innerText().catch(() => '')).trim()
    if (cell === name) return rows.nth(i)
  }
  return null
}

async function gotoPartners(h) {
  await h.clickNav('合作机构管理', '/partners')
  await h.page.getByRole('heading', { name: '合作机构管理' }).waitFor({ timeout: 15000 })
  await h.page.getByPlaceholder('搜索机构名称、联系人...').waitFor({ timeout: 20000 })
  await h.pause(300)
}

async function moduleBox(drawer, name) {
  const labels = drawer.locator('label:has(input[type=checkbox])')
  const count = await labels.count()
  for (let i = 0; i < count; i += 1) {
    const text = (await labels.nth(i).innerText()).replace(/\s+/g, '')
    if (text === name) return labels.nth(i).locator('input[type=checkbox]')
  }
  return null
}

async function ensurePolicyModule(drawer) {
  const box = await moduleBox(drawer, '政策服务')
  if (!box) return '没有政策服务勾选框'
  if (!(await box.isChecked())) await box.check()
  return '政策服务已勾选'
}

async function fieldInput(scope, label) {
  return scope.locator('label').filter({ hasText: label }).locator('input, textarea, select').first()
}

async function closeDrawer(drawer) {
  if (!(await drawer.isVisible().catch(() => false))) return
  await drawer.getByRole('button', { name: '关闭' }).click().catch(() => {})
  const hidden = await drawer.waitFor({ state: 'hidden', timeout: 8000 }).then(() => true).catch(() => false)
  if (!hidden) {
    await drawer.page().keyboard.press('Escape').catch(() => {})
    await drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  }
}

async function openDetail(page, row) {
  const existing = page.locator('[role=dialog]').filter({ hasText: '机构详情' })
  if (await existing.count()) await closeDrawer(existing.last())
  await row.getByRole('button', { name: '详情/账号' }).click()
  const drawer = page.locator('[role=dialog]').filter({ hasText: '机构详情' }).last()
  await drawer.waitFor()
  await drawer.getByText('机构档案', { exact: true }).waitFor({ timeout: 15000 })
  const nameInput = await fieldInput(drawer, '机构名称')
  await page.waitForFunction((el) => el instanceof HTMLInputElement && el.value.length > 1, await nameInput.elementHandle(), { timeout: 15000 }).catch(() => {})
  return drawer
}

async function saveProfile(page, h, drawer, org, account) {
  const nameInput = await fieldInput(drawer, '机构名称')
  const before = await nameInput.inputValue()
  if (before !== org.name) await nameInput.fill(org.name)
  const typeSelect = drawer.locator('label').filter({ hasText: '机构类型' }).locator('select').first()
  if (await typeSelect.count()) {
    const current = (await typeSelect.locator('option:checked').innerText().catch(() => '')).trim()
    if (current !== org.typeLabel) {
      await typeSelect.selectOption({ label: org.typeLabel })
      await h.pause(400)
    }
  }
  const contact = await fieldInput(drawer, '联系人')
  if (await contact.count()) await contact.fill(account.contact)
  const phone = drawer.locator('label').filter({ hasText: '联系电话' }).locator('input').first()
  if (await phone.count()) await phone.fill(account.contactPhone)
  const moduleNote = await ensurePolicyModule(drawer)
  const shot = await h.shot(`org-profile-${org.key}`)
  h.clearNet()
  await drawer.getByRole('button', { name: '保存档案' }).click()
  await h.pause(1200)
  const titleOk = await drawer.getByRole('heading', { name: org.name }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
  const err = await drawer.locator('.text-error-fg, [role=alert]').allInnerTexts().catch(() => [])
  await h.log({
    action: '保存机构档案',
    input: `${before} → ${org.name}；联系人 ${account.contact}`,
    result: `${titleOk ? '成功' : '未见新名称'}；${moduleNote}；报错=${err.join(' ') || '无'}；网络=${JSON.stringify(h.netErrors().slice(-2))}`,
    screenshot: shot,
  })
  if (!titleOk) throw new Error(`保存档案失败 ${org.key} ${err.join(' ')}`)
}

async function ensureAccount(page, h, drawer, account) {
  const sectionText = await drawer.innerText()
  if (sectionText.includes(account.username)) {
    await h.log({ action: '机构账号', input: account.username, result: '已存在，跳过创建' })
    account.accountCreated = true
    return
  }
  await drawer.getByRole('button', { name: '新增账号' }).click()
  await h.pause(300)
  const box = drawer.locator('div').filter({ hasText: '初始密码' }).last()
  await (await fieldInput(box, '登录用户名')).fill(account.username)
  await (await fieldInput(box, '账号姓名')).fill(account.accountName)
  await (await fieldInput(box, '登录手机号')).fill(account.phone)
  await box.locator('input[type=password]').fill(account.initialPassword)
  const shot = await h.shot(`org-account-form-${account.key}`)
  h.clearNet()
  await box.getByRole('button', { name: '创建账号' }).click()
  await h.pause(1500)
  const after = await drawer.innerText()
  const ok = after.includes(account.username)
  await h.log({
    action: '新增机构账号',
    input: `${account.username} / ${account.accountName} / ${account.phone}（密码略）`,
    result: ok ? '成功' : `失败：${after.slice(after.indexOf('机构后台账号')).slice(0, 240)}；网络=${JSON.stringify(h.netErrors().slice(-2))}`,
    screenshot: shot,
  })
  if (!ok) {
    const spare = ORGS.find((item) => item.key === account.key)?.sparePhones?.[0]
    if (spare && account.phone !== spare && /手机|已存在|占用|重复/.test(after)) {
      account.phone = spare
      await h.log({ action: '机构账号换用备用手机号后重试', input: account.username, result: '见下一条' })
      const cancelish = box.getByRole('button', { name: '新增账号' })
      if (await drawer.getByText(account.username).count() === 0) {
        await (await fieldInput(box, '登录手机号')).fill(spare)
        await box.locator('input[type=password]').fill(account.initialPassword)
        await box.getByRole('button', { name: '创建账号' }).click()
        await h.pause(1500)
        if ((await drawer.innerText()).includes(account.username)) {
          account.accountCreated = true
          return
        }
      }
      void cancelish
    }
    throw new Error(`创建账号失败 ${account.key}`)
  }
  account.accountCreated = true
}

async function ensureTrust(page, h, drawer, org) {
  const panel = drawer.locator('section').filter({ hasText: '发布闸门判据' }).first()
  await panel.waitFor({ timeout: 15000 })
  await panel.scrollIntoViewIfNeeded()
  await h.pause(300)
  const text = await panel.innerText()
  if (text.includes('允许发布') && /contentTrustStatus=active/.test(text)) {
    await h.log({ action: '内容可信', input: org.name, result: '已经是可发布状态' })
    return
  }
  await panel.locator('select').selectOption('active')
  await panel.locator('textarea').fill(TRUST_REASON)
  h.clearNet()
  await panel.getByRole('button', { name: '标记为「内容可信」' }).click()
  await h.pause(1200)
  const shot = await h.shot(`org-trust-${org.key}`)
  const after = await panel.innerText()
  const ok = after.includes('允许发布')
  await h.log({
    action: '标记内容可信',
    input: org.name,
    result: `${ok ? '成功' : '未见允许发布'}；${after.replace(/\s+/g, ' ').slice(0, 220)}；网络=${JSON.stringify(h.netErrors().slice(-2))}`,
    screenshot: shot,
  })
  if (!ok) throw new Error(`内容可信失败 ${org.key}`)
}

function coversHost(host, listed) {
  const name = host.toLowerCase()
  return listed.some((domain) => name === domain || name.endsWith(`.${domain}`))
}

async function listedDomains(dom) {
  const nodes = dom.locator('[aria-label="已登记的官方域名"] span.font-mono')
  if (!(await nodes.count())) return []
  return (await nodes.allInnerTexts())
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(item))
}

async function domainPanel(drawer) {
  const dom = drawer.locator('section[aria-label="官方域名（入驻核验）"]').last()
  await dom.waitFor({ state: 'visible', timeout: 15000 })
  await dom.getByText(/已登记 \d+ 个|尚未登记|没有读到/).first().waitFor({ timeout: 15000 })
  return drawer.locator('section[aria-label="官方域名（入驻核验）"]').last()
}

async function ensureDomains(page, h, drawer, org, hosts) {
  const wanted = [...new Set((hosts?.length ? hosts : [org.domain]).map((item) => item.toLowerCase()))]
  let dom = await domainPanel(drawer)
  await dom.scrollIntoViewIfNeeded().catch(async () => {
    dom = await domainPanel(drawer)
    await dom.scrollIntoViewIfNeeded()
  })
  const listed = await listedDomains(dom)
  const missing = wanted.filter((host) => !coversHost(host, listed))
  if (!missing.length) {
    await h.log({ action: '官方域名', input: wanted.join('、'), result: `已覆盖：${listed.join('、') || '无'}` })
    return
  }
  await dom.getByRole('button', { name: '编辑域名' }).click()
  await h.pause(300)
  for (const host of missing) {
    const inputs = dom.locator('input[aria-label^="官方域名"]')
    let filled = false
    const count = await inputs.count()
    for (let i = 0; i < count; i += 1) {
      if (!(await inputs.nth(i).inputValue()).trim()) {
        await inputs.nth(i).fill(host)
        filled = true
        break
      }
    }
    if (!filled) {
      await dom.getByRole('button', { name: '添加一个域名' }).click()
      await dom.locator('input[aria-label^="官方域名"]').last().fill(host)
    }
  }
  const check = dom.getByRole('button', { name: '检查并保存' })
  if (await check.isDisabled()) {
    const shot = await h.shot(`org-domain-blocked-${org.key}`)
    await h.log({ action: '登记官方域名', input: missing.join('、'), result: `检查按钮不可用：${(await dom.innerText()).replace(/\s+/g, ' ').slice(0, 240)}`, screenshot: shot })
    throw new Error(`域名检查不可用 ${org.key}`)
  }
  await check.click()
  await h.pause(400)
  const confirm = dom.getByRole('button', { name: '确认替换' })
  if (await confirm.isDisabled()) {
    const shot = await h.shot(`org-domain-unchanged-${org.key}`)
    await h.log({ action: '登记官方域名', input: missing.join('、'), result: '确认替换不可用，列表没有变化', screenshot: shot })
    throw new Error(`域名没有变化 ${org.key}`)
  }
  h.clearNet()
  await confirm.click()
  await h.pause(1200)
  const shot = await h.shot(`org-domain-${org.key}`)
  const after = await listedDomains(dom)
  const ok = wanted.every((host) => coversHost(host, after))
  await h.log({
    action: '登记官方域名',
    input: missing.join('、'),
    result: `${ok ? '成功' : '未见新增域名'}；现有 ${after.join('、') || '无'}；网络=${JSON.stringify(h.netErrors().slice(-2))}`,
    screenshot: shot,
  })
  if (!ok) throw new Error(`域名登记失败 ${org.key}`)
}

export async function ensurePolicyServices(session) {
  const { page, h } = session
  for (const org of ORGS) {
    await gotoPartners(h)
    const row = await exactOrgVisible(page, org.name)
    if (!row) throw new Error(`找不到机构 ${org.name}，无法核对政策服务`)
    const drawer = await openDetail(page, row)
    try {
      const box = await moduleBox(drawer, '政策服务')
      if (!box) throw new Error(`没有政策服务勾选框 ${org.key}`)
      if (await box.isChecked()) {
        await h.log({ action: '核对政策服务模块', input: org.name, result: '已经勾选' })
        continue
      }
      await box.check()
      h.clearNet()
      await drawer.getByRole('button', { name: '保存档案' }).click()
      await drawer.getByText('机构档案', { exact: true }).waitFor({ timeout: 15000 })
      await h.pause(500)
      const shot = await h.shot(`org-policy-module-${org.key}`)
      await h.log({
        action: '勾选政策服务模块',
        input: org.name,
        result: `已点保存；网络=${JSON.stringify(h.netErrors().slice(-2))}`,
        screenshot: shot,
      })
    } finally {
      await closeDrawer(drawer)
      await h.pause(200)
    }
    await gotoPartners(h)
    const saved = await exactOrgVisible(page, org.name)
    const modules = saved ? (await saved.locator('td').nth(3).innerText()).replace(/\s+/g, '') : ''
    await h.log({ action: '核对政策服务模块', input: org.name, result: modules.includes('政策服务') ? '列表里已有政策服务' : `列表未见政策服务：${modules.slice(0, 80)}` })
    if (!modules.includes('政策服务')) throw new Error(`政策服务没有保存 ${org.key}`)
  }
}

export async function ensureOrgDomains(session, org, hosts) {
  const { page, h } = session
  await gotoPartners(h)
  const row = await exactOrgVisible(page, org.name)
  if (!row) throw new Error(`找不到机构 ${org.name}，无法登记域名`)
  const drawer = await openDetail(page, row)
  try {
    await ensureDomains(page, h, drawer, org, hosts)
  } finally {
    await closeDrawer(drawer)
    await h.pause(200)
  }
}

async function finishExisting(page, h, secrets, org, hosts) {
  await gotoPartners(h)
  const row = await exactOrgVisible(page, org.name)
  if (!row) throw new Error(`找不到机构 ${org.name}`)
  const drawer = await openDetail(page, row)
  try {
    const account = accountOf(secrets, org.key)
    await saveProfile(page, h, drawer, org, account)
    await ensureTrust(page, h, drawer, org)
    await ensureDomains(page, h, drawer, org, hosts)
    await ensureAccount(page, h, drawer, account)
    savePartnerSecrets(secrets)
  } finally {
    await closeDrawer(drawer)
    await h.pause(300)
  }
}

async function createOrg(page, h, secrets, org) {
  await gotoPartners(h)
  await page.getByRole('button', { name: '新增机构' }).click()
  const drawer = page.locator('[role=dialog]').filter({ hasText: '新增合作机构' }).last()
  await drawer.waitFor()
  const account = accountOf(secrets, org.key)
  await (await fieldInput(drawer, '机构名称')).fill(org.name)
  await (await fieldInput(drawer, '机构类型')).selectOption({ label: org.typeLabel })
  await h.pause(300)
  await (await fieldInput(drawer, '联系人')).fill(account.contact)
  await drawer.locator('label').filter({ hasText: '联系电话' }).locator('input').first().fill(account.contactPhone)
  await ensurePolicyModule(drawer)
  await drawer.getByText('同时开通机构后台登录账号').click()
  await (await fieldInput(drawer, '登录用户名')).fill(account.username)
  await (await fieldInput(drawer, '账号姓名')).fill(account.accountName)
  await (await fieldInput(drawer, '登录手机号')).fill(account.phone)
  await drawer.locator('input[type=password]').fill(account.initialPassword)
  const shot = await h.shot(`org-create-form-${org.key}`)
  h.clearNet()
  await drawer.getByRole('button', { name: '创建机构' }).click()
  await h.pause(1500)
  const still = await drawer.isVisible().catch(() => false)
  const err = still ? (await drawer.innerText()).replace(/\s+/g, ' ').slice(-300) : ''
  await h.log({
    action: '新建合作机构',
    input: `${org.name}；类型 ${org.typeLabel}；账号 ${account.username}（密码略）`,
    result: still ? `失败：${err}` : '抽屉已关闭',
    screenshot: shot,
  })
  if (still) throw new Error(`新建机构失败 ${org.key}`)
  account.accountCreated = true
  savePartnerSecrets(secrets)
}

async function renameOrg(page, h, secrets, org, hosts) {
  await gotoPartners(h)
  const row = await exactOrgVisible(page, org.previousName)
  if (!row) return false
  const drawer = await openDetail(page, row)
  try {
    const account = accountOf(secrets, org.key)
    await saveProfile(page, h, drawer, org, account)
    await h.log({ action: '机构改名', input: `${org.previousName} → ${org.name}`, result: '已在档案里保存示例名' })
    await ensureTrust(page, h, drawer, org)
    await ensureDomains(page, h, drawer, org, hosts)
    await ensureAccount(page, h, drawer, account)
    savePartnerSecrets(secrets)
  } finally {
    await closeDrawer(drawer)
  }
  return true
}

export async function setupOrgs(session, hostsByOrg = {}) {
  const { page, h } = session
  const secrets = loadPartnerSecrets()
  const hostsOfOrg = (org) => (hostsByOrg[org.key]?.length ? hostsByOrg[org.key] : [org.domain])
  const notes = []
  for (const org of ORGS) {
    const hosts = hostsOfOrg(org)
    await gotoPartners(h)
    const hasNew = await exactOrgVisible(page, org.name)
    if (hasNew) {
      await h.log({ action: '确认示例机构', input: org.name, result: '列表里已有该名称，核对账号与域名' })
      await finishExisting(page, h, secrets, org, hosts)
      notes.push(`${org.name}：沿用已有名称`)
      continue
    }
    if (org.previousName) {
      const renamed = await renameOrg(page, h, secrets, org, hosts).catch(async (error) => {
        const shot = await h.shot(`org-rename-error-${org.key}`)
        await h.log({ action: '机构改名失败', input: org.previousName, result: String(error.message).slice(0, 240), screenshot: shot })
        return false
      })
      if (renamed) {
        notes.push(`${org.name}：由「${org.previousName}」改名`)
        continue
      }
      notes.push(`${org.name}：改名失败或找不到旧机构，改为新建`)
    }
    await createOrg(page, h, secrets, org)
    await finishExisting(page, h, secrets, org, hosts)
    notes.push(`${org.name}：新建`)
  }
  await gotoPartners(h)
  const search = page.getByPlaceholder('搜索机构名称、联系人...')
  await search.fill('示例·')
  await h.pause(500)
  const pageSize = page.locator('select').filter({ hasText: '100' }).last()
  if (await pageSize.count()) await pageSize.selectOption('100').catch(() => {})
  await h.pause(400)
  const shot = await h.shot('admin-partners-example')
  await h.log({ action: '示例机构列表', result: notes.join('；'), screenshot: shot })
  return notes
}
