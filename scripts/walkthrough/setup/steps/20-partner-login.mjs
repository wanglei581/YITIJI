// B：合作机构后台登录（账号从 secret/partners.json 读取，不打印密码）；
// 若弹「手机号本人验证」，点获取验证码，从 API 日志读 [DEV 短信] 验证码后确认验证。
// 用法：WALK_ACCOUNT=walk_partner_a node run.mjs steps/20-partner-login.mjs partner
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const KEY = process.env.WALK_ACCOUNT ?? 'walk_partner_a'
const API_LOG = join(homedir(), '.cache/walk0929/logs/api.log')

function latestSmsCode(phoneTail, afterLen) {
  const txt = readFileSync(API_LOG, 'utf8').slice(afterLen)
  const re = new RegExp(`\\[DEV 短信\\][^\\n]*${phoneTail}[^\\n]*验证码[:：]\\s*(\\d{6})`, 'g')
  let m, code = null
  while ((m = re.exec(txt))) code = m[1]
  return code
}

export default async ({ page, h }) => {
  const acct = h.readSecret('partners.json')[KEY]
  const password = acct.currentPassword ?? acct.initialPassword
  await h.goto('/login')
  await page.locator('#partner-login-id').fill(acct.username)
  await page.locator('#partner-password').fill(password)
  const agree = page.locator('button.c-agree')
  if ((await agree.getAttribute('aria-checked')) !== 'true') await agree.locator('.box').click()
  h.clearNet()
  await page.locator('form button[type=submit]').first().click()
  await h.settle(1500)
  let shot = await h.shot(`partner-login-${KEY}`)
  const verifyDlg = page.locator('[role=dialog][aria-label="手机号本人验证"]')
  if (await verifyDlg.isVisible().catch(() => false)) {
    await h.log({ action: '合作机构登录 → 弹出手机号本人验证', input: `账号 ${acct.username}（密码略）`, result: (await verifyDlg.innerText()).replace(/\s+/g, ' ').slice(0, 200), screenshot: shot })
    const logLen = readFileSync(API_LOG, 'utf8').length
    await verifyDlg.getByRole('button', { name: '获取验证码' }).click()
    let code = null
    for (let i = 0; i < 20 && !code; i++) { await page.waitForTimeout(500); code = latestSmsCode(acct.phone.slice(-4), logLen) }
    if (!code) {
      shot = await h.shot(`partner-verify-nocode-${KEY}`)
      await h.log({ action: '获取验证码', result: `API 日志 10 秒内没有该手机号的 [DEV 短信]；弹窗=${(await verifyDlg.innerText()).replace(/\s+/g, ' ').slice(0, 200)}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })
      await verifyDlg.getByRole('button', { name: '稍后验证' }).click()
    } else {
      await verifyDlg.locator('#partner-phone-verify-code').fill(code)
      h.clearNet()
      await verifyDlg.getByRole('button', { name: '确认验证' }).click()
      await h.settle(2000)
      shot = await h.shot(`partner-verified-${KEY}`)
      await h.log({ action: '手机号本人验证：填 API 日志中的短信码，确认验证', input: '验证码来自 [DEV 短信] 日志（不记录码值）', result: `${(await verifyDlg.isVisible().catch(() => false)) ? '弹窗未关：' + (await verifyDlg.innerText()).replace(/\s+/g, ' ').slice(0, 200) : '验证完成'}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })
    }
  }
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 10000 }).catch(() => {})
  await h.settle(1500)
  shot = await h.shot(`partner-dashboard-first-${KEY}`)
  const ok = !page.url().includes('/login')
  await h.log({ action: '合作机构后台登录结果', input: `账号 ${acct.username}`, result: ok ? `成功，进入 ${new URL(page.url()).pathname}；首页：${(await h.text('main')).replace(/\s+/g, ' ').slice(0, 300)}` : `失败：${(await h.text()).replace(/\s+/g, ' ').slice(0, 300)}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })
}
