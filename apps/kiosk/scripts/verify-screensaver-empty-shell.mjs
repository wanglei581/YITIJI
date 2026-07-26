import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const page = readFileSync(join(kioskRoot, 'src/pages/screensaver/ScreensaverPage.tsx'), 'utf8')

let failures = 0
function check(label, run) {
  try {
    run()
    console.log(`PASS ${label}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

check('no-media branch is not a blank aria-hidden shell', () => {
  // Historical bug: while waiting for playlist/media, return <div ... aria-hidden="true" /> only.
  assert.doesNotMatch(
    page,
    /if\s*\(\s*!current\s*\|\|\s*!mediaUrl\s*\)\s*\{\s*return\s*<div[^>]*aria-hidden="true"\s*\/>/,
  )
})

check('no-media / empty shell still exposes wake copy and screensaver marker', () => {
  assert.match(page, /触摸屏幕开始使用/)
  assert.match(page, /data-kiosk-screen="screensaver"/)
  // Must keep an honest shell path that renders wake prompt without requiring mediaUrl.
  assert.match(
    page,
    /screensaver-wake-prompt[\s\S]{0,240}触摸屏幕开始使用/,
  )
  assert.match(page, /role="presentation"/)
})

check('empty playlist after fetch still exits home (no fake media)', () => {
  assert.match(page, /if\s*\(\s*!p\.enabled\s*\|\|\s*p\.items\.length\s*===\s*0\s*\)\s*\{\s*exit\(\)/)
  assert.doesNotMatch(page, /items:\s*\[[^\]]*url:\s*['"]https?:\/\//)
  assert.doesNotMatch(page, /demoPlaylist|fakePlaylist|mockPlaylist/)
})

if (failures) {
  console.error(`\n${failures} FAIL screensaver empty shell contract`)
  process.exit(1)
}
console.log('\nALL PASS screensaver empty shell contract')
