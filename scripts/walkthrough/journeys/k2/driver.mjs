// K2 走查驱动：常驻一个 headless Chromium，本机 HTTP 口收一段 JS 在页面上下文外执行。
// 只用于本机走查；只监听 127.0.0.1。用法：
//   node scripts/walkthrough/journeys/k2/driver.mjs          # 启动（K2_DRIVER_PORT，默认 4792）
//   node scripts/walkthrough/journeys/k2/run.mjs <<'EOF'      # 发一段代码
//     await go('/'); return await text();
//   EOF
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/wanglei/AI求职打印服务终端/.claude/worktrees/youthful-jang-8df61d/apps/kiosk/node_modules/@playwright/test');

const PORT = Number(process.env.K2_DRIVER_PORT || 4792);
const EVID = path.join(os.homedir(), '.cache/walk0929/evidence/k2');
const LEDGER = path.join(EVID, 'ledger.jsonl');
const NETLOG = path.join(EVID, 'network-errors.jsonl');
const API_LOG = path.join(os.homedir(), '.cache/walk0929/logs/api.log');
const KIOSK = 'http://127.0.0.1:4310';
fs.mkdirSync(EVID, { recursive: true });

let seq = fs.readdirSync(EVID).filter((f) => /^\d{3}-/.test(f)).map((f) => Number(f.slice(0, 3))).reduce((a, b) => Math.max(a, b), 0);

const browser = await chromium.launch({ headless: true });
const state = { ctx: null, page: null, mctx: null, mpage: null, persona: '', phone: '', net: [], console: [] };

function shanghaiIso(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000).toISOString().replace('Z', '+08:00');
  return t;
}
function maskPhone(p) { return p ? `${p.slice(0, 3)}****${p.slice(-4)}` : ''; }

function wirePage(page, tag) {
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/api/v1/')) return;
    const st = res.status();
    const entry = { time: shanghaiIso(), tag, method: res.request().method(), url: url.replace(/^https?:\/\/[^/]+/, ''), status: st };
    if (st >= 400) {
      try { entry.body = (await res.text()).slice(0, 500); } catch { /* ignore */ }
      fs.appendFileSync(NETLOG, JSON.stringify(entry) + '\n');
    }
    state.net.push(entry);
    if (state.net.length > 400) state.net.shift();
  });
  page.on('console', (m) => { if (m.type() === 'error') { state.console.push({ time: shanghaiIso(), tag, text: m.text().slice(0, 300) }); if (state.console.length > 200) state.console.shift(); } });
  page.on('pageerror', (e) => { state.console.push({ time: shanghaiIso(), tag, text: 'PAGEERROR ' + String(e).slice(0, 300) }); });
}

async function newKiosk() {
  if (state.ctx) await state.ctx.close().catch(() => {});
  state.ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', acceptDownloads: true });
  state.page = await state.ctx.newPage();
  wirePage(state.page, 'kiosk');
  state.net = [];
  return state.page;
}
async function newMobile() {
  if (state.mctx) await state.mctx.close().catch(() => {});
  state.mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50' });
  state.mpage = await state.mctx.newPage();
  wirePage(state.mpage, 'mobile');
  return state.mpage;
}

const helpers = {
  get page() { return state.page; },
  get mpage() { return state.mpage; },
  state, newKiosk, newMobile, maskPhone, shanghaiIso, KIOSK, EVID,
  setPersona(name, phone) { state.persona = name; state.phone = phone; },
  async go(p, pg = state.page) { await pg.goto(p.startsWith('http') ? p : KIOSK + p, { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(1500); return pg.url(); },
  async shot(slug, opts = {}) {
    const pg = opts.page || state.page;
    seq += 1;
    const name = `${String(seq).padStart(3, '0')}-${slug}.png`;
    await pg.screenshot({ path: path.join(EVID, name), fullPage: !!opts.full });
    return name;
  },
  ledger(o) {
    const row = { time: shanghaiIso(), 人物: state.persona, 手机号: maskPhone(state.phone), 端: '一体机', 页面URL: (state.page && state.page.url().replace(KIOSK, '')) || '', ...o };
    fs.appendFileSync(LEDGER, JSON.stringify(row) + '\n');
    return row;
  },
  async text(pg = state.page) { return (await pg.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n').trim(); },
  async buttons(pg = state.page) {
    return pg.evaluate(() => [...document.querySelectorAll('button, a, [role=button], input, textarea, select')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((e) => { const r = e.getBoundingClientRect(); return `${e.tagName.toLowerCase()}${e.disabled ? '[disabled]' : ''}${e.getAttribute('aria-disabled') === 'true' ? '[aria-disabled]' : ''} "${(e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').replace(/\s+/g, ' ').slice(0, 60)}" ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}${e.getAttribute('href') ? ' href=' + e.getAttribute('href') : ''}`; }));
  },
  async click(textOrSel, pg = state.page, opts = {}) {
    let loc;
    if (textOrSel instanceof RegExp || !/^[.#\[]|^(button|a|input|textarea|div|span)[\[.:#]/.test(textOrSel)) {
      loc = pg.getByText(textOrSel, { exact: opts.exact ?? false });
      if (opts.role) loc = pg.getByRole(opts.role, { name: textOrSel, exact: opts.exact ?? false });
    } else loc = pg.locator(textOrSel);
    const n = await loc.count();
    if (n === 0) throw new Error(`找不到：${textOrSel}`);
    const target = loc.nth(opts.nth ?? (n > 1 ? n - 1 : 0));
    await target.click({ timeout: opts.timeout ?? 8000, force: opts.force });
    await pg.waitForTimeout(opts.wait ?? 1200);
    return `${n} 个匹配，点了第 ${(opts.nth ?? (n > 1 ? n - 1 : 0)) + 1} 个`;
  },
  smsCode(phone) {
    const tail = phone.slice(-4);
    const log = fs.readFileSync(API_LOG, 'utf8').split('\n');
    for (let i = log.length - 1; i >= 0; i--) {
      const m = log[i].match(/DEV 短信\]\s*\d{3}\*{4}(\d{4})\s*验证码[:：]\s*(\d{4,6})/);
      if (m && m[1] === tail) return m[2];
    }
    return null;
  },
  async fontAudit(pg = state.page) {
    return pg.evaluate(() => {
      const scale = (() => { const s = document.querySelector('[data-stage-scale]'); return s ? Number(s.getAttribute('data-stage-scale')) || 1 : 1; })();
      let small = 0, total = 0; const samples = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode; const t = n.textContent.trim(); if (!t) continue;
        const el = n.parentElement; const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
        const fs = parseFloat(cs.fontSize); total++; if (fs < 20) { small++; if (samples.length < 12) samples.push(`${fs}px:${t.slice(0, 20)}`); }
      }
      return { total, small, samples };
    });
  },
  async smallTargets(pg = state.page) {
    return pg.evaluate(() => [...document.querySelectorAll('button, a, [role=button]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 48 || r.width < 48); }).map((e) => { const r = e.getBoundingClientRect(); return `"${(e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`; }));
  },
  netSince(n = 30) { return state.net.slice(-n); },
  consoleErrors(n = 20) { return state.console.slice(-n); },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  fs, path,
};

await newKiosk();

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const started = Date.now();
    try {
      const fn = new AsyncFunction(...Object.keys(helpers), 'h', body);
      const out = await fn(...Object.values(helpers), helpers);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ms: Date.now() - started, out }, null, 1));
    } catch (e) {
      let shotName = null;
      try { shotName = await helpers.shot('error-auto'); } catch { /* ignore */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, ms: Date.now() - started, error: String(e && e.stack || e).slice(0, 1500), url: state.page && state.page.url(), shot: shotName }, null, 1));
    }
  });
});
server.timeout = 0;
server.requestTimeout = 0;
server.listen(PORT, '127.0.0.1', () => console.log(`k2 driver on ${PORT}`));
