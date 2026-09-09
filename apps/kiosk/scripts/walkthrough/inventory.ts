/**
 * 一体机走查取证：冷开 productionRoutePatterns 每一条，记下人能不能进来、看到什么、能不能出去、壳是哪一套。
 *
 * 跑法（apps/kiosk）：
 *   pnpm walkthrough:inventory
 *
 * 产出：
 *   docs/reviews/kiosk-walkthrough-inventory-2026-09-09.md
 *   docs/progress/evidence/walkthrough-2026-09-09/<slug>.png
 *
 * 这是取证不是门禁：没有 expect，采集失败记在表里，不让整次运行变红。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@playwright/test'
import { ApiRouter } from '../../tests/fixtures/api-router'
import { registerW6Api } from '../../tests/visual/fixtures/fusion-w6-api'
import { sweepCases } from '../../tests/visual/route-sweep-cases'
import { collectPage, settleClientRedirects, type DomShot } from './collect'
import { renderReport, routeSlug, writeReportFile } from './report'
import type { RouteRow } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const kioskRoot = resolve(here, '../..')
const repoRoot = resolve(kioskRoot, '../..')
const LOCAL_TERMINAL_IDENTITY_URL = 'http://127.0.0.1:9527/local/terminal-identity'
const ORIGIN = process.env.WALKTHROUGH_ORIGIN ?? 'http://127.0.0.1:4196'
const SHOT_DIR = resolve(repoRoot, 'docs/progress/evidence/walkthrough-2026-09-09')
const REPORT_PATH = resolve(repoRoot, 'docs/reviews/kiosk-walkthrough-inventory-2026-09-09.md')
const JSON_PATH = resolve(SHOT_DIR, 'inventory.json')

function gitValue(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function pathnameOf(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return new URL(pathOrUrl).pathname
  }
  return pathOrUrl.split('?')[0] ?? pathOrUrl
}

function emptyDom(requestPathname: string): DomShot {
  return {
    landedPathname: requestPathname,
    landedSearch: '',
    headings: [],
    title: '',
    mainActions: [],
    topbarBack: [],
    ctaSecondary: [],
    ctaAll: [],
    disabledButtons: [],
    qxFrame: false,
    v6Shell: false,
    pageFrame: false,
    w4Frame: false,
  }
}

async function installTerminalIdentity(page: import('@playwright/test').Page): Promise<void> {
  await page.route(LOCAL_TERMINAL_IDENTITY_URL, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.abort('blockedbyclient')
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        data: { terminalId: 'KSK-001', terminalCode: 'KSK-001' },
      }),
    })
  })
}

function clearPreviousOutput(): void {
  mkdirSync(SHOT_DIR, { recursive: true })
  for (const name of readdirSync(SHOT_DIR)) {
    if (name.endsWith('.png') || name === 'inventory.json') {
      unlinkSync(join(SHOT_DIR, name))
    }
  }
}

test('productionRoutePatterns 冷开取证', async ({ browser }) => {
  test.setTimeout(40 * 60 * 1000)
  clearPreviousOutput()

  const slugs = new Map<string, string>()
  for (const route of sweepCases) {
    const slug = routeSlug(route.pattern)
    const previous = slugs.get(slug)
    if (previous) {
      throw new Error(`截图 slug 冲突：${slug} ← ${previous} 与 ${route.pattern}`)
    }
    slugs.set(slug, route.pattern)
  }

  const rows: RouteRow[] = []
  const startedAt = Date.now()

  for (let index = 0; index < sweepCases.length; index += 1) {
    const route = sweepCases[index]
    const requestPathname = pathnameOf(route.url)
    const screenshotRel = `docs/progress/evidence/walkthrough-2026-09-09/${routeSlug(route.pattern)}.png`
    const screenshotAbs = resolve(repoRoot, screenshotRel)
    const row: RouteRow = {
      pattern: route.pattern,
      requestUrl: route.url,
      requestPathname,
      screenshot: screenshotRel,
      captureError: null,
      ...emptyDom(requestPathname),
    }

    const context = await browser.newContext({
      viewport: { width: 1080, height: 1920 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()

    try {
      await installTerminalIdentity(page)
      const api = new ApiRouter(page)
      await api.install()
      registerW6Api(api)
      if (route.pattern === '/error-offline') {
        api.respond('GET', '/api/v1/health', {
          status: 503,
          json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'offline' } },
        })
      }

      await page.goto(`${ORIGIN}${route.url}`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      await settleClientRedirects(page)
      Object.assign(row, await collectPage(page))
      await page.screenshot({
        path: screenshotAbs,
        fullPage: false,
        animations: 'disabled',
      })
    } catch (error) {
      row.captureError = error instanceof Error ? error.message : String(error)
      await page.screenshot({
        path: screenshotAbs,
        fullPage: false,
        animations: 'disabled',
      }).catch(() => undefined)
    } finally {
      rows.push(row)
      await context.close()
    }

    const shell = [
      row.qxFrame ? 'qx' : null,
      row.v6Shell ? 'v6' : null,
      row.pageFrame ? 'page-frame' : null,
      row.w4Frame ? 'w4' : null,
    ].filter(Boolean).join('+') || 'none'
    console.log(
      `[walkthrough] ${index + 1}/${sweepCases.length} ${route.pattern} → ${row.landedPathname}${row.landedSearch} shell=${shell}${row.captureError ? ` error=${row.captureError}` : ''}`,
    )
  }

  const markdown = renderReport(
    {
      generatedAt: new Date().toISOString(),
      sha: gitValue(['rev-parse', '--short=12', 'HEAD']),
      branch: gitValue(['branch', '--show-current']),
      origin: ORIGIN,
      viewport: '1080×1920',
      fixture: 'apps/kiosk/tests/visual/fixtures/fusion-w6-api.ts',
      routeSource: 'apps/kiosk/tests/visual/route-manifest.ts productionRoutePatterns → route-sweep-cases.ts',
      routeCount: rows.length,
      screenshotDir: 'docs/progress/evidence/walkthrough-2026-09-09/',
    },
    rows,
  )
  writeReportFile(REPORT_PATH, markdown)
  writeFileSync(JSON_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt, rows }, null, 2)}\n`, 'utf8')
  console.log(`[walkthrough] wrote ${REPORT_PATH}`)
  console.log(`[walkthrough] wrote ${JSON_PATH}`)
  console.log(`[walkthrough] screenshots ${SHOT_DIR} (${rows.length} files)`)
})
