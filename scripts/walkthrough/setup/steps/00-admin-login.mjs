// 管理员后台：密码登录（凭据从 secret/admin.json 读取，不打印）。
export default async ({ page, h }) => {
  const { username, password } = h.readSecret('admin.json')
  await h.goto('/login')
  await page.locator('#admin-login-id').fill(username)
  await page.locator('#admin-password').fill(password)
  const agree = page.locator('button.c-agree')
  if ((await agree.getAttribute('aria-checked')) !== 'true') await agree.locator('.box').click()
  await page.locator('form.c-pane button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {})
  await h.settle(1200)
  const shot = await h.shot('admin-login-dashboard')
  const ok = !page.url().includes('/login')
  await h.log({ action: '管理员登录', input: `账号 ${username}（密码略）`, result: ok ? '成功，进入 ' + new URL(page.url()).pathname : '失败：' + (await h.text()).slice(0, 200), screenshot: shot })
}
