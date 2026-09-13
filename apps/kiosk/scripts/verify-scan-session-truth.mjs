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

/* ── 创建在飞时被清场：生命周期闸门（2026-09-13） ──────────────────────────
 *
 * POST /scan/sessions 在飞的那一刻，本机登记里还没有 live —— 清场
 * （隐私空闲 / 退出 / 屏保 / 离开扫描流程）走到 revokeLiveScanSession 时读不到
 * 任何可撤的东西，只能把本地那份抹掉。旧代码等响应回来照旧把 live 写回去，
 * 于是刚被清掉那一位的收件箱又被立了起来：服务端任务停在 waiting，
 * 下一位在面板上按下扫描，文件投给了上一位。
 *
 * 下面钉住这条闸门的三块可被一行改坏的地方。 */
assert.match(
  scanSettings,
  /createGenerationRef\.current = scanLifecycleGeneration\(\)[\s\S]{0,200}?createScanSession\(/,
  '代次必须在**发出创建请求之前**取；请求发出后再取就永远等于当前值，闸门恒真',
)
assert.match(
  scanSettings,
  /const lifecycleEnded = createGeneration === null\s*\n\s*\|\| scanLifecycleGeneration\(\) !== createGeneration/,
  '响应回来时要把代次和发请求时那一份比对：不相等就说明这一场已经被清掉了',
)
assert.match(
  scanSettings,
  /const abandoned = !confirmedRef\.current\s*\n\s*&& \(lifecycleEnded \|\| unmountedRef\.current \|\| terminalFailClosedRef\.current\)/,
  '弃用判据是三选一（代次变了 / 本页已卸载 / 终端已 fail-closed），且用户已确认时一律不弃',
)
assert.match(
  scanSettings,
  /if \(abandoned\) \{\s*\n\s*if \(cancellationCredentials\) abandonCreatedSession\(cancellationCredentials\)\s*\n\s*return\s*\n\s*\}[\s\S]*patchScanWorkbenchSession\(/,
  '弃用分支必须排在任何 patchScanWorkbenchSession 之前：先 return 才谈得上「绝不回写」',
)
assert.match(
  scanSettings,
  /revokeCreatedScanSession\(credentials, createTokenRef\.current\)/,
  '撤销要用**创建时**那个身份：清场之后 getToken() 已经空了，拿它发只会 403（看起来撤了，其实没撤）',
)
assert.doesNotMatch(
  scanSettings,
  /explicitCancelRequestedRef/,
  '旧判据「只有用户显式点返回才撤」必须消失：清场与卸载这两条最常见路径当时全都留下孤儿任务',
)
assert.match(
  scanSettings,
  /const unmountedRef = useRef\(false\)[\s\S]*useEffect\(\(\) => \{\s*\n\s*unmountedRef\.current = false\s*\n\s*return \(\) => \{\s*\n\s*unmountedRef\.current = true\s*\n\s*\}\s*\n\s*\}, \[\]\)/,
  '卸载判据必须来自空依赖 effect：复用创建 effect 的 cancelled 会把一次终端重校验误判成「用户走了」',
)
assert.match(
  scanSettings,
  /terminalFailClosedRef\.current = true/,
  '终端 fail-closed 且页面已对用户宣告失败时要登记：那次创建若其实成功了，回来必须自己撤掉',
)
assert.match(
  scanSettings,
  /terminalFailClosedRef\.current = false\s*\n\s*let cancelled = false/,
  '终端回到 ready 时失败结论作废：不清掉这一笔，恢复后到达的成功响应会被当成孤儿撤掉',
)
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
const workbenchSession = read('src/pages/scan/scanWorkbenchSession.ts')
assert.match(
  workbenchSession,
  /sessionStorage/,
  'scan live credentials persist only in the dedicated session module',
)
/* 代次是「创建在飞时被清场」这条竞态的唯一判据，它必须比异步响应先落地：
 * 同步自增、且排在任何存储改动之前。反过来写会留出一个窗口——
 * 登记已空、代次还是旧的，那一刻回来的响应照样能把 live 写回去。 */
assert.match(
  workbenchSession,
  /export function scanLifecycleGeneration\(\): number \{\s*\n\s*return lifecycleGeneration\s*\n\s*\}/,
  '代次要能被创建方读到（发请求前取一份，响应回来比一次）',
)
assert.match(
  workbenchSession,
  /function endScanLifecycle\(\): void \{\s*\n\s*lifecycleGeneration \+= 1\s*\n\s*\}/,
  '推进代次必须是同步自增：任何 await / 存储 IO 都会让它晚于还在飞的响应',
)
assert.doesNotMatch(
  workbenchSession,
  /export function endScanLifecycle/,
  '不导出：谁能宣告一场扫描结束由本模块两个入口决定，开放出去就会各自发挥',
)
assert.match(
  workbenchSession,
  /if \('live' in patch && patch\.live === undefined\) endScanLifecycle\(\)\s*\n\s*const next: ScanWorkbenchSession = \{/,
  '显式抹掉 live = 这一场到此为止，代次要在写回之前推进（安全返回 / 回到首页 / 重扫都走这条）',
)
assert.match(
  workbenchSession,
  /export function clearScanWorkbenchSession\(\): void \{[\s\S]*?endScanLifecycle\(\)\s*\n\s*try \{\s*\n\s*window\.sessionStorage\.removeItem/,
  '清空登记时代次必须在 removeItem **之前**推进；顺序反了就留出可被写回的窗口',
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
  /if \(attempted\.has\(scanTaskId\)\) return false\s*\n\s*attempted\.add\(scanTaskId\)/,
  '去重必须在发请求之前登记，失败也不再补发（撤销是尽力而为）',
)
/* 两个入口共用同一条发送路径与同一个 attempted：读本机登记的那条够不着
 * 「创建还在飞」的任务，所以另开一条由持有响应的一方交凭证；但同一个 scanTaskId
 * 合起来仍然只许发一次 DELETE。各写各的 fetch 就会对同一个任务发两次。 */
assert.match(
  scanRevoke,
  /export function revokeCreatedScanSession\(\s*\n\s*credentials: \{ scanTaskId: string; controlToken: string \},/,
  '创建在飞时被清场：撤销只能由持有响应的一方交出凭证（本机登记里当时还没有 live）',
)
assert.match(
  scanRevoke,
  /return sendRevoke\(live\.scanTaskId, live\.controlToken, outgoingMemberToken\)/,
  '读本机登记的入口也走同一条发送路径，否则两条各自去重 = 同一个任务发两次',
)
assert.match(
  scanRevoke,
  /return sendRevoke\(credentials\.scanTaskId, credentials\.controlToken, creatingMemberToken\)/,
  '交凭证的入口同上；身份参数是**创建时**那一个，不是当前的',
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

/* ── 离开整条扫描流程只许有一份语义（2026-09-13） ──────────────────────────
 *
 * 一张工作台四个阶段、四个出口：顶栏返回 + 底栏三项主导航。它们都是「离开这条流程」，
 * 不是页内切换。当天顶栏返回收得干干净净，底栏三项却还是裸 navigate ——
 * 按「首页 / AI 顾问 / 我的」走的用户，服务端任务和本机登记两样都留在原地，
 * 同一屏上两个出口两种命运。所以下面钉的不是「有几个出口」，而是
 * 「每个出口都必须走同一条 leaveScanFlow，只有落点不同」。 */
const scanChrome = read('src/pages/scan/ScanWorkbenchChrome.tsx')
assert.match(
  scanChrome,
  /const leaveScanFlow = \(destination: string\): void => \{\s*\n\s*revokeLiveScanSession\(getToken\(\)\)\s*\n\s*clearScanWorkbenchSession\(\)\s*\n\s*navigate\(destination\)\s*\n\s*\}/,
  '离开 = 先撤服务端任务，再清本地登记，最后才走人；落点是参数，语义不随落点变',
)
for (const [prop, destination] of [
  ['onBack', '/print-scan'],
  ['onHome', '/'],
  ['onAdvisor', '/assistant'],
  ['onProfile', '/profile'],
]) {
  assert.match(
    scanChrome,
    new RegExp(`${prop}=?:? ?\\{?\\(\\) => leaveScanFlow\\('${destination.replace('/', '\\/')}'\\)`),
    `${prop}（落点 ${destination}）必须走 leaveScanFlow，不能自己 navigate`,
  )
}
assert.doesNotMatch(
  scanChrome,
  /on(Home|Advisor|Profile)=\{\(\) => navigate\(/,
  '底栏三项一旦改回裸 navigate，这一屏就又会留下孤儿服务端任务',
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
