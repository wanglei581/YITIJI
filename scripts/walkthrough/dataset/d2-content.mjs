// 机构后台发布官方渠道和政策，管理员紧急下架其中 2 条。
// 渠道界面没有「自审 / 对内容负责」，实际动作是「保存后立即启用」。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ORGS } from './d2-catalog.mjs'
import { EVID, openAdmin, openPartner } from './d2-lib.mjs'
import { ensureOrgDomains, ensurePolicyServices } from './d2-orgs.mjs'
import { accountOf, loadPartnerSecrets } from './d2-secrets.mjs'
import { loadDraftContent, waitForContent } from './d2-sources.mjs'

const STATE_PATH = join(EVID, 'state.json')

function readState() {
  if (!existsSync(STATE_PATH)) return { takedownDone: [] }
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')) } catch { return { takedownDone: [] } }
}

function writeState(state) {
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
}

async function gotoFirstPage(page) {
  for (let i = 0; i < 6; i += 1) {
    const prev = page.getByRole('button', { name: '上一页' })
    if (!(await prev.count()) || (await prev.isDisabled())) return
    await prev.click()
    await page.waitForTimeout(400)
  }
}

async function policyRow(page, title) {
  await gotoFirstPage(page)
  for (let i = 0; i < 6; i += 1) {
    const row = page.locator('tbody tr').filter({ hasText: title }).first()
    if (await row.count()) return row
    const next = page.getByRole('button', { name: '下一页' })
    if (!(await next.count()) || (await next.isDisabled())) return null
    await next.click()
    await page.waitForTimeout(500)
  }
  return null
}

async function openPolicyForm(page) {
  await page.getByRole('button', { name: '新增政策内容' }).click()
  const drawer = page.getByRole('dialog', { name: '新增政策内容' })
  await drawer.waitFor()
  return drawer
}

async function fillPolicy(drawer, h, policy) {
  await drawer.locator('label').filter({ hasText: '内容类型' }).locator('select').selectOption(policy.kind)
  await drawer.locator('label').filter({ hasText: '标题' }).locator('input').fill(policy.title)
  const extra = policy.kind === 'policy_guide'
    ? drawer.locator('label').filter({ hasText: '适用人群' }).locator('select')
    : drawer.locator('label').filter({ hasText: '公告标签' }).locator('select')
  await extra.waitFor({ timeout: 10000 })
  await extra.selectOption(policy.kind === 'policy_guide' ? policy.audience : policy.category)
  await drawer.locator('label').filter({ hasText: '摘要' }).locator('textarea').fill(policy.summary)
  await drawer.locator('label').filter({ hasText: '正文' }).locator('textarea').fill(policy.content)
  const link = drawer.locator('label').filter({ hasText: '政策来源' }).locator('input')
  if (policy.externalUrl) await link.fill(policy.externalUrl)
  if (policy.publishedDate) {
    await drawer.locator('label').filter({ hasText: '展示日期' }).locator('input').fill(policy.publishedDate)
  }
}

async function createPolicy(page, h, policy) {
  const drawer = await openPolicyForm(page)
  await fillPolicy(drawer, h, policy)
  h.clearNet()
  await drawer.getByRole('button', { name: '提交审核' }).click()
  const closed = await drawer.waitFor({ state: 'hidden', timeout: 20000 }).then(() => true).catch(() => false)
  if (!closed) {
    const err = (await drawer.innerText()).replace(/\s+/g, ' ').slice(0, 300)
    const shot = await h.shot(`policy-create-fail-${policy.orgKey}`)
    await h.log({ action: '提交政策审核', input: policy.title, result: `抽屉没关：${err}；网络=${JSON.stringify(h.netErrors().slice(-2))}`, screenshot: shot })
    await drawer.getByRole('button', { name: '关闭' }).click().catch(() => {})
    throw new Error(`政策提交失败 ${policy.title}`)
  }
  await page.locator('tbody tr').filter({ hasText: policy.title }).first().waitFor({ timeout: 15000 })
  await h.log({ action: '提交政策审核', input: `${policy.title}；${policy.disposition}`, result: '已保存为待审核' })
}

async function policyCells(row) {
  const review = (await row.locator('td').nth(4).innerText()).replace(/\s+/g, '')
  const publish = (await row.locator('td').nth(5).innerText()).replace(/\s+/g, '')
  return { review, publish }
}

async function approveAndRelease(page, h, policy) {
  let row = await policyRow(page, policy.title)
  if (!row) throw new Error(`提交后找不到政策 ${policy.title}`)
  let cells = await policyCells(row)
  if (!cells.review.includes('已通过') && !cells.publish.includes('已发布')) {
    await row.getByRole('button', { name: '审核通过' }).click()
    const ok = await page.getByText('已审核通过').waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
    const shot = await h.shot(`policy-approve-${policy.orgKey}`)
    await h.log({
      action: '机构自审通过',
      input: policy.title,
      result: ok ? '审核通过' : `未见通过提示：${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 180)}`,
      screenshot: shot,
    })
    if (!ok) throw new Error(`自审失败 ${policy.title}`)
    row = await policyRow(page, policy.title)
    cells = await policyCells(row)
  }
  if (cells.publish.includes('已发布')) {
    await h.log({ action: '确认发布', input: policy.title, result: '已经是已发布' })
    return
  }
  await row.getByRole('button', { name: '发布', exact: true }).click()
  const dialog = page.locator('[role=dialog][aria-labelledby="policy-release-title"]')
  await dialog.waitFor()
  await dialog.getByRole('checkbox').check()
  h.clearNet()
  await dialog.getByRole('button', { name: '确认发布' }).click()
  const closed = await dialog.waitFor({ state: 'hidden', timeout: 20000 }).then(() => true).catch(() => false)
  const shot = await h.shot(`policy-release-${policy.orgKey}`)
  const afterCells = closed ? await policyCells(await policyRow(page, policy.title)) : null
  const after = closed ? `${afterCells.review}/${afterCells.publish}` : (await dialog.innerText())
  const ok = closed && afterCells.publish.includes('已发布')
  await h.log({
    action: '勾选对内容负责并发布',
    input: policy.title,
    result: ok ? '已发布' : `未发布：${after.replace(/\s+/g, ' ').slice(0, 220)}；网络=${JSON.stringify(h.netErrors().slice(-2))}`,
    screenshot: shot,
  })
  if (!ok) throw new Error(`发布失败 ${policy.title}`)
}

async function publishPolicies(page, h, org, policies) {
  await h.clickNav('政策公告管理', '/policy')
  await page.getByRole('heading', { name: '政策公告' }).waitFor({ timeout: 15000 })
  await h.pause(600)
  const add = page.getByRole('button', { name: '新增政策内容' })
  if (await add.isDisabled()) {
    const shot = await h.shot(`policy-disabled-${org.key}`)
    await h.log({ action: '打开政策公告', input: org.name, result: `不能新建：${await add.getAttribute('title')}`, screenshot: shot })
    throw new Error(`机构不能发布政策 ${org.key}`)
  }
  for (const policy of policies) {
    let row = await policyRow(page, policy.title)
    if (!row) {
      await gotoFirstPage(page)
      await createPolicy(page, h, policy)
      row = await policyRow(page, policy.title)
    }
    const cells = await policyCells(row)
    if (cells.publish.includes('平台已紧急下架') || cells.publish.includes('已下架')) {
      await h.log({ action: '跳过政策', input: policy.title, result: `发布状态 ${cells.publish}` })
      continue
    }
    if (policy.disposition === 'pending') {
      await h.log({
        action: '政策留待审核',
        input: policy.title,
        result: cells.review.includes('待审核') || cells.review.includes('审核中') ? '仍是待审核，不发布' : `当前：${cells.review}/${cells.publish}`,
      })
      continue
    }
    if (cells.publish.includes('已发布')) {
      await h.log({ action: '跳过政策', input: policy.title, result: '已发布' })
      continue
    }
    await approveAndRelease(page, h, policy)
  }
  const shot = await h.shot(`policy-list-${org.key}`)
  await h.log({ action: '政策列表', input: org.name, result: `本机构 ${policies.length} 条已处理`, screenshot: shot })
}

async function publishChannels(page, h, org, channels) {
  await h.clickNav('机构资料', '/profile')
  await page.getByRole('heading', { name: '本机构官方渠道' }).waitFor({ timeout: 15000 })
  const add = page.getByRole('button', { name: '添加渠道' })
  await add.scrollIntoViewIfNeeded()
  const enabled = await page.waitForFunction((el) => el instanceof HTMLButtonElement && !el.disabled, await add.elementHandle(), { timeout: 15000 }).then(() => true).catch(() => false)
  if (!enabled) {
    const shot = await h.shot(`channel-disabled-${org.key}`)
    await h.log({ action: '添加官方渠道', input: org.name, result: `按钮不可用：${await add.getAttribute('title')}`, screenshot: shot })
    throw new Error(`还不能添加渠道 ${org.key}`)
  }
  for (const channel of channels) {
    const table = page.locator('[aria-label="本机构官方渠道列表"]')
    if ((await table.count()) && (await table.innerText()).includes(channel.name)) {
      await h.log({ action: '跳过官方渠道', input: channel.name, result: '列表里已有' })
      continue
    }
    await add.click()
    const dialog = page.getByRole('dialog').filter({ hasText: '添加官方渠道' })
    await dialog.waitFor()
    await dialog.locator('label').filter({ hasText: '渠道名称' }).locator('input').fill(channel.name)
    await dialog.locator('label').filter({ hasText: '链接' }).locator('input').fill(channel.url)
    await dialog.locator('label').filter({ hasText: '排序' }).locator('input').fill(channel.order)
    const box = dialog.locator('label').filter({ hasText: '保存后立即启用' }).locator('input[type=checkbox]')
    if (!(await box.isChecked())) await box.check()
    h.clearNet()
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    const closed = await dialog.waitFor({ state: 'hidden', timeout: 15000 }).then(() => true).catch(() => false)
    const shot = await h.shot(`channel-${org.key}`)
    const alert = closed ? '' : (await dialog.locator('[role=alert]').allInnerTexts()).join(' ')
    await h.log({
      action: '添加官方渠道并启用',
      input: `${channel.name} ${channel.url}（界面没有自审和对内容负责，用保存后立即启用）`,
      result: closed ? '已保存' : `没有保存：${alert}；网络=${JSON.stringify(h.netErrors().slice(-2))}`,
      screenshot: shot,
    })
    if (!closed) {
      await dialog.getByRole('button', { name: '关闭' }).click().catch(() => {})
      throw new Error(`渠道保存失败 ${channel.name}`)
    }
  }
}

function takedownTargets(policies, done) {
  const pool = policies.filter((item) => item.disposition === 'expired' || item.disposition === 'takedown')
  const already = new Set(done)
  const remaining = pool.filter((item) => !already.has(item.title))
  const picked = []
  for (const code of ['expired', 'takedown']) {
    const hit = remaining.find((item) => item.disposition === code && !picked.includes(item))
    if (hit) picked.push(hit)
  }
  for (const item of remaining) {
    if (picked.length >= 2) break
    if (!picked.includes(item)) picked.push(item)
  }
  return picked.slice(0, Math.max(0, 2 - already.size))
}

async function emergencyTakedown(session, policy) {
  const { page, h } = session
  await h.clickNav('政策信息源', '/policy-sources')
  await page.getByPlaceholder('搜索标题、来源机构...').waitFor({ timeout: 15000 })
  const search = page.getByPlaceholder('搜索标题、来源机构...')
  await search.fill(policy.title)
  await h.pause(1200)
  const row = page.locator('tbody tr').filter({ hasText: policy.title }).first()
  await row.waitFor({ timeout: 15000 })
  const publishCell = (await row.locator('td').nth(7).innerText()).replace(/\s+/g, '')
  if (publishCell.includes('已下架')) {
    await h.log({ action: '紧急下架', input: policy.title, result: '列表里已经是下架状态，跳过' })
    return
  }
  await row.getByRole('button', { name: '紧急下架' }).click()
  const dialog = page.locator('[role=dialog][aria-labelledby="emergency-takedown-title"]')
  await dialog.waitFor()
  const mark = policy.disposition === 'expired' ? '已过期' : '准备下架'
  await dialog.locator('#emergency-takedown-reason').selectOption('other')
  await dialog.locator('#emergency-takedown-note').fill(`示例：该条标注为「${mark}」，按数据集走查走紧急下架。不是真实投诉，也不认定出处原文违法。`)
  const shotForm = await h.shot(`takedown-form-${policy.orgKey}`)
  h.clearNet()
  await dialog.getByRole('button', { name: '确认紧急下架（不可恢复）' }).click()
  const done = dialog.getByRole('button', { name: '完成' })
  const ok = await done.waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  const shot = await h.shot(`takedown-result-${policy.orgKey}`)
  const text = (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 240)
  await h.log({
    action: '管理员紧急下架',
    input: `${policy.title}；事由 其他；标注 ${mark}`,
    result: ok ? `服务端已确认。${text}` : `没有完成：${text}；网络=${JSON.stringify(h.netErrors().slice(-2))}`,
    screenshot: ok ? shot : shotForm,
  })
  if (!ok) throw new Error(`紧急下架失败 ${policy.title}`)
  await done.click()
  await h.pause(400)
}

export async function publishContent() {
  const ready = await waitForContent()
  const content = ready ?? loadDraftContent()
  const state = readState()
  state.contentSource = content.source
  state.contentPaths = content.paths
  state.policyCount = content.policies.length
  state.channelCount = content.channels.length
  writeState(state)
  console.log(`内容来源：${content.source}，政策 ${content.policies.length}，渠道 ${content.channels.length}`)

  const admin = await openAdmin()
  try {
    await ensurePolicyServices(admin)
    for (const org of ORGS) {
      await ensureOrgDomains(admin, org, content.hostsByOrg[org.key])
    }
  } finally {
    await admin.close()
  }

  const secrets = loadPartnerSecrets()
  for (const org of ORGS) {
    const account = accountOf(secrets, org.key)
    const session = await openPartner(account)
    try {
      const channels = content.channels.filter((item) => item.orgKey === org.key)
      const policies = content.policies.filter((item) => item.orgKey === org.key)
      await publishChannels(session.page, session.h, org, channels)
      await publishPolicies(session.page, session.h, org, policies)
    } finally {
      await session.close()
    }
  }

  const targets = takedownTargets(content.policies, state.takedownDone ?? [])
  if (!targets.length) {
    console.log('紧急下架已做过 2 条，不再追加')
    return content
  }
  const again = await openAdmin()
  try {
    for (const policy of targets) {
      await emergencyTakedown(again, policy)
      state.takedownDone = [...(state.takedownDone ?? []), policy.title]
      writeState(state)
    }
  } finally {
    await again.close()
  }
  return content
}
