// audit:qingxu-v2-drafts — 按需检查「青序流光 2.0」稿（docs/design/kiosk-redesign-2026-08-v2）的每一个状态，
// 对应 v2 目录 README 的规则 2、规则 4，外加文字被压住：
//   1. 用词：可见文字（含读屏文字）不出现写给用户看的工程词；
//   2. 字号：可见文字不小于 20px（备案号那一行除外；51 是手机页，按手机字阶，不查字号）；
//   3. 压字：一段文字上有别的元素压着（卡片盖住标签、两段字叠在一起、内容钻到底部导航下面）。
//      弹层（role=dialog / aria-modal、铺满整屏的遮罩）盖住底下的页面不算，透明无字的点击层不算；
//      水印、印章这类装饰用 aria-hidden 或 pointer-events:none 标出来，不参与判断。
//
// 状态清单与并排截图工具（tests/visual/qingxu-pairs.spec.ts）共用 tests/visual/fixtures/qingxu-pair-targets.ts
// 的 buildQingxuPairs()：用 vite 自带的 esbuild 临时打包后导入，两边不会各数各的。稿的取法也一样：
// v2 目录里有的稿（及其 .js / .css 附件）以 v2 为准，其余读原稿。只检查解析到 v2 目录的稿。
//
// 用法（在 apps/kiosk 下）：node scripts/audit-qingxu-v2-drafts.mjs [--only=<正则，匹配稿文件名>] [--json=<输出文件>]
// 有问题退出码为 1。不进 CI：v2 稿还在陆续补，改稿后自己跑。

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const kioskRoot = path.resolve(here, '..')
const require = createRequire(path.join(kioskRoot, 'package.json'))
const { chromium } = require('@playwright/test')
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')

const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const ONLY = onlyArg ? new RegExp(onlyArg.slice('--only='.length)) : null
const jsonArg = process.argv.find((a) => a.startsWith('--json='))
const JSON_OUT = jsonArg ? path.resolve(jsonArg.slice('--json='.length)) : null

// 规则 4 的用词：写给用户看的页面上不该出现的工程词。
const BANNED = /服务端|后端|前台|后台|落库|会话|元数据|回执|链路|网桥|真机|未验收|pending|uploaded|签名链接|字段|接口/
const MIN_FONT = 20
const FONT_EXEMPT = new Set(['51-phone-relay.html'])
const ICP_LINE = /备案|ICP|公网安备/
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' }

async function loadPairTargets() {
  const entry = path.join(kioskRoot, 'tests', 'visual', 'fixtures', 'qingxu-pair-targets.ts')
  // 打包结果放在 kiosk 自己的 node_modules/.cache 下：留在外部的第三方包（如 @playwright/test）要能从这里解析到。
  const cacheRoot = path.join(kioskRoot, 'node_modules', '.cache')
  fs.mkdirSync(cacheRoot, { recursive: true })
  const outDir = fs.mkdtempSync(path.join(cacheRoot, 'qx-v2-audit-'))
  const outFile = path.join(outDir, 'pair-targets.mjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: outFile,
    logLevel: 'error',
    // 打包后文件不在源目录；模块里按 import.meta.url 算稿目录，要让它仍指向源文件所在目录。
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(entry).href) },
    // 只打包仓库自己的代码（含 @ai-job-print/* 工作区包，它们发的是 TS 源码）；第三方包留在外部。
    plugins: [{
      name: 'keep-third-party-external',
      setup(build) {
        build.onResolve({ filter: /^[^./]/ }, (args) => (
          args.path.startsWith('@ai-job-print/') || args.path.startsWith('node:') ? undefined : { path: args.path, external: true }
        ))
      },
    }],
  })
  try {
    return await import(pathToFileURL(outFile).href)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
}

// 在页面里跑：返回工程词、小字、被压住的文字。
const PROBE = ({ bannedSource, minFont, checkFont, icpSource }) => {
  const banned = new RegExp(bannedSource)
  const icp = new RegExp(icpSource)
  const VW = window.innerWidth
  const VH = window.innerHeight
  const lines = document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean)
  const words = [...new Set(lines.filter((l) => banned.test(l)))]

  const cs = (el) => getComputedStyle(el)
  const hidden = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const st = cs(e)
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) return true
    }
    return false
  }
  const visuallyHiddenText = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const st = cs(e)
      if (st.clipPath !== 'none' || (st.clip && st.clip !== 'auto')) return true
    }
    return false
  }
  const decoration = (el) => Boolean(el.closest('[aria-hidden="true"]')) || cs(el).pointerEvents === 'none'
  const overlay = (el) => el.closest('[role="dialog"],[aria-modal="true"],dialog')
  // 压在上面的元素自己画了东西才算压字：透明、无字的点击层（待机屏「点任意处唤醒」）不挡视线。
  const paints = (e) => {
    if (/^(img|svg|canvas|video|picture|iframe|input|textarea|select|path|circle|rect|g|use|polygon|polyline|line|ellipse)$/i.test(e.tagName)) return true
    if ((e.textContent || '').trim()) return true
    const st = cs(e)
    if (st.backgroundImage !== 'none') return true
    const m = st.backgroundColor.match(/rgba?\(([^)]+)\)/)
    return Boolean(m && (m[1].split(',').length < 4 || parseFloat(m[1].split(',')[3]) > 0.05))
  }
  // 铺满整屏的定位层（弹窗遮罩、待机层）盖住底下的页面是设计如此。
  const fullLayer = (e, el) => {
    for (let x = e; x && x !== document.body && x !== document.documentElement; x = x.parentElement) {
      if (x.contains(el)) return false
      const st = cs(x)
      if (st.position !== 'fixed' && st.position !== 'absolute') continue
      const r = x.getBoundingClientRect()
      if (r.width >= VW * 0.9 && r.height >= VH * 0.9) return true
    }
    return false
  }
  // 文字所在的可见框：视口与各级裁切祖先（overflow 不是 visible）的交集。
  const clipBox = (el) => {
    let box = { l: 0, t: 0, r: VW, b: VH }
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const st = cs(e)
      if (st.overflowX === 'visible' && st.overflowY === 'visible') continue
      const r = e.getBoundingClientRect()
      box = { l: Math.max(box.l, r.left), t: Math.max(box.t, r.top), r: Math.min(box.r, r.right), b: Math.min(box.b, r.bottom) }
    }
    return box
  }
  const label = (el) => `${el.tagName.toLowerCase()}${el.classList[0] ? '.' + el.classList[0] : ''}`

  const small = []
  const covered = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue || '').trim()
    if (!text) continue
    const el = node.parentElement
    if (!el || hidden(el)) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const rects = [...range.getClientRects()].filter((r) => r.width >= 3 && r.height >= 3 && r.bottom > 0 && r.top < VH && r.right > 0 && r.left < VW)
    if (!rects.length) continue
    const px = parseFloat(cs(el).fontSize)
    if (checkFont && px < minFont && !icp.test(text)) small.push(`${px}px「${text.slice(0, 16)}」`)
    if (decoration(el) || visuallyHiddenText(el)) continue
    const box = clipBox(el)
    const ownOverlay = overlay(el)
    let hit = null
    for (const r of rects) {
      const y = r.top + r.height / 2
      if (y <= box.t || y >= box.b) continue
      for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const x = r.left + r.width * f
        if (x <= box.l || x >= box.r) continue
        const top = document.elementFromPoint(x, y)
        if (!top || top === el || el.contains(top) || top.contains(el)) continue
        const topOverlay = overlay(top)
        if (topOverlay && topOverlay !== ownOverlay) continue
        if (!paints(top) || fullLayer(top, el)) continue
        hit = `「${text.slice(0, 16)}」(${label(el)}) 被 ${label(top)}「${(top.textContent || '').trim().slice(0, 12)}」压住 @${Math.round(x)},${Math.round(y)}`
        break
      }
      if (hit) break
    }
    if (hit) covered.push(hit)
  }
  return { words, small: [...new Set(small)], covered: [...new Set(covered)] }
}

async function main() {
  const { buildQingxuPairs, protoFile, PROTO_V2_DIR } = await loadPairTargets()
  const targets = buildQingxuPairs().filter((t) => {
    const file = protoFile(t.file)
    return file && file.startsWith(PROTO_V2_DIR + path.sep) && (!ONLY || ONLY.test(t.file))
  })
  // 与 qingxu-pairs.spec.ts 的稿服务一致：v2 优先，其余读原稿，越出两个目录的一律 404。
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const file = protoFile(decodeURIComponent(url.pathname).replace(/^\/+/, ''))
    if (!file) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'zh-CN' })
  const rows = []
  try {
    for (const t of targets) {
      const page = await context.newPage()
      const pageErrors = []
      page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 100)))
      try {
        if (t.protoSessionLost) {
          // 与 qingxu-pairs.spec.ts 相同：扫描工作台「会话丢失」态要先放一份等待回传的本地状态。
          await page.addInitScript(() => {
            sessionStorage.setItem('s16.scan.workbench.v1', JSON.stringify({ v: 1, step: 'waiting-delivery', scanType: 'resume' }))
          })
        }
        await page.goto(`${origin}/${t.file}${t.protoQuery}`, { waitUntil: 'load', timeout: 20_000 })
        if (t.waitProtoState) {
          await page.locator(`[data-state="${t.state}"]`).waitFor({ state: 'visible', timeout: 12_000 }).catch(() => undefined)
        } else {
          await page.waitForTimeout(200)
        }
        await page.evaluate(() => document.fonts && document.fonts.ready)
        const r = await page.evaluate(PROBE, { bannedSource: BANNED.source, minFont: MIN_FONT, checkFont: !FONT_EXEMPT.has(t.file), icpSource: ICP_LINE.source })
        rows.push({ file: t.file, screen: t.screen, state: t.state, query: t.protoQuery, ...r, pageErrors })
      } catch (e) {
        rows.push({ file: t.file, screen: t.screen, state: t.state, query: t.protoQuery, error: String(e.message).slice(0, 160) })
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
    server.close()
  }

  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1))
  let problems = 0
  const byFile = new Map()
  for (const row of rows) {
    const list = byFile.get(row.file) ?? []
    list.push(row)
    byFile.set(row.file, list)
  }
  for (const [file, list] of [...byFile].sort()) {
    const bad = list.filter((r) => r.error || r.pageErrors?.length || r.words?.length || r.small?.length || r.covered?.length)
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${file.padEnd(40)} ${list.length} 个状态${bad.length ? `，${bad.length} 个有问题` : ''}`)
    for (const r of bad) {
      problems++
      const tag = `       ${r.screen === 'main' ? '' : r.screen + ' · '}${r.state}`
      if (r.error) console.log(`${tag}：打不开 ${r.error}`)
      if (r.pageErrors?.length) console.log(`${tag}：脚本报错 ${r.pageErrors[0]}`)
      if (r.words?.length) console.log(`${tag}：工程词 ${r.words.slice(0, 3).join(' / ')}`)
      if (r.small?.length) console.log(`${tag}：小于 ${MIN_FONT}px ${r.small.length} 处，如 ${r.small.slice(0, 3).join('、')}`)
      if (r.covered?.length) console.log(`${tag}：压字 ${r.covered.length} 处，如 ${r.covered.slice(0, 2).join('；')}`)
    }
  }
  console.log(`\n${byFile.size} 张 v2 稿、${rows.length} 个状态；有问题的状态 ${problems} 个。`)
  if (problems) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
