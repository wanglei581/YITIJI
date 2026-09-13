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
  // 2026-09-13：四页合并后的真地址是 /scan?stage=settings（/scan/settings 只剩兼容重定向）。
  /navigate\(["']\/scan\?stage=settings["'][\s\S]*state:\s*\{\s*scanType:\s*selected\s*\}/,
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

/* ── 扫描会话撤销契约（2026-09-13） ────────────────────────────────────────
 *
 * 本机 sessionStorage 里那份 scan session 只是凭证副本；真正决定「面板扫出来的文件
 * 投给谁」的是服务端 ScanTask。清本地不撤服务端 = 把上一位用户的收件箱留在原地，
 * 下一位在面板上按下扫描就会把文件投给他。下面钉住三件事：
 *   1) 撤销发生在**清掉本地登记之前**（顺序反了就再也找不到要撤谁）；
 *   2) 撤销带的是**正在失效的那个身份**（服务端按 endUserId 校验取消权限，
 *      用新身份发只会 403 —— 看起来撤了，其实没撤）；
 *   3) 已经是终态的任务不再发 DELETE，且撤销不重试、不阻塞清场。
 */
const scanRevoke = read('src/pages/scan/scanSessionRevoke.ts')
assert.match(
  scanRevoke,
  /readScanWorkbenchSession\(\)/,
  '撤销要从本机登记里读 scanTaskId / controlToken，不能另存一份',
)
assert.match(scanRevoke, /method:\s*'DELETE'/, '撤销走 DELETE /scan/sessions/:id')
assert.match(scanRevoke, /'X-Scan-Session-Control'/, '撤销必须带控制凭证，否则服务端 403')
assert.match(scanRevoke, /keepalive:\s*true/, '清场会拆掉页面：没有 keepalive 的请求会随文档一起被取消')
assert.match(scanRevoke, /const attempted = new Set<string>\(\)/, '同一次页面生命周期内每个任务只尝试一次')
assert.match(
  scanRevoke,
  /attempted\.add\(live\.scanTaskId\)/,
  '去重必须在发请求之前登记，失败也不再补发（撤销是尽力而为）',
)
assert.match(
  scanRevoke,
  /if \(hasResult\) return false/,
  '已有结果快照 = 服务端已给终态，不再发 DELETE',
)
assert.match(
  scanRevoke,
  /if \(!\(Date\.parse\(live\.expiresAt\) > Date\.now\(\)\)\) return false/,
  '本机已知过期的任务不再发 DELETE',
)
assert.match(scanRevoke, /\.catch\(\(\) => undefined\)/, '网络错误 / 409 / 已终态一律吞掉，不打断清场')
// 注释里会解释「为什么不 await / 不重试」，所以这条只能对**代码**判，先剥注释。
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
assert.doesNotMatch(
  stripComments(scanRevoke),
  /setTimeout|setInterval|for \(|while \(|await /,
  '撤销只尝试一次：不重试、不轮询、不 await（清场比撤销要紧）',
)

const sensitiveSession = read('src/auth/kioskSensitiveSession.ts')
assert.match(
  sensitiveSession,
  /revokeLiveScanSession\(outgoingMemberToken \?\? null\)\s*\n\s*clearScanWorkbenchSession\(\)/,
  '顺序：先撤服务端任务，再清本地登记。反过来就找不到要撤谁了',
)
assert.match(
  sensitiveSession,
  /export function clearKioskSensitiveSession\(outgoingMemberToken\?: string \| null\)/,
  '清场入口要接收「正在失效的会员令牌」，否则撤销只能匿名发出去',
)

const authContext = read('src/auth/AuthContext.tsx')
assert.match(
  authContext,
  /const login = useCallback\([\s\S]*?clearKioskSensitiveSession\(current\.token\)/,
  '换人时必须用**上一位**的令牌撤销（新登录这位发只会 403，旧任务原地存活）',
)
assert.match(
  authContext,
  /const logout = useCallback\([\s\S]*?const token = userRef\.current\?\.token \?\? null[\s\S]*?clearKioskSensitiveSession\(token\)/,
  '退出 / 401 过期时用即将作废的那个令牌撤销，且必须在清空 userRef 之前取到它',
)
assert.match(
  read('src/auth/KioskPrivacyGuard.tsx'),
  /clearKioskSensitiveSession\(getToken\(\)\)/,
  '隐私清场（idle 到点 / 硬清除 / 进屏保）要把当前令牌交给撤销',
)
assert.match(
  read('src/pages/screensaver/ScreensaverPage.tsx'),
  /clearKioskSensitiveSession\(getToken\(\)\)/,
  '待机屏挂载清场同样要交出当前令牌',
)

const scanChrome = read('src/pages/scan/ScanWorkbenchChrome.tsx')
assert.match(
  scanChrome,
  /revokeLiveScanSession\(getToken\(\)\)\s*\n\s*clearScanWorkbenchSession\(\)\s*\n\s*navigate\('\/print-scan'\)/,
  '顶栏返回 = 离开整条扫描流程：先撤服务端任务，再清本地登记，最后才走人',
)

assert.match(
  scanProgress,
  /if \(localGiveUp\) revokeLiveScanSession\(getToken\(\)\)/,
  '本机放弃轮询时要撤掉服务端任务（它还停在 waiting，会收下一次面板扫描）',
)
assert.equal(
  (scanProgress.match(/\}, true\)/g) ?? []).length,
  2,
  '只有两条本机放弃路径传 localGiveUp=true（轮询总时长到点、连续查不动）；'
    + '服务端自己报的 completed / expired / failed / cancelled 一律不得发 DELETE',
)

const scanTasksApi = read('src/services/api/scanTasks.ts')
assert.match(
  scanTasksApi,
  /createScanSession[\s\S]*?terminalProtected: true/,
  '创建扫描会话必须走终端身份闸门：服务端 POST /scan/sessions 挂了 TerminalIdentityGuard，'
    + '只带 x-terminal-id 会被 401 顶回来',
)
assert.match(
  scanTasksApi,
  /terminalProtectedFetch\(makeUrl\(path\), request\)/,
  '终端受保护请求走 terminalProtectedFetch（它负责带会话令牌并在 401 后换票一次）',
)
assert.match(
  scanTasksApi,
  /if \(error instanceof ApiHttpError\) throw error/,
  '闸门抛的 401 不能被压成 NETWORK_ERROR/status 0：那会让页面对用户说反话',
)
assert.match(
  scanSettings,
  /terminalSession === 'checking'/,
  '终端会话还在换票时不抢跑创建请求',
)
assert.match(
  scanSettings,
  /TERMINAL_SESSION_INVALID/,
  '终端身份不可用时页面按终端安全校验失败呈现，不伪造会话',
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
