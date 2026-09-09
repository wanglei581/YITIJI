import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(resolve(kioskRoot, relativePath), 'utf8')

const scanStart = read('src/pages/scan/ScanStartPage.tsx')
const scanSettings = read('src/pages/scan/ScanSettingsPage.tsx')

assert.doesNotMatch(
  scanStart,
  /\/kiosk\/device\/status|fetchScannerStatus|setInterval\s*\(/,
  'scan start must not depend on the nonexistent device-status endpoint or auto retry it',
)
assert.match(
  scanStart,
  /\u4e0b\u4e00\u6b65\u4f1a\u521b\u5efa\u771f\u5b9e\u626b\u63cf\u4f1a\u8bdd/,
  'scan start must explain that the real session is created on the next step',
)
assert.match(
  scanStart,
  /navigate\(["']\/scan\/settings["'][\s\S]*state:\s*\{\s*scanType:\s*selected\s*\}/,
  'scan start must carry an explicit scan type through route state',
)

assert.match(scanSettings, /function isScanType\(/, 'scan settings must validate its route state')
assert.match(
  scanSettings,
  /if\s*\(!scanType\)\s*return/,
  'scan settings must stop before creating when route state is invalid',
)
assert.doesNotMatch(
  scanSettings,
  /const GUIDE_STEPS|\u521b\u5efa\u626b\u63cf\u4efb\u52a1\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5|\u81ea\u52a8\u91cd\u8bd5/,
  'scan settings must not show fabricated guide steps or invite a blind retry',
)
assert.match(scanSettings, /instructions\.map\(/, 'success must render server instructions')
assert.match(scanSettings, /sessionPromiseRef/, 'StrictMode must share one create request')
assert.match(scanSettings, /cancelRequestedRef/, 'cancellation must be de-duplicated')
assert.match(
  scanSettings,
  /const cancellationCredentials = getCancellationCredentials\(created\)[\s\S]*if \(!isValidCreatedSession\(created\)\)[\s\S]*cancelSessionOnce\(/,
  'a malformed created session with usable credentials must be cancelled instead of orphaned',
)
assert.match(scanSettings, /controlTokenRef/, 'control token must remain in memory for cleanup')
assert.doesNotMatch(
  scanSettings,
  /localStorage|sessionStorage/,
  'scan settings must never persist its control token in browser storage',
)

const scanProgress = read('src/pages/scan/ScanProgressPage.tsx')
const scanResult = read('src/pages/scan/ScanResultPage.tsx')
const scanFormat = read('src/pages/scan/scanOutputFormat.ts')

assert.match(
  scanFormat,
  /export function formatLabelFromMime/,
  'scan format label must be derived from mimeType, not hardcoded',
)
assert.match(
  scanSettings,
  /SCAN_OUTPUT_FORMAT_PENDING/,
  'settings must not promise a format before the file exists',
)
assert.doesNotMatch(
  scanSettings,
  /PDF（服务端生成）|PDF（自动生成）/,
  'settings must not claim server-generated PDF',
)
assert.match(
  scanProgress,
  /formatLabelFromMime\(file\.mimeType\)/,
  'progress result state must derive format from the delivered mimeType',
)
assert.doesNotMatch(
  scanProgress,
  /format:\s*'PDF'|自动生成 PDF|PDF（自动生成）/,
  'progress must not hardcode PDF as the scan output',
)
assert.match(
  scanProgress,
  /服务端不做转换/,
  'progress must say the server stores the original bytes',
)
assert.doesNotMatch(
  scanResult,
  /format:\s*'PDF'|application\/pdf/,
  'result must not default the scanned file to PDF',
)
assert.match(
  scanResult,
  /formatLabelFromMime\(file\?\.mimeType\)/,
  'result chip must follow the real mimeType',
)
assert.doesNotMatch(
  scanResult,
  /登录后可在「我的文档」管理|登录后管理文件/,
  'guest scan result must not promise My Documents after login',
)
assert.match(
  scanResult,
  /未登录扫描件不会进入「我的文档」/,
  'guest scan result must say the file will not enter My Documents',
)
assert.match(
  scanResult,
  /disabled=\{!file \|\| !isLoggedIn\}/,
  'guest must not be sent to login as if the scan file will be claimed',
)
assert.match(
  scanStart,
  /未登录不会进入「我的文档」|未登录扫描件不会进入「我的文档」/,
  'scan start must not tell guests that login will recover the file',
)
assert.doesNotMatch(
  scanStart,
  /生成 PDF/,
  'scan start must not advertise PDF conversion that the server does not do',
)

assert.match(scanFormat, /mime === 'image\/jpeg'[\s\S]{0,40}return 'JPEG'/, 'jpeg mime maps to JPEG')
assert.match(scanFormat, /mime === 'image\/png'[\s\S]{0,40}return 'PNG'/, 'png mime maps to PNG')
assert.match(scanFormat, /mime === 'application\/pdf'[\s\S]{0,40}return 'PDF'/, 'pdf mime maps to PDF')
assert.match(scanFormat, /if \(!mime\) return '未知格式'/, 'missing mime maps to 未知格式')

const workbench = read('src/pages/scan/ScanWorkbenchPage.tsx')
assert.match(workbench, /readScanWorkbenchSession/, 'workbench rehydrates from sessionStorage')
assert.match(workbench, /replace: true/, 'workbench stage changes replace history')

/* 2026-09-08 补：三条公共终端约束里，「复水」和「replace」上面已有断言，
 * 但「URL 是意图不是授权」和「离开进度阶段必须停轮询」当时只在代码里，没被钉住。
 * 这两条恰恰是最容易被后人一行改回去的：
 *   - 把 resolveScanView 改成直接返回 requested，深链就能伪造一场扫描；
 *   - 把 ScanProgressPage 提到条件外常驻，轮询就在别的阶段一直打接口。 */
const workbenchModel = read('src/pages/scan/scanWorkbenchModel.ts')
assert.match(
  workbenchModel,
  /isScanStageAuthorized\s*\(/,
  'URL 是意图不是授权：阶段准入必须过 isScanStageAuthorized，不能直接采信 ?stage=',
)
assert.match(
  workbenchModel,
  /if \(stage === 'progress'\) return hasLiveSession/,
  '没有扫描会话时 progress 阶段不许落地（深链也不行）',
)
assert.match(
  workbenchModel,
  /if \(stage === 'result'\) return hasResult/,
  '没有扫描结果时 result 阶段不许落地（不伪造已完成）',
)
assert.match(
  workbench,
  /view === 'progress' \? \(\s*<ScanProgressPage/,
  '轮询只在 progress 阶段挂载：ScanProgressPage 必须条件渲染，常驻会让轮询在别的阶段继续打接口',
)
assert.doesNotMatch(
  workbench,
  /clearScanWorkbenchSession/,
  'workbench must not clear the scan session on unmount',
)
assert.match(
  read('src/auth/kioskSensitiveSession.ts'),
  /SCAN_WORKBENCH_SESSION_KEY/,
  'scan workbench session key is registered for leftover detection',
)
assert.match(
  read('src/pages/scan/scanWorkbenchSession.ts'),
  /sessionStorage/,
  'scan live credentials persist only in the dedicated session module',
)

const modelTest = spawnSync(
  process.execPath,
  ['--test', resolve(kioskRoot, 'scripts/tests/scan-workbench-model.test.mjs')],
  { encoding: 'utf8' },
)
assert.equal(
  modelTest.status,
  0,
  `scan workbench model unit test failed: ${modelTest.stderr || modelTest.stdout}`,
)

console.log('ALL PASS scan session truth contract')
