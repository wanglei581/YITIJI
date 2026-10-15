import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname))
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const page = read('src/pages/scan/ScanSettingsPage.tsx')
const view = read('src/pages/scan/ScanSettingsStatusView.tsx')
const recovery = read('src/pages/scan/scanRescanRecovery.ts')

assert.match(recovery, /SCAN_TERMINAL_QUIET_PERIOD/)
assert.match(recovery, /上一位的扫描可能还在出纸，请等约/)
assert.match(page, /quietPeriodRemaining/)
assert.match(page, /setQuietPeriodRemaining\(\(seconds\) => Math\.max\(0, seconds - 1\)\)/)
assert.match(view, /请等约 \$\{quietPeriodRemaining\} 秒/)
assert.match(view, /重新开始一次扫描/)
assert.doesNotMatch(recovery, /设备故障/)
console.log('PASS kiosk scan quiet period verification')
