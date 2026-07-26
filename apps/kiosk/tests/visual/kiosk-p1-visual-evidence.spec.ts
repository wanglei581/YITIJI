import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import type { Browser, Page } from '@playwright/test'
import { test, expect } from '@playwright/test'
import { ApiRouter } from '../fixtures/api-router'
import {
  loginThroughVisibleUi,
  openLoginVerificationError,
  openScanSettingsCreateFailed,
  registerAuthenticatedMemberApis,
  registerEmptyToolbox,
  registerEvidenceShell,
  registerMemberLogin,
  seedCashierFailed,
  seedCashierPending,
  seedPrintDoneCompleted,
  seedPrintFlow,
  seedPrintProgress,
  seedScreensaver,
  seedScanProgress,
} from './fixtures/kiosk-p1-evidence-capture-api'
import {
  visualEvidenceTargets,
  type VisualEvidenceTarget,
} from './fixtures/kiosk-p1-visual-evidence-targets'

const workspaceRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
const sha = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf8' }).trim()
const evidenceRoot = join(workspaceRoot, 'test-results', 'kiosk-p1-visual-evidence', sha)
const PROTO_ORIGIN = process.env.P1_PROTO_ORIGIN ?? 'http://127.0.0.1:8399'
const KIOSK_ORIGIN = process.env.P1_KIOSK_ORIGIN ?? 'http://127.0.0.1:58245'
const LIVE = process.env.P1_LIVE === '1'
const TARGET_IDS = new Set(
  (process.env.P1_TARGET_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)

type AutoSignals = {
  readyMarkerFound: boolean
  englishErrorPage: boolean
  mojibake: boolean
  horizontalOverflow: boolean
  dualBottomNav: boolean
  clippedMain: boolean
  pageErrors: string[]
  notes: string[]
}

type CaptureRecord = {
  targetId: string
  captureKey: string
  targetGroup: string
  referenceKind: string
  routeOrState: readonly string[]
  captureUrl: string
  viewport: { width: number; height: number }
  prototypePath: string
  prototypeScreenshot: string
  productionScreenshot: string
  readyMarker: string
  fixture: string
  precondition: string
  claimScope: string
  knownLimits: string
  captureOk: boolean
  autoSignals: AutoSignals
  judgment: 'PENDING' | 'PASS' | 'FAIL' | 'CAPTURE_FAIL' | 'PROFILE_DEFER'
  judgmentNotes: string
}

const AUTH_TARGETS = new Set([
  '14', '16', '17', '18', '19', '20', '21', '22', '22B', '23', '42', '48', '56', '71',
])
const PROFILE_PROTECTED = new Set(['14', '16', '17', '18', '19', '20', '21', '22', '22B', '23', '71'])

function prototypeUrl(prototypePath: string): string {
  return `${PROTO_ORIGIN}/${prototypePath.replace(/^docs\/design\//, '')}`
}

function expandScreenshotPath(template: string): string {
  return join(workspaceRoot, template.replace('<sha>', sha))
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (/Unexpected Application Error|http proxy error|ECONNREFUSED/i.test(message.text())) {
      errors.push(message.text())
    }
  })
  return errors
}

async function collectAutoSignals(page: Page, readyMarker: string, pageErrors: string[]): Promise<AutoSignals> {
  const bodyText = await page.locator('body').innerText().catch(() => '')
  const readyMarkerFound = await page.locator(readyMarker).first().isVisible().catch(() => false)
  const englishErrorPage = /Unexpected Application Error|Oops!|Something went wrong|Not Found/i.test(bodyText)
  const mojibake = /Ã.|å.|æ.|ä.|é.|å¤|ï¿½|锟斤拷/.test(bodyText)
  const overflowCount = await page.locator('body *').evaluateAll((elements) => {
    const viewportWidth = document.documentElement.clientWidth
    return elements.filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.right > viewportWidth + 1 || rect.left < -1
    }).length
  }).catch(() => 0)
  const bottomNavCount = await page.locator('nav[aria-label*="主导航"], nav.kiosk-bottom-nav, [data-kiosk-component="bottom-nav"]').count().catch(() => 0)
  const clippedMain = await page.locator('main').evaluateAll((mains) => {
    return mains.some((main) => {
      const style = window.getComputedStyle(main)
      return (style.overflowY === 'hidden' || style.overflow === 'hidden') && main.scrollHeight > main.clientHeight + 8
    })
  }).catch(() => false)

  return {
    readyMarkerFound,
    englishErrorPage,
    mojibake,
    horizontalOverflow: overflowCount > 0,
    dualBottomNav: bottomNavCount >= 2,
    clippedMain,
    pageErrors: [...pageErrors],
    notes: [],
  }
}

async function capturePrototype(browser: Browser, target: VisualEvidenceTarget, outPath: string): Promise<void> {
  mkdirSync(dirname(outPath), { recursive: true })
  const context = await browser.newContext({
    viewport: target.viewport,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.goto(prototypeUrl(target.prototypePath), { waitUntil: 'domcontentloaded', timeout: 15_000 })
  await page.waitForTimeout(150)
  await page.screenshot({ path: outPath, fullPage: false })
  await context.close()
}

async function prepareProduction(
  page: Page,
  api: ApiRouter | null,
  target: VisualEvidenceTarget,
  captureKey: string,
  captureUrl: string,
): Promise<void> {
  if (LIVE || !api) {
    await page.goto(captureUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    return
  }

  registerEvidenceShell(api)

  if (target.targetId === '76A') registerEmptyToolbox(api)
  if (AUTH_TARGETS.has(target.targetId)) {
    registerMemberLogin(api)
    registerAuthenticatedMemberApis(api)
  }

  if (target.targetId === '15A') {
    await openLoginVerificationError(page, api)
    return
  }

  if (target.targetId === '57') {
    await seedScreensaver(page)
    await page.goto(captureUrl, { waitUntil: 'domcontentloaded' })
    return
  }

  if (target.targetId === '03' || target.targetId === '31' || target.targetId === '64' || target.targetId === '65') {
    await seedPrintFlow(page, captureUrl)
    return
  }

  if (target.targetId === '32') {
    await seedCashierPending(page, api)
    return
  }

  if (target.targetId === '32A') {
    await seedCashierFailed(page, api)
    return
  }

  if (target.targetId === '04') {
    await seedPrintProgress(page, api)
    return
  }

  if (target.targetId === '36') {
    await seedScanProgress(page, api)
    return
  }

  if (target.targetId === '33') {
    await seedPrintDoneCompleted(page, api)
    return
  }

  if (target.targetId === '34A' && captureKey === 'scan-settings') {
    await openScanSettingsCreateFailed(page, api)
    return
  }

  if (AUTH_TARGETS.has(target.targetId)) {
    const pathname = new URL(captureUrl, KIOSK_ORIGIN).pathname
    await loginThroughVisibleUi(page, pathname)
    if (!page.url().includes(pathname)) {
      await page.goto(captureUrl, { waitUntil: 'domcontentloaded' })
    }
    return
  }

  await page.goto(captureUrl, { waitUntil: 'domcontentloaded' })

  if (target.targetId === '73') {
    const callButton = page.getByRole('button', { name: /语音通话|开始通话|呼叫小青/ }).first()
    if (await callButton.count()) await callButton.click().catch(() => undefined)
  }
}

function recordKey(targetId: string, captureKey: string): string {
  return `${targetId}::${captureKey}`
}

function loadExistingRecords(): CaptureRecord[] {
  const summaryPath = join(evidenceRoot, 'capture-summary.json')
  if (!existsSync(summaryPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(summaryPath, 'utf8')) as { records?: CaptureRecord[] }
    return Array.isArray(parsed.records) ? parsed.records : []
  } catch {
    return []
  }
}

function writeProgress(records: CaptureRecord[]): void {
  writeFileSync(join(evidenceRoot, 'capture-summary.json'), JSON.stringify({
    sha,
    mode: LIVE ? 'live-58245' : 'contract-fixture',
    kioskOrigin: KIOSK_ORIGIN,
    protoOrigin: PROTO_ORIGIN,
    capturedAt: new Date().toISOString(),
    pairCount: records.length,
    expectedPairs: 83,
    captureOkCount: records.filter((item) => item.captureOk).length,
    captureFailCount: records.filter((item) => !item.captureOk).length,
    records,
  }, null, 2))

  const lines = [
    `# P1 Visual Evidence PASS/FAIL (${sha})`,
    '',
    `Mode: ${LIVE ? 'live-58245' : 'contract-fixture'} · Captured so far: ${records.length}/83`,
    `Kiosk: ${KIOSK_ORIGIN} · Prototype: ${PROTO_ORIGIN}`,
    '',
    'Manual judgment starts as PENDING / PROFILE_DEFER / CAPTURE_FAIL only. No PASS without human review.',
    '',
    '| ID | Key | Route/State | Capture | Auto flags | Judgment | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...records.map((item) => {
      const flags = [
        item.autoSignals.readyMarkerFound ? '' : 'no-ready',
        item.autoSignals.englishErrorPage ? 'en-error' : '',
        item.autoSignals.mojibake ? 'mojibake' : '',
        item.autoSignals.horizontalOverflow ? 'overflow' : '',
        item.autoSignals.dualBottomNav ? 'dual-nav' : '',
        item.autoSignals.clippedMain ? 'clip' : '',
        item.autoSignals.pageErrors.length ? 'pageerror' : '',
      ].filter(Boolean).join(',') || 'none'
      return `| ${item.targetId} | ${item.captureKey} | ${item.routeOrState.join('<br>')} | ${item.captureOk ? 'OK' : 'FAIL'} | ${flags} | ${item.judgment} | ${item.judgmentNotes || item.autoSignals.notes.join('; ').replace(/\|/g, '/')} |`
    }),
    '',
  ]
  writeFileSync(join(evidenceRoot, 'PASS-FAIL-TABLE.md'), `${lines.join('\n')}\n`)
}

test('capture all P1 visual evidence pairs', async ({ browser }) => {
  test.setTimeout(2_700_000)
  mkdirSync(evidenceRoot, { recursive: true })
  const allPairs = visualEvidenceTargets.flatMap((target) =>
    target.capturePairs.map((pair) => ({ target, pair })),
  )
  expect(allPairs.length, 'expected 83 capture pairs').toBe(83)

  const pairs = TARGET_IDS.size > 0
    ? allPairs.filter(({ target }) => TARGET_IDS.has(target.targetId))
    : allPairs
  expect(pairs.length, 'filtered capture pairs must be > 0').toBeGreaterThan(0)

  const mergedByKey = new Map(
    loadExistingRecords().map((item) => [recordKey(item.targetId, item.captureKey), item]),
  )
  const records: CaptureRecord[] = []

  for (const { target, pair } of pairs) {
    const prototypeScreenshot = expandScreenshotPath(pair.screenshotPair.prototype)
    const productionScreenshot = expandScreenshotPath(pair.screenshotPair.production)
    let captureOk = true
    let autoSignals: AutoSignals = {
      readyMarkerFound: false,
      englishErrorPage: false,
      mojibake: false,
      horizontalOverflow: false,
      dualBottomNav: false,
      clippedMain: false,
      pageErrors: [],
      notes: [],
    }

    try {
      await capturePrototype(browser, target, prototypeScreenshot)

      const context = await browser.newContext({
        baseURL: KIOSK_ORIGIN,
        viewport: target.viewport,
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        colorScheme: 'light',
        reducedMotion: 'reduce',
      })
      const page = await context.newPage()
      const pageErrors = collectPageErrors(page)
      const api = LIVE ? null : new ApiRouter(page)
      if (api) await api.install()
      await prepareProduction(page, api, target, pair.captureKey, pair.captureUrl)

      const ready = page.locator(pair.readyMarker).first()
      await ready.waitFor({ state: 'visible', timeout: LIVE ? 8_000 : 15_000 }).catch(() => {
        captureOk = false
      })
      // Always screenshot whatever rendered; live mode often shows honest empty/login gates.
      await page.waitForTimeout(120)
      autoSignals = await collectAutoSignals(page, pair.readyMarker, pageErrors)
      if (!autoSignals.readyMarkerFound) captureOk = false
      if (autoSignals.englishErrorPage || autoSignals.mojibake) captureOk = false

      mkdirSync(dirname(productionScreenshot), { recursive: true })
      await page.screenshot({ path: productionScreenshot, fullPage: false })
      await context.close()
    } catch (error) {
      captureOk = false
      autoSignals.notes.push(error instanceof Error ? error.message : String(error))
      mkdirSync(dirname(productionScreenshot), { recursive: true })
    }

    // Screenshot files existing counts as evidence even when ready marker missed.
    const hasFiles = true
    const nextRecord: CaptureRecord = {
      targetId: target.targetId,
      captureKey: pair.captureKey,
      targetGroup: target.targetGroup,
      referenceKind: target.referenceKind,
      routeOrState: target.routeOrState,
      captureUrl: pair.captureUrl,
      viewport: target.viewport,
      prototypePath: target.prototypePath,
      prototypeScreenshot: prototypeScreenshot.replace(`${workspaceRoot}/`, ''),
      productionScreenshot: productionScreenshot.replace(`${workspaceRoot}/`, ''),
      readyMarker: pair.readyMarker,
      fixture: LIVE ? `${target.fixture} | live-preview:${KIOSK_ORIGIN}` : target.fixture,
      precondition: target.precondition,
      claimScope: target.claimScope,
      knownLimits: LIVE
        ? `${target.knownLimits} Live :58245 capture may show real-API empty/error/login gates.`
        : target.knownLimits,
      captureOk: captureOk && hasFiles,
      autoSignals,
      judgment: !captureOk
        ? 'CAPTURE_FAIL'
        : PROFILE_PROTECTED.has(target.targetId)
          ? 'PROFILE_DEFER'
          : 'PENDING',
      judgmentNotes: PROFILE_PROTECTED.has(target.targetId)
        ? 'Profile/me evidence captured for record only; no production edits without separate authorization.'
        : (!captureOk ? 'Ready marker or hard error during capture; screenshots retained for review.' : ''),
    }
    records.push(nextRecord)
    mergedByKey.set(recordKey(nextRecord.targetId, nextRecord.captureKey), nextRecord)

    const mergedRecords = TARGET_IDS.size > 0
      ? (() => {
          const ordered: CaptureRecord[] = []
          for (const { target: allTarget, pair: allPair } of allPairs) {
            const existing = mergedByKey.get(recordKey(allTarget.targetId, allPair.captureKey))
            if (existing) ordered.push(existing)
          }
          return ordered
        })()
      : records

    writeProgress(mergedRecords)
    console.log(`[p1-evidence] ${records.length}/${pairs.length} ${target.targetId}/${pair.captureKey} ${captureOk ? 'OK' : 'FAIL'}`)
  }

  if (TARGET_IDS.size === 0) {
    expect(records.length).toBe(83)
  } else {
    expect(records.length).toBe(pairs.length)
    expect(mergedByKey.size).toBeGreaterThanOrEqual(records.length)
  }
})
