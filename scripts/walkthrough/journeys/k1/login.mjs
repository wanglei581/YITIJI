// 用一体机数字键盘登录：参数 phone
async function keypadType(page, digits) {
  for (const d of digits) { await page.getByRole('button', { name: d, exact: true }).click(); await page.waitForTimeout(80); }
}
export async function kioskLogin(page, lib, phone, who) {
  const reqs = [];
  page.on('response', async r => { if (r.url().includes('/api/') && r.request().method() !== 'GET') { let b = ''; try { b = (await r.text()).slice(0, 200); } catch {} reqs.push(r.request().method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '') + ' ' + r.status() + ' ' + b); } });
  const cb = page.getByRole('checkbox', { name: /我已阅读并同意/ });
  if ((await cb.getAttribute('aria-checked')) !== 'true') await cb.click();
  await page.getByText('请输入本人手机号').click(); await page.waitForTimeout(500);
  await keypadType(page, phone);
  const s1 = await lib.shot(page, 'login-phone-typed');
  // 输满 11 位后键盘自动切到验证码，并用遮罩盖住「获取验证码」：必须先收起键盘
  const hide = page.getByRole('button', { name: '收起键盘' });
  if (await hide.isVisible().catch(() => false)) { await hide.click(); await page.waitForTimeout(400); }
  await page.getByRole('button', { name: '获取验证码' }).click();
  await page.waitForTimeout(2500);
  const code = lib.latestSmsCode(phone.slice(-4));
  const s2 = await lib.shot(page, 'login-code-sent');
  // 打开验证码键盘
  await page.locator('[data-testid*=code], button:has-text("验证码")').filter({ hasNotText: '获取' }).filter({ hasNotText: '短信验证码 ' }).last().click().catch(() => {});
  await page.waitForTimeout(500);
  await keypadType(page, code);
  await page.waitForTimeout(800);
  const s3 = await lib.shot(page, 'login-code-typed');
  const btns = await page.$$eval('button', bs => bs.filter(b => b.getBoundingClientRect().height > 0).map(b => (b.innerText || b.getAttribute('aria-label') || '').replace(/\n/g, ' ').slice(0, 24)));
  lib.ledger({ 人物: who, 手机号: lib.mask(phone), 页面: page.url(), 操作: '数字键盘输手机号→获取验证码→输验证码', 输入: '验证码（取自 API 日志）', 结果: '见截图', 截图: [s1, s2, s3].join(',') });
  return { code: code ? 'got' : null, reqs, btns };
}
