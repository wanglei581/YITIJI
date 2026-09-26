// 青序流光原稿 ↔ 一体机运行页并排截图。按需跑，不进 CI。
// 每一对用全新 browser context。造状态只走 qingxu-pair-targets 里复用的注册器。
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from '../fixtures/kiosk-test'
import { ApiRouter } from '../fixtures/api-router'
import {
  PROTO_DIR,
  buildQingxuPairs,
  markerSeen,
  prepareRuntime,
  type PairStatus,
  type QingxuPairTarget,
} from './fixtures/qingxu-pair-targets'

const here = path.dirname(fileURLToPath(import.meta.url))
const kioskRoot = path.resolve(here, '../..')
const repoRoot = path.resolve(kioskRoot, '../..')
const PREVIEW = 'http://127.0.0.1:4217'
const PROTO_PORT = 4218
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

function assetNames(html: string): string[] {
  return [...html.matchAll(/\/assets\/[^"'()\s]+/g)].map((match) => match[0]).sort()
}

function sha(): string {
  return execSync('git rev-parse --short=7 HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim()
}

async function listenProto(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const file = path.join(PROTO_DIR, decodeURIComponent(url.pathname))
    if (!file.startsWith(PROTO_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(PROTO_PORT, '127.0.0.1', () => resolve())
  })
  return {
    origin: `http://127.0.0.1:${PROTO_PORT}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

test('capture qingxu prototype/runtime pairs', async ({ browser }) => {
  test.skip(process.env.QX_PAIRS !== '1', 'on-demand capture; run capture:qingxu-pairs')
  test.setTimeout(4_200_000)

  const localHtml = fs.readFileSync(path.join(kioskRoot, 'dist/index.html'), 'utf8')
  const previewHtml = await (await fetch(PREVIEW)).text()
  const localAssets = assetNames(localHtml)
  const previewAssets = assetNames(previewHtml)
  if (localAssets.length === 0 || previewAssets.join('\n') !== localAssets.join('\n')) {
    throw new Error(
      `整轮作废：preview 的 index.html 资源与本次 dist 不一致\n dist ${localAssets.join(', ')}\n preview ${previewAssets.join(', ')}`,
    )
  }

  const proto = await listenProto()
  const id = sha()
  const outRoot = path.join(repoRoot, 'test-results/qingxu-pairs', id)
  fs.mkdirSync(outRoot, { recursive: true })
  const only = process.env.QX_PAIRS_ONLY
  const filter = only ? new RegExp(only) : null
  const targets = buildQingxuPairs().filter((item) => !filter || filter.test(item.file) || filter.test(item.nn))
  const rows: Array<Record<string, unknown>> = []

  try {
    for (const target of targets) {
      rows.push(await capturePair(browser, proto.origin, repoRoot, outRoot, target))
      fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify({
        sha: id,
        preview: PREVIEW,
        distAssets: localAssets,
        pairs: rows,
      }, null, 2))
    }
  } finally {
    await proto.close()
  }

  const summary = new Map<string, { total: number; paired: number; missing: number; redirected: number; error: number }>()
  for (const row of rows) {
    const key = String(row.file)
    const bucket = summary.get(key) ?? { total: 0, paired: 0, missing: 0, redirected: 0, error: 0 }
    bucket.total += 1
    if (row.status === 'paired') bucket.paired += 1
    else if (row.status === 'missing-runtime-setup') bucket.missing += 1
    else if (row.status === 'runtime-redirected') bucket.redirected += 1
    else bucket.error += 1
    summary.set(key, bucket)
  }
  let total = 0
  let paired = 0
  let missing = 0
  let redirected = 0
  let error = 0
  console.log('\n青序并排截图逐稿汇总')
  for (const [file, bucket] of summary) {
    total += bucket.total
    paired += bucket.paired
    missing += bucket.missing
    redirected += bucket.redirected
    error += bucket.error
    console.log(`${file}  总对数 ${bucket.total}  已配对 ${bucket.paired}  缺造状态 ${bucket.missing}  被重定向 ${bucket.redirected}  报错 ${bucket.error}`)
  }
  console.log(`合计  总对数 ${total}  已配对 ${paired}  缺造状态 ${missing}  被重定向 ${redirected}  报错 ${error}`)
  console.log(`manifest ${path.join(outRoot, 'manifest.json')}`)
})

async function capturePair(
  browser: import('@playwright/test').Browser,
  protoOrigin: string,
  repoRoot: string,
  outRoot: string,
  target: QingxuPairTarget,
): Promise<Record<string, unknown>> {
  const dir = path.join(outRoot, target.nn)
  fs.mkdirSync(dir, { recursive: true })
  const stem = `${target.screen}--${target.state}`
  const protoPath = path.join(dir, `${stem}.proto.png`)
  const runPath = path.join(dir, `${stem}.run.png`)
  const pairPath = path.join(dir, `${stem}.pair.png`)
  const base = {
    file: target.file,
    nn: target.nn,
    screen: target.screen,
    state: target.state,
    protoQuery: target.protoQuery,
    route: target.route,
    runtimeUrl: target.runtimeUrl,
    readyMarker: target.readyMarker,
    readyMarkerSeen: false,
    status: (target.plan.kind === 'none' ? 'missing-runtime-setup' : 'error') as PairStatus,
    consoleErrorCount: 0,
    consoleErrors: [] as string[],
    failedRequestCount: 0,
    reason: target.missingReason,
    images: {} as Record<string, string>,
  }
  if (!target.capture) return base

  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
    colorScheme: 'light',
  })
  await context.route('http://127.0.0.1:9527/local/terminal-identity', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.abort('blockedbyclient')
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, data: { terminalId: 'KSK-001', terminalCode: 'KSK-001' } }),
    })
  })
  const consoleErrors: string[] = []
  let failedRequests = 0
  try {
    const protoPage = await context.newPage()
    if (target.protoSessionLost) {
      await protoPage.addInitScript(() => {
        sessionStorage.setItem('s16.scan.workbench.v1', JSON.stringify({ v: 1, step: 'waiting-delivery', scanType: 'resume' }))
      })
    }
    await protoPage.goto(`${protoOrigin}/${target.file}${target.protoQuery}`, { waitUntil: 'load', timeout: 20_000 })
    if (target.waitProtoState) {
      await protoPage.locator(`[data-state="${target.state}"]`).waitFor({ state: 'visible', timeout: 12_000 }).catch(() => undefined)
    } else {
      await protoPage.waitForTimeout(200)
    }
    await protoPage.screenshot({ path: protoPath, animations: 'disabled' })
    base.images.proto = path.relative(repoRoot, protoPath)
    await protoPage.close()

    if (target.plan.kind === 'none' || !target.runtimeUrl) return base

    const page = await context.newPage()
    page.on('pageerror', (error) => consoleErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('requestfailed', () => { failedRequests += 1 })
    const api = new ApiRouter(page)
    await api.install()
    try {
      await prepareRuntime(page, api, target)
      if (target.readyMarker) {
        await page.locator(target.readyMarker.split(',')[0].trim()).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined)
      }
      base.readyMarkerSeen = await markerSeen(page, target.readyMarker)
      const landed = new URL(page.url())
      const expected = new URL(target.runtimeUrl, PREVIEW)
      await page.screenshot({ path: runPath, animations: 'disabled' })
      base.images.run = path.relative(repoRoot, runPath)
      base.status = landed.pathname === expected.pathname ? 'paired' : 'runtime-redirected'
      if (base.status === 'runtime-redirected') base.reason = `落到 ${landed.pathname}${landed.search}`
    } catch (error) {
      base.status = 'error'
      base.reason = error instanceof Error ? error.message.slice(0, 400) : String(error)
      if (!page.isClosed()) {
        await page.screenshot({ path: runPath, animations: 'disabled' }).catch(() => undefined)
        if (fs.existsSync(runPath)) base.images.run = path.relative(repoRoot, runPath)
      }
    }
    if (base.images.proto && base.images.run) {
      await composePair(context, target, protoPath, runPath, pairPath)
      base.images.pair = path.relative(repoRoot, pairPath)
    }
  } catch (error) {
    base.status = 'error'
    base.reason = error instanceof Error ? error.message.slice(0, 400) : String(error)
  } finally {
    base.consoleErrorCount = consoleErrors.length
    base.consoleErrors = consoleErrors.slice(0, 3)
    base.failedRequestCount = failedRequests
    await context.close()
  }
  return base
}

async function composePair(
  context: import('@playwright/test').BrowserContext,
  target: QingxuPairTarget,
  protoPath: string,
  runPath: string,
  pairPath: string,
): Promise<void> {
  const htmlPath = pairPath.replace(/\.png$/, '.html')
  const caption = `${target.file}  /  ${target.screen}  /  ${target.state}  /  ${target.route ?? '无路由'}`
  fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#111}
    .cap{box-sizing:border-box;height:36px;padding:8px 12px;background:#0b241e;color:#f5f2e9;font:14px/20px "PingFang SC","Microsoft YaHei",sans-serif;white-space:nowrap;overflow:hidden}
    .row{display:flex;width:1080px;height:960px}
    img{width:540px;height:960px;object-fit:fill;display:block}
  </style><div class="cap">${caption.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] ?? ch))}</div>
  <div class="row"><img src="${path.basename(protoPath)}" alt=""><img src="${path.basename(runPath)}" alt=""></div>`)
  const page = await context.newPage()
  await page.setViewportSize({ width: 1080, height: 996 })
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
  await page.screenshot({ path: pairPath, animations: 'disabled' })
  await page.close()
  fs.rmSync(htmlPath)
}
