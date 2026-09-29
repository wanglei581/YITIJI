// K1 走查（一体机打印扫描链）共用工具：连接常驻无头浏览器、截图、记流水、取验证码。
// 只用于本机走查，不部署。浏览器由 browsers.sh 启动（CDP 端口 9531 一体机、9532 手机）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const PW = path.join(REPO, 'node_modules/.pnpm/playwright@1.55.1/node_modules/playwright/index.mjs');
export const { chromium } = await import(PW);

export const HOME = os.homedir();
export const W = path.join(HOME, '.cache/walk0929');
export const EV = path.join(W, 'evidence/k1');
export const FIX = path.join(W, 'fixtures');
export const KIOSK = 'http://127.0.0.1:4310';
export const PHONE = 'http://127.0.0.1:4311';
export const API = 'http://127.0.0.1:4300/api/v1';
fs.mkdirSync(EV, { recursive: true });

const SEQ_FILE = path.join(EV, '.seq');
function nextSeq() {
  let n = 0;
  try { n = Number(fs.readFileSync(SEQ_FILE, 'utf8')) || 0; } catch {}
  n += 1;
  fs.writeFileSync(SEQ_FILE, String(n));
  return String(n).padStart(3, '0');
}

export function shanghaiIso(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600e3).toISOString().replace('Z', '+08:00');
  return t;
}

export async function connect(which = 'kiosk') {
  const port = which === 'kiosk' ? 9531 : 9532;
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => !p.url().startsWith('devtools')) ?? (await ctx.newPage());
  if (which === 'kiosk') await page.setViewportSize({ width: 1080, height: 1920 });
  else await page.setViewportSize({ width: 390, height: 844 });
  return { browser, ctx, page };
}

export async function shot(page, slug, opts = {}) {
  const name = `${nextSeq()}-${slug}.png`;
  await page.screenshot({ path: path.join(EV, name), fullPage: !!opts.fullPage });
  return name;
}

export function ledger(row) {
  const full = {
    time: shanghaiIso(),
    人物: row.人物 ?? '',
    手机号: row.手机号 ?? '',
    端: row.端 ?? '一体机',
    页面: row.页面 ?? '',
    操作: row.操作 ?? '',
    输入: row.输入 ?? '',
    结果: row.结果 ?? '',
    页数: row.页数 ?? '',
    份数: row.份数 ?? '',
    金额: row.金额 ?? '',
    单号: row.单号 ?? '',
    截图: row.截图 ?? '',
  };
  fs.appendFileSync(path.join(EV, 'ledger.jsonl'), JSON.stringify(full) + '\n');
}

/** 从 API 日志取某手机号后四位的最新验证码 */
export function latestSmsCode(last4) {
  const log = fs.readFileSync(path.join(W, 'logs/api.log'), 'utf8');
  const re = new RegExp(`\\*\\*\\*\\*${last4}\\D{0,20}验证码[:：]\\s*(\\d{4,8})`, 'g');
  let m, code = null;
  while ((m = re.exec(log))) code = m[1];
  return code;
}

/** 页面可见文字（截断） */
export async function visibleText(page, max = 3000) {
  const t = await page.evaluate(() => document.body.innerText);
  return t.replace(/\n{2,}/g, '\n').slice(0, max);
}

export function mask(phone) {
  return phone ? phone.slice(0, 3) + '****' + phone.slice(-4) : '';
}

/** 从当前任何状态回到一体机首页（屏保轻触、完成页回首页、底部导航「首页」） */
export async function toHome(page) {
  if (page.url().includes('screensaver')) { await page.mouse.click(540, 1000); await page.waitForTimeout(1500); }
  const kb = page.getByRole('button', { name: '收起键盘' });
  if (await kb.isVisible().catch(() => false)) await kb.click();
  if (new URL(page.url()).pathname !== '/') {
    const back = page.getByText('回首页', { exact: true });
    if (await back.isVisible().catch(() => false)) await back.click();
    else await page.locator('nav').getByText('首页', { exact: true }).last().click({ timeout: 5000 }).catch(async () => { await page.getByText('首页', { exact: true }).last().click({ timeout: 5000 }); });
    await page.waitForTimeout(1500);
  }
  if (page.url().includes('screensaver')) { await page.mouse.click(540, 1000); await page.waitForTimeout(1500); }
}
export async function toPrintScan(page) {
  await toHome(page);
  await page.getByText('打印 · 扫描').first().click();
  await page.waitForTimeout(1800);
}
export async function keypad(page, digits) {
  for (const d of digits) { await page.getByRole('button', { name: d, exact: true }).click({ timeout: 5000 }); await page.waitForTimeout(80); }
}
/** 记录 /api 响应（非 GET 带响应体前 N 字） */
export function netlog(page, filter = () => true, n = 300) {
  const reqs = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (!u.includes('/api/') || /heartbeat|printer-status|screensaver/.test(u) || !filter(u)) return;
    let b = '';
    if (r.request().method() !== 'GET') { try { b = (await r.text()).slice(0, n); } catch {} }
    reqs.push(`${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '').slice(0, 100)} ${r.status()} ${b}`);
  });
  return reqs;
}
