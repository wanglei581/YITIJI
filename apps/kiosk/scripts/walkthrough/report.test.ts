/**
 * 出口三态与「真正无出口」过滤。
 * 防的是只认 `.qx-topbar-back` 把 KioskPageHeader 页记成无出口。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { backExitLabel, isTrueNoExit, renderReport } from './report.ts'

const here = dirname(fileURLToPath(import.meta.url))

function row(partial: {
  landedPathname?: string
  topbarBack?: string[]
  legacyBack?: string[]
  ctaSecondary?: string[]
  pattern?: string
  requestPathname?: string
}) {
  return {
    landedPathname: '/',
    topbarBack: [],
    legacyBack: [],
    ctaSecondary: [],
    ...partial,
  }
}

test('KioskPageHeader 仍用 .ui-kiosk-back-button + aria-label={backLabel}', () => {
  const src = readFileSync(
    resolve(here, '../../../../packages/ui/src/components/KioskPageHeader.tsx'),
    'utf8',
  )
  assert.match(src, /className="ui-kiosk-back-button"/)
  assert.match(src, /aria-label=\{backLabel\}/)
  assert.match(src, /className="ui-kiosk-back-label"/)
})

test('青序返回槽', () => {
  const shot = row({ landedPathname: '/print-scan', topbarBack: ['返回首页'] })
  assert.equal(backExitLabel(shot), '青序返回槽（返回首页）')
  assert.equal(isTrueNoExit(shot), false)
})

test('旧壳返回键记下 label（LegalDocPage 那种）', () => {
  const shot = row({ landedPathname: '/legal/privacy', legacyBack: ['返回'] })
  assert.equal(backExitLabel(shot), '旧壳返回键（返回）')
  assert.equal(isTrueNoExit(shot), false)
})

test('首页落地不算无出口', () => {
  const shot = row({ landedPathname: '/' })
  assert.equal(backExitLabel(shot), '根页面，不适用')
  assert.equal(isTrueNoExit(shot), false)
})

test('两者都没有才是无', () => {
  const shot = row({ landedPathname: '/member/qr-login' })
  assert.equal(backExitLabel(shot), '无')
  assert.equal(isTrueNoExit(shot), true)
})

test('有 CTA 次级出口也不进无出口表', () => {
  const shot = row({ landedPathname: '/profile', ctaSecondary: ['回首页'] })
  assert.equal(backExitLabel(shot), '无')
  assert.equal(isTrueNoExit(shot), false)
})

test('无出口表不含 / 与旧壳返回页', () => {
  const markdown = renderReport(
    {
      generatedAt: 't',
      sha: 'abc',
      branch: 'chore/walkthrough-harness',
      origin: 'http://127.0.0.1:4196',
      viewport: '1080×1920',
      fixture: 'fixture',
      routeSource: 'routes',
      routeCount: 3,
      screenshotDir: 'shots/',
    },
    [
      {
        pattern: '/',
        requestUrl: '/',
        requestPathname: '/',
        screenshot: 'root.png',
        captureError: null,
        landedPathname: '/',
        landedSearch: '',
        headings: [],
        title: '首页',
        mainActions: [],
        topbarBack: [],
        legacyBack: [],
        ctaSecondary: [],
        ctaAll: [],
        disabledButtons: [],
        qxFrame: true,
        v6Shell: false,
        pageFrame: false,
        w4Frame: false,
      },
      {
        pattern: '/legal/:doc',
        requestUrl: '/legal/privacy',
        requestPathname: '/legal/privacy',
        screenshot: 'legal_doc.png',
        captureError: null,
        landedPathname: '/legal/privacy',
        landedSearch: '',
        headings: [],
        title: '隐私政策',
        mainActions: [],
        topbarBack: [],
        legacyBack: ['返回'],
        ctaSecondary: [],
        ctaAll: [],
        disabledButtons: [],
        qxFrame: false,
        v6Shell: false,
        pageFrame: true,
        w4Frame: false,
      },
      {
        pattern: '/member/qr-login',
        requestUrl: '/member/qr-login',
        requestPathname: '/member/qr-login',
        screenshot: 'member_qr-login.png',
        captureError: null,
        landedPathname: '/member/qr-login',
        landedSearch: '',
        headings: [],
        title: '就业服务大厅',
        mainActions: [],
        topbarBack: [],
        legacyBack: [],
        ctaSecondary: [],
        ctaAll: [],
        disabledButtons: [],
        qxFrame: false,
        v6Shell: false,
        pageFrame: false,
        w4Frame: false,
      },
    ],
  )
  const section = (markdown.split('## 没有任何出口的')[1] ?? '').split('## ')[0] ?? ''
  assert.match(section, /共 1 条/)
  assert.match(section, /\/member\/qr-login/)
  assert.doesNotMatch(section, /\/legal\/:doc/)
  assert.doesNotMatch(section, /\| \/ \|/)
  assert.match(markdown, /旧壳返回键（返回）/)
  assert.match(markdown, /根页面，不适用/)
  assert.match(section, /如果将来又出现第三种壳，它会重新产生假阳性/)
})
