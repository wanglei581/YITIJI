import { test } from '../fixtures/kiosk-test'
import { writeScanWorkbenchSession, W2_FILE } from './fixtures/fusion-w2-state'
import { FusionW2BinaryRoute } from './fixtures/fusion-w2-binary-route'

for (const vp of [{ width: 390, height: 844 }, { width: 1080, height: 1920 }, { width: 1280, height: 720 }, { width: 760, height: 1024 }]) {
  test(`probe scan result ${vp.width}`, async ({ page, api }) => {
    await page.setViewportSize(vp)
    const binary = new FusionW2BinaryRoute(page)
    await binary.install()
    api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
    api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true } })
    api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', { status: 200, json: { capabilities: [] } })
    api.respond('POST', '/api/v1/resume/parse', { status: 503, json: { success: false, error: { code: 'X', message: 'x' } } })
    await page.goto('/scan?stage=start')
    await writeScanWorkbenchSession(page, { stage: 'result', scanType: 'resume', extras: {}, result: { outcome: 'completed', success: true, file: { fileId: 'w2-scan-file', fileUrl: W2_FILE.fileUrl, name: 'w2-scan.pdf', size: '128 KB', pages: 2, format: 'PDF', mimeType: 'application/pdf' } } })
    await page.goto('/scan?stage=result')
    await page.waitForTimeout(800)
    const dump = await page.evaluate(() => {
      const q = (s: string) => document.querySelector(s) as HTMLElement | null
      const r = (s: string) => {
        const e = q(s)
        if (!e) return null
        const b = e.getBoundingClientRect()
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width), ch: e.clientHeight, sh: e.scrollHeight, ov: getComputedStyle(e).overflowY }
      }
      return {
        fit: q('[data-kiosk-stage-fit]')?.getAttribute('data-kiosk-stage-fit'),
        doc: { sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth },
        stage: r('.qx-stage'), topbar: r('.qx-topbar'), head: r('.qx-pagehead'), body: r('.qx-body'),
        swpage: r('.sw-page'), xq: r('.sw-xq'), scroll: r('.sw-scroll'), truth: r('.sw-truth'),
        result: r('.sw-result'), preview: r('.sw-preview'), actrow: r('.sw-actrow'), home: r('.sw-home-exit'),
        cta: r('.qx-ctabar'), nav: r('.qx-navbar'),
      }
    })
    console.log(vp.width, JSON.stringify(dump))
    await page.screenshot({ path: `/tmp/purring-probe-out/before-${vp.width}.png` })
    const btn = page.getByRole('button', { name: /AI 简历识别/ })
    await btn.scrollIntoViewIfNeeded()
    const box = await btn.boundingBox()
    const hit = await page.evaluate(({ x, y }) => {
      const e = document.elementFromPoint(x, y)
      return e ? `${e.tagName}.${(e as HTMLElement).className} in ${(e.closest('.sw-xq,.sw-truth,.sw-exit') as HTMLElement | null)?.className ?? '-'}` : null
    }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })
    console.log(vp.width, 'btn box', JSON.stringify(box), 'hit', hit)
    await page.screenshot({ path: `/tmp/purring-probe-out/before-${vp.width}-scrolled.png` })
    try {
      await btn.click({ timeout: 3000 })
      await page.waitForURL('**/resume/parse', { timeout: 3000 })
      console.log(vp.width, 'CLICK OK', page.url())
    } catch (e) {
      console.log(vp.width, 'CLICK FAIL', String(e).slice(0, 1200))
    }
  })
}
