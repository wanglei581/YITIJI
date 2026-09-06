// verify:qingxu-proto-geometry — 青序流光 51 页原型在 1080×1920 真实视口下的几何门禁（2026-09-05）。
//
// 背景：2026-09-05 体检用同款探针在 662 个夹具态里查出回答区叠压、首页文字互撞、卡片内容画出边界等
// 缺陷，这些在缩略图里看不出来，typecheck / lint 也抓不到。本门禁把探针固化：
//   1. 内容最低点不超出 1920 舞台（可滚动容器内的内容除外；aria-hidden 隐藏层除外）；
//   2. 卡片类容器（有背景/边框/圆角、overflow:visible）内的静态子内容不得越出其 border box > 6px；
//   3. 可点区域最小边 ≥ 48px；
//   4. 正文最小字号 ≥ 14px（硬线），< 16px 的文本节点数不得超过基线（棘轮，只能降不能升）。
//
// 遍历口径：每页默认态 + 页内 `STATES=[...]` / `?state=` / sidecar JS 状态表列出的状态，
// 状态变体一律带 `capture=1&flat=1`（夹具门 + 去动效）。
// 用法：node scripts/verify-qingxu-proto-geometry.mjs [--update-baseline]
// 依赖：@playwright/test（kiosk 已有）；用 node:http 起本地静态服务，不需要 python。

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const kioskRoot = path.resolve(here, '..')
const repoRoot = path.resolve(kioskRoot, '..', '..')
const protoDir = path.join(repoRoot, 'docs', 'design', 'kiosk-redesign-2026-08')
const baselinePath = path.join(here, 'fixtures', 'qingxu-proto-geometry-baseline.json')
const require = createRequire(path.join(kioskRoot, 'package.json'))
const { chromium } = require('@playwright/test')

const UPDATE = process.argv.includes('--update-baseline')
const STAGE_H = 1920
const STAGE_TOLERANCE = 6
const OVERFLOW_TOLERANCE = 6
const MIN_TOUCH = 48
const HARD_MIN_FONT = 14
const SOFT_MIN_FONT = 16
// 36 是设计索引页（长页，自身可滚动）；51 是手机接力页（390 宽），不按 1080×1920 舞台判。
const STAGE_EXEMPT = new Set(['36-index.html', '51-phone-relay.html'])
// 51 是手机页，12px 辅助字是手机口径，不按 27 寸竖屏的字号硬线判。
const FONT_EXEMPT = new Set(['51-phone-relay.html'])
// 本地迭代用：--only <正则> 只跑匹配的页面（CI 不传，跑全量）。
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const ONLY = onlyArg ? new RegExp(onlyArg.slice('--only='.length)) : null

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' }

function statesOf(file) {
  let html = fs.readFileSync(path.join(protoDir, file), 'utf8')
  for (const m of html.matchAll(/src="([a-z0-9_-]+\.js)"/gi)) {
    try { html += '\n' + fs.readFileSync(path.join(protoDir, m[1]), 'utf8') } catch { /* sidecar 缺失由别的门禁管 */ }
  }
  const set = new Set()
  for (const m of html.matchAll(/\?state=([a-z0-9_-]+)/gi)) set.add(m[1])
  const arr = html.match(/var STATES\s*=\s*\[([\s\S]*?)\]/)
  if (arr) for (const m of arr[1].matchAll(/'([a-z0-9_-]+)'/g)) set.add(m[1])
  for (const m of html.matchAll(/\[\s*'([a-z0-9_-]+)'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*\]/g)) set.add(m[1])
  for (const m of html.matchAll(/data-state="([a-z0-9_-]+)"/g)) set.add(m[1])
  return [...set].filter((s) => s.length > 2 && s !== 'state')
}

const PROBE = () => {
  const stage = document.getElementById('stage') || document.querySelector('.stage') || document.body
  const sr = stage.getBoundingClientRect()
  const cs = (el) => getComputedStyle(el)
  const isScroller = (el) => { const s = cs(el); return /(auto|scroll)/.test(s.overflowY) || /(auto|scroll)/.test(s.overflow) }
  const insideScrollerBelow = (d, ancestor) => { let e = d.parentElement; while (e && e !== ancestor) { if (isScroller(e)) return true; e = e.parentElement } return false }
  const vis = []
  for (const el of stage.querySelectorAll('*')) {
    const st = cs(el)
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) continue
    if (el.closest('[aria-hidden="true"]')) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    vis.push({ el, r, st })
  }
  let contentBottom = 0
  for (const v of vis) {
    if (v.st.position === 'fixed') continue
    if (insideScrollerBelow(v.el, stage)) continue
    contentBottom = Math.max(contentBottom, v.r.bottom - sr.top)
  }
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT)
  let minFont = null, under16 = 0, under14 = 0, n
  const under14Sample = []
  while ((n = walker.nextNode())) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue
    const p = n.parentElement
    if (!p || p.closest('[aria-hidden="true"]')) continue
    const st = cs(p)
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) continue
    const r = p.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    const px = parseFloat(st.fontSize)
    if (minFont === null || px < minFont) minFont = px
    if (px < 16) under16++
    if (px < 14) { under14++; if (under14Sample.length < 3) under14Sample.push(`${px}px:${n.nodeValue.trim().slice(0, 12)}`) }
  }
  const small = []
  for (const el of stage.querySelectorAll('button,a[href],[role="button"],input,select,textarea,[data-route]')) {
    const st = cs(el)
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) continue
    if (el.closest('[aria-hidden="true"]')) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    if (Math.min(r.width, r.height) < 48) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 12)} ${Math.round(r.width)}x${Math.round(r.height)}`)
  }
  const overflows = []
  for (const v of vis) {
    const st = v.st
    const cardLike = (st.backgroundColor !== 'rgba(0, 0, 0, 0)' && st.backgroundColor !== 'transparent') || parseFloat(st.borderRadius) > 0 || parseFloat(st.borderTopWidth) > 0
    if (!cardLike) continue
    if (st.overflow !== 'visible' && st.overflowY !== 'visible') continue
    let maxB = -1e9, maxR = -1e9, worst = ''
    for (const d of v.el.querySelectorAll('*')) {
      const ds = cs(d)
      if (ds.position === 'absolute' || ds.position === 'fixed') continue
      if (ds.display === 'none' || ds.visibility === 'hidden') continue
      if (d.closest('[aria-hidden="true"]')) continue
      if (insideScrollerBelow(d, v.el)) continue
      const dr = d.getBoundingClientRect()
      if (dr.width <= 0 || dr.height <= 0) continue
      if (dr.bottom > maxB) { maxB = dr.bottom; worst = (d.textContent || '').trim().slice(0, 16) }
      if (dr.right > maxR) maxR = dr.right
    }
    const ob = maxB - v.r.bottom, orr = maxR - v.r.right
    if (ob > 6 || orr > 6) overflows.push(`${String(v.el.className).split(' ')[0] || v.el.tagName}:${Math.round(Math.max(ob, orr))}px "${worst}"`)
  }
  // 可滚动区域被压成一条（内容有得滚、可视高度却不足 160px）：回答区、列表这类主内容被
  // 邻居挤扁时不会「越界」，但用户只能看到一条横纹，这是 05 回答态曾经的真实缺陷形态。
  const shortScrollers = []
  for (const v of vis) {
    if (!isScroller(v.el)) continue
    const ch = v.el.clientHeight, sh = v.el.scrollHeight
    if (sh > ch + 4 && ch < 160 && v.r.width >= 300) shortScrollers.push(`${String(v.el.className).split(' ')[0] || v.el.tagName}: 可视 ${Math.round(ch)}px / 内容 ${Math.round(sh)}px`)
  }
  return { contentBottom: Math.round(contentBottom), minFont, under16, under14, under14Sample, small, overflows, shortScrollers }
}

async function main() {
  const files = fs.readdirSync(protoDir).filter((f) => /^\d{2}-.*\.html$/.test(f) && (!ONLY || ONLY.test(f))).sort()
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const file = path.join(protoDir, decodeURIComponent(url.pathname))
    if (!file.startsWith(protoDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/`
  const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {}
  const nextBaseline = {}
  const failures = []
  let variants = 0
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'zh-CN' })
  try {
    for (const file of files) {
      const queries = ['', ...statesOf(file).map((s) => `?state=${s}&capture=1&flat=1`)]
      let pageMaxUnder16 = 0
      for (const q of queries) {
        const page = await ctx.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 100)))
        try {
          await page.goto(base + file + q, { waitUntil: 'networkidle', timeout: 20000 })
          await page.waitForTimeout(400)
          const m = await page.evaluate(PROBE)
          variants++
          const tag = `${file}${q}`
          if (errors.length) failures.push(`${tag}: pageerror ${errors[0]}`)
          if (!STAGE_EXEMPT.has(file) && m.contentBottom > STAGE_H + STAGE_TOLERANCE) failures.push(`${tag}: 内容最低点 ${m.contentBottom} 超出舞台 1920`)
          if (m.overflows.length) failures.push(`${tag}: ${m.overflows.length} 处卡片内容越界 — ${m.overflows.slice(0, 2).join('; ')}`)
          if (m.small.length) failures.push(`${tag}: ${m.small.length} 个可点区域 < ${MIN_TOUCH}px — ${m.small.slice(0, 2).join('; ')}`)
          if (m.shortScrollers.length) failures.push(`${tag}: ${m.shortScrollers.length} 个可滚动区域被压扁（可视 < 160px）— ${m.shortScrollers.slice(0, 2).join('; ')}`)
          if (!FONT_EXEMPT.has(file) && m.minFont !== null && m.minFont < HARD_MIN_FONT) failures.push(`${tag}: 最小字号 ${m.minFont}px < ${HARD_MIN_FONT} — ${m.under14Sample.join('; ')}`)
          pageMaxUnder16 = Math.max(pageMaxUnder16, m.under16)
        } catch (e) {
          failures.push(`${file}${q}: 探针失败 ${String(e.message).slice(0, 120)}`)
        } finally {
          await page.close()
        }
      }
      nextBaseline[file] = pageMaxUnder16
      const allowed = Object.prototype.hasOwnProperty.call(baseline, file) ? baseline[file] : 0
      if (!UPDATE && pageMaxUnder16 > allowed) failures.push(`${file}: 小于 ${SOFT_MIN_FONT}px 的文本节点 ${pageMaxUnder16} 个，超过基线 ${allowed}（只能降不能升）`)
      process.stdout.write('.')
    }
  } finally {
    await browser.close()
    server.close()
  }
  process.stdout.write('\n')
  if (UPDATE) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
    fs.writeFileSync(baselinePath, JSON.stringify(nextBaseline, null, 2) + '\n')
    console.log(`baseline updated: ${baselinePath}`)
  }
  if (process.env.QINGXU_PROTO_GEOMETRY_OUT) fs.writeFileSync(process.env.QINGXU_PROTO_GEOMETRY_OUT, JSON.stringify({ variants, failures, nextBaseline }, null, 1))
  if (failures.length) {
    console.error(`FAIL: ${failures.length} 项（${variants} 个页面/状态）`)
    for (const f of failures) console.error('  ' + f)
    process.exit(1)
  }
  console.log(`ALL PASS: qingxu proto geometry (${files.length} pages, ${variants} variants)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
