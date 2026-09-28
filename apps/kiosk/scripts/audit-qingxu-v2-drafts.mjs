// audit:qingxu-v2-drafts — 按需检查「青序流光 2.0」稿（docs/design/kiosk-redesign-2026-08-v2）的每一个状态，
// 对应 v2 目录 README 的规则 2、规则 4，外加文字被压住：
//   1. 用词：可见文字（含读屏文字）不出现写给用户看的工程词，也不出现内部英文键名
//      （interview-report、x-resume-access-token、taskId 这类）；
//   2. 字号：可见文字不小于 20px（备案号那一行除外；51 是手机页，按手机字阶，不查字号）；
//   3. 压字：一段文字上有别的元素压着（卡片盖住标签、两段字叠在一起、内容钻到底部导航下面）。
//      弹层（role=dialog / aria-modal、铺满整屏的遮罩）盖住底下的页面不算，透明无字的点击层不算；
//      水印、印章这类装饰用 aria-hidden 或 pointer-events:none 标出来，不参与判断。
//   4. 留白（产品负责人 9/28：不许留大片空白）：整行连续空白 ≥ 160px，或左 / 右半边 ≥ 240px 算问题；
//      只量第一屏；手机页 51 不按 1080 宽量。
//   5. 被裁：文字上下边超出 overflow:hidden 的外框（含 1920 高的舞台），也就是被裁掉或挤出屏幕。
//      填留白时最容易把底部按钮和导航挤下去，所以和留白一起查；可滚动区与多行截断不算。
//      按钮落在所在滚动区可见底边以下（被遮住或要滑才看得到）也算；列表条目里的按钮不算。
//
// 状态清单与并排截图工具（tests/visual/qingxu-pairs.spec.ts）共用 tests/visual/fixtures/qingxu-pair-targets.ts
// 的 buildQingxuPairs()：用 vite 自带的 esbuild 临时打包后导入，两边不会各数各的。稿的取法也一样：
// v2 目录里有的稿（及其 .js / .css 附件）以 v2 为准，其余读原稿。只检查解析到 v2 目录的稿。
//
// 用法（在 apps/kiosk 下）：node scripts/audit-qingxu-v2-drafts.mjs [--only=<正则，匹配稿文件名>] [--json=<输出文件>] [--shots=<目录>]
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
// --shots=<目录>：把有大片留白的状态截图存下来，文件名是「稿名__屏__状态.png」，改稿时对着看。
const shotsArg = process.argv.find((a) => a.startsWith('--shots='))
const SHOTS_DIR = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : null

// 规则 4 的用词：写给用户看的页面上不该出现的工程词。
// 9/28 补：接口地址（/api/…、GET /…）写在屏上也是工程词——英文键名规则会跳过「/」后面的词，所以单独列。
const BANNED = /服务端|后端|前台|后台|落库|会话|元数据|回执|链路|网桥|真机|未验收|pending|uploaded|签名链接|字段|接口|\/api\/|\b(?:GET|POST|PUT|PATCH|DELETE)\s+\//
// 规则 4 的另一半：内部英文键名（来源键 interview-report、请求头 x-resume-access-token、taskId 这类
// 短横线 / 下划线 / 驼峰标识符）。网址、邮箱、文件名前后带 . / @ 的不算。
const ENGLISH_KEY = /(?<![\w./@-])[a-z]+(?:[-_][a-z0-9]+)+(?![\w./@-])|(?<![\w./@])[a-z]+[A-Z][A-Za-z0-9]*(?![\w./@])/g
// 长得像键名、其实是用户认得的产品名或格式名。
const KEY_ALLOW = new Set(['exFAT', 'iPhone', 'iPad', 'iOS', 'macOS'])
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
const PROBE = ({ bannedSource, minFont, checkFont, icpSource, keySource }) => {
  const banned = new RegExp(bannedSource)
  const icp = new RegExp(icpSource)
  const VW = window.innerWidth
  const VH = window.innerHeight
  const lines = document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean)
  const words = [...new Set(lines.filter((l) => banned.test(l)))]
  const keys = [...new Set([...document.body.innerText.matchAll(new RegExp(keySource, 'g'))].map((m) => m[0]))]

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
    // 从文字所在元素本身算起：单行省略号的文字，range 的矩形比元素宽，超出的部分本来就看不见，不算被压。
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const st = cs(e)
      if (st.overflowX === 'visible' && st.overflowY === 'visible') continue
      const r = e.getBoundingClientRect()
      box = { l: Math.max(box.l, r.left), t: Math.max(box.t, r.top), r: Math.min(box.r, r.right), b: Math.min(box.b, r.bottom) }
    }
    return box
  }
  const label = (el) => `${el.tagName.toLowerCase()}${el.classList[0] ? '.' + el.classList[0] : ''}`
  // 被裁：文字的上下边超出了 overflow:hidden / clip 的祖先（包括整张 1920 高的舞台）。
  // 可滚动区域里暂时滚出去的内容不算；-webkit-line-clamp 的多行截断是有意的，不算；横向省略号只影响左右，这里只看上下。
  const hardClip = (el) => {
    let box = { t: 0, b: VH }
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const st = cs(e)
      if (st.webkitLineClamp && st.webkitLineClamp !== 'none') return null
      if (e === el) continue
      if (/auto|scroll/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 1) return null
      if (st.overflowY === 'hidden' || st.overflowY === 'clip') {
        const r = e.getBoundingClientRect()
        box = { t: Math.max(box.t, r.top), b: Math.min(box.b, r.bottom) }
      }
    }
    return box
  }

  const small = []
  const covered = []
  const clipped = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue || '').trim()
    if (!text) continue
    const el = node.parentElement
    if (!el || hidden(el)) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const allRects = [...range.getClientRects()].filter((r) => r.width >= 3 && r.height >= 3)
    if (allRects.length && !decoration(el) && !visuallyHiddenText(el)) {
      const hc = hardClip(el)
      const cut = hc && allRects.find((r) => r.bottom > hc.b + 2 || r.top < hc.t - 2)
      if (cut) clipped.push(`「${text.slice(0, 16)}」(${label(el)}) 被裁在 y=${Math.round(cut.top)}–${Math.round(cut.bottom)}（可见到 ${Math.round(hc.b)}）`)
    }
    const rects = allRects.filter((r) => r.bottom > 0 && r.top < VH && r.right > 0 && r.left < VW)
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
  // 按钮在第一屏看不到：落在它所在滚动区（没有就是屏幕）的可见底边以下——被遮住，或要滑才看得到。
  // 列表条目里的按钮（li、role=listitem、或同一父元素下 ≥3 个同类兄弟里的一个）不算：第 N 条的「查看」本来就要滑。
  // 手机页（51，checkFont 为假的那张）不查：手机网页往下滑是正常操作，这条只管 27 寸一体机。
  const inList = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (e.tagName === 'LI' || e.getAttribute('role') === 'listitem') return true
      const p = e.parentElement
      if (p && e.className && typeof e.className === 'string' && [...p.children].filter((c) => c.className === e.className).length >= 3) return true
    }
    return false
  }
  const scrollerOf = (el) => {
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const st = cs(e)
      if (/auto|scroll/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 1) return e
    }
    return null
  }
  for (const b of checkFont ? document.querySelectorAll('button, a.btn, [role="button"]') : []) {
    if (hidden(b) || decoration(b)) continue
    const r = b.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue
    const sc = scrollerOf(b)
    const sr = sc && sc.getBoundingClientRect()
    // 卡片内部的小滚动区（列表卡、记录卡）里滑到最后才出现的按钮（如「加载更多」）不算；
    // 只管整块正文区在滚（滚动区高于屏高 55%，例如顶部卡下面整个 main 在滚）或内容被舞台裁掉的情形。
    if (sr && sr.height < VH * 0.55) continue
    const limit = sr ? Math.min(VH, sr.bottom) : VH
    if (r.bottom <= limit + 2 || inList(b)) continue
    clipped.push(`按钮「${(b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 14)}」在第一屏看不到 y=${Math.round(r.top)}–${Math.round(r.bottom)}（可见到 ${Math.round(limit)}）`)
  }
  return { words, keys, small: [...new Set(small)], covered: [...new Set(covered)], clipped: [...new Set(clipped)] }
}

// 规则（产品负责人 9/28）：一屏里不许留大片空白，空间要按内容规划好。
// 口径同原稿空白门禁的 pixel 口径：min(r,g,b)<165，或 (max-min>45 且 min<220) 才算有内容；
// 卡片边框、浅底、纸色都不算。量整行、左半、右半三段里最长的连续空白（两栏布局常是一栏空着）。
// 两张卡之间的正常节奏（上卡下内边距 + 间隔 + 下卡上内边距）本身就有 110–130px，门槛取 160 / 240，
// 抓的是 9/28 那批 300–500px 的大片空白，不误伤正常间距。
const BLANK_FULL = 160
const BLANK_HALF = 240
const BLANK_EXEMPT = new Set(['51-phone-relay.html'])
const BLANK_PROBE = async ({ b64, top, bottom }) => {
  const img = new Image()
  img.src = `data:image/png;base64,${b64}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height)
  const half = width >> 1
  const left = new Uint8Array(height)
  const right = new Uint8Array(height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const lo = Math.min(data[i], data[i + 1], data[i + 2])
      const hi = Math.max(data[i], data[i + 1], data[i + 2])
      if (lo < 165 || (hi - lo > 45 && lo < 220)) {
        if (x < half) left[y] = 1
        else right[y] = 1
        if (left[y] && right[y]) break
      }
    }
  }
  const longest = (ink) => {
    let best = [0, 0, 0]
    let start = -1
    for (let y = top; y <= Math.min(bottom, height); y++) {
      const blank = y < Math.min(bottom, height) && !ink(y)
      if (blank && start < 0) start = y
      if (!blank && start >= 0) {
        if (y - start > best[0]) best = [y - start, start, y]
        start = -1
      }
    }
    return best
  }
  return {
    full: longest((y) => left[y] || right[y]),
    left: longest((y) => left[y]),
    right: longest((y) => right[y]),
  }
}
const blankProblem = (b) => b && (b.full[0] >= BLANK_FULL || b.left[0] >= BLANK_HALF || b.right[0] >= BLANK_HALF)
const blankText = (b) => [['整行', b.full], ['左半', b.left], ['右半', b.right]]
  .filter(([name, v]) => v[0] >= (name === '整行' ? BLANK_FULL : BLANK_HALF))
  .map(([name, v]) => `${name} ${v[0]}px（y ${v[1]}–${v[2]}）`).join('，')

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
        const r = await page.evaluate(PROBE, { bannedSource: BANNED.source, minFont: MIN_FONT, checkFont: !FONT_EXEMPT.has(t.file), icpSource: ICP_LINE.source, keySource: ENGLISH_KEY.source })
        r.keys = r.keys.filter((key) => !KEY_ALLOW.has(key))
        if (!BLANK_EXEMPT.has(t.file)) {
          const shot = await page.screenshot()
          r.blank = await page.evaluate(BLANK_PROBE, { b64: shot.toString('base64'), top: 60, bottom: 1900 })
          if (SHOTS_DIR && blankProblem(r.blank)) {
            fs.mkdirSync(SHOTS_DIR, { recursive: true })
            fs.writeFileSync(path.join(SHOTS_DIR, `${t.file.replace(/\.html$/, '')}__${t.screen}__${t.state}.png`), shot)
          }
        }
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
    const bad = list.filter((r) => r.error || r.pageErrors?.length || r.words?.length || r.keys?.length || r.small?.length || r.covered?.length || r.clipped?.length || blankProblem(r.blank))
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${file.padEnd(40)} ${list.length} 个状态${bad.length ? `，${bad.length} 个有问题` : ''}`)
    for (const r of bad) {
      problems++
      const tag = `       ${r.screen === 'main' ? '' : r.screen + ' · '}${r.state}`
      if (r.error) console.log(`${tag}：打不开 ${r.error}`)
      if (r.pageErrors?.length) console.log(`${tag}：脚本报错 ${r.pageErrors[0]}`)
      if (r.words?.length) console.log(`${tag}：工程词 ${r.words.slice(0, 3).join(' / ')}`)
      if (r.keys?.length) console.log(`${tag}：英文键名 ${r.keys.slice(0, 4).join(' / ')}`)
      if (r.small?.length) console.log(`${tag}：小于 ${MIN_FONT}px ${r.small.length} 处，如 ${r.small.slice(0, 3).join('、')}`)
      if (r.covered?.length) console.log(`${tag}：压字 ${r.covered.length} 处，如 ${r.covered.slice(0, 2).join('；')}`)
      if (r.clipped?.length) console.log(`${tag}：文字被裁或挤出屏幕 ${r.clipped.length} 处，如 ${r.clipped.slice(0, 2).join('；')}`)
      if (blankProblem(r.blank)) console.log(`${tag}：大片留白 ${blankText(r.blank)}`)
    }
  }
  console.log(`\n${byFile.size} 张 v2 稿、${rows.length} 个状态；有问题的状态 ${problems} 个。`)
  if (problems) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
