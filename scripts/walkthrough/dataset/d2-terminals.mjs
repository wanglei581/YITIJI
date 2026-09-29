// 管理员后台：校正 WALK-001 的名称与位置，预建 WALK-002/003/004，生成绑定码。
// 绑定码只写入 secret/bind-WALK-00N.txt，不进流水、不进截图。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ORGS, TERMINALS } from './d2-catalog.mjs'
import { SECRET, writePrivate } from './d2-lib.mjs'

async function openTerminals(h) {
  await h.clickNav('设备管理', '/devices?tab=terminals')
  await h.page.getByRole('heading', { name: '设备管理' }).waitFor({ timeout: 15000 })
  const tab = h.page.getByRole('button', { name: '终端', exact: true })
  if (await tab.count()) await tab.click()
  await h.page.getByRole('button', { name: '预创建设备' }).waitFor({ timeout: 20000 })
  await h.page.waitForFunction(() => !document.querySelector('tbody .animate-pulse'), null, { timeout: 20000 }).catch(() => {})
  await h.pause(300)
}

async function searchCode(page, code) {
  const box = page.getByPlaceholder('搜索编号、设备名、MAC、位置、IP...')
  await box.fill(code)
  await page.waitForFunction(() => !document.querySelector('tbody .animate-pulse'), null, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(300)
  const row = page.locator('tbody tr').filter({ hasText: code }).first()
  if (await row.count()) return row
  return null
}

async function ensureProfile(page, h, terminal) {
  const row = await searchCode(page, terminal.code)
  if (!row) return false
  const text = await row.innerText()
  if (text.includes(terminal.name) && text.includes(terminal.location)) {
    await h.log({ action: '终端档案', input: terminal.code, result: '名称和位置已是网点口径' })
    return true
  }
  await row.getByRole('button', { name: `编辑 ${terminal.code} 设备档案` }).click()
  await h.pause(300)
  const editor = page.locator('tbody tr').filter({ hasText: terminal.code }).first()
  await editor.getByPlaceholder('设备名称').fill(terminal.name)
  await editor.getByPlaceholder('摆放位置').fill(terminal.location)
  h.clearNet()
  await editor.getByRole('button', { name: '保存设备档案' }).click()
  await h.pause(1200)
  const shot = await h.shot(`terminal-profile-${terminal.code}`)
  const notice = await page.locator('body').innerText()
  const rowAfter = await searchCode(page, terminal.code)
  const rowText = rowAfter ? await rowAfter.innerText() : ''
  const ok = notice.includes(`已更新终端 ${terminal.code}`) || (rowText.includes(terminal.name) && rowText.includes(terminal.location))
  await h.log({
    action: '更新终端名称和位置',
    input: `${terminal.code} / ${terminal.name} / ${terminal.location}`,
    result: ok ? '成功' : `未见成功提示；网络=${JSON.stringify(h.netErrors().slice(-2))}`,
    screenshot: shot,
  })
  if (!ok) throw new Error(`终端档案没有保存 ${terminal.code}`)
  return true
}

async function createTerminal(page, h, terminal) {
  const org = ORGS.find((item) => item.key === terminal.orgKey)
  await page.getByRole('button', { name: '预创建设备' }).click()
  const dialog = page.locator('[role=dialog][aria-labelledby="planned-terminal-title"]')
  await dialog.waitFor()
  await dialog.locator('label').filter({ hasText: '终端编号' }).locator('input').fill(terminal.code)
  await dialog.locator('label').filter({ hasText: '设备名称' }).locator('input').fill(terminal.name)
  await dialog.locator('label').filter({ hasText: '摆放位置' }).locator('input').fill(terminal.location)
  await dialog.locator('select').selectOption({ label: org.name })
  const shot = await h.shot(`terminal-create-${terminal.code}`)
  h.clearNet()
  await dialog.getByRole('button', { name: '创建设备' }).click()
  await h.pause(1500)
  const still = await dialog.isVisible().catch(() => false)
  const alert = still ? (await dialog.locator('[role=alert]').allInnerTexts()).join(' ') : ''
  await h.log({
    action: '预创建终端',
    input: `${terminal.code} / ${terminal.name} / ${org.name}`,
    result: still ? `失败：${alert || (await dialog.innerText()).slice(0, 180)}；网络=${JSON.stringify(h.netErrors().slice(-2))}` : '成功',
    screenshot: shot,
  })
  if (still) {
    await dialog.getByRole('button', { name: '关闭' }).click().catch(() => {})
    throw new Error(`预创建失败 ${terminal.code} ${alert}`)
  }
}

async function issueBindCode(page, h, terminal) {
  const secretName = `bind-${terminal.code}.txt`
  if (existsSync(join(SECRET, secretName))) {
    await h.log({ action: '绑定码', input: terminal.code, result: `${secretName} 已存在，不再重新生成` })
    return
  }
  const row = await searchCode(page, terminal.code)
  const button = page.getByRole('button', { name: `为 ${terminal.code} 生成一次性绑定码` })
  await button.waitFor({ timeout: 10000 })
  if (await button.isDisabled()) {
    const title = await button.getAttribute('title')
    const shot = await h.shot(`terminal-bind-disabled-${terminal.code}`)
    await h.log({
      action: '生成绑定码',
      input: terminal.code,
      result: `按钮不可用：${title ?? '无提示'}；行=${(await row.innerText()).replace(/\s+/g, ' ').slice(0, 180)}`,
      screenshot: shot,
    })
    throw new Error(`不能生成绑定码 ${terminal.code}`)
  }
  await button.click()
  const dialog = page.locator('[role=dialog]').filter({ hasText: '生成一次性绑定码' }).last()
  await dialog.waitFor()
  await dialog.locator('input[type=number]').fill('60')
  h.clearNet()
  await dialog.getByRole('button', { name: '生成绑定码', exact: true }).click()
  const generated = await dialog.getByText('已生成绑定码').waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  const code = generated ? (await dialog.locator('code').first().innerText().catch(() => '')).trim() : ''
  if (!generated || !code || code.length < 8 || code.includes('install-production-agent')) {
    const shot = await h.shot(`terminal-bind-fail-${terminal.code}`)
    const alert = (await dialog.locator('p').allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ').slice(0, 180)
    await h.log({ action: '生成绑定码', input: terminal.code, result: `没有读到码；${alert}；网络=${JSON.stringify(h.netErrors().slice(-2))}`, screenshot: shot })
    throw new Error(`绑定码生成失败 ${terminal.code}`)
  }
  writePrivate(secretName, `${code}\n`)
  await dialog.evaluate((el, secret) => {
    const walk = (node) => {
      if (node.nodeType === 3 && node.textContent?.includes(secret)) {
        node.textContent = node.textContent.split(secret).join('●●●●')
      } else node.childNodes.forEach(walk)
    }
    walk(el)
  }, code)
  const shot = await h.shot(`terminal-bind-${terminal.code}`)
  await h.log({
    action: '生成绑定码',
    input: `${terminal.code}，有效时长 60 分钟`,
    result: `已写入 secret/${secretName}（0600），码长 ${code.length}`,
    screenshot: shot,
  })
  await dialog.getByRole('button', { name: '我已经复制，关闭' }).click()
  await h.pause(400)
}

export async function setupTerminals(session) {
  const { page, h } = session
  await openTerminals(h)
  const shotBefore = await h.shot('terminals-before')
  await h.log({ action: '打开终端列表', result: '准备按四个网点核对', screenshot: shotBefore })
  for (const terminal of TERMINALS) {
    await openTerminals(h)
    const exists = await ensureProfile(page, h, terminal)
    if (!exists) {
      if (terminal.existing) throw new Error(`${terminal.code} 不在列表里，不能新建设备顶替已绑定的机器`)
      await createTerminal(page, h, terminal)
      await openTerminals(h)
      await ensureProfile(page, h, terminal)
    }
    if (!terminal.existing) await issueBindCode(page, h, terminal)
  }
  await openTerminals(h)
  await page.getByPlaceholder('搜索编号、设备名、MAC、位置、IP...').fill('WALK-00')
  await h.pause(400)
  const shot = await h.shot('terminals-walk')
  await h.log({ action: '终端列表核对', input: 'WALK-00', result: '四台网点终端应能被搜到', screenshot: shot })
}
