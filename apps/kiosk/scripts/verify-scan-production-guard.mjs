import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const files = {
  scanStart: 'src/pages/scan/ScanStartPage.tsx',
  scanSettings: 'src/pages/scan/ScanSettingsPage.tsx',
  scanProgress: 'src/pages/scan/ScanProgressPage.tsx',
  scanResult: 'src/pages/scan/ScanResultPage.tsx',
}

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

let failures = 0

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  failures += 1
  console.error(`  FAIL ${message}`)
}

function expectIncludes(source, needle, message) {
  if (source.includes(needle)) pass(message)
  else fail(`${message} — missing ${JSON.stringify(needle)}`)
}

function expectMatches(source, pattern, message) {
  if (pattern.test(source)) pass(message)
  else fail(`${message} — pattern ${pattern} not found`)
}

function expectButtonBlockIncludes(source, marker, needles, message) {
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) {
    fail(`${message} — marker ${JSON.stringify(marker)} not found`)
    return
  }

  const buttonStart = source.lastIndexOf('<Button', markerIndex)
  const buttonEnd = source.indexOf('</Button>', markerIndex)
  if (buttonStart < 0 || buttonEnd < markerIndex) {
    fail(`${message} — could not locate containing Button block`)
    return
  }

  const block = source.slice(buttonStart, buttonEnd)
  const missing = needles.filter((needle) => !block.includes(needle))
  if (missing.length === 0) pass(message)
  else fail(`${message} — missing ${missing.map((needle) => JSON.stringify(needle)).join(', ')}`)
}

console.log('\n=== Kiosk scan production guard ===')

const scanStart = read(files.scanStart)
const scanSettings = read(files.scanSettings)
const scanProgress = read(files.scanProgress)
const scanResult = read(files.scanResult)

expectIncludes(
  scanStart,
  "import { API_MODE } from '../../services/api/client'",
  'ScanStartPage reads API_MODE',
)
expectIncludes(
  scanStart,
  "const scanUnavailable = API_MODE === 'http'",
  'ScanStartPage treats http mode as unavailable until real scan Agent is connected',
)
expectMatches(
  scanStart,
  /disabled=\{selected === null \|\| scanUnavailable\}/,
  'ScanStartPage disables the start button in http mode',
)

expectIncludes(
  scanSettings,
  "import { API_MODE } from '../../services/api/client'",
  'ScanSettingsPage reads API_MODE',
)
expectIncludes(
  scanSettings,
  "const scanUnavailable = API_MODE === 'http'",
  'ScanSettingsPage treats http mode as unavailable until real scan Agent is connected',
)
expectButtonBlockIncludes(
  scanSettings,
  '开始扫描',
  ['disabled={scanUnavailable}', '真机扫描待接入'],
  'ScanSettingsPage disables the start button in http mode',
)

expectIncludes(
  scanProgress,
  "import { API_MODE } from '../../services/api/client'",
  'ScanProgressPage reads API_MODE',
)
expectIncludes(
  scanProgress,
  'SCAN_HARDWARE_UNAVAILABLE_REASON',
  'ScanProgressPage has an explicit hardware-unavailable failure reason',
)
expectIncludes(
  scanProgress,
  "const useSimulatedScan = API_MODE !== 'http'",
  'ScanProgressPage gates simulated scan behind non-http mode',
)

const simulatedGuardIndex = scanProgress.indexOf('if (!useSimulatedScan)')
const unavailableFailIndex = scanProgress.indexOf('navigateFail(SCAN_HARDWARE_UNAVAILABLE_REASON)', simulatedGuardIndex)
const mockFileIndex = scanProgress.indexOf('mockFile(scanType)', simulatedGuardIndex)
if (simulatedGuardIndex >= 0 && unavailableFailIndex > simulatedGuardIndex && simulatedGuardIndex < mockFileIndex) {
  pass('ScanProgressPage fails honestly in http mode before mockFile() can run')
} else {
  fail('ScanProgressPage must fail in http mode before creating a fake scan file')
}

expectButtonBlockIncludes(
  scanResult,
  '<PrinterIcon',
  ['disabled={API_MODE === \'http\'}', '打印(硬件接入后开放)'],
  'ScanResultPage keeps fake scan files out of real print flow in http mode',
)
expectMatches(
  scanResult,
  /const handlePrint = \(\) => \{\s+if \(API_MODE === 'http'\) return/s,
  'ScanResultPage print handler also exits in http mode',
)
expectButtonBlockIncludes(
  scanResult,
  '<SaveIcon',
  ['disabled={API_MODE === \'http\'}', '保存(硬件接入后开放)'],
  'ScanResultPage keeps fake scan files out of saved documents in http mode',
)
expectMatches(
  scanResult,
  /const handleSave = \(\) => \{\s+if \(API_MODE === 'http'\) return/s,
  'ScanResultPage save handler also exits in http mode',
)
expectButtonBlockIncludes(
  scanResult,
  '<SparklesIcon',
  ['disabled={scanType !== \'resume\' || API_MODE === \'http\'}'],
  'ScanResultPage disables AI resume parsing for fake scan files in http mode',
)
expectMatches(
  scanResult,
  /const handleResumeAI = \(\) => \{\s+if \(API_MODE === 'http'\) return/s,
  'ScanResultPage AI resume handler also exits in http mode',
)

if (failures > 0) {
  console.error(`\n${failures} scan production guard check(s) failed`)
  process.exit(1)
}

console.log('✅ ALL PASS — Kiosk scan production guard\n')
