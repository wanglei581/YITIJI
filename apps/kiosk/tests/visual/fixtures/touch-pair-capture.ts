// 稿一屏、运行页一屏、左右并排。文字稿照 11/02 走查：正文、输入框、可见按钮（导航不计，禁用标［禁用］）。
// 运行页另记可点数、最小字号、最长纯底色空带。截图目录由 TOUCH_PAIRS_OUT 指定，默认在仓库根的 test-results/touch-pairs（已忽略）。
// TOUCH_PAIRS_ONLY=稿屏__状态,稿屏__状态 只重拍这几对；清单按对合并，不冲掉同一项里没重拍的对。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { installLocalBridge, terminalReady } from './touch-pair-shell'
import { ApiRouter } from '../../fixtures/api-router'
import { longestBlankRun } from './blank-run'
import type { PairStatus, ProtoMeasure, RuntimeMetrics, TouchPair } from './touch-pair-types'

export const PROTO_PORT = 7472
const DEFAULT_OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../test-results/touch-pairs')
// 设备停用标准句是「这台机器暂时不能用，……」（unattendedCopy 标准句 3）。不带逗号会误伤
// 确认页收费态正常出现的「这台机器暂时不能用优惠券」、到机码页的「这台机器暂时不能用同一个到机码接着打」。
export const ABNORMAL_TEXT = /状态未知|这台机器暂时不能用，|安全校验没通过|暂时打不了|网络连接失败/

function onlyStems(): Set<string> | null {
  const raw = process.env.TOUCH_PAIRS_ONLY?.trim()
  if (!raw) return null
  return new Set(raw.split(',').map((stem) => stem.trim()).filter(Boolean))
}

function rowKey(row: Record<string, unknown>): string {
  return `${String(row.item)}|${String(row.screen)}__${String(row.state)}`
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

export function pairsOutDir(): string {
  return process.env.TOUCH_PAIRS_OUT?.trim() || DEFAULT_OUT
}

export function previewOrigin(): string {
  const raw = process.env.TOUCH_PAIRS_PORT
  const port = raw === undefined ? 7471 : Number(raw)
  return `http://127.0.0.1:${port}`
}

export async function listenProto(root: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const file = path.resolve(root, rel)
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(404)
      res.end()
      return
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`稿服务端口 ${PROTO_PORT} 已被占用`)
        process.exit(1)
      }
      reject(error)
    })
    server.listen(PROTO_PORT, '127.0.0.1', () => resolve())
  })
  return {
    origin: `http://127.0.0.1:${PROTO_PORT}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

function esc(value: string): string {
  return value.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] ?? ch))
}

function protoUrl(origin: string, pair: TouchPair): string {
  const query = new URLSearchParams({ shot: '1', reduced: '1', ...pair.proto?.query })
  return `${origin}/index.html?${query.toString()}#${encodeURIComponent(pair.screen)}`
}

async function dumpText(page: Page, rootSelector: string | null): Promise<string> {
  return page.evaluate((root) => {
    const scope = root ? document.querySelector(root) : document.body
    const text = scope?.innerText ?? ''
    const fields = [...(scope?.querySelectorAll('input, textarea') ?? [])]
      .filter((node) => {
        const el = node as HTMLInputElement
        return el.type !== 'checkbox' && el.type !== 'file' && el.offsetParent
      })
      .map((node) => {
        const el = node as HTMLInputElement
        const label = el.getAttribute('aria-label') || el.name || el.placeholder || el.tagName
        return `[${label}] ${el.value}`
      })
      .join('\n')
    const buttons = [...(scope?.querySelectorAll('button, a') ?? [])]
      .filter((node) => {
        const el = node as HTMLElement
        return el.offsetParent && !el.closest('nav')
      })
      .map((node) => {
        const el = node as HTMLButtonElement
        const label = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
        return label ? label + (el.disabled ? '［禁用］' : '') : ''
      })
      .filter(Boolean)
    return `${text}\n\n===== 输入框 =====\n${fields}\n\n===== 可见按钮 =====\n${buttons.join('\n')}\n`
  }, rootSelector)
}

async function runtimeMetrics(page: Page): Promise<Omit<RuntimeMetrics, 'blankBandPx' | 'blankAtY'>> {
  return page.evaluate(() => {
    const visible = (node: Element) => {
      const el = node as HTMLElement
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && !el.closest('[hidden]')
    }
    const taps = [...document.querySelectorAll('button, a, [role="button"], input')].filter(visible).length
    let minFontPx: number | null = null
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      const raw = node.textContent?.trim() ?? ''
      if (!raw) continue
      const parent = node.parentElement
      if (!parent || !visible(parent) || parent.closest('svg') || parent.closest('[aria-hidden="true"]')) continue
      const size = Number.parseFloat(getComputedStyle(parent).fontSize)
      if (Number.isFinite(size)) minFontPx = minFontPx === null ? size : Math.min(minFontPx, size)
    }
    return { taps, minFontPx }
  })
}

async function readProtoMeasure(page: Page): Promise<ProtoMeasure | null> {
  return page.evaluate(() => {
    const bag = window as unknown as {
      __proto?: { measure?: () => { taps: number; small: number; pct: number; minFs: number | string } | null }
    }
    return bag.__proto?.measure?.() ?? null
  })
}

async function shootDraft(page: Page, origin: string, pair: TouchPair, png: string): Promise<{
  measure: ProtoMeasure | null
  screenId: string | null
}> {
  await page.goto(protoUrl(origin, pair), { waitUntil: 'load', timeout: 20_000 })
  await page.waitForTimeout(1300)
  if (pair.proto?.patch) {
    await page.evaluate((patch) => {
      const proto = (window as unknown as {
        __proto?: { S?: Record<string, unknown>; refresh?: () => void }
      }).__proto
      if (!proto?.S || !proto.refresh) throw new Error('稿没有 window.__proto.S')
      Object.assign(proto.S, patch)
      proto.refresh()
    }, pair.proto.patch)
    await page.waitForTimeout(400)
  }
  const screenId = await page.evaluate(() => {
    const el = document.querySelector('#stage .screen:not(.leave)') as HTMLElement | null
    return el?.dataset.id ?? null
  })
  await page.screenshot({ path: png, animations: 'disabled' })
  return { measure: await readProtoMeasure(page), screenId }
}

async function compose(
  context: BrowserContext,
  pair: TouchPair,
  draftPng: string,
  runPng: string,
  pairPng: string,
): Promise<void> {
  const htmlPath = pairPng.replace(/\.png$/, '.html')
  const caption = `稿 ${pair.screen} · ${pair.state} · 运行页 ${pair.route ?? '无路由'}`
  fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#111}
    .cap{box-sizing:border-box;height:48px;padding:12px 16px;background:#0b241e;color:#f5f2e9;font:18px/24px "PingFang SC","Microsoft YaHei",sans-serif;white-space:nowrap;overflow:hidden}
    .row{display:flex;width:2160px;height:1920px}
    img{width:1080px;height:1920px;object-fit:fill;display:block}
  </style><div class="cap">${esc(caption)}</div>
  <div class="row"><img src="${path.basename(draftPng)}" alt=""><img src="${path.basename(runPng)}" alt=""></div>`)
  const page = await context.newPage()
  await page.setViewportSize({ width: 2160, height: 1968 })
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
  await page.screenshot({ path: pairPng, animations: 'disabled' })
  await page.close()
  fs.rmSync(htmlPath)
}

function expectedPath(route: string | null): string | null {
  if (!route) return null
  try {
    return new URL(route, 'http://127.0.0.1').pathname
  } catch {
    return null
  }
}

export async function captureItem(
  browser: Browser,
  protoOrigin: string,
  preview: string,
  pairs: TouchPair[],
): Promise<Array<Record<string, unknown>>> {
  const outRoot = pairsOutDir()
  fs.mkdirSync(outRoot, { recursive: true })
  const rows: Array<Record<string, unknown>> = []
  const only = onlyStems()
  for (const pair of pairs) {
    if (only && !only.has(`${pair.screen}__${pair.state}`)) continue
    rows.push(await capturePair(browser, protoOrigin, preview, outRoot, pair))
    writeManifest(outRoot, preview, rows, pair.item, only !== null)
  }
  const paired = rows.filter((row) => row.status === 'paired').length
  const missing = rows.filter((row) => row.status === 'runtime-missing').length
  const draftMissing = rows.filter((row) => row.status === 'draft-missing').length
  console.log(`${pairLabel(pairs)}  总对数 ${rows.length}  paired ${paired}  runtime-missing ${missing}  draft-missing ${draftMissing}`)
  return rows
}

function pairLabel(pairs: TouchPair[]): string {
  return pairs[0]?.item ?? '并排'
}

function writeManifest(
  outRoot: string,
  preview: string,
  rows: Array<Record<string, unknown>>,
  item: string,
  partial: boolean,
): void {
  const file = path.join(outRoot, 'manifest.json')
  let previous: Array<Record<string, unknown>> = []
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { pairs?: Array<Record<string, unknown>> }
      previous = parsed.pairs ?? []
    } catch {
      previous = []
    }
  }
  let pairs: Array<Record<string, unknown>>
  if (partial) {
    // 只重拍几对：按对替换，原有顺序不变，新对排在末尾。
    const fresh = new Map(rows.map((row) => [rowKey(row), row]))
    pairs = previous.map((row) => fresh.get(rowKey(row)) ?? row)
    const kept = new Set(previous.map(rowKey))
    for (const row of rows) if (!kept.has(rowKey(row))) pairs.push(row)
  } else {
    pairs = [...previous.filter((row) => row.item !== item), ...rows]
  }
  fs.writeFileSync(file, JSON.stringify({
    preview,
    proto: `http://127.0.0.1:${PROTO_PORT}`,
    pairs,
  }, null, 2))
}

async function capturePair(
  browser: Browser,
  protoOrigin: string,
  preview: string,
  outRoot: string,
  pair: TouchPair,
): Promise<Record<string, unknown>> {
  const dir = path.join(outRoot, pair.item)
  fs.mkdirSync(dir, { recursive: true })
  const stem = `${pair.screen}__${pair.state}`
  const draftPng = path.join(dir, `${stem}.draft.png`)
  const runPng = path.join(dir, `${stem}.run.png`)
  const pairPng = path.join(dir, `${stem}.png`)
  const row: Record<string, unknown> = {
    item: pair.item,
    screen: pair.screen,
    state: pair.state,
    route: pair.route,
    seeds: pair.seeds,
    status: (pair.missingReason ? 'runtime-missing' : 'paired') as PairStatus,
    reason: pair.missingReason,
    protoMeasure: null,
    runtime: null,
    files: { draft: draftPng, draftTxt: draftPng.replace(/\.png$/, '.txt') } as Record<string, string>,
  }
  const context = await browser.newContext({
    baseURL: preview,
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
    colorScheme: 'light',
  })
  // 不设的话 click / waitForURL 会一直等到整项 30 分钟超时，一对卡住后面全丢。
  context.setDefaultTimeout(60_000)
  context.setDefaultNavigationTimeout(60_000)
  // 稿引谷歌字体；本机连谷歌时快时卡，卡住时稿页 20 秒等不到 load，后面整串配对全丢。
  // 运行页本来就用系统字体（PingFang SC 等），稿也退回系统字体，两边字形一致、读数可比。
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort('blockedbyclient'))
  await installLocalBridge(context)
  try {
    const protoPage = await context.newPage()
    const draft = await shootDraft(protoPage, protoOrigin, pair, draftPng)
    row.protoMeasure = draft.measure
    const draftText = await dumpText(protoPage, '#stage .screen:not(.leave)')
    fs.writeFileSync(String(row.files && (row.files as Record<string, string>).draftTxt), `# ${pair.screen} ${pair.state}\n# ${protoUrl(protoOrigin, pair)}\n${draftText}`)
    await protoPage.close()
    if (draft.screenId !== pair.screen) {
      row.status = 'draft-missing'
      row.reason = `稿停在 ${draft.screenId ?? '无屏'}`
      return row
    }
    if (pair.missingReason || !pair.route) return row

    const page = await context.newPage()
    const api = new ApiRouter(page)
    await api.install()
    try {
      if (!pair.prepare) throw new Error('没有准备函数')
      await pair.prepare(page, api)
      await terminalReady(page)
      if (pair.ready) await page.locator(pair.ready).first().waitFor({ state: 'visible', timeout: 15_000 })
      api.assertNoUnhandledRequests()
      const abnormalStates = ['ai-down', 'printer-down', 'expired', 'gone', 'incomplete', 'timeout', 'nofile', 'start-fail']
      if (pair.item !== '状态样式板' && !abnormalStates.includes(pair.state)) {
        await expect(page.locator('body')).not.toContainText(ABNORMAL_TEXT)
      }
      const landed = new URL(page.url())
      const expected = expectedPath(pair.route)
      if (expected && landed.pathname !== expected) {
        row.status = 'runtime-missing'
        row.reason = `落到 ${landed.pathname}${landed.search}`
      }
      await finishRuntime(context, page, pair, runPng, pairPng, draftPng, row)
    } catch (error) {
      row.status = 'runtime-missing'
      row.reason = error instanceof Error ? error.message.slice(0, 400) : String(error)
      if (!page.isClosed()) await finishRuntime(context, page, pair, runPng, pairPng, draftPng, row)
    }
  } catch (error) {
    if (row.status === 'paired') row.status = 'runtime-missing'
    row.reason = error instanceof Error ? error.message.slice(0, 400) : String(error)
  } finally {
    await context.close()
  }
  return row
}

async function finishRuntime(
  context: BrowserContext,
  page: Page,
  pair: TouchPair,
  runPng: string,
  pairPng: string,
  draftPng: string,
  row: Record<string, unknown>,
): Promise<void> {
  const counts = await runtimeMetrics(page)
  await page.screenshot({ path: runPng, animations: 'disabled' })
  const blank = longestBlankRun(fs.readFileSync(runPng))
  const metrics: RuntimeMetrics = { ...counts, blankBandPx: blank.px, blankAtY: blank.atY }
  row.runtime = metrics
  const files = row.files as Record<string, string>
  files.run = runPng
  files.runTxt = runPng.replace(/\.png$/, '.txt')
  const text = await dumpText(page, null)
  fs.writeFileSync(files.runTxt, `# ${pair.screen} ${pair.state}\n# ${page.url()}\n${text}`)
  if (fs.existsSync(draftPng)) {
    await compose(context, pair, draftPng, runPng, pairPng)
    files.pair = pairPng
  }
}
