import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const scanStartPath = path.join(root, 'src/pages/scan/ScanStartPage.tsx')
const scanProgressPath = path.join(root, 'src/pages/scan/ScanProgressPage.tsx')
const scanResultPath = path.join(root, 'src/pages/scan/ScanResultPage.tsx')

const read = (file) => fs.readFileSync(file, 'utf8')
const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}
const pass = (message) => console.log(`✓ ${message}`)

const scanStart = read(scanStartPath)
const scanProgress = read(scanProgressPath)
const scanResult = read(scanResultPath)

console.log('\n=== verify scan production guard ===')

if (scanStart.includes("import { API_MODE } from '../../services/api/client'")) {
  pass('ScanStartPage reads API_MODE')
} else {
  fail('ScanStartPage must read API_MODE before allowing the scan flow to start')
}

if (scanStart.includes("const scanUnavailable = API_MODE === 'http'")) {
  pass('ScanStartPage detects production http mode as scan-unavailable')
} else {
  fail('ScanStartPage must explicitly treat http mode as unavailable until real scan Agent is connected')
}

if (scanStart.includes('disabled={selected === null || scanUnavailable}')) {
  pass('ScanStartPage disables the start button in http mode')
} else {
  fail('ScanStartPage must disable the start button in http mode')
}

if (scanProgress.includes("import { API_MODE } from '../../services/api/client'")) {
  pass('ScanProgressPage reads API_MODE')
} else {
  fail('ScanProgressPage must read API_MODE to distinguish production http from mock demo')
}

if (scanProgress.includes('SCAN_HARDWARE_UNAVAILABLE_REASON')) {
  pass('ScanProgressPage has an explicit hardware-unavailable failure reason')
} else {
  fail('ScanProgressPage must use an explicit hardware-unavailable failure reason in http mode')
}

if (scanProgress.includes("const useSimulatedScan = API_MODE !== 'http'")) {
  pass('ScanProgressPage gates simulated scan behind non-http mode')
} else {
  fail('ScanProgressPage must gate mockFile/Math.random simulated success behind API_MODE !== http')
}

const simulatedGuardIndex = scanProgress.indexOf('if (!useSimulatedScan)')
const unavailableFailIndex = scanProgress.indexOf('navigateFail(SCAN_HARDWARE_UNAVAILABLE_REASON)', simulatedGuardIndex)
const mockFileIndex = scanProgress.indexOf('mockFile(scanType)')
if (simulatedGuardIndex >= 0 && unavailableFailIndex > simulatedGuardIndex && simulatedGuardIndex < mockFileIndex) {
  pass('ScanProgressPage fails honestly in http mode instead of producing fake files')
} else {
  fail('ScanProgressPage must navigate to a failed result in http mode before mockFile() can run')
}

if (scanResult.includes("disabled={API_MODE === 'http'}")) {
  pass('ScanResultPage keeps fake scan files out of real print flow in http mode')
} else {
  fail('ScanResultPage must keep scan demo files out of real print flow in http mode')
}

if (
  scanResult.includes("title={API_MODE === 'http' ? '扫描硬件接入后开放真实保存' : undefined}") &&
  scanResult.includes("保存(硬件接入后开放)")
) {
  pass('ScanResultPage keeps fake scan files out of saved documents in http mode')
} else {
  fail('ScanResultPage must disable saving scan demo files in http mode')
}

if (scanResult.includes("disabled={scanType !== 'resume' || API_MODE === 'http'}")) {
  pass('ScanResultPage keeps fake scan files out of AI resume parsing in http mode')
} else {
  fail('ScanResultPage must disable AI resume parsing for scan demo files in http mode')
}

if (process.exitCode) {
  console.error('\nScan production guard verification failed.')
  process.exit(process.exitCode)
}

console.log('ALL PASS: scan production guard')
