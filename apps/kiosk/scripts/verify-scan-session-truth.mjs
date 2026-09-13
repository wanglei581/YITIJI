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
  /createGenerationRef\.current = scanLifecycleGeneration\(\)[\s\S]{0,900}?createScanSession\(/,
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
  /if \(abandoned\) \{[\s\S]{0,200}?creationAbandonedRef\.current = true\s*\n\s*if \(cancellationCredentials\) abandonCreatedSession\(cancellationCredentials\)\s*\n\s*return\s*\n\s*\}[\s\S]*patchScanWorkbenchSession\(/,
  '弃用分支必须排在任何 patchScanWorkbenchSession 之前（先 return 才谈得上「绝不回写」），'
    + '并且要把「这一次创建已经丢弃」登记下来',
)

/* ── 丢弃是终局：终端恢复不得把已撤销的任务接回来（2026-09-13） ─────────────
 *
 * 上面那道闸门撤掉任务之后，页面停在「终端安全校验失败」。终端身份随后恢复
 * （failed → ready）会让创建 effect 再跑一次 —— 而 sessionPromiseRef 里那个 promise
 * 已经 resolve 了：重新挂上去，闸门这一轮全部判否（代次没变、页面没卸载、
 * terminalFailClosedRef 刚被 ready 分支清成 false），于是一个**已经 DELETE 掉**的任务
 * 被写成成功、连同控制凭证一起写回本机登记。用户照着屏上的编号去面板扫，
 * 扫出来的文件没有任何任务认领。
 *
 * 所以这一笔必须不可逆，且要在 effect 重新挂 promise 之前就把整条 effect 拦住。 */
assert.match(
  scanSettings,
  /if \(skipCreateRef\.current\) return[\s\S]{0,900}?if \(creationAbandonedRef\.current\) return[\s\S]{0,400}?if \(terminalSession === 'checking'\) return/,
  '丢弃之后创建 effect 必须整条停掉，且这道闸要排在终端状态分支之前：'
    + '排在后面就会先被 ready 分支重新挂上那个已经 resolve 的 promise',
)
assert.match(
  scanSettings,
  /if \(creationAbandonedRef\.current\) return[\s\S]*sessionPromiseRef\.current = createScanSession\(/,
  '这道闸也必须排在创建之前：丢弃之后页面不自动重建会话，重不重扫由用户自己决定',
)
assert.doesNotMatch(
  scanSettings,
  /creationAbandonedRef\.current = false/,
  '这一笔不可逆：任务已经撤掉了，服务端不会因为终端恢复把它变回 waiting；'
    + '像 terminalFailClosedRef 那样在 ready 分支清掉，缺陷就原样回来了',
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

/* 离开结果页那条历史条目必须被 replace 掉，不是压上去 —— 判据在下面 E 段
 * （leaveScanFlow 那条断言）里和撤销/清场一起钉，不在这里重复一遍。 */
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
  /function endScanLifecycle\(\): void \{\s*\n\s*lifecycleGeneration \+= 1\s*\n\s*rescanAuthority = null\s*\n\s*\}/,
  '推进代次必须是同步自增，并在**同一步**里把一次性重扫授权扔掉。'
    + '两件事的理由不同，别混：自增必须同步，是因为任何 await / 存储 IO 都会让它晚于'
    + '还在飞的响应；而扔掉授权这一句管的是**留存** —— 授权里那份 controlToken 是'
    + '上一位用户的明文凭证，这一场结束之后不该继续被模块变量引着。'
    + '注意它不是「防止被下一位取用」的那道闸（那道是 usableRescanAuthority 里的代次比对，'
    + '删掉本句不会让授权重新可用 —— 2026-09-14 实测行为用例全绿）；'
    + '两道是纵深，少一道就少一道。',
)
assert.doesNotMatch(
  workbenchSession,
  /export function endScanLifecycle/,
  '不导出：谁能宣告一场扫描结束由本模块两个入口决定，开放出去就会各自发挥',
)
assert.match(
  workbenchSession,
  /const lifecycleEnding = 'live' in patch && patch\.live === undefined\s*\n\s*if \(lifecycleEnding\) endScanLifecycle\(\)\s*\n\s*const next: ScanWorkbenchSession = \{/,
  '显式抹掉 live = 这一场到此为止，代次要在写回之前推进（安全返回 / 回到首页 / 重扫都走这条）。'
    + '这一位另外还决定 rescanIntent 要不要跟着抹掉，所以它是一个具名常量而不是内联条件',
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

/* ── 游客 → 会员：无人认领的扫描不许被下一个人继承 ─────────────────────────
 *
 * login() 的老规则是「只清别人的」：current && current.id !== next.id 才清场，
 * 理由是「游客中途登录视为同一人继续办理，打印材料仍在」。对打印材料成立，
 * 对扫描不成立 —— 扫描件是上一位的身份证/简历原件，登记里还带着那一场的
 * controlToken 明文：
 *
 *   上一位游客扫完走了（没按出口，所以登记还在，隐私空闲也没到点）→
 *   下一位走上来一碰屏幕就把空闲计时重置了 → 他去登录 → current 是 null，
 *   老规则一个字节都不清 → 他现在是会员，而登记里躺着上一位的扫描件。
 *
 * 扫描流程今天没有「登录后存进我的文档」这类自己把人送去登录的入口
 * （结果页未登录时那颗按钮是禁用的，任何出口都会先 leaveScanFlow 清干净），
 * 所以没有可信的延续标记，按 fail-closed 判。范围只到扫描：其余敏感会话不动。 */
assert.match(
  authContext,
  /\} else if \(!current\) \{[\s\S]{0,600}?clearGuestScanBeforeMemberLogin\(\)/,
  '游客 → 会员那一刻必须先收掉扫描：这条分支正是老规则一个字节都不清的那一条',
)
const clearScope = read('src/auth/kioskClearScope.ts')
assert.match(
  clearScope,
  /export function clearGuestScanBeforeMemberLogin\(\): boolean \{[\s\S]*?revokeLiveScanSession\(null\)\s*\n[\s\S]{0,400}?clearScanWorkbenchSession\(\)/,
  '顺序与 clearKioskSensitiveSession 一致：先撤服务端任务再清本地登记；'
    + '身份传 null —— 游客的任务在服务端 endUserId 就是 null，'
    + '拿新登录这位的令牌去发只会被 403 顶回来，旧任务原地存活',
)
assert.doesNotMatch(
  clearScope,
  /clearPrintMaterialSession|clearAiResumeSession|clearInterviewWorkbenchSession/,
  '这条闸门的范围只到扫描：整体清场是 logout / 屏保 / 隐私空闲那三条既有边界的事，'
    + '在登录路径上顺手扩大范围会把「游客中途登录仍能继续办理」那条产品判断一起改掉',
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

/* ══ 一次性安全重扫授权（2026-09-14） ══════════════════════════════════════
 *
 * ## 修的是什么
 *
 * 服务端对「已经取到文件（matched）但没建档成功」的同一份字节做 2 小时去重
 * （scan-tasks.service.ts 的 SCAN_CONTENT_DEDUP_WINDOW_MS / SCAN_FILE_PREVIOUSLY_ATTEMPTED）。
 * 这道防线本身必须留 —— 它挡的是把上一位用户的扫描件误挂到下一位的等待中任务上。
 * 代价落在合法用户身上：上一场在取件之后失败了，他把**同一张纸**再扫一遍，字节一模一样，
 * 文件回传会被那条去重原样拒掉，任务停在 waiting 直到过期。用户在机器前白等十分钟，
 * 全程没有任何提示，因为那次拒绝发生在 Agent 与服务端之间，屏幕上看不见。
 *
 * 服务端为此铸了一枚一次性授权（15 分钟，绑定用户 / 终端 / 扫描类型 / 内容 hash /
 * 上一场 controlToken，CAS 消费一次）。前台这条链路此前完全没接：结果页的「重试扫描」
 * 只是 patch 一下阶段就回设置页重新建会话 —— 一个普通新会话，照样撞去重。
 *
 * ## 下面钉的四组
 *
 *   A 两半同生同死：body 的 retryOfScanTaskId 与 X-Scan-Retry-Control 头只能成对出现；
 *   B 取用时机：授权必须和代次在同一个同步块里取，且每次创建只取一次；
 *   C 被拒不许静默降级：服务端说不作数时页面照实说，不自动改发普通创建；
 *   D 授权不得被下一位用户继承：代次一推进就扔掉，成功终态也扔掉。
 *
 * 头名与字段名一律从**服务端源码**反查，不跟着本仓某个常量自说自话 ——
 * 只对着自己写的常量断言，两端改一边就只剩一份绿色的假证据。 */
const repoRoot = resolve(kioskRoot, '../..')
const readRepo = (relativePath) => readFileSync(resolve(repoRoot, relativePath), 'utf8')

const scanTaskContract = readRepo('packages/shared/src/types/scanTask.ts')
const apiScanController = readRepo('services/api/src/scan-tasks/scan-tasks.controller.ts')
const apiScanDto = readRepo('services/api/src/scan-tasks/dto/create-scan-task.dto.ts')
const apiScanService = readRepo('services/api/src/scan-tasks/scan-tasks.service.ts')

// ── A. 两半同生同死 ────────────────────────────────────────────────────────
const sharedHeaderName = /SCAN_RETRY_CONTROL_HEADER = '([^']+)'/.exec(scanTaskContract)?.[1]
assert.ok(sharedHeaderName, '共享契约必须导出 SCAN_RETRY_CONTROL_HEADER，两端不各写各的字面量')
assert.match(
  apiScanController,
  new RegExp(`@Headers\\('${sharedHeaderName.toLowerCase()}'\\)`),
  `服务端读的头名必须与共享契约一致（当前契约值 ${sharedHeaderName}）；`
    + '对不上就是前端发了一个服务端永远读不到的头，重扫静默退化成普通创建',
)
assert.match(
  apiScanDto,
  /retryOfScanTaskId\?: string/,
  '服务端 body 字段名必须仍是 retryOfScanTaskId；改名而前端不跟，授权就永远取不到',
)
assert.match(
  scanTaskContract,
  /export interface ScanRescanAuthorization \{[\s\S]*?retryOfScanTaskId: string[\s\S]*?priorControlToken: string[\s\S]*?\}/,
  '两半必须收在同一个类型里：分开传参就一定会有人只传一半',
)
const createRequestBody = /export interface ScanSessionCreateRequest \{([\s\S]*?)\n\}/.exec(scanTaskContract)?.[1]
assert.ok(createRequestBody, '共享契约里必须还有 ScanSessionCreateRequest')
assert.match(
  createRequestBody,
  /retryOfScanTaskId\?: string/,
  '进 body 的那一半就是 retryOfScanTaskId，必须留在请求体类型里',
)
assert.doesNotMatch(
  createRequestBody,
  /[Cc]ontrolToken/,
  '凭证不得进 body 类型：它只走 header（body 会进请求日志与回放，header 通常不会）',
)

const scanTasksApiSource = read('src/services/api/scanTasks.ts')
assert.match(
  scanTasksApiSource,
  /const body: ScanSessionCreateRequest = \{ scanType: input\.scanType, terminalId: input\.terminalId \}/,
  'body 必须按白名单重建：直接展开调用方给的 input，就可能带进一个没有配对凭证的 '
    + 'retryOfScanTaskId，服务端 403，而页面以为自己在做安全重扫',
)
assert.match(
  scanTasksApiSource,
  /if \(paired\) \{\s*\n\s*body\.retryOfScanTaskId = paired\.retryOfScanTaskId\s*\n\s*[\s\S]{0,200}?headers\[SCAN_RETRY_CONTROL_HEADER\] = paired\.priorControlToken\s*\n\s*\}/,
  '两半必须在同一个 if 里从同一个对象派生：分成两处写，普通创建迟早会误带重扫头，'
    + '或者带了 id 却没带凭证',
)
assert.match(
  scanTasksApiSource,
  /if \(retryOfScanTaskId\.length === 0 \|\| priorControlToken\.length === 0\) \{[\s\S]{0,400}?throw new ApiHttpError\(\s*\n?\s*'SCAN_RESCAN_AUTHORITY_INCOMPLETE'/,
  '半对凭据必须当场拒，不许当成「没有授权」发普通创建 —— 那正是这次要修的静默降级',
)
assert.doesNotMatch(
  scanTasksApiSource,
  /body: JSON\.stringify\(input\)/,
  '不得再原样序列化 input：两半的配对保证全靠按白名单重建的那个 body',
)

// ── B. 取用时机：和代次同一个同步块，且每次创建只取一次 ──────────────────────
assert.match(
  scanSettings,
  /createGenerationRef\.current = scanLifecycleGeneration\(\)[\s\S]{0,600}?const rescan = takeScanRescanAuthority\(scanType\)[\s\S]{0,400}?if \(!rescan && rescanIntentRef\.current\) \{[\s\S]{0,400}?return undefined\s*\n\s*\}[\s\S]{0,200}?sessionPromiseRef\.current = createScanSession\(/,
  '三件事的**顺序**一起钉死：\n'
    + '  · 授权必须在「取代次」与「发创建请求」之间取 —— 授权本身按代次校验，'
    + '中间隔一次 await 就可能取到属于上一场的那一份；\n'
    + '  · 取完立刻是延迟取用闸门，再往下才允许出现 createScanSession。',
)

/* ── B2. 延迟取用：意图还在、凭据没了，一个请求都不许发 ───────────────────────
 *
 * rescanCredentialsLost 是**挂载那一刻**算一次的（必须如此，否则正常重扫路径上
 * 授权一被取走就会把自己判成 fail-closed）。但真正取用可能晚几十秒：终端会话换票时
 * 本页停在 checking 等着，等完才创建。这中间本地 15 分钟窗口可能走完、别处可能清过场。
 *
 * 那一刻 takeScanRescanAuthority() 返回 null，而登记里那笔意图还在。旧代码会照常
 * 发一个**不带签名**的普通创建 —— 用户按的是「同一份材料」，同一张纸回传时撞上
 * 服务端两小时的同字节去重，任务停在 waiting 直到过期。
 *
 * 判据必须是「登记里那笔意图」而不是「rescanCredentialsLost 这一帧的值」：
 * 后者在这条路径上恒为 false，拿它当判据等于没有闸门。 */
assert.match(
  scanSettings,
  /const rescanIntentRef = useRef\(stored\?\.rescanIntent === true\)/,
  '延迟取用闸门的判据必须是挂载时登记里那笔 rescanIntent，并且锁在 ref 里：'
    + '每帧重算会把一场正在正常创建的会话判成「凭据没了」',
)
assert.match(
  scanSettings,
  /if \(!rescan && rescanIntentRef\.current\) \{\s*\n\s*setRescanCredentialsLost\(true\)[\s\S]{0,200}?setPhase\('error'\)\s*\n\s*return undefined/,
  '延迟取用闸门必须 fail-closed 到那一屏并直接 return：任何「继续往下走」的写法'
    + '都会让一次安全重扫意图落成无签名的普通创建',
)
assert.match(
  scanSettings,
  /rescanIntentRef\.current = false/,
  '唯一允许解除那道闸门的是用户显式按下「重新开始一次扫描」（handlePlainRestart）',
)
assert.match(
  scanSettings,
  /if \(!sessionPromiseRef\.current\) \{[\s\S]{0,900}?takeScanRescanAuthority\(scanType\)/,
  '取用必须在「只创建一次」那道闸里：闸外取的话，终端会话 checking→ready 每切一次'
    + '就白消耗一枚授权，而真正那次创建反倒拿不到',
)
assert.equal(
  (scanSettings.match(/takeScanRescanAuthority\(/g) ?? []).length,
  1,
  '整页只许取一次：一次性授权取过就没了，第二处调用必然拿到 null 并静默退化成普通创建',
)
assert.match(
  scanSettings,
  /createScanSession\(\s*\n\s*\{ scanType, terminalId: getTerminalId\(\) \},\s*\n\s*getToken\(\),\s*\n\s*rescan,\s*\n\s*\)/,
  '取到的授权必须真的传给创建请求；取了不传 = 白取一枚，重扫照旧退化',
)

// ── C. 被拒不许静默降级 ────────────────────────────────────────────────────
const rejectionCodeTable = /const SCAN_RESCAN_REJECTION_CODES = new Set\(\[([\s\S]*?)\]\)/.exec(scanSettings)?.[1]
assert.ok(rejectionCodeTable, '扫描设置页必须有一张显式的重扫拒绝码表')
for (const code of ['SCAN_RETRY_NOT_AUTHORIZED', 'SCAN_RETRY_CONFLICT', 'SCAN_RETRY_TASK_ID_MISSING']) {
  assert.match(
    apiScanService,
    new RegExp(`code: '${code}'`),
    `服务端仍会抛 ${code}，前端必须继续认它`,
  )
  assert.match(
    rejectionCodeTable,
    new RegExp(`'${code}'`),
    `${code} 必须在拒绝码表**里面**（不是文件里某处出现过就算），否则它会掉进`
      + '「扫描任务未创建」的通用兜底：用户读不出「重扫授权失效」这件事，'
      + '也不知道该不该再把同一张纸放回去',
  )
}
assert.match(
  rejectionCodeTable,
  /'SCAN_RESCAN_AUTHORITY_INCOMPLETE'/,
  '本机成对校验抛的码也要在表里：否则半对凭据会被当成一次普通创建失败',
)
assert.match(
  scanSettings,
  /RESCAN_REFUSED_FAILURE = \{\s*\n\s*title: '安全重扫授权已失效'/,
  '重扫被拒要有自己的结论屏，不能和「服务端没能创建扫描会话」混成一句',
)
assert.match(
  scanSettings,
  /SCAN_RESCAN_REJECTION_CODES\.has\(code \?\? ''\)[\s\S]{0,1600}?setRescanRefusedByServer\(true\)[\s\S]{0,300}?title: RESCAN_REFUSED_FAILURE\.title/,
  '拒绝码那条分支必须既立起「服务端不认」这一位，又挂上它自己那张结论屏',
)
assert.match(
  scanSettings,
  /本页不会自动改用普通重扫/,
  '必须对用户明说不会自动降级：降级本身不危险，但它会把用户支到面板前去扫一张'
    + '注定被去重拒收的纸，白等十分钟且毫无提示',
)
assert.equal(
  (scanSettings.match(/createScanSession\(/g) ?? []).length,
  1,
  '全页只许有一处创建调用：重扫被拒之后另开一处「改发普通创建」就是静默降级',
)

/* ── C2. 不许自动降级，但必须给一个显式出路 ─────────────────────────────────
 *
 * 「不自动降级」和「不给出路」是两件事，早先的实现把它们混成了一件：服务端拒绝之后
 * 屏幕上唯一能按的是「安全返回扫描首页」，主行动是灰掉的「未创建扫描任务」。
 * 而这一屏最常见的来源恰恰是**上一场根本没走到取件** —— 服务端那种情况从不铸授权，
 * 必然 403。于是最常见的失败路径上，主行动注定失败，用户得原路退回重走一遍。
 *
 * 现在两种 fail-closed（本机取不到 / 服务端不认）共用同一个显式出路。
 * 它仍然不是自动降级：按钮由用户按下，文案写明它不是同字节重扫、同一张纸可能被拒收。 */
assert.match(
  scanSettings,
  /\{rescanCredentialsLost \|\| rescanRefusedByServer \? \(\s*\n\s*<button[^>]*onClick=\{handlePlainRestart\}>\s*\n\s*重新开始一次扫描/,
  '两种 fail-closed 都必须给出同一个显式主行动「重新开始一次扫描」：'
    + '只给其中一种，另一种就是一条注定失败的死路',
)
assert.match(
  scanSettings,
  /RESCAN_REFUSED_FAILURE[\s\S]{0,600}?可能按重复件拒收/,
  '那颗按钮的代价必须写在同一屏：它不是同字节重扫，同一张纸可能被服务端拒收',
)
/* 「显式出路必须解除延迟取用闸门、并置空那个已经 reject 的 sessionPromiseRef」
 * 与「两个 fail-closed 标志都要进 effect 依赖」这两条，和 handlePlainRestart 的
 * 其余形状一起钉在下面（搜 `const handlePlainRestart`），不在这里重复一遍。 */

// ── D. 授权不得被下一位用户继承 ────────────────────────────────────────────
assert.match(
  workbenchSession,
  /export function takeScanRescanAuthority\(scanType: ScanType\): ScanRescanAuthorization \| null \{\s*\n\s*const authority = usableRescanAuthority\(scanType\)\s*\n\s*rescanAuthority = null/,
  '取用必须**无条件**清空槽位（先取后清，清在校验结果之前）：只在成功时清，'
    + '一份过期/错类型的授权会一直留在内存里等下一位用户',
)
assert.match(
  workbenchSession,
  /export function beginScanRescan\([\s\S]*?const carried = usableRescanAuthority\(args\.scanType\)\s*\n\s*if \(!carried\) return false\s*\n\s*rescanAuthority = null\s*\n\s*patchScanWorkbenchSession\(\{[\s\S]*?live: undefined,[\s\S]*?rescanIntent: true,\s*\n\s*\}\)\s*\n\s*rescanAuthority = \{ \.\.\.carried, generation: lifecycleGeneration \}/,
  '两件事一起钉：\n'
    + '  · 拿不到授权必须**在动任何东西之前**早退（`if (!carried) return false` 是第一句）。'
    + '早先的版本先 patch 再判断，于是这条路径会把本机唯一那份 scanTaskId + controlToken'
    + '连同结果快照一起销毁掉再返回 false —— 调用方就算看返回值也没有东西可退回，'
    + '用户连那张失败回执都看不到，服务端那个任务也再没人能撤；\n'
    + '  · 有授权时移交顺序只有一种对：先取出 → 再推进代次（patch 的 live: undefined）→ '
    + '最后按**新**代次重新登记，且 armedAtMs 原样带走（`...carried`），重新计时等于可以无限续期。\n'
    + '同一笔 patch 里立起 rescanIntent: true —— 那是写给整页重载之后那一帧的 fail-closed 判据。',
)
assert.match(
  workbenchSession,
  /export function beginPlainScanRestart\([\s\S]*?rescanAuthority = null\s*\n\s*patchScanWorkbenchSession\(\{[\s\S]*?live: undefined,[\s\S]*?rescanIntent: undefined,\s*\n\s*\}\)/,
  '「重新开始一次扫描」必须是一条**独立**的显式入口：清掉槽位里任何残留授权，'
    + '并且抹掉登记里那笔意图（否则设置页会对着一场普通会话 fail-closed）。'
    + '把它和 beginScanRescan 合成一个函数，就等于把「拿不到授权自动降级」写回代码里',
)
assert.match(
  workbenchSession,
  /rescanIntent: 'rescanIntent' in patch\s*\n\s*\? patch\.rescanIntent\s*\n\s*: lifecycleEnding\s*\n\s*\? undefined\s*\n\s*: current\.rescanIntent,/,
  '意图不许比它那一场活得久：生命周期终结（live: undefined）的同一笔 patch 必须把它抹掉。'
    + '少了这一句，「安全返回扫描首页」之后开的那场普通扫描会继承一个过期意图，'
    + '被设置页 fail-closed 锁死 —— 防线错杀正常路径比没有防线更糟',
)
assert.match(
  workbenchSession,
  /rescanIntent: parsed\.rescanIntent === true \? true : undefined/,
  '只认真正的 true：存储里别的值不足以把一场扫描锁进 fail-closed',
)
assert.match(
  workbenchSession,
  /export function scanRescanCredentialsLost\(args: \{[\s\S]*?if \(args\.session\?\.rescanIntent !== true\) return false[\s\S]*?if \(args\.restoredLive\) return false\s*\n\s*return !hasScanRescanAuthority\(args\.scanType\)/,
  'fail-closed 判据三段都不能少：没有意图不管（普通会话照常建）、会话已经建成不管'
    + '（那时 restoredLive 能复水），只有「有意图 + 没 live + 内存里没凭据」才是重载丢凭据',
)
assert.doesNotMatch(
  workbenchSession,
  /(setItem|JSON\.stringify)\([\s\S]{0,120}rescanAuthority/,
  '授权含上一场 controlToken 明文，一个字节都不许写进浏览器存储（公共设备，跨刷新跨用户）',
)
assert.match(
  scanResult,
  /if \(outcome !== 'failed' && outcome !== 'expired'\) \{\s*\n\s*clearScanRescanAuthority\(\)/,
  '只有 failed / expired 才可能有授权（服务端只在 matched 之后落到那几条路径时铸）；'
    + 'completed 与「完成但没带文件」的任务已建档（fileId 非空）按契约不会有授权，'
    + '这时必须把手里那份显式扔掉。这一句是纵深：今天成功终态之前必然先经过一次'
    + '一次性取用（槽位那时已空），它守的是那个前提被改坏的将来',
)
assert.match(
  scanResult,
  /armScanRescanAuthority\(\{ priorScanTaskId, priorControlToken, scanType \}\)/,
  '登记要用刚结束那一场的真实凭证，不能另造一份',
)
/* ── 安全重扫意图不许落成一个无签名的普通 POST（2026-09-14 第二轮） ──────────
 *
 * 结果页那一刻手里可能根本没有可用的成对授权：从来没铸过、已经被取用、超过本地
 * 15 分钟、或者中间清过场。旧实现忽略 `beginScanRescan()` 的返回值照样跳设置页 ——
 * 设置页接着建会话，`takeScanRescanAuthority()` 返回 null，于是发出去的是一个
 * **普通**创建。用户按的是「同一份材料」，随后把同一张纸放回面板，服务端按两小时
 * 同字节去重把文件拒掉，任务停在 waiting 直到过期：人在机器前白等十分钟，
 * 屏幕上全程没有一句话解释。
 *
 * 下面钉三处：点击时先幂等补登记（关掉首屏那一帧的窗口）、返回值必须判、
 * 以及「重新开始一次扫描」是一条**另外的、用户显式按下**的路径。 */
assert.match(
  scanResult,
  /armIfPossible\(\)\s*\n\s*if \(!beginScanRescan\(\{ scanType, extras: retryExtras \}\)\) \{/,
  '「重试扫描」必须：先幂等再登记一次（首屏那一帧 effect 还没跑，按钮已经能点了），'
    + '然后**判返回值**。忽略返回值就是把安全重扫意图变成一次普通建单',
)
assert.match(
  scanResult,
  /if \(!beginScanRescan\([\s\S]{0,200}?setSafeRescanLost\(true\)\s*\n\s*setRescanAuthorized\(false\)\s*\n\s*return\s*\n\s*\}/,
  '拿不到授权时必须在这里**停住**：不跳设置页（跳过去就会发普通创建），'
    + '把状态改成实话，并且什么都不销毁',
)
assert.match(
  scanResult,
  /const handlePlainRestart = \(\) => \{\s*\n\s*beginPlainScanRestart\(\{ scanType, extras: retryExtras \}\)/,
  '普通新会话只能走独立的 beginPlainScanRestart，且由用户按下那个另外的按钮',
)
assert.match(
  scanResult,
  /rescanAuthorized \? \([\s\S]{0,400}?重试扫描（同一份材料）[\s\S]{0,400}?onClick=\{handlePlainRestart\}>\s*\n\s*重新开始一次扫描/,
  '两个按钮不是一个按钮两种文案：拿到凭据是安全重扫，拿不到是普通新会话'
    + '（同一张纸会被按重复件拒收）。代价不同，文案必须分开，且各自接自己的处置',
)
assert.match(
  scanResult,
  /setInterval\(\(\) => \{\s*\n\s*setRescanAuthorized\(hasScanRescanAuthority\(scanType\)\)\s*\n\s*\}, RESCAN_AUTHORITY_RECHECK_MS\)/,
  '本地有效期会走完：不重新采样，按钮会一直挂着「（同一份材料）」那句话，'
    + '用户照着它把同一张纸放回去，而那时本机其实已经没有可用凭据了',
)
assert.match(
  scanResult,
  /data-testid="scan-safe-rescan-lost"/,
  '「刚才那份凭据已经用不了了」必须在屏幕上说出来：按钮按下去什么都没发生，'
    + '而页面一言不发，比静默降级更难排查',
)

/* ── 成功页那三个去向也是「离开整条扫描流程」（2026-09-14 第二轮） ────────────
 *
 * 直接打印 / AI 简历识别 / 前往我的文档此前都是裸 navigate：本机登记原封不动留在
 * sessionStorage 里 —— 里面有上一位的 live.controlToken 明文，以及 result.file
 * （文件名 + 那条签名内容链接）。下一位在这台机器上进 /scan，阶段直接从登记复水到
 * result，他看到的是上一位的扫描件。 */
for (const [handler, destination] of [
  ['handlePrint', '/print/confirm'],
  ['handleDocuments', '/me/documents'],
  ['handleResumeAI', '/resume/parse'],
]) {
  assert.match(
    scanResult,
    new RegExp(`const ${handler} = \\(\\) => \\{[\\s\\S]{0,200}?leaveScanFlow\\('${destination.replaceAll('/', '\\/')}'`),
    `${handler}（落点 ${destination}）必须走 leaveScanFlow：撤服务端任务 → 清本机登记 → `
      + '再带着文件跳过去。裸 navigate 会把上一位的凭证与扫描件留在登记里给下一位复水',
  )
}
assert.match(
  scanResult,
  /leaveScanFlow\('\/print\/confirm', \{\s*\n\s*state: \{/,
  '清登记的同时必须把文件从路由 state 带过去：打印页读的是 location.state.file，'
    + '不读扫描登记 —— 少了 state，清场就把这条去向弄断了',
)
assert.match(
  scanResult,
  /leaveScanFlow\('\/resume\/parse', \{\s*\n\s*state: \{/,
  'AI 解析页读的是 state.fileId，同理',
)
/* ── E. 结果页自己的出口也必须把这枚授权收走 ───────────────────────────────
 *
 * 顶栏返回与底栏三项走的是 ScanWorkbenchChrome 的 leaveScanFlow（上面已单独钉）。
 * 结果页 ctabar 上那几个出口是**另一套按钮**，此前只是裸 navigate —— 同一屏两种命运：
 * 从顶栏走的人本机登记被清干净，从 ctabar 走的人把 live 登记（含刚结束那一场的
 * controlToken 明文）和这枚一次性授权一起留在原地，下一位用户接着用这台机器就继承了。
 * 所以下面钉的不是「有几个出口」，而是「每个出口都必须走同一条 leaveScanFlow」。 */
assert.match(
  scanResult,
  /const leaveScanFlow = \(destination: string, options\?: NavigateOptions\): void => \{\s*\n\s*revokeLiveScanSession\(getToken\(\)\)\s*\n\s*clearScanWorkbenchSession\(\)\s*\n\s*navigate\(destination, \{ \.\.\.options, replace: true \}\)\s*\n\s*\}/,
  '结果页的出口与顶栏返回同一条语义：先撤服务端任务，再清本机登记'
    + '（代次推进的同一步把授权扔掉），最后 replace 掉这条历史再走人。'
    + 'options 是给成功页那三个去向的 —— 它们要带着文件走，但一样必须先清。\n'
    + 'replace 那一位不是风格问题：清 sessionStorage 只决定「下一位进 /scan 复水到哪一屏」，'
    + 'push 之后 `/scan?stage=result` 仍是历史里的一条，并且带着当时那笔 location.state'
    + '（ScanProgressPage 的非工作台路径会把 file 写进去），而结果页取数是'
    + '`stored?.result?.file ?? locationState.file` —— 存储清了，路由 state 还能把上一位'
    + '那份文件名与签名内容链接补回来。改回 push，后退/前进就又能走到那一屏。',
)
const scanResultNavigates = scanResult.match(/\bnavigate\(/g) ?? []
assert.equal(
  scanResultNavigates.length,
  2,
  '结果页只许有两处 navigate：leaveScanFlow 里那一处（replace），以及 goToSettings 的'
    + '非工作台兜底。多出来的一处就是一个绕开了撤销/清场/replace 的出口',
)
for (const destination of ['/print-scan', '/help', '/']) {
  assert.match(
    scanResult,
    new RegExp(`leaveScanFlow\\('${destination.replaceAll('/', '\\/')}'\\)`),
    `结果页落点 ${destination} 的出口必须走 leaveScanFlow`,
  )
  assert.doesNotMatch(
    scanResult,
    new RegExp(`onClick=\\{\\(\\) => navigate\\('${destination.replaceAll('/', '\\/')}'\\)\\}`),
    `落点 ${destination} 一旦改回裸 navigate，这一屏又会把上一位的凭证和授权留给下一位`,
  )
}

/* ── F. 谁有资格说「服务端已放行」 ─────────────────────────────────────────
 *
 * 结果页只知道「我手里有一份上一场的凭据」，**不知道服务端到底铸没铸那枚授权** ——
 * 服务端只在任务已经取到文件（matched + lastAttemptHash）之后落到 failed /
 * cancelled / expired 时才铸；而本机在一个还停在 waiting 的任务上放弃轮询也会走到
 * 这一屏，那种情况根本没有授权，凭据照样在手里。
 *
 * 设置页相反：那一行只在创建成功之后才渲染，而带着重扫两半的创建能成功，
 * 等于服务端已经把授权消费掉了 —— 所以「已放行」只有它说得出口。 */
assert.doesNotMatch(
  scanResult,
  /服务端给的安全重扫放行|服务端已放行/,
  '结果页不得替服务端下结论：这一刻它只有凭据，没有放行结果',
)
assert.match(
  scanResult,
  /去申请安全重扫放行[\s\S]{0,120}?不会悄悄按普通重扫处理/,
  '结果页只能说「带着凭据去申请」，并当场承诺不会悄悄降级 —— 用户据此决定'
    + '要不要把同一张纸放回去',
)
assert.match(
  scanSettings,
  /rescanRequested\s*\n?\s*\? \['本次性质', '安全重扫：服务端已放行同一份材料再扫一次'\]/,
  '「已放行」只许出现在创建成功之后的设置页：那一刻服务端确实已经消费掉那枚授权',
)
assert.match(
  scanSettings,
  /const restoredFromStorageRef = useRef\(Boolean\(restoredLive && scanType\)\)/,
  '设置页必须能分辨「这一场是复水出来的」：那一刻它说不出当初带没带重扫授权。'
    + '而且必须锁在初次渲染（ref）—— 创建成功之后本页自己会把 live 写回登记，'
    + '每帧重算会把一个刚在本页建成的会话说成「本页重载过」',
)
assert.match(
  scanSettings,
  /restoredFromStorageRef\.current\s*\n?\s*\? \['本次性质', '本页重载过；这一场当初是不是安全重扫，本机无从判断'\]/,
  '复水出来的会话只能如实说无从判断：猜「安全重扫」会让用户把同一张纸放回去'
    + '（可能被去重拒收），猜「普通会话」会让他白换一份材料',
)
assert.match(
  scanSettings,
  /plainRestartChosen\s*\n?\s*\? \['本次性质', '普通会话：你已确认这一次不是安全同字节重扫'\]/,
  '用户在 fail-closed 那一屏选的普通会话要记在屏幕上：否则下一屏看起来像是本页悄悄降级的',
)

/* ── 整页重载把内存里那份凭据抹掉之后：fail-closed（2026-09-14 第二轮） ────────
 *
 * 安全重扫的凭据只活在模块内存里（刻意的，公共设备不给它落存储）。看门狗整页重载
 * 一发生，它就没了，而用户还站在机器前、手里还是同一张纸。设置页此刻若照常创建，
 * 发出去的就是一个普通会话 —— 同一张纸回传时被服务端两小时同字节去重拒掉，
 * 任务停在 waiting 直到过期，人白等十分钟。
 *
 * 所以登记里留一位**布尔**意图（不是凭证），设置页据此 fail-closed，
 * 并且只给一个显式出路。 */
assert.match(
  scanSettings,
  /const \[rescanCredentialsLost, setRescanCredentialsLost\] = useState\(\(\) =>\s*\n\s*scanRescanCredentialsLost\(\{ session: stored, scanType, restoredLive \}\),\s*\n\s*\)/,
  '两件事一起钉：\n'
    + '  · 判据要用**校验过有效期**的 restoredLive —— 拿 session.live 原样判，一场已经过期的'
    + '会话会被当成「已经建成」放行，于是又发出去一个普通创建；\n'
    + '  · 必须是挂载那一刻算一次的 state，不能每帧重算。每帧重算会坏在正常路径上：'
    + '创建 effect 一开跑就把一次性授权取走，槽位随即变空，下一帧重算就把一场正在正常'
    + '创建的会话判成「凭据没了」，effect 重跑并早退，再没有人给那个还在飞的响应挂处置 ——'
    + '页面永远停在「正在创建扫描任务」，服务端那个任务也没人认领',
)
assert.match(
  scanSettings,
  /if \(rescanCredentialsLost\) return\s*\n\s*\/\/ 终端安全会话还在换票/,
  'fail-closed 必须排在终端会话那两个分支**之前**（页面要说的是「凭据没了」，'
    + '不是「正在做终端安全校验」），而且它 return 掉的正是那一个会悄悄发出去的普通创建',
)
assert.match(
  scanSettings,
  /\}, \[terminalSession, rescanCredentialsLost, rescanRefusedByServer\]\)/,
  '两个 fail-closed 标志都必须进依赖：用户显式选了「重新开始一次扫描」之后它们变 false，'
    + '这条 effect 要跟着跑一次，否则那个按钮按下去什么都不会发生。\n'
    + 'rescanRefusedByServer 这一位尤其容易被判成冗余 —— 服务端拒绝那条路径上'
    + 'rescanCredentialsLost 从头到尾都是 false，复位它不构成依赖变化。',
)
assert.match(
  scanSettings,
  /const handlePlainRestart = \(\) => \{\s*\n\s*if \(!scanType\) return\s*\n\s*beginPlainScanRestart\(\{ scanType, extras: stored\?\.extras \}\)\s*\n\s*rescanIntentRef\.current = false\s*\n\s*sessionPromiseRef\.current = null\s*\n\s*setRescanCredentialsLost\(false\)\s*\n\s*setRescanRefusedByServer\(false\)/,
  '出路只有这一条显式动作：走 beginPlainScanRestart（它抹掉那笔意图），'
    + '并且当场把 fail-closed 那一位放下来 —— 否则按钮按下去什么都不会发生',
)
assert.match(
  scanSettings,
  /rescanCredentialsLost \|\| rescanRefusedByServer \? \([\s\S]{0,400}?onClick=\{handlePlainRestart\}>\s*\n\s*重新开始一次扫描/,
  '两种 fail-closed（本机取不到凭据 / 服务端不认）都要有同一个能按的主行动；'
    + '其余失败态仍然什么都不许按（本页不自动重发）。\n'
    + '只给其中一种就会留下一条死路：服务端拒绝那一屏最常见的来源是「上一场根本没走到取件」，'
    + '服务端那种情况从不铸授权、必然 403 —— 最常见的失败路径上主行动注定失败。',
)
assert.match(
  scanSettings,
  /RESCAN_CREDENTIALS_LOST_FAILURE = \{\s*\n\s*title: '安全重扫凭据已经不在本机'/,
  'fail-closed 要有自己的结论屏，不能混进「扫描任务未创建」的通用兜底',
)
assert.doesNotMatch(
  scanSettings,
  /title: '安全重扫凭据已随本页重载消失'/,
  '这一屏的成因不止「整页重载」一种：延迟取用（等终端换票期间本地窗口走完 / 别处清过场）'
    + '走的是同一屏。把成因写死成其中一种，另一种发生时就是一句假的诊断',
)
assert.match(
  scanSettings,
  /本页不会替你改发一次普通重扫/,
  '必须对用户明说不会自动降级 —— 降级本身不危险，但它会把用户支到面板前去扫一张'
    + '注定被去重拒收的纸',
)
assert.doesNotMatch(
  scanResult,
  /patchScanWorkbenchSession\(/,
  '结果页不得再自己 patch：移交那三步必须原子，散在页面里迟早被改成先 patch 再取',
)
// 服务端的资格集合与 TTL 变了，本机这两条判据（只在 failed/expired 登记、15 分钟）就得跟。
assert.match(
  apiScanService,
  /SCAN_RETRY_ELIGIBLE_STATUSES = \['failed', 'cancelled', 'expired'\]/,
  '服务端的可重扫状态集合变了：结果页的登记条件与本地有效期都要重新核一遍',
)
assert.match(
  apiScanService,
  /SCAN_RETRY_AUTHORITY_TTL_MS = 15 \* 60 \* 1000/,
  '服务端授权有效期变了：scanWorkbenchSession 的 SCAN_RESCAN_AUTHORITY_TTL_MS 必须同步',
)
assert.match(
  workbenchSession,
  /SCAN_RESCAN_AUTHORITY_TTL_MS = 15 \* 60 \* 1000/,
  '本地有效期与服务端取同一个值：短了会在服务端还认的时候静默降级，长了只是多发一次 403',
)

const rescanAuthorityTest = spawnSync(
  process.execPath,
  ['--test', resolve(kioskRoot, 'scripts/tests/scan-rescan-authority.test.mjs')],
  { encoding: 'utf8' },
)
assert.equal(
  rescanAuthorityTest.status,
  0,
  `scan rescan authority behaviour test failed: ${rescanAuthorityTest.stderr || rescanAuthorityTest.stdout}`,
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
