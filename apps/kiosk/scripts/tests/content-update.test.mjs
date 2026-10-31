import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../../src/services/contentUpdate.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { ContentUpdateController, readContentRelease, fetchContentRelease } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
)
const OLD = '11111111-1111-4111-8111-111111111111'
const NEW = '22222222-2222-4222-8222-222222222222'

function harness(readPublished) {
  let time = 0
  let safe = true
  let version = NEW
  let reloads = 0
  const requests = []
  const controller = new ContentUpdateController({
    currentVersion: OLD,
    canReload: () => safe,
    now: () => time,
    reload: () => {
      reloads += 1
    },
    readPublished: async (verifyAssets, signal) => {
      requests.push({ verifyAssets, signal })
      return readPublished ? readPublished(verifyAssets, signal) : { version, assets: [] }
    },
  })
  return {
    controller,
    requests,
    get reloads() {
      return reloads
    },
    time: (value) => {
      time = value
    },
    safe: (value) => {
      safe = value
    },
    version: (value) => {
      version = value
    },
  }
}

test('new content waits 60 seconds, revalidates assets, and reloads only once', async () => {
  const h = harness()
  await h.controller.tick()
  h.time(59_999)
  await h.controller.tick()
  assert.equal(h.reloads, 0)
  h.time(60_000)
  await h.controller.tick()
  await h.controller.tick()
  assert.equal(h.reloads, 1)
  assert.deepEqual(
    h.requests.map((r) => r.verifyAssets),
    [false, true]
  )
})

test('unchanged releases poll every five minutes without refreshing', async () => {
  const h = harness()
  h.version(OLD)
  await h.controller.tick()
  h.time(299_999)
  await h.controller.tick()
  assert.equal(h.requests.length, 1)
  h.time(300_000)
  await h.controller.tick()
  assert.equal(h.requests.length, 2)
  assert.equal(h.reloads, 0)
})

test('activity resets the full idle window', async () => {
  const h = harness()
  await h.controller.tick()
  h.time(59_000)
  h.controller.markActivity()
  await h.controller.tick()
  h.time(118_999)
  await h.controller.tick()
  assert.equal(h.reloads, 0)
  h.time(119_000)
  await h.controller.tick()
  assert.equal(h.reloads, 1)
})

test('unsafe routes, busy tasks, sessions or dialogs restart the safe idle window', async () => {
  const h = harness()
  h.safe(false)
  await h.controller.tick()
  h.time(600_000)
  await h.controller.tick()
  assert.equal(h.reloads, 0)
  h.safe(true)
  await h.controller.tick()
  h.time(659_999)
  await h.controller.tick()
  assert.equal(h.reloads, 0)
  h.time(660_000)
  await h.controller.tick()
  assert.equal(h.reloads, 1)
})

test('activity or navigation during the network probe prevents reload', async () => {
  let complete
  const h = harness(async (verify) =>
    verify
      ? new Promise((resolve) => {
          complete = resolve
        })
      : { version: NEW }
  )
  await h.controller.tick()
  h.time(60_000)
  const pending = h.controller.tick()
  h.safe(false)
  h.controller.markActivity()
  complete({ version: NEW })
  await pending
  assert.equal(h.reloads, 0)
})

test('a rollback during the idle window cancels the pending update', async () => {
  const h = harness()
  await h.controller.tick()
  h.version(OLD)
  h.time(60_000)
  await h.controller.tick()
  assert.equal(h.reloads, 0)
})

test('unavailable assets keep the old page and back off for five minutes', async () => {
  const h = harness(async (verify) => {
    if (verify) throw new Error('network unavailable')
    return { version: NEW }
  })
  await h.controller.tick()
  h.time(60_000)
  await h.controller.tick()
  h.time(359_999)
  await h.controller.tick()
  assert.equal(h.requests.length, 2)
  assert.equal(h.reloads, 0)
})

test('missing or invalid release metadata never triggers reload', async () => {
  const h = harness(async () => null)
  await h.controller.tick()
  h.time(600_000)
  await h.controller.tick()
  assert.equal(h.reloads, 0)
})

test('concurrent checks share one request and unmount aborts the pending refresh', async () => {
  let complete
  const h = harness(
    async () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  const pending = h.controller.tick()
  await h.controller.tick()
  assert.equal(h.requests.length, 1)
  h.controller.stop()
  assert.equal(h.requests[0].signal.aborted, true)
  complete({ version: NEW })
  await pending
  h.time(600_000)
  await h.controller.tick()
  assert.equal(h.reloads, 0)
  assert.equal(h.requests.length, 1)
})

function releaseDocument({ version = NEW, root = true, script = '/assets/index-new.js' } = {}) {
  const attribute = (value) => ({ getAttribute: () => value })
  return {
    querySelector: () => (version ? { content: version } : null),
    getElementById: () => (root ? {} : null),
    querySelectorAll: (selector) =>
      selector.startsWith('script')
        ? script
          ? [attribute(script)]
          : []
        : [attribute('/assets/index-new.css')],
  }
}

test('release parser requires an application root, version, module entry and same-origin assets', () => {
  const base = 'https://example.test/'
  assert.deepEqual(readContentRelease(releaseDocument(), base), {
    version: NEW,
    assets: [
      'https://example.test/assets/index-new.js',
      'https://example.test/assets/index-new.css',
    ],
  })
  for (const options of [
    { version: '' },
    { version: 'invalid' },
    { root: false },
    { script: '' },
    { script: 'https://elsewhere.test/a.js' },
  ]) {
    assert.equal(readContentRelease(releaseDocument(options), base), null)
  }
})

test('network checks bypass cache, omit credentials, reject redirects and verify JS/CSS MIME', async (t) => {
  const requests = []
  let assetType = 'text/javascript'
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, ...options })
    return new Response(options.method === 'HEAD' ? null : '<html></html>', {
      headers: {
        'content-type':
          options.method === 'HEAD' ? (url.endsWith('.css') ? 'text/css' : assetType) : 'text/html',
      },
    })
  })
  const originalParser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser')
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    value: class {
      parseFromString() {
        return releaseDocument()
      }
    },
  })
  t.after(() => {
    if (originalParser) Object.defineProperty(globalThis, 'DOMParser', originalParser)
    else delete globalThis.DOMParser
  })
  const signal = new AbortController().signal
  const release = await fetchContentRelease('https://example.test/', true, signal)
  assert.equal(release.version, NEW)
  assert.deepEqual(
    requests.map((r) => r.method ?? 'GET'),
    ['GET', 'HEAD', 'HEAD']
  )
  for (const request of requests) {
    assert.equal(request.cache, 'no-store')
    assert.equal(request.credentials, 'omit')
    assert.equal(request.redirect, 'error')
    assert.equal(request.signal, signal)
  }
  assetType = 'text/html'
  await assert.rejects(
    fetchContentRelease('https://example.test/', true, signal),
    /asset unavailable/
  )
})

test(
  'production browser: safe home updates; dialog, session residue and business route defer',
  {
    skip: !process.env.CONTENT_UPDATE_BROWSER_URL,
    timeout: 90_000,
  },
  async () => {
    const { chromium, expect } = await import('@playwright/test')
    const browser = await chromium.launch({
      channel: process.env.CONTENT_UPDATE_BROWSER_CHANNEL || 'msedge',
    })
    const base = process.env.CONTENT_UPDATE_BROWSER_URL.replace(/\/$/, '')
    const html = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8')
    const newer = html.replace(/(name="kiosk-content-version" content=")[^"]+/, `$1${NEW}`)
    mkdirSync(new URL('../../../../test-results/content-update/', import.meta.url), {
      recursive: true,
    })
    try {
      for (const viewport of [
        { width: 1080, height: 1920 },
        { width: 390, height: 844 },
      ]) {
        const context = await browser.newContext({ viewport })
        const page = await context.newPage()
        let navigations = 0
        let checks = 0
        // No real API, local Agent, files, login, payment or printer is contacted.
        await page.route('**/api/v1/**', (route) =>
          route.fulfill({ status: 503, json: { message: 'Test service unavailable' } })
        )
        await page.route('http://127.0.0.1:9527/**', (route) =>
          route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, json: {} })
        )
        await page.route(`${base}/`, (route) => {
          if (route.request().isNavigationRequest()) navigations += 1
          else checks += 1
          const body = route.request().isNavigationRequest() && navigations === 1 ? html : newer
          return route.fulfill({ status: 200, contentType: 'text/html', body })
        })
        await page.clock.install()
        await page.goto(base)
        await expect(page.locator('[data-testid="qx-home"]')).toBeVisible()
        await expect.poll(() => checks).toBeGreaterThan(0)
        // The initial background check sees a newer release than the loaded document.
        await page.evaluate(() => {
          const dialog = document.createElement('dialog')
          dialog.textContent = 'Update protection test'
          document.body.append(dialog)
          dialog.showModal()
        })
        await page.clock.fastForward(61_000)
        assert.equal(navigations, 1, 'open dialog prevents reload')
        await page.evaluate(() => document.querySelector('dialog').remove())
        await page.clock.fastForward(1_000)
        await page.clock.fastForward(59_000)
        assert.equal(navigations, 1, 'closing a dialog starts a new idle window')
        await page.evaluate(() => sessionStorage.setItem('ai-job-print:current-ai-resume', '{}'))
        await page.clock.fastForward(2_000)
        assert.equal(navigations, 1, 'sensitive session residue prevents reload')
        await page.evaluate(() => {
          sessionStorage.removeItem('ai-job-print:current-ai-resume')
          window.dispatchEvent(new Event('pointerdown'))
          history.pushState(history.state, '', '/print/upload')
          window.dispatchEvent(new PopStateEvent('popstate'))
        })
        await expect(page).toHaveURL(/\/print\/upload$/)
        await page.clock.fastForward(61_000)
        assert.equal(navigations, 1, 'business page prevents content reload')
        await page.evaluate(() => {
          window.dispatchEvent(new Event('pointerdown'))
          history.pushState(history.state, '', '/')
          window.dispatchEvent(new PopStateEvent('popstate'))
        })
        await expect(page.locator('[data-testid="qx-home"]')).toBeVisible()
        await page.clock.fastForward(1_000)
        await page.clock.fastForward(58_000)
        assert.equal(navigations, 1)
        await page.clock.fastForward(3_000)
        await expect.poll(() => navigations).toBe(2)
        await expect(page.locator('meta[name="kiosk-content-version"]')).toHaveAttribute(
          'content',
          NEW
        )
        await expect(page.locator('[data-testid="qx-home"]')).toBeVisible()
        await page.screenshot({
          path: new URL(
            `../../../../test-results/content-update/home-${viewport.width}.png`,
            import.meta.url
          ).pathname.replace(/^\/(\w:)/, '$1'),
          fullPage: true,
        })
        await context.close()
      }
    } finally {
      await browser.close()
    }
  }
)
