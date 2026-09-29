/**
 * 管理员后台（4300 前端）两步：
 *   node clock-shift-admin.mjs provision
 *   node clock-shift-admin.mjs shots --order <订单号>
 * 绑定码只写入 0600 文件，不进 stdout。截图避开绑定码对话框。
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '/Users/wanglei/AI求职打印服务终端/.claude/worktrees/youthful-jang-8df61d/node_modules/.pnpm/playwright@1.55.1/node_modules/playwright/index.mjs'

const ADMIN = 'http://127.0.0.1:4320'
const STATE = join(homedir(), '.cache/walk0929/secret/ui-state-admin.json')
const SECRET = join(homedir(), '.cache/walk0929/secret/admin.json')
const BIND_FILE = join(homedir(), '.cache/walk0929/secret/walk-099-bind-code')
const SHOTS = join(homedir(), '.cache/walk0929/evidence/d3-clock')
const CODE = 'WALK-099'
const NAME = '示例·时钟验证机'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : ''
}

async function open() {
  mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    storageState: STATE,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  return { browser, page }
}

async function ensureLogin(page) {
  await page.goto(`${ADMIN}/devices?tab=terminals`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  if (!page.url().includes('/login')) return
  const secret = JSON.parse(readFileSync(SECRET, 'utf8'))
  const loginId = secret.loginId || secret.username || secret.account || secret.phone
  const password = secret.password
  if (!loginId || !password) throw new Error('管理员登录态失效，且 secret/admin.json 没有可用账号字段')
  await page.fill('input[autocomplete="username"], input[placeholder*="账号"]', loginId)
  await page.fill('#admin-password', password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 })
  await page.goto(`${ADMIN}/devices?tab=terminals&search=${CODE}`, { waitUntil: 'domcontentloaded' })
}

async function provision() {
  const { browser, page } = await open()
  try {
    await ensureLogin(page)
    await page.goto(`${ADMIN}/devices?tab=terminals&search=${CODE}`, { waitUntil: 'networkidle' })
    const existing = page.getByRole('button', { name: `为 ${CODE} 生成一次性绑定码` })
    if (await existing.count() === 0) {
      await page.getByRole('button', { name: '预创建设备' }).click()
      const dialog = page.getByRole('dialog', { name: '预创建设备' })
      await dialog.locator('input[placeholder="例如 KSK-011"]').fill(CODE)
      await dialog.locator('input[placeholder="例如 就业服务大厅 2 号机"]').fill(NAME)
      await dialog.locator('input[placeholder="例如 一楼东侧服务区"]').fill('示例·时钟验证，不接真机')
      await dialog.getByRole('button', { name: '创建设备' }).click()
      await page.getByText(`已预创建设备 ${CODE}`).waitFor({ timeout: 15_000 })
      await page.goto(`${ADMIN}/devices?tab=terminals&search=${CODE}`, { waitUntil: 'networkidle' })
    }
    await page.getByRole('button', { name: `为 ${CODE} 生成一次性绑定码` }).click()
    const bindDialog = page.getByRole('dialog', { name: `为终端 ${CODE} 生成绑定码` })
    await bindDialog.getByRole('button', { name: '生成绑定码' }).click()
    await bindDialog.getByText('一次性绑定码（终端）').waitFor()
    const code = (await bindDialog.locator('code').first().innerText()).trim()
    if (!code || code.length < 6) throw new Error('没有读到绑定码')
    writeFileSync(BIND_FILE, `${code}\n`, { mode: 0o600 })
    await bindDialog.getByRole('button', { name: '关闭绑定码弹窗' }).click()
    await page.screenshot({ path: join(SHOTS, '01-terminal-created.png'), fullPage: true })
    process.stdout.write(`provision ok terminal=${CODE} bindFile=${BIND_FILE} shot=${join(SHOTS, '01-terminal-created.png')}\n`)
  } finally {
    await browser.close()
  }
}

async function shots() {
  const orderNo = arg('--order')
  if (!orderNo) throw new Error('缺少 --order')
  const { browser, page } = await open()
  try {
    await ensureLogin(page)
    await page.goto(`${ADMIN}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const dashText = await page.locator('body').innerText()
    await page.screenshot({ path: join(SHOTS, '02-dashboard.png'), fullPage: true })

    await page.goto(`${ADMIN}/orders`, { waitUntil: 'networkidle' })
    const search = page.getByPlaceholder('搜索订单号')
    await search.fill(orderNo)
    await search.press('Enter')
    await page.waitForTimeout(1500)
    const row = page.getByRole('row', { name: new RegExp(orderNo) })
    const rowText = (await row.count()) > 0 ? await row.first().innerText() : ''
    await page.screenshot({ path: join(SHOTS, '03-orders.png'), fullPage: true })
    if ((await row.count()) > 0) {
      await row.first().click()
      await page.waitForTimeout(1200)
      await page.screenshot({ path: join(SHOTS, '04-order-detail.png'), fullPage: true })
    }

    await page.goto(`${ADMIN}/screen/usage`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(SHOTS, '05-screen-usage-default.png'), fullPage: true })
    await page.getByRole('button', { name: '近 30 天' }).click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(SHOTS, '06-screen-usage-30d.png'), fullPage: true })

    await page.goto(`${ADMIN}/screen/gov`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(SHOTS, '07-screen-gov.png'), fullPage: true })
    const govText = await page.locator('body').innerText()

    await page.goto(`${ADMIN}/devices?tab=terminals&search=${CODE}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    const terminalText = await page.locator('body').innerText()
    await page.screenshot({ path: join(SHOTS, '08-terminal-on-4300.png'), fullPage: true })

    const notes = {
      dashboardMentionsOrder: dashText.includes(orderNo),
      dashboardMentionsFile: dashText.includes('示例-时钟验证'),
      orderRow: rowText.replace(/\s+/g, ' ').slice(0, 500),
      govMentionsSep16: /09-16|9月16|09\/16|16日/.test(govText),
      terminalSnippet: terminalText.split('\n').filter((line) => /WALK-099|在线|离线|示例·时钟/.test(line)).slice(0, 12),
    }
    writeFileSync(join(SHOTS, 'ui-notes.json'), `${JSON.stringify(notes, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(notes, null, 2)}\n`)
  } finally {
    await browser.close()
  }
}

const cmd = process.argv[2]
if (cmd === 'provision') await provision()
else if (cmd === 'shots') await shots()
else {
  process.stderr.write('用法: provision | shots --order <订单号>\n')
  process.exit(1)
}
