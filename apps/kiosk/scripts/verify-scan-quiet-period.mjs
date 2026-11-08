import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname))
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
// 2026-11-02 K1a：设置页按职责拆开后，静默期倒计时那条 effect 在 useScanSessionCreate.ts，
// 页面本身只把 quietPeriodRemaining 传给状态屏；所以这里读这两份的拼接，断言原样不变。
const page = ['src/pages/scan/useScanSessionCreate.ts', 'src/pages/scan/ScanSettingsPage.tsx'].map(read).join('\n')
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
