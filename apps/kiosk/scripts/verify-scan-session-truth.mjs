import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(resolve(kioskRoot, relativePath), 'utf8')

const scanStart = read('src/pages/scan/ScanStartPage.tsx')
const scanSettings = read('src/pages/scan/ScanSettingsPage.tsx')
/* 2026-09-14 结构收敛：拒绝码表与两屏结论文案、以及「失败码 → 说什么」的纯翻译
 * 搬到了 scanRescanRecovery.ts（ScanSettingsPage 触到 800 行硬线）。搬的是无状态的
 * 那一半，副作用仍在页面里。下面凡是钉这些常量/文案的断言改钉这份源，**判据一个没减**。 */
const rescanRecovery = read('src/pages/scan/scanRescanRecovery.ts')
/* 2026-09-14 第三轮：丢失响应的有界重放，以及设置页里那几条无状态判定/文案。
 * 两者都是因为 ScanSettingsPage 顶着 800 行硬线（CLAUDE.md §8）才分出去的，
 * 搬的仍然只是无状态那一半 —— 下面凡是钉它们的断言改钉这两份源，**判据一个没减**。 */
const scanCreateReplay = read('src/pages/scan/scanCreateReplay.ts')
const scanSettingsModel = read('src/pages/scan/scanSettingsModel.ts')
/* 2026-09-14 第四轮（投递确认 ACK）：设置页「还不能去面板操作」的那几屏整块搬到了
 * ScanSettingsStatusView.tsx —— 同一条理由（800 行硬线），同一条边界：搬走的**只有
 * 渲染**，它一个 ref / effect / 请求都不碰，判据一条没减，只是改钉这份源。
 * 投递确认本身的码表与文案在 scanDeliveryAck.ts。 */
const scanSettingsView = read('src/pages/scan/ScanSettingsStatusView.tsx')
const scanDeliveryAck = read('src/pages/scan/scanDeliveryAck.ts')
/* 2026-09-15 第五轮（清场收尾闸）：设置页「这一场到此为止」的四种收场
 * （cancelSessionOnce / abandonCreatedSession / discardCreatedSession /
 * failClosedOnAckRefusal）整组搬到了 scanSettingsTeardown.ts —— 同一条理由
 * （800 行硬线），同一条边界：它们的**判据、顺序、注释一个字都没改**，只是按
 * refs + setters 装配出来。下面凡是钉这四条定义的断言改钉这份源；
 * 调用点仍在设置页里，那些断言原地不动。 */
const scanSettingsTeardown = read('src/pages/scan/scanSettingsTeardown.ts')
/* 清场收尾闸本身：等服务端确认之前不许换人。这一轮 P1 的本体。 */
const scanCleanupGate = read('src/pages/scan/scanCleanupGate.ts')
const privacyGuard = read('src/auth/KioskPrivacyGuard.tsx')
/* 清场遮罩自己的组件：它现在除了「正在清除本机会话」，还要如实说出收尾闸在等什么。 */
const clearingOverlay = read('src/auth/KioskClearingOverlay.tsx')

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
 * 所以这一笔必须不可逆，且要在 effect 重新挂 promise 之前就把整条 effect 拦住。
 *
 * 2026-09-15 新增第五道 `if (cleanupHolding)`：上一位的扫描还没收完尾时一个创建
 * 请求都不发（服务端的租约取的是这台终端最早那条「已确认 + waiting」的行，
 * 现在建会话，下一位扫出来的纸会落到上一位名下）。它同样要排在终端状态分支
 * **之前** —— 排在后面，换票窗口里那一次就会抢在收尾完成之前把请求发出去。 */
assert.match(
  scanSettings,
  /if \(skipCreateRef\.current\) return[\s\S]{0,900}?if \(creationAbandonedRef\.current\) return[\s\S]{0,600}?if \(ackRefused\) return[\s\S]{0,900}?if \(rescanCredentialsLost\) return[\s\S]{0,400}?if \(cleanupHolding\) \{[\s\S]{0,600}?if \(terminalSession === 'checking'\) return/,
  '丢弃之后创建 effect 必须整条停掉，且这道闸要排在终端状态分支之前：'
    + '排在后面就会先被 ready 分支重新挂上那个已经 resolve 的 promise。\n'
    + '2026-09-14 起同一串里还多一道：投递授权被服务端明确拒绝（ackRefused）之后，'
    + '这一场已经撤掉、本机登记也清了，effect 同样必须整条停掉 —— 不停的话它会立刻'
    + '重建一场，而页面刚刚才对用户宣告过「这次会话没能取得投递授权」。',
)
assert.match(
  scanSettings,
  /if \(creationAbandonedRef\.current\) return[\s\S]*const sendCreate = \(\) => createScanSession\(/,
  '这道闸也必须排在创建之前：丢弃之后页面不自动重建会话，重不重扫由用户自己决定',
)
assert.doesNotMatch(
  scanSettings,
  /creationAbandonedRef\.current = false/,
  '这一笔不可逆：任务已经撤掉了，服务端不会因为终端恢复把它变回 waiting；'
    + '像 terminalFailClosedRef 那样在 ready 分支清掉，缺陷就原样回来了',
)
assert.match(
  scanSettingsTeardown,
  /revokeCreatedScanSession\(credentials, refs\.createTokenRef\.current, intent\)/,
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
/* 「输出格式」那一行随「这次会话」整张卡搬进了 ScanSettingsStatusView（同一条 800 行
 * 硬线，搬的仍然只有渲染）。两份一起核，判据一条没减。 */
assert.match(
  scanSettingsView,
  /SCAN_OUTPUT_FORMAT_PENDING/,
  'settings must not promise a format before the file exists',
)
for (const [label, source] of [['page', scanSettings], ['status view', scanSettingsView]]) {
  assert.doesNotMatch(
    source,
    /PDF（服务端生成）|PDF（自动生成）/,
    `settings ${label} must not claim server-generated PDF`,
  )
}
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
  /function endScanLifecycle\(\): void \{\s*\n\s*lifecycleGeneration \+= 1\s*\n\s*rescanAuthority = null\s*\n(?:\s*\/\/[^\n]*\n)*\s*takenRescanAuthority = null\s*\n\s*\}/,
  '推进代次必须是同步自增，并在**同一步**里把一次性重扫授权扔掉。'
    + '两件事的理由不同，别混：自增必须同步，是因为任何 await / 存储 IO 都会让它晚于'
    + '还在飞的响应；而扔掉授权这一句管的是**留存** —— 授权里那份 controlToken 是'
    + '上一位用户的明文凭证，这一场结束之后不该继续被模块变量引着。'
    + '注意它不是「防止被下一位取用」的那道闸（那道是 usableRescanAuthority 里的代次比对，'
    + '删掉本句不会让授权重新可用 —— 2026-09-14 实测行为用例全绿）；'
    + '两道是纵深，少一道就少一道。\n'
    + '同一步还要扔掉**寄存格**（takenRescanAuthority）：那一份是取走后待裁决的，'
    + '删掉它就等于留了一条真实的复活路径 —— 离开 / 清场之后回来的失败响应'
    + '仍能把上一场的凭证恢复进槽位，这一条和上面那句不同，它是真闸不是纵深。',
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
/* ── 去重的判据必须是「发了几次」，不是「发过没有」（2026-09-14 P1） ──────────
 *
 * 旧写法是一个模块级 `attempted: Set<string>`：一个任务发过一次 DELETE 之后就再也
 * 发不出第二次。它在下面这条路径上会留下一个跨用户串件的口子：
 *
 *   用户离开 → leaveScanFlow 按本机登记发第一次 DELETE → **那一次在路上丢了**
 *   （keepalive 请求随文档拆卸被掐断 / 网络抖动，本机永远不会知道）→ 离开那一刻
 *   还在飞的那次 ACK **成功了** → 服务端那条任务 deliveryAckedAt 非空
 *   （60 秒未确认回收器再也收不到它）、状态仍是 waiting（Agent 的 current-lease
 *   看得见它）→ 补偿那一次 DELETE 被 `attempted` 挡掉 → 它一直可投递到自然过期。
 *
 * 而且「ACK 成功」正是第一次 DELETE 没生效的**证据**：服务端 ack() 只对未过期的
 * waiting/matched 放行，真撤掉了那一次确认只会拿回 409 SCAN_TASK_ACK_NOT_ALLOWED。
 * 所以补偿不是「重试一个也许成功了的请求」，是对一个已知没生效的请求做一次补偿。
 *
 * 下面钉的是这件事的形状：按 id 计数 + 按意图取上限，且清场那一路仍然只许一次。 */
assert.match(
  scanRevoke,
  /const attemptsByTask = new Map<string, number>\(\)/,
  '去重要记「这个任务已经发了几次 DELETE」，不能退回布尔的「发过没有」：'
    + '那样会把「离开之后 ACK 才成功」那一支唯一的补偿挡掉',
)
assert.match(
  scanRevoke,
  /const REVOKE_ATTEMPT_CAP: Record<ScanRevokeIntent, number> = \{\s*\n\s*'best-effort': 1,\s*\n\s*'ack-compensation': 2,\s*\n\s*\}/,
  '上限必须是一张按意图取值的表：清场链路（hardClear → logout → '
    + 'clearKioskSensitiveSession）合起来 1 次，ACK 补偿最多再补 1 次。'
    + '两个数字都不许动 —— 调大就是无界重试，调小就是把那条串件路径放回去',
)
assert.match(
  scanRevoke,
  /const alreadySent = attemptsByTask\.get\(scanTaskId\) \?\? 0\s*\n\s*if \(alreadySent >= REVOKE_ATTEMPT_CAP\[intent\]\) return false\s*\n[\s\S]{0,200}?attemptsByTask\.set\(scanTaskId, alreadySent \+ 1\)/,
  '判据是「已经发了几次」对上「这一次的意图允许几次」，而且计数必须在发请求之前登记：'
    + '失败也不补发（撤销是尽力而为，不重试、不阻塞清场）',
)
assert.match(
  scanRevoke,
  /export type ScanRevokeIntent = 'best-effort' \| 'ack-compensation'/,
  '意图只有两种，且必须是导出的联合类型：调用方写错字符串要在 tsc 就红，'
    + '而不是在生产里悄悄退化成一个谁也匹配不上的上限',
)
/* 两个入口共用同一条发送路径与同一份计数：读本机登记的那条够不着
 * 「创建还在飞」的任务，所以另开一条由持有响应的一方交凭证；但同一个 scanTaskId
 * 合起来仍然受同一个上限约束。各写各的 fetch 就会绕开整张上限表。 */
assert.match(
  scanRevoke,
  /export function revokeCreatedScanSession\(\s*\n\s*credentials: \{ scanTaskId: string; controlToken: string \},/,
  '创建在飞时被清场：撤销只能由持有响应的一方交出凭证（本机登记里当时还没有 live）',
)
assert.match(
  scanRevoke,
  /return sendRevoke\(live\.scanTaskId, live\.controlToken, outgoingMemberToken, 'best-effort'\)/,
  '读本机登记的入口也走同一条发送路径，否则两条各自去重 = 绕开上限表。'
    + '它永远是 best-effort：清场那一路（含 leaveScanFlow）合起来只许一次',
)
assert.match(
  scanRevoke,
  /intent: ScanRevokeIntent = 'best-effort',\s*\n\)[\s\S]{0,80}?return sendRevoke\(credentials\.scanTaskId, credentials\.controlToken, creatingMemberToken, intent\)/,
  '交凭证的入口同上；身份参数是**创建时**那一个，不是当前的。'
    + '意图默认 best-effort —— 补偿必须由调用方显式要，漏传只会少发一次，不会多发',
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
/* 2026-09-15：这个文件从此有**两条**撤销通道，判据相反，必须分开判。
 *
 * 上半条仍是 fire-and-forget（页内离开 / 结果页出口用它）：页面还活着，ACK 补偿也
 * 还跑得动，所以「不重试、不 await、不阻塞」这条原判据一个字都不能松。
 * 下半条是清场专用的「等服务端把话说完」：它的职责正是等回执，所以对它判 await
 * 反而是必须的（见下面那一组）。
 *
 * 切点取源码里那句分界注释。取不到就直接失败 —— 分界没了意味着两条通道又混在
 * 一起，那时上半条的原判据会被下半条的 await 悄悄绕过，闸看起来还在，实际空转。 */
const REVOKE_CONFIRMED_CHANNEL_MARK = '以下是「等服务端把话说完」的那一条撤销通道'
const revokeChannelSplit = scanRevoke.indexOf(REVOKE_CONFIRMED_CHANNEL_MARK)
assert.ok(
  revokeChannelSplit > 0,
  'scanSessionRevoke 必须保留两条通道之间那句分界注释：没有它就没法只对 fire-and-forget '
    + '那一半判「不重试、不 await」，而那正是页内离开路径赖以不被清场逻辑拖慢的判据',
)
assert.doesNotMatch(
  stripComments(scanRevoke.slice(0, revokeChannelSplit)),
  /setTimeout|setInterval|for \(|while \(|await /,
  '尽力而为那条通道只尝试一次：不重试、不轮询、不 await（清场比撤销要紧）',
)

const sensitiveSession = read('src/auth/kioskSensitiveSession.ts')
/* 2026-09-15：清场这条路上「撤一次就走」换成了「交给收尾闸，等服务端确认」。
 * 顺序判据一个字没变 —— 要撤谁、凭什么撤仍然只写在本机登记里，先抹就再也找不到。
 * 变的只是接手的那一方：revokeLiveScanSession（发完就算）→ beginScanSessionCleanup
 * （重试到服务端回话确认为止，期间不许换人）。 */
assert.match(
  sensitiveSession,
  /beginScanSessionCleanup\(outgoingMemberToken \?\? null\)\s*\n\s*clearScanWorkbenchSession\(\)/,
  '顺序：先把要撤的那一场交给收尾闸，再清本地登记。反过来就找不到要撤谁了',
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
  /export function clearGuestScanBeforeMemberLogin\(\): boolean \{[\s\S]*?beginScanSessionCleanup\(null\)\s*\n[\s\S]{0,400}?clearScanWorkbenchSession\(\)/,
  '顺序与 clearKioskSensitiveSession 一致：先把要撤的那一场交给收尾闸再清本地登记；'
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
  3,
  '只有本机放弃的路径才传 localGiveUp=true：轮询总时长到点、连续查不动，'
    + '以及 2026-09-14 起的第三条 —— 投递授权被服务端明确拒绝。\n'
    + '第三条也算「本机放弃」而不是「服务端终态」：ACK 被拒时那条任务在服务端多半还'
    + '停在 waiting（拒的是**确认**，不是任务本身的状态），不 DELETE 它就会留在原地'
    + '收下一次面板扫描。\n'
    + '服务端自己报的 completed / expired / failed / cancelled 一律不得发 DELETE。',
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
  /createGenerationRef\.current = scanLifecycleGeneration\(\)[\s\S]{0,600}?const rescan = takeScanRescanAuthority\(scanType\)[\s\S]{0,400}?if \(!rescan && rescanIntentRef\.current\) \{[\s\S]{0,400}?return undefined\s*\n\s*\}[\s\S]{0,400}?const sendCreate = \(\) => createScanSession\(/,
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
  /createScanSession\(\s*\n\s*\{ scanType, terminalId: getTerminalId\(\) \},\s*\n\s*identityToken,\s*\n\s*rescan,\s*\n\s*\)/,
  '取到的授权必须真的传给创建请求；取了不传 = 白取一枚，重扫照旧退化。\n'
    + '身份那一格必须是 identityToken（创建那一刻的快照），不是现取的 getToken()——见下一条。',
)

/* ── 身份快照：创建 / 重放 / 撤销 / 确认必须绑同一份（2026-09-15 第五轮）───────
 *
 * 此前是两处取值：effect 里写一次 `createTokenRef.current = getToken()`，`sendCreate`
 * 里又写一次 `getToken()` —— 中间隔着最长 24 秒的丢失响应重放。用户在那 24 秒里退出 /
 * 换人 / 会话过期的话，重放会用**新身份**（或匿名）去建任务，而 createTokenRef 里还是
 * 旧的那一个。服务端 cancel() 与 ack() 都按 endUserId 校验，于是那条 child 以另一个人
 * 的名义活着，谁都撤不掉，一直等到自然过期。
 *
 * 判据钉的是「整条创建 effect 里 getToken() 只出现一次，并且那一次就是写快照」。 */
const createEffectStart = scanSettings.indexOf('if (!sessionPromiseRef.current) {')
const createEffectEnd = scanSettings.indexOf('sessionPromiseRef.current\n      .then(')
assert.ok(
  createEffectStart > 0 && createEffectEnd > createEffectStart,
  '创建闸门那一段必须还在：找不到它，下面几条身份断言就全是空转',
)
// 注释里会解释「为什么不能再取一次」，所以只对**代码**数，先剥注释。
const createBlock = stripComments(scanSettings.slice(createEffectStart, createEffectEnd))
assert.match(
  createBlock,
  /const identityToken = getToken\(\)\s*\n\s*createTokenRef\.current = identityToken/,
  '身份**只取一次**并当场存成这一场的快照：撤销、确认、重放三件事必须绑同一份',
)
assert.equal(
  (createBlock.match(/getToken\(\)/g) ?? []).length,
  1,
  '创建这一段里 getToken() 只许出现一次（写快照那一次）。第二处取值会在重放窗口里'
    + '取到**另一个人**的身份：任务以他的名义建成，撤销时按 endUserId 校验只会 403',
)
assert.match(
  scanSettings,
  /const memberToken = createTokenRef\.current\s*\n\s*let stale = false/,
  '投递确认也用**建这一场时**那份快照。现取的话，用户中途退出之后拿回的 403 会被'
    + '这一屏读成「服务端不认这一场」—— 把本机的身份漂移说成服务端的结论',
)
assert.match(
  scanSettings,
  /if \(restoredFromStorageRef\.current && createTokenRef\.current === null\) \{\s*\n\s*createTokenRef\.current = getToken\(\)/,
  '复水进来的那一场没走过创建，快照是空的：挂载这一刻就要补上。'
    + '等到确认 effect 再补是不够的 —— 用户可能在确认回来之前就按下「返回（取消任务）」',
)

/* ── B3. 丢失响应的重放：把「看不见的收件箱」收回来（2026-09-14 第三轮）───────
 *
 * POST /scan/sessions 的响应在回来的路上丢了，浏览器侧只有一个 TypeError。但服务端
 * **可能已经提交了一条 child waiting 任务**，它挂在这台终端上等文件 —— 屏幕上什么都
 * 没有，下一位走到面板前按下扫描，文件就投给了这条没有任何界面在看着的任务。
 * 一体机是公共设备，这正是「看不见的收件箱」。
 *
 * 服务端把配对创建做成了幂等：同一对凭据再发一次拿回**同一条** child（controlToken
 * 就是上一场那份明文），不会多建一条。所以本机对未知态的正确动作是重放同一对请求。
 *
 * 下面钉的是这件事的四条边界 —— 少任何一条，它就从「收回收件箱」变成别的东西。 */
assert.match(
  scanSettings,
  /const sendCreate = \(\) => createScanSession\([\s\S]{0,600}?sessionPromiseRef\.current = replayCreateUntilOutcomeKnown\(sendCreate, rescan !== null, \{/,
  '重放必须复用**同一个** sendCreate 闭包，并且 paired 位直接取 `rescan !== null`：\n'
    + '  · 另写一处调用就可能漏带那两半，而漏带的那一次是一个无签名的普通创建；\n'
    + '  · paired 位若写死 true，普通创建（没有幂等键）会被重发成真的第二条任务。\n'
    + '  并且结果仍然存进 sessionPromiseRef —— StrictMode / effect 重跑共用同一个 promise，'
    + '所以「一次创建意图只有一条重放循环」是结构保证的，不靠调用方自觉。',
)
assert.match(
  scanCreateReplay,
  /if \(!paired \|\| !isUnknownCreateOutcome\(firstError\)\) throw firstError/,
  '两道闸必须在同一句里：非配对请求一个字节都不许重发（普通创建没有幂等键，'
    + '重发就是真的多建一条）；拿到任何 HTTP 应答都说明服务端回过话了，'
    + '429 / SCAN_TERMINAL_BUSY / 401 / 5xx / 403 一律原样抛出交给用户手动决定',
)
assert.match(
  scanCreateReplay,
  /export function isUnknownCreateOutcome\(error: unknown\): boolean \{\s*\n\s*return error instanceof ApiHttpError && \(error\.code === 'NETWORK_ERROR' \|\| error\.status === 0\)\s*\n\s*\}/,
  '「未知」的判据只能是本仓既有的那一条（status 0 = 压根没拿到 HTTP 应答）。'
    + '放宽它就会把一个**确定**的失败当成未知去重放 —— 比如 401 终端票失效，'
    + '那是「请求根本没发出去」，重放五次只是白烧限流额度',
)
assert.match(
  scanCreateReplay,
  /if \(!isUnknownCreateOutcome\(replayError\)\) throw replayError/,
  '重放途中拿到确定答案（含 409 SCAN_RETRY_CHILD_NOT_RECOVERABLE）必须当场收工：'
    + '继续重放等于把一个已经有结论的失败拖成一屏无意义的等待',
)
assert.match(
  scanCreateReplay,
  /SCAN_CREATE_REPLAY_DELAYS_MS: readonly number\[\] = \[[\d, ]+\]/,
  '退避表必须是一张**有界**的常量表：创建端点按出口 IP 限 12 次/分'
    + '（scan-tasks.controller.ts 的 @Throttle，tracker 是纯 IP），'
    + '一个大厅好几台机器共用一个桶，无界重放会把整个大厅的额度烧掉',
)
assert.ok(
  (JSON.parse(
    /SCAN_CREATE_REPLAY_DELAYS_MS: readonly number\[\] = (\[[\d, ]+\])/.exec(scanCreateReplay)?.[1] ?? '[]',
  )).length <= 6,
  '重放次数上限不许放大：最坏情况 1 次原始 + 5 次重放 = 6/12，'
    + '必须给用户自己的动作留下另一半额度',
)
/* 这两条钉的是**代码**，不是注释里提到过什么，所以先剥注释
 * （模块的文档注释本来就要把 retryOfScanTaskId / expiresAt 这些名字说清楚）。 */
const replayCode = stripComments(scanCreateReplay)
assert.doesNotMatch(
  replayCode,
  /createScanSession|X-Scan-Retry-Control|retryOfScanTaskId/,
  '重放模块**从不**自己构造请求：它只会重放调用方给的那个闭包。'
    + '一旦它自己拼 body / 头，就出现了第二条能退化成无签名普通创建的路径',
)
assert.doesNotMatch(
  replayCode,
  /expiresAt|armedAtMs|TTL_MS/,
  '重放不许碰任何有效期：child 的 expiresAt 是服务端给的，本机那枚授权的 15 分钟'
    + '也从上一场铸出来那一刻算起。重放把它们中任何一个延长，'
    + '页面就会照着一句已经不成立的承诺让用户把纸放回去',
)
/* 重放窗口里屏幕上那句话。这一刻「正在建扫描会话」已经不准确 —— 会话可能早就建成，
 * 丢的只是回话。不说这个区别，用户会以为什么都没发生，转身去面板上按开始，
 * 而服务端那条 child 正等着收他这一张纸。 */
assert.match(
  scanSettingsView,
  /replayingLostCreate\s*\n?\s*\? '正在确认上一次请求'/,
  '重放期间必须改口：说「正在建扫描会话」是假话（会话可能已经建成）',
)
assert.match(
  scanSettingsView,
  /data-testid="scan-create-replay-notice"[\s\S]{0,400}?先别在面板上按开始/,
  '重放窗口必须明说「会话可能已经建成」并劝阻面板操作：'
    + '这是这条修复在屏幕上唯一看得见的部分，少了它，用户的动作依旧会撞上那条 child',
)

// ── C. 被拒不许静默降级 ────────────────────────────────────────────────────
const rejectionCodeTable = /export const SCAN_RESCAN_REJECTION_CODES = new Set\(\[([\s\S]*?)\]\)/.exec(rescanRecovery)?.[1]
assert.ok(rejectionCodeTable, '必须有一张显式的重扫拒绝码表（scanRescanRecovery）')
for (const code of [
  'SCAN_RETRY_NOT_AUTHORIZED',
  'SCAN_RETRY_CONFLICT',
  'SCAN_RETRY_TASK_ID_MISSING',
  // 2026-09-14：丢失响应重放的终点之一 —— child 存在过但已不在 waiting/matched。
  // 服务端明确不会再开 grandchild，所以它和 403 同一个处置：永久丢弃那枚授权。
  'SCAN_RETRY_CHILD_NOT_RECOVERABLE',
]) {
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
  rescanRecovery,
  /RESCAN_REFUSED_FAILURE = \{\s*\n\s*title: '安全重扫授权已失效'/,
  '重扫被拒要有自己的结论屏，不能和「服务端没能创建扫描会话」混成一句',
)
/* 那张表里的码必须和 shared 的常量是同一个字符串。分别硬写两处、其中一处被改掉，
 * 表里那个码就永远匹配不上服务端回的那个 —— 闸门看起来还在，实际已经空转。 */
assert.match(
  readRepo('packages/shared/src/types/scanTask.ts'),
  /export const SCAN_RETRY_CHILD_NOT_RECOVERABLE = 'SCAN_RETRY_CHILD_NOT_RECOVERABLE'/,
  'shared 必须仍然导出这个码，且值与前端拒绝码表里那个字面量一致',
)
/* 处置相同、成因不同 → 必须是两屏。child 不可恢复那一条要多交代一件事：
 * 服务端那边**没有**留下还在等文件的任务。不说这句，用户不知道刚才那张纸还会不会
 * 被谁收走，也就不敢开新的一场。 */
assert.match(
  rescanRecovery,
  /RESCAN_CHILD_LOST_FAILURE = \{\s*\n\s*title: '那次安全重扫的会话已经失效'/,
  'child 已提交但不可恢复要有自己的结论屏：它和「上一场根本没走到取件」'
    + '（从来没有任务）的成因正相反，混成一句就有一半的人读到假的诊断',
)
assert.match(
  rescanRecovery,
  /RESCAN_CHILD_LOST_FAILURE[\s\S]{0,600}?没有留下还在等文件的任务/,
  '这一屏必须明说服务端没有留下等文件的任务：用户据此判断自己那张纸安不安全',
)
assert.match(
  rescanRecovery,
  /failure: code === 'SCAN_RETRY_CHILD_NOT_RECOVERABLE'\s*\n\s*\? RESCAN_CHILD_LOST_FAILURE/,
  '分屏必须按码分，不能按「重放过没有」之类的本机状态分：'
    + '本机状态证明不了服务端那条 child 到底存不存在过',
)
/* 重放到头仍未知：既不许说成「已经建成」，也不许说成「没建成」。它必须仍然是
 * outcomeUnknown —— 那一位决定授权被**原样放回**，用户那颗「再试一次安全重扫」
 * 发出去的才还是成对的，服务端才可能幂等地把那条 child 交回来。 */
assert.match(
  rescanRecovery,
  /if \(code === SCAN_CREATE_REPLAY_UNRESOLVED\) \{\s*\n\s*return \{\s*\n\s*outcomeUnknown: true,\s*\n\s*refusedRescan: false,/,
  '重放到头的结论必须 outcomeUnknown: true + refusedRescan: false：\n'
    + '  · 判成 refused 会永久丢弃一枚服务端**可能还认**的授权，'
    + '用户只能去开一场注定撞两小时去重的普通会话；\n'
    + '  · 判成确定失败会让页面对一件本机并不知道的事下结论。',
)
assert.match(
  rescanRecovery,
  /if \(code === SCAN_CREATE_REPLAY_UNRESOLVED\)[\s\S]{0,400}?const outcomeUnknown = error instanceof ApiHttpError/,
  '这一条必须排在通用 outcomeUnknown **之前**：两者都是 status 0，但通用那条说'
    + '「本页不会自动重发，要不要再发由你按」—— 重发已经发过五次了，说那句就是假话',
)
/* 原来这一条用一个跨越「码表 → 置位 → 结论屏」的长正则钉在页面里。结构收敛之后
 * 翻译那一半在 helper、置位那一半在页面，所以拆成两条 —— 合起来的判据一个没减：
 * 拒绝码必须翻译成它**自己那张**结论屏，且页面必须据此立起「服务端不认」这一位。 */
assert.match(
  rescanRecovery,
  /isRescanRefusedByServer\(code\)\) \{[\s\S]{0,400}?refusedRescan: true,[\s\S]{0,300}?title: RESCAN_REFUSED_FAILURE\.title/,
  '拒绝码必须翻译成它自己那张结论屏，不能掉进「扫描任务未创建」的通用兜底',
)
assert.match(
  scanSettings,
  /if \(verdict\.refusedRescan\) setRescanRefusedByServer\(true\)\s*\n\s*setFailure\(verdict\.failure\)/,
  '页面必须据此立起「服务端不认」这一位，并把那张结论屏挂上去：'
    + '少了置位，CTA 就不会切成显式的普通重启，用户在这一屏无路可走',
)
assert.match(
  rescanRecovery,
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
  scanSettingsView,
  /rescanCredentialsLost \|\| rescanRefusedByServer \|\| ackRefused \? \(\s*\n\s*<button[^>]*onClick=\{handlePlainRestart\}>\s*\n\s*重新开始一次扫描/,
  '三种 fail-closed（本机取不到凭据 / 服务端不认这次重扫 / 服务端不给投递授权）'
    + '都必须给出同一个显式主行动「重新开始一次扫描」：'
    + '少给其中任何一种，那一种就是一条注定失败的死路',
)
/* 第三条分支：安全重扫这条路**还通着**（失败码证明不了服务端消费过那枚授权）。
 * 它必须排在上面那两条 fail-closed 之前 —— 顺序反了的话，一次限流 / 断网就会把用户
 * 推到「重新开始一次扫描」上去，同一张纸随后撞上服务端两小时的同字节去重。 */
assert.match(
  scanSettingsView,
  /\) : rescanRetryable \? \(\s*\n\s*<button[^>]*onClick=\{handleRescanRetry\}>\s*\n\s*再试一次安全重扫\s*\n\s*<\/button>\s*\n\s*\) : rescanCredentialsLost \|\| rescanRefusedByServer \|\| ackRefused \? \(/,
  '「还能再试一次成对重扫」必须排在三条 fail-closed 的普通重启之前：'
    + '把它排在后面或干脆不给，等于让一次 429 永久烧掉用户那枚一次性授权。\n'
    + '（2026-09-14 起它前面还多一条 awaitingAck 分支 —— 见下面那条专门的断言：'
    + '会话已经建成、只差一次确认时，重开一场只会白建一条任务。）',
)
assert.match(
  rescanRecovery,
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
  scanSettingsModel,
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
/* 文案搬进 scanSettingsModel 之后，「必须喂那个 ref」这一位要单独钉一次：
 * 只钉 model 里的三元，页面把 restoredLive 原样传进去照样绿 —— 而那正是
 * 「一个刚在本页建成的会话被说成本页重载过」那句假话的来源。 */
assert.match(
  scanSettings,
  /restoredFromStorage=\{restoredFromStorageRef\.current\}/,
  '「本次性质」必须由挂载那一刻的 ref 喂：每帧重算会把一个刚在本页建成的会话'
    + '说成「本页重载过」，那是一句假话。喂 restoredLive / storedLive 都会当场变成那句假话',
)
/* 那张卡搬进 ScanSettingsStatusView 之后，「页面喂对了」还不够：中间那一层必须**原样
 * 透传**。只要它在组件里自己重算一次（比如读 readScanWorkbenchSession），上面那条
 * 断言照样绿，而假话原封不动回来了。 */
assert.match(
  scanSettingsView,
  /sessionNatureRow\(\{ rescanRequested, plainRestartChosen, restoredFromStorage \}\)/,
  '「本次性质」那一行只能用调用方传进来的三个值算，不许在展示组件里自己重算',
)
assert.doesNotMatch(
  scanSettingsView,
  /readScanWorkbenchSession|liveSessionStillValid/,
  '展示组件不许自己去读本机登记：它没有生命周期上下文，读出来的必然是「此刻」而不是「挂载那一刻」',
)
assert.match(
  scanSettingsModel,
  /restoredFromStorage\s*\n?\s*\? \['本次性质', '本页重载过；这一场当初是不是安全重扫，本机无从判断'\]/,
  '复水出来的会话只能如实说无从判断：猜「安全重扫」会让用户把同一张纸放回去'
    + '（可能被去重拒收），猜「普通会话」会让他白换一份材料',
)
assert.match(
  scanSettingsModel,
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
  /if \(rescanCredentialsLost\) return\s*\n[\s\S]{0,700}?if \(cleanupHolding\) \{[\s\S]{0,400}?\}\s*\n\s*\/\/ 终端安全会话还在换票/,
  'fail-closed 必须排在终端会话那两个分支**之前**（页面要说的是「凭据没了」，'
    + '不是「正在做终端安全校验」），而且它 return 掉的正是那一个会悄悄发出去的普通创建。\n'
    + '2026-09-15 起同一位置上还多一道：上一位的扫描没收完尾时一个创建都不许发'
    + '（cleanupHolding）。它同样必须排在终端状态分支之前 —— 排在后面的话，'
    + '换票窗口里那一次就会抢在收尾完成之前把请求发出去。',
)
assert.match(
  scanSettings,
  /\}, \[terminalSession, rescanCredentialsLost, rescanRefusedByServer, rescanRetryable, ackRefused, cleanupHolding\]\)/,
  '五个标志都必须进依赖：用户显式选了「重新开始一次扫描」或「再试一次安全重扫」之后'
    + '它们变 false，这条 effect 要跟着跑一次，否则那个按钮按下去什么都不会发生。\n'
    + 'rescanRefusedByServer 这一位尤其容易被判成冗余 —— 服务端拒绝那条路径上'
    + 'rescanCredentialsLost 从头到尾都是 false，复位它不构成依赖变化。\n'
    + 'rescanRetryable 是「再试一次安全重扫」唯一的复跑开关，同理。\n'
    + 'ackRefused（2026-09-14）同理，而且它还多守一头：置位时让 effect 早退，'
    + '否则这一场刚被撤掉，effect 转身就重建一条。\n'
    + 'cleanupHolding（2026-09-15）是唯一一个**不由用户按钮**复位的：上一场收完尾时'
    + '订阅把它打回 false，这一次创建才发得出去。不进依赖的话页面会永远停在'
    + '「还在收上一场的尾」，而收尾其实早就结束了。',
)
assert.match(
  scanSettings,
  /const handlePlainRestart = \(\) => \{\s*\n\s*if \(!scanType\) return\s*\n\s*beginPlainScanRestart\(\{ scanType, extras: stored\?\.extras \}\)\s*\n\s*rescanIntentRef\.current = false\s*\n\s*sessionPromiseRef\.current = null\s*\n\s*setRescanCredentialsLost\(false\)\s*\n\s*setRescanRefusedByServer\(false\)/,
  '出路只有这一条显式动作：走 beginPlainScanRestart（它抹掉那笔意图），'
    + '并且当场把 fail-closed 那一位放下来 —— 否则按钮按下去什么都不会发生',
)
assert.match(
  scanSettingsView,
  /rescanCredentialsLost \|\| rescanRefusedByServer \|\| ackRefused \? \([\s\S]{0,400}?onClick=\{handlePlainRestart\}>\s*\n\s*重新开始一次扫描/,
  '三种 fail-closed（本机取不到凭据 / 服务端不认这次重扫 / 服务端不给投递授权）'
    + '都要有同一个能按的主行动；'
    + '其余失败态仍然什么都不许按（本页不自动重发）。\n'
    + '只给其中一种就会留下一条死路：服务端拒绝那一屏最常见的来源是「上一场根本没走到取件」，'
    + '服务端那种情况从不铸授权、必然 403 —— 最常见的失败路径上主行动注定失败。',
)
assert.match(
  rescanRecovery,
  /RESCAN_CREDENTIALS_LOST_FAILURE = \{\s*\n\s*title: '安全重扫凭据已经不在本机'/,
  'fail-closed 要有自己的结论屏，不能混进「扫描任务未创建」的通用兜底',
)

/* ── C3. 创建失败之后那枚一次性授权的归属 ──────────────────────────────────
 *
 * 取用排在请求发出之前（并发双击、effect 重跑都得撞空槽位），所以失败回来时本机那份
 * 已经不在槽位里。而服务端那一半的消费（retryConsumedAt 的 CAS）在
 * scan-tasks.service.ts 的 $transaction **内部**，限流（12 次/分）与终端态检查更在
 * 事务之前就抛 —— 429 / SCAN_TERMINAL_BUSY / 断网 / 5xx 回来时，服务端那枚授权
 * 原封没动，只有本机把它自己扔了。
 *
 * 扔掉不是「少一个便利功能」：授权只在任务 matched 之后才铸，而 matched 同时写下
 * lastAttemptHash —— 那正是两小时同字节去重的键。两个条件必然同时成立，所以只要曾经
 * 有过授权，同一张纸走普通会话就必定撞 SCAN_FILE_PREVIOUSLY_ATTEMPTED：Agent 把文件
 * 隔离进 _unclaimed 且不重试，任务停在 waiting，用户白等到十分钟轮询上限。
 *
 * 下面钉的就是那条二选一，以及它绝不许放宽的三个边界。 */
assert.match(
  scanSettings,
  /const serverRefusedRescan = isRescanRefusedByServer\(code\)/,
  '恢复与丢弃的判据只能是失败码本身：按别的东西（重试次数、是否超时）分叉，'
    + '等于在猜服务端有没有消费那枚授权',
)
assert.match(
  rescanRecovery,
  /export function isRescanRefusedByServer\(code: string \| undefined\): boolean \{\s*\n\s*return SCAN_RESCAN_REJECTION_CODES\.has\(code \?\? ''\)\s*\n\s*\}/,
  '那个判据必须就是拒绝码表本身（一个薄包装，不许在里面加别的条件）',
)
assert.match(
  scanSettings,
  /if \(rescanCarriesOver\) \{\s*\n\s*rescanStillUsable = restoreScanRescanAuthority\(scanType\)\s*\n\s*\} else \{\s*\n\s*discardTakenScanRescanAuthority\(\)\s*\n\s*\}/,
  '二选一必须是显式的：证明不了服务端消费过就原样放回，服务端明确不认就永久丢弃。'
    + '少了 restore 那一支，一次 429 就永久烧掉用户那枚一次性授权；'
    + '少了 discard 那一支，屏幕上会挂一句「可以再试一次安全重扫」的假承诺。',
)
assert.match(
  scanSettings,
  /const rescanCarriesOver = !serverRefusedRescan\s*\n\s*&& createGeneration !== null\s*\n\s*&& scanLifecycleGeneration\(\) === createGeneration\s*\n\s*&& !unmountedRef\.current/,
  '恢复必须和**发起这次创建时**那个代次配对，并且页面还挂着：\n'
    + '  · 代次一变就说明这一场已经结束（离开 / 清场 / 换人 / 安全返回都会推进它），'
    + '那一刻回来的失败响应不许把上一场的凭证立回槽位 —— 下一位用户会继承它；\n'
    + '  · 卸载后没有人会再用它，而它握着上一场的 controlToken 明文。',
)
assert.match(
  scanSettings,
  /const serverRefusedRescan = isRescanRefusedByServer[\s\S]{0,1200}?if \(cancelled\) return/,
  '这段裁决必须排在 `if (cancelled) return` **之前**：cancelled 只表示本轮 effect 过时'
    + '（终端会话 checking/ready 切一次就置位），和授权归谁无关。排在后面的话，'
    + '正好在换票窗口里失败的那一次会两头落空 —— 既没恢复也没丢弃。',
)
assert.match(
  scanSettings,
  /\.then\(\(created\) => \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*discardTakenScanRescanAuthority\(\)/,
  '拿到 2xx 就意味着服务端跑过 handler、事务里的 CAS 已经消费掉那枚授权，'
    + '寄存的那一份必须在 .then 的**第一句**永久丢弃 —— 无论这份响应本身可不可用。'
    + '漏掉这一句，一次成功的创建会把上一场的 controlToken 明文继续留在模块内存里，'
    + '而它已经没有任何用途了',
)
assert.match(
  scanSettings,
  /if \(rescanStillUsable\) setRescanRetryable\(true\)/,
  '只许在真的恢复成功时立起那一位，且**从不**在 catch 里写回 false：'
    + '本 promise 已经 settle，后续每一轮 effect 都会再挂一次 catch，那时寄存格已空、'
    + '恢复必然返回 false，照写就会把上一轮刚立起来的按钮当场按灭',
)
assert.match(
  scanSettings,
  /const handleRescanRetry = \(\) => \{\s*\n\s*if \(!scanType\) return\s*\n\s*sessionPromiseRef\.current = null\s*\n\s*setRescanRetryable\(false\)/,
  '「再试一次安全重扫」必须置空那个已经 reject 的 sessionPromiseRef（否则 effect 重跑'
    + '只会给同一个 rejection 再挂一遍 then/catch，新的 POST 永远发不出去，页面停在 loading）',
)
assert.doesNotMatch(
  scanSettings,
  /const handleRescanRetry = \(\) => \{[\s\S]{0,400}?rescanIntentRef\.current = false/,
  '「再试一次安全重扫」绝不能解除延迟取用闸门：它仍然是一次「同一份材料」，'
    + '万一取用时授权已经过期，必须照旧 fail-closed，而不是放一个无签名的普通创建出去',
)
assert.match(
  scanSettingsView,
  /rescanRetryable && !awaitingAck \?[\s\S]{0,600}?这次失败没有用掉你的安全重扫凭据[\s\S]{0,300}?重试不会延长/,
  '这一屏必须如实说明「凭据还在」与「有效期不会因为重试而延长」：'
    + '只给按钮不给这两句，用户会以为同一份材料已经扫不成了，转头去开一场'
    + '注定被同字节去重拒收的普通会话',
)

// ── C4. 恢复语义本体（scanWorkbenchSession）────────────────────────────────
assert.match(
  workbenchSession,
  /export function restoreScanRescanAuthority\(scanType: ScanType\): boolean \{\s*\n\s*const pending = takenRescanAuthority\s*\n\s*takenRescanAuthority = null\s*\n\s*if \(!pending\) return false\s*\n\s*if \(pending\.generation !== lifecycleGeneration\) return false\s*\n\s*if \(pending\.scanType !== scanType\) return false\s*\n\s*if \(rescanAuthority\) return false\s*\n\s*rescanAuthority = pending\s*\n\s*return usableRescanAuthority\(scanType\) !== null\s*\n\s*\}/,
  '恢复的形状一条都不能少：\n'
    + '  · 先取出寄存格再清空（恢复是一次性的，同一次失败不许被恢复两遍）；\n'
    + '  · 代次 / 类型必须配对，否则上一场的凭证会被下一位继承；\n'
    + '  · 槽位已经有主就让路（期间用户可能已经重新 arm 过）；\n'
    + '  · 放回的是**同一个对象**（armedAtMs 原样），返回值只说明它此刻还可不可用。',
)
assert.doesNotMatch(
  workbenchSession,
  /export function restoreScanRescanAuthority\([\s\S]{0,800}?(Date\.now\(\)|armedAtMs:)/,
  '恢复绝不能重新计时：只要出现 Date.now() 或重写 armedAtMs，'
    + '「失败一次就续 15 分钟」就成立，本机窗口会长过服务端那枚授权，'
    + '页面会照着一句已经不成立的承诺让用户把纸放回去',
)
assert.match(
  workbenchSession,
  /function endScanLifecycle\(\): void \{\s*\n\s*lifecycleGeneration \+= 1\s*\n\s*rescanAuthority = null\s*\n(?:\s*\/\/[^\n]*\n)*\s*takenRescanAuthority = null/,
  '代次推进时寄存格必须和槽位一起扔掉：少了这一句，用户离开 / 清场 / 换人之后，'
    + '一个还在飞的失败响应回来仍然能把上一场的凭证恢复进槽位',
)
assert.match(
  workbenchSession,
  /export function clearScanRescanAuthority\(\): void \{\s*\n\s*rescanAuthority = null\s*\n(?:\s*\/\/[^\n]*\n)*\s*takenRescanAuthority = null/,
  '「明确扔掉」这条入口也要清寄存格，否则等于给它留了一扇从失败响应里被恢复回来的后门',
)
assert.match(
  workbenchSession,
  /export function takeScanRescanAuthority[\s\S]{0,500}?takenRescanAuthority = authority\s*\n\s*if \(!authority\) return null/,
  '取用时必须把取走的那一份寄存起来（且在早退之前）：不寄存就没有东西可以恢复，'
    + '一次 429 依旧会把授权永久烧掉',
)
assert.doesNotMatch(
  scanSettings,
  /title: '安全重扫凭据已随本页重载消失'/,
  '这一屏的成因不止「整页重载」一种：延迟取用（等终端换票期间本地窗口走完 / 别处清过场）'
    + '走的是同一屏。把成因写死成其中一种，另一种发生时就是一句假的诊断',
)
assert.match(
  rescanRecovery,
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

/* ══ D. 投递确认（ACK）：会话「建成」与「可投递」之间的那道闸 ══════════════════
 *
 * ## 它修的是哪一个缺陷
 *
 * 在这之前，`POST /scan/sessions` 一回 2xx，服务端那条任务就已经可投递了：Agent 的
 * current-lease 立刻看得见它，面板上扫出来的文件会直接投过去。于是只要那份 2xx
 * **没能变成屏幕上的一场会话**（回话在路上丢了、整页重载、清场把本机登记抹了），
 * 服务端就留下一个可投递却没有任何界面在看着的收件箱 —— 下一位走到面板前按下扫描，
 * 文件进的是上一位的任务。一体机是公共设备，这是这条链路上最后一个能跨用户串件的口子。
 *
 * 服务端 2026-09-14 起把它拆成两段：新建会话一律 `deliveryAckedAt = null`，
 * current-lease 看不见未确认的行（60 秒没确认就回收）；只有本机确认自己确实握着这一场
 * 的控制凭据之后，它才变得可投递。
 *
 * 下面钉的就是本机这一侧的四条边界。少任何一条，这道闸要么形同虚设，要么把用户骗去
 * 面板上扫一张没人会收的纸。 */

// ── D1. 确认请求本身：凭据齐全才发，且四样一个不少 ──────────────────────────
assert.match(
  scanTasksApi,
  /scan\/sessions\/\$\{encodeURIComponent\(scanTaskId\)\}\/ack/,
  '确认必须打到服务端那个专门的端点上（POST /scan/sessions/:id/ack）',
)
assert.match(
  scanTasksApi,
  /export function ackScanSession\([\s\S]{0,1200}?terminalProtected: true/,
  'ACK 必须走终端身份闸门：服务端在这个端点上挂了 TerminalIdentityGuard，'
    + '只带 x-terminal-id 会被 401 顶回来，而 401 在页面上会被读成「还没确认」——'
    + '一个本可以成功的确认会被说成网络问题',
)
assert.match(
  scanTasksApi,
  /export function ackScanSession\([\s\S]{0,1200}?controlToken,/,
  'controlToken 必须交给 requestJson（它组 X-Scan-Session-Control 头）：'
    + '服务端按这一头比对任务的 controlTokenHash，不带就是 403',
)
assert.match(
  scanTasksApi,
  /if \(!hasId \|\| !hasControl\) \{\s*\n\s*return Promise\.reject\(new ApiHttpError\(\s*\n\s*SCAN_ACK_CREDENTIALS_INCOMPLETE,/,
  '凭据不全时**一个请求都不发**：半对凭据发出去只会拿回 403，'
    + '而那条 403 在页面上会被判成「服务端不认这一场」并把它撤掉 ——'
    + '把本机自己的缺失说成了服务端的结论',
)
/* 发出去的必须是**原样**那一串。这两条钉的是代码，所以先剥注释（注释里要解释
 * 为什么判空按 trim 算）。给凭据做 trim 再发，等于发了一份不同的凭据。 */
assert.doesNotMatch(
  stripComments(scanTasksApi).slice(
    stripComments(scanTasksApi).indexOf('export function ackScanSession'),
  ),
  /controlToken: controlToken\.trim\(\)|encodeURIComponent\(scanTaskId\.trim\(\)\)/,
  '判空可以按 trim 算，发出去的必须是原串：服务端按字节比对 hash，'
    + '替用户「整理」一下凭据就是发了另一份凭据',
)

// ── D2. 「服务端明确不认」那张码表，字符串取自 shared，不许再打一遍 ─────────
assert.match(
  scanDeliveryAck,
  /import \{ SCAN_TASK_ACK_NOT_ALLOWED \} from '@ai-job-print\/shared'/,
  '这个码必须从 shared 取：两处各写一份、其中一处被改掉时，'
    + '表就永远匹配不上服务端回的那个码 —— 闸门看起来还在，实际已经空转',
)
const ackCodeTable = /export const SCAN_ACK_DEFINITIVE_CODES = new Set<string>\(\[([\s\S]*?)\]\)/
  .exec(scanDeliveryAck)?.[1]
assert.ok(ackCodeTable, '必须有一张显式的「服务端明确不认」码表（scanDeliveryAck）')
assert.match(ackCodeTable, /SCAN_TASK_ACK_NOT_ALLOWED/, '409：任务状态不允许确认投递')
for (const code of ['SCAN_TASK_FORBIDDEN', 'SCAN_TASK_NOT_FOUND']) {
  assert.match(
    apiScanService,
    new RegExp(`code: '${code}'`),
    `服务端仍会在 ack 路径上抛 ${code}，前端必须继续认它`,
  )
  assert.match(
    ackCodeTable,
    new RegExp(`'${code}'`),
    `${code} 必须在表**里面**：漏了它，一个本机根本操作不了的任务会被当成「还没确认，`
      + `再试试」，页面对着一场自己碰不到的会话一直重试`,
  )
}
assert.match(
  readRepo('packages/shared/src/types/scanTask.ts'),
  /export const SCAN_TASK_ACK_NOT_ALLOWED = 'SCAN_TASK_ACK_NOT_ALLOWED'/,
  'shared 必须仍然导出这个码',
)
assert.match(
  apiScanService,
  /code: 'SCAN_TASK_ACK_NOT_ALLOWED'/,
  '服务端仍会抛这个码；它一旦改名，上面那张表就空转了',
)
assert.match(
  scanDeliveryAck,
  /if \(typeof acked\?\.deliveryAckedAt !== 'string' \|\| acked\.deliveryAckedAt\.trim\(\)\.length === 0\) \{\s*\n\s*return \{ ok: false, definitive: false/,
  '放行的判据必须是服务端**真的写下了那一笔**：2xx 但没带 deliveryAckedAt 时按'
    + '「还没确认」处理。只看 HTTP 状态码就放行，等于凭一个空回执把用户支到面板上',
)

// ── D3. 设置页：写完登记立刻确认；没确认就不许出现面板指引 ──────────────────
assert.match(
  scanSettings,
  /if \(!patchScanWorkbenchSessionWithDurableLive\(\{ stage: 'settings', scanType, live \}\)\) \{[\s\S]{0,900}?if \(ackRequestedForRef\.current !== created\.scanTaskId\) \{\s*\n\s*ackRequestedForRef\.current = created\.scanTaskId\s*\n\s*setAckState\('pending'\)/,
  '顺序钉死：**先**把 live 写进本机登记并读回核对，**再**确认投递授权。反过来的话，'
    + 'ACK 一成功服务端那条任务就可投递了，而这一刻本机还没把凭据落到能跨重载存活的'
    + '地方 —— 又造出一个「可投递却没人看着」的收件箱，正是这道闸要消灭的东西。\n'
    + '而且判据必须是**读回核对**那一条（2026-09-14 P1）：patchScanWorkbenchSession 是 void 的，'
    + '底下的 setItem 可能抛（已被吞）也可能静默什么都不做 —— 「写过了」证明不了「记住了」。\n'
    + '认 id 而不是无条件置位：那段 .then 挂在一个会被重挂多次的 promise 上，'
    + '无条件置位会把刚确认好的 acked 一次次打回 pending，两个 effect 互相喂招。',
)
/* 核不上那一支：撤任务 + 立起「这一次创建已经丢弃」+ 换结论屏，**且不许 ACK**。
 * 少了 creationAbandonedRef 那一行，终端身份 failed → ready 会让创建 effect 再跑一次，
 * 把一场已经撤掉的会话重新建出来；少了 discardCreatedSession，服务端那条任务会留在
 * 终端上占住活动会话，而本机连界面都不再提它。 */
assert.match(
  scanSettings,
  /if \(!patchScanWorkbenchSessionWithDurableLive\([\s\S]{0,600}?creationAbandonedRef\.current = true\s*\n\s*discardCreatedSession\(live, SCAN_LIVE_NOT_DURABLE_FAILURE\)\s*\n\s*setLiveNotDurable\(true\)\s*\n\s*return\s*\n\s*\}/,
  '凭据没能落进登记时必须 fail-closed：撤掉刚建的那条任务、宣告这一次创建已丢弃、'
    + '如实换屏，并且**一个 ACK 都不发** —— ACK 一成功那条任务就可投递，'
    + '而本机根本没记住它，那就是一个没有任何界面在看着的收件箱',
)
/* 顺序：撤销必须发生在 setPhase('success') / 置 ackState 之前。把成功态先画出来再撤，
 * 屏幕上会闪过一次「扫描任务已创建」，用户可能就在那一帧转身去了面板。 */
const durableGateIndex = scanSettings.indexOf('if (!patchScanWorkbenchSessionWithDurableLive(')
assert.ok(durableGateIndex > 0, '设置页必须有那道「读回核对」闸')
assert.ok(
  scanSettings.indexOf("setPhase('success')") > durableGateIndex,
  "setPhase('success') 必须排在读回核对之后：先画成功再撤销，屏上会闪过一次「扫描任务已创建」",
)
assert.match(
  scanSettings,
  /if \(!pendingScanTaskId \|\| !pendingControlToken\) return undefined/,
  '没有完整凭据时一个确认请求都不发（理由同 D1）',
)
assert.match(
  scanSettings,
  /if \(scanLifecycleGeneration\(\) !== ackGeneration \|\| unmountedRef\.current\) \{[\s\S]{0,900}?abandonCreatedSession\(credentials, 'ack-compensation'\)/,
  '确认回来时必须过同一副生命周期闸门（代次 / 卸载），而且这一支比创建那一支更要紧：'
    + '确认成功的那一刻任务**已经可投递**，如果用户已经走了或清过场，'
    + '它就是一个没有任何界面在看着的收件箱 —— 必须撤，且一个字节都不许写回本机。\n'
    + "意图必须是 'ack-compensation'：离开那条路径已经按本机登记发过一次 DELETE，"
    + '按普通去重这一次会被挡掉；而 ACK 成功恰恰证明那一次没生效（生效了只会回 409），'
    + '同时 deliveryAckedAt 已经非空 —— 60 秒未确认回收器再也收不到它',
)
/* 双层闸门：本页的 cancelRequestedRef 也必须给补偿留口子。只放开 scanSessionRevoke
 * 那一层是不够的 —— handleSafeReturn / 过期取消都会把这一位立起来，补偿照样发不出去。 */
assert.match(
  scanSettingsTeardown,
  /if \(refs\.cancelRequestedRef\.current && intent !== 'ack-compensation'\) return\s*\n\s*refs\.cancelRequestedRef\.current = true[\s\S]{0,900}?revokeCreatedScanSession\(credentials, refs\.createTokenRef\.current, intent\)/,
  'abandonCreatedSession 自己那道去重也要认意图：只放开 scanSessionRevoke 那一层，'
    + '本页这一层照样会把补偿挡掉（handleSafeReturn / 过期取消都会置位 cancelRequestedRef）',
)
assert.match(
  scanSettingsTeardown,
  /const discardCreatedSession = \([\s\S]{0,600}?abandonCreatedSession\(credentials\)\s*\n\s*patchScanWorkbenchSession\(\{ stage: 'settings', live: undefined \}\)/,
  'fail-closed 的公共那一半：撤服务端任务 + 抹本机登记（live: undefined 同时推进代次）。'
    + '只抹本机不撤服务端，那条任务会留在终端上占住活动会话；'
    + '只撤服务端不抹本机，看门狗整页重载之后这一场会被复水成「有会话」',
)
/* 两处成因（服务端不给投递授权 / 凭据没能落进登记）必须走同一段丢弃逻辑。
 * 各写一份的话，改动其中一份时另一份会悄悄停在旧语义上 —— 那正是这四件事最容易漏掉的方式。 */
assert.match(
  scanSettingsTeardown,
  /const failClosedOnAckRefusal = \([\s\S]{0,200}?\): void => \{\s*\n\s*discardCreatedSession\(credentials, ackFailure\)\s*\n\s*setters\.setAckRefused\(true\)/,
  '「服务端不认投递授权」这一支必须复用 discardCreatedSession，只额外立起它自己那位 fail-closed 标志',
)
assert.match(
  scanSettings,
  /if \(ackState !== 'acked' \|\| phase !== 'success' \|\| !scanType/,
  '放行判据是两件事同时成立：服务端回了可用会话**并且**它已经拿到投递授权。'
    + '少了后半句，用户会照着指引去按开始，而那一刻服务端还不肯把文件投给这一场',
)
/* 结构性判据，不靠读文案：面板指引与「我已操作，开始等待」必须整个排在那道
 * 放行闸**之后**。排在前面的话，闸门写得再对也拦不住它们出现在屏幕上。 */
const ackGateIndex = scanSettings.indexOf("if (ackState !== 'acked' || phase !== 'success'")
assert.ok(ackGateIndex > 0, '设置页必须有那道放行闸')
for (const marker of ['<ScanPanelMock', '我已操作，开始等待', 'instructions.map(', '<ScanSettingsSessionFacts']) {
  const at = scanSettings.indexOf(marker)
  assert.ok(at > ackGateIndex, `「${marker}」必须排在投递授权放行闸之后：`
    + '没确认的会话在服务端是不可投递的，这时候让用户去面板按开始，那张纸不会进他的记录，'
    + '人会在机器前白等到轮询上限')
}

// ── D4. 两屏的话都不许把人支到面板上去 ────────────────────────────────────
assert.match(
  scanSettingsView,
  /const awaitingAck = phase === 'success' && ackState !== 'acked'/,
  '「会话建成了但还没确认」必须是一个独立的屏，不能混进 create-loading：'
    + '那一屏说的是「还没建成」，而这一刻它已经建成了 —— 混成一句话，'
    + '用户读到的诊断是假的',
)
assert.match(
  scanSettingsView,
  /data-testid="scan-ack-pending-notice"[\s\S]{0,500}?先别在面板上按开始/,
  '这一屏必须明说「现在扫也不会进这一场」并劝阻面板操作：'
    + '这是这条修复在屏幕上唯一看得见的部分',
)
assert.match(
  scanSettingsView,
  /\{awaitingAck \? \(\s*\n\s*ackRetryable \? \(/,
  'awaitingAck 必须是 CTA 的第一条分支：这一屏上「再试一次安全重扫」「重新开始一次扫描」'
    + '都是错的主行动 —— 会话已经建成，缺的只是那一次确认，重开一场只会白建一条任务',
)
assert.match(
  scanProgress,
  /const \[ackState, setAckState\] = useState<ScanAckState>\('pending'\)/,
  '等待页也必须从「还没确认」起算：它经常是整页重载之后凭 sessionStorage 里那份 live '
    + '直接挂起来的，本机并不知道当初确认过没有。ACK 幂等，所以再问一次永远是对的，'
    + '猜「应该确认过了」才是错的',
)
assert.match(
  scanProgress,
  /if \(scanLifecycleGeneration\(\) !== ackGeneration\) \{\s*\n\s*revokeCreatedScanSession\(credentials, memberToken, 'ack-compensation'\)/,
  '等待页这一次确认同样要过生命周期闸门：它可能刚好把任务变成可投递的，'
    + "而那一刻用户已经走了。意图同样必须是 'ack-compensation' —— "
    + '离开那条路径已经按本机登记发过一次 DELETE，按普通去重这一次兜底会被整个挡掉',
)
assert.match(
  scanProgress,
  /finishWithResult\(\{ outcome: 'failed', success: false, reason: SCAN_ACK_REFUSED_PROGRESS_REASON \}, true\)/,
  '等待页被明确拒绝时如实落一个失败结果并撤掉任务，不在这一屏继续假装还在等文件',
)
assert.match(
  scanProgress,
  /subtitle=\{deliveryAcked\s*\n\s*\? '请在打印机面板完成扫描到本机接收目录[^']*'\s*\n\s*: '[^']*先别在面板上按开始'\}/,
  '等待页那句副标题必须跟着确认状态改口：没确认时说「请在打印机面板完成扫描」是假话 ——'
    + '服务端此刻不肯把文件投给这一场',
)

// ── D5. 「写过了」不等于「记住了」：落地核对（2026-09-14 P1）──────────────────
//
// `saveScanWorkbenchSession` 把 `setItem` 的异常吞掉了，而更糟的一种是**根本不抛**：
// 隐私模式、配额写满、被扩展改写过的 sessionStorage 都可能静默什么也不做。两种情况下
// 调用方拿到的都是「看起来写成功了」，于是照常 ACK —— 服务端那条任务就变得可投递
// （deliveryAckedAt 非空，60 秒未确认回收器再也收不到它），而本机其实一个字节都没记住：
// 整页重载之后没有任何界面找得回这一场，它会一直可投递到自然过期，下一位在面板上按下
// 扫描，文件投给上一位。ACK 那道闸本来就是为了消灭这种收件箱，不能被这条路重新绕开。
assert.match(
  workbenchSession,
  /export function patchScanWorkbenchSessionWithDurableLive\([\s\S]{0,300}?\): boolean \{\s*\n\s*patchScanWorkbenchSession\(patch\)\s*\n\s*const persisted = readScanWorkbenchSession\(\)\?\.live\s*\n\s*if \(!persisted\) return false/,
  '放行判据必须是「写完**读回来**」：只看 setItem 有没有抛，对静默吞掉的那一种一个字都读不到',
)
/* 四样一个不能少，而且必须逐字节比。少比 controlToken，一份被改写过的凭据会被当成
 * 落地成功，拿它去 ACK / 撤销只会 403，而页面会把那条 403 读成「服务端不认这一场」；
 * 少比 instructions，屏上会少一步，用户照着做不完还不知道为什么。 */
for (const [field, why] of [
  ['scanTaskId', '任务编号是认领回传文件的唯一键'],
  ['controlToken', '控制凭据是查询 / 撤销 / 确认投递的唯一凭证'],
  ['expiresAt', '倒计时与过期撤销都按它走'],
]) {
  assert.match(
    workbenchSession,
    new RegExp(`persisted\\.${field} === live\\.${field}`),
    `读回核对必须逐字段比 ${field}：${why}`,
  )
}
assert.match(
  workbenchSession,
  /persisted\.instructions\.length === live\.instructions\.length\s*\n\s*&& persisted\.instructions\.every\(\(line, index\) => line === live\.instructions\[index\]\)/,
  '指引要连长度带逐条内容一起比：只比长度的话，被改写过的某一步会原样上屏',
)
assert.match(
  scanSettingsModel,
  /export const SCAN_LIVE_NOT_DURABLE_FAILURE: SessionFailure = \{/,
  '「本机没能记住这一场」要有自己的结论文案：它的成因和「服务端不认」完全不同，'
    + '共用一份文字就会对用户说错原因',
)
{
  const notDurableText = /SCAN_LIVE_NOT_DURABLE_FAILURE: SessionFailure = \{([\s\S]*?)\n\}/.exec(scanSettingsModel)?.[1] ?? ''
  assert.ok(notDurableText.length > 0, '取不到那份文案就谈不上核它')
  assert.doesNotMatch(notDurableText, /\*\*/, '纯字符串直接渲染进 <p>：写 markdown 会把星号打在 27 寸公共屏上')
  assert.match(notDurableText, /先别在面板上按开始/, '必须劝阻面板操作：这一刻没有任何会话会认领那份文件')
  assert.match(notDurableText, /撤掉/, '必须说出「那条任务已经撤掉了」，否则用户会以为纸可能被谁悄悄收走')
  assert.match(notDurableText, /工作人员/, '出路必须可执行：存储坏了用户自己修不了，只能安全返回 + 叫人')
}
/* 这一屏刻意**不给**「重新开始一次扫描」：写不进去是这台机器的存储坏了 / 被禁用 / 写满，
 * 重建一次只会在同一处再失败，还多留一条要撤的服务端任务。给一颗按不出结果的按钮，
 * 比不给更糟 —— 用户会反复按，每按一次就多一条要撤的任务。 */
{
  // 取「重新开始一次扫描」那颗按钮的**整个**判定条件再核，不按某一种写法去匹配：
  // 写成 `liveNotDurable || rescanCredentialsLost || ...` 时，按顺序匹配的断言会漏过去。
  const restartBranch = /\) : ([^?]*?)\? \(\s*\n\s*<button[^\n]*onClick=\{handlePlainRestart\}>\s*\n\s*重新开始一次扫描/
    .exec(scanSettingsView)?.[1]
  assert.ok(restartBranch, '取不到「重新开始一次扫描」那颗按钮的判定条件，后面的核对无从谈起')
  assert.doesNotMatch(
    restartBranch,
    /liveNotDurable/,
    '「本机记不住」不许并进那三种 fail-closed 的「重新开始一次扫描」：'
      + '写不进去是这台机器的存储坏了 / 被禁用 / 写满，重建只会在同一处再失败一次，'
      + '还多留一条要撤的服务端任务 —— 给一颗按不出结果的按钮比不给更糟，用户会反复按',
  )
}
assert.match(
  scanSettingsView,
  /data-testid="scan-live-not-durable-notice"[\s\S]{0,400}?先别在面板上按开始/,
  '这一屏必须自己说出「任务建过、已经撤掉、现在别去面板」：'
    + '只显示 failure 正文的话，读屏的人分不清「没建成」和「建成了但本机记不住」',
)
assert.match(
  scanSettingsView,
  /liveNotDurable\s*\n?\s*\? '本机存储不可用，无法建会话'[\s\S]{0,300}?cleanupHolding \? '等本机收完上一场的尾' : '未创建扫描任务'/,
  '这一支上任务**建过**（随后被本页撤掉）：禁用按钮写死「未创建扫描任务」就是句假话，'
    + '必须按 liveNotDurable 分开说。\n'
    + '2026-09-15 再多一支：收尾闸挡住时本页**一个请求都没发**，'
    + '「未创建扫描任务」虽然不算错，却没说出为什么按不了，用户会以为是自己漏了一步。',
)

/* ── 收尾闸挡住时那一屏不许说成「会话创建失败」（2026-09-15 第五轮）───────────
 *
 * 成因在**上一位**身上，而这一刻本页一个创建请求都没发出去。说「会话创建失败」
 * 等于把一次根本没发生的请求说成失败了，还把责任说给了服务端 —— CLAUDE.md §9
 * 「不伪造能力」这条两头都犯。 */
assert.match(
  scanSettingsView,
  /cleanupHolding\s*\n?\s*\? \{ tone: 'warn' as const, label: '正在收上一场的尾' \}/,
  '状态条要说的是「在等上一场的回执」，不是「会话创建失败」：本页此刻没发过任何请求',
)
assert.match(
  scanSettingsView,
  /cleanupHolding\s*\n?\s*\? 'cleanup-holding'/,
  '这一屏要有自己的 data-state：混进 create-failed 的话，'
    + '视觉与证据链上再也分不出「没建成」和「还没轮到你建」',
)

/* ══ F. 清场收尾闸：确认之前不许换人（2026-09-15 第五轮 P1）══════════════════
 *
 * ## 修的是哪一个缺陷
 *
 * 清场（隐私空闲 / 屏保 / 退出 / 换人）此前是：发一次 fire-and-forget 的 keepalive
 * DELETE → 同步抹本机 → logout() → 一帧后 window.location.reload()。三件事一撞就漏：
 *   ① 那次 DELETE 在路上丢了（回执一律吞掉，本机永远不会知道）；
 *   ② 离开那一刻还在飞的那次 ACK **成功了**；
 *   ③ 重载把「ACK 回来之后补一次撤销」那段补偿代码连同执行环境一起干掉。
 * 服务端于是留下一条 `deliveryAckedAt` 非空、状态仍 waiting 的任务：60 秒未确认
 * 回收器收不到它，Agent 的 current-lease 看得见它 —— 一个可投递却没人看着的收件箱，
 * 活到自然过期，接走下一位在面板上扫出来的文件。跨用户串件。
 *
 * ## 下面钉的边界（少一条它就退回原样）
 *
 * 本地清场照旧**同步、立即、不等网络**；变的只是「把机器交给下一位」这一步。 */

/* 这一组钉的是**时序**，而 KioskPrivacyGuard 里解释时序的注释比代码还长（本来就该这样）。
 * 所以先剥注释：连注释一起判会让「把那几句挪个位置」只要注释没动就照样绿。 */
const privacyGuardCode = stripComments(privacyGuard)

// F1. 本机 PII 一个字节都不多留：清场那几句仍然同步跑在等待之前。
assert.match(
  privacyGuardCode,
  /setClearing\(true\)\s*\n\s*clearKioskSensitiveSession\(getToken\(\)\)\s*\n\s*logout\(\)[\s\S]{0,400}?hold\(\(\) => scheduleSanitizedDestination\(nextBoundary, destination\)\)/,
  '顺序不可调换：先 fail-closed 遮罩 + 同步清本机 + logout，**然后**才是等收尾。\n'
    + '把等待挪到清本机之前，就等于让上一位的 PII 在网络不好时多留在屏幕上几十秒 ——\n'
    + '那是拿一个隐私问题去换另一个隐私问题。',
)
// F2. 整页重载必须被按住 —— 它是杀掉 ACK 补偿的那一步。
assert.doesNotMatch(
  privacyGuardCode,
  /\n\s*scheduleSanitizedDestination\(nextBoundary, destination\)\s*\n/,
  '重载那一步只许走 hold(...)：裸调一次就把「等服务端确认」整条闸绕过去了',
)
// F3. 进屏保同样是换人。它不重载，但一样会把设置页（连同那段 ACK 补偿）拆掉，
//     而屏保页一被触摸就唤醒成一台可用的机器。
assert.match(
  privacyGuardCode,
  /hold\(\(\) => \{\s*\n\s*navigate\('\/screensaver', \{/,
  '进屏保也必须等收尾：那一刻服务端那条扫描任务必须已经收到确认',
)
// F4. 遮罩要如实说在等什么。没有这一块，屏幕上只剩一块吃掉所有触摸的黑板。
assert.match(clearingOverlay, /data-testid="session-guard-cleanup-hold"/)
assert.match(clearingOverlay, /data-testid="session-guard-cleanup-retry"/)
assert.match(
  clearingOverlay,
  /cleanup\.holding \? <CleanupHoldPanel status=\{cleanup\} \/> : null/,
  '收尾已经结束时这一块不许出现：那会把最常见的那条清场路径说成「有事没办完」',
)
// F5. 这一屏一个凭证、一个任务编号、一句服务端原文都不许出现（CLAUDE.md §11）：
//     27 寸竖屏摆在人才市场大厅，站在旁边的人和使用者看到的是同一块屏。
for (const leak of [/controlToken/, /scanTaskId/, /identityToken/, /status\.(?:message|detail)/]) {
  assert.doesNotMatch(clearingOverlay, leak, `清场遮罩里不许出现 ${leak} —— 旁边站着的人看的是同一块屏`)
}
assert.match(
  scanCleanupGate,
  /export type ScanCleanupOutcome = 'none' \| 'unreachable' \| 'server-error' \| 'rejected'/,
  '对外只给这四种收敛值：把服务端原文透出去，错误串就会直接上 27 寸大屏',
)

/* F6. 「确认了」只认服务端**亲口**说的那三种。这条是整条闸的判据本体：
 *     放宽任何一格，闸就从「等确认」退化成「等一会儿」。 */
assert.match(
  scanRevoke,
  /if \(res\.ok\) return \{ confirmed: true, reason: 'cancelled' \}/,
  '200 = 服务端刚把它 CAS 成 cancelled',
)
assert.match(
  scanRevoke,
  /if \(res\.status === 403 \|\| code === 'SCAN_TASK_FORBIDDEN'\) \{\s*\n\s*return \{ confirmed: false, reason: 'forbidden' \}/,
  '403 = 本机手里这份身份动不了那条任务，它可能仍是 waiting —— 绝不许当成清干净了',
)
assert.match(
  scanRevoke,
  /return \{ confirmed: false, reason: 'server-error' \}\s*\n\}/,
  '兜底必须是 confirmed:false：认不出的状态码一律按「服务端没给结论」，继续重试',
)
/* F7. 这条通道**必须等回执**，而上半条 fire-and-forget 的通道必须不等。
 *     两条判据相反，混在一起哪一条都守不住。 */
assert.match(
  stripComments(scanRevoke.slice(revokeChannelSplit)),
  /res = await fetch\(revokeUrl\(credentials\.scanTaskId\), \{[\s\S]{0,400}?\}\)/,
  '等回话那条通道必须 await fetch：拿不到回执就没有「确认」可言',
)
assert.doesNotMatch(
  stripComments(scanRevoke.slice(revokeChannelSplit)).replace(
    /export function sendUnloadRevokeBeacon[\s\S]*$/,
    '',
  ),
  /keepalive: true/,
  'requestConfirmedScanRevoke 不许带 keepalive：keepalive 的意义是「文档正在被拆掉也要发出去」，\n'
    + '而这条路径的全部前提恰恰是**先别拆文档**；它还受额外配额限制，拿回执反而更不可靠。\n'
    + '（pagehide 上那一发是例外，它就是为文档要没了准备的。）',
)

/* F8. 等待必然收敛：要么服务端确认，要么走到**服务端给的**那个有效期。
 *     没有这一条，网络坏掉时这台机器会永远停在清场屏上 —— 比它要防的问题更糟。 */
assert.match(
  scanCleanupGate,
  /function isNotLeasableByTime\(task: PendingTask\): boolean \{[\s\S]{0,300}?return Date\.now\(\) >= task\.expiresAt/,
  '自然过期这一支必须在：服务端的租约查询带 `expiresAt: { gt: now }`，过了这一刻它签不出租约了。\n'
    + '这是服务端给的事实，不是本机给自己的宽限 —— 换成任何一个本机拍脑袋的超时，闸就变成了摆设。',
)
assert.match(
  scanCleanupGate,
  /if \(expiresAt === null\) \{\s*\n\s*settledIds\.add\(scanTaskId\)\s*\n\s*revokeCreatedScanSession\(\{ scanTaskId, controlToken \}, identityToken\)/,
  '没有截止时刻的那一支（半残响应）只许退回尽力而为，**不许按住**：\n'
    + '本机拿不出任何收敛依据，按住就成了一块永远不放行的黑屏。\n'
    + '退回去是安全的 —— 凭据没落进登记就永远不会 ACK，而租约只签已确认的行。',
)

/* F9. 三处 fail-closed 都要接在同一条闸上，少一处那一处就是缺口。 */
assert.match(
  scanDeliveryAck,
  /if \(scanDeliveryAckBlocked\(\)\) \{\s*\n\s*return \{ ok: false, definitive: false, failure: SCAN_ACK_PENDING_FAILURE \}/,
  '收尾期间一个 ACK 都不许发：确认成功等于把一个没人看着的收件箱重新点亮。\n'
    + '并且不许判成 definitive —— 服务端一个字都没说过，页面不能据此把这一场撤掉',
)
assert.match(
  scanSettingsTeardown,
  /if \(scanCleanupInProgress\(\)\) return\s*\n\s*revokeCreatedScanSession\(credentials, refs\.createTokenRef\.current, intent\)/,
  '这一场已经交给收尾闸了（创建时就连同身份快照交了出去）：再发一次拿不到回执的 keepalive\n'
    + '既证明不了什么，也可能和闸里那次请求赛跑',
)
assert.match(
  scanCreateReplay,
  /if \(options\.shouldContinue && !options\.shouldContinue\(\)\) break\s*\n\s*options\.onReplay\?\.\(attempt \+ 1\)/,
  '收手判据必须问在**发出之前**：问在发出之后，清场屏还要再干等一整个退避窗口',
)
assert.match(
  scanSettings,
  /shouldContinue: \(\) => !scanCleanupInProgress\(\),/,
  '清场开始之后不再发新的重放：这一位已经走了，把 child 领回来没有意义，而重放最长 24 秒',
)
assert.match(
  scanSettings,
  /trackScanSessionCreation\(sessionPromiseRef\.current, identityToken\)/,
  '每一次创建都要连同**创建那一刻的身份快照**交给收尾闸：清场发生在创建在飞的那一刻时，\n'
    + '本机登记里还没有 live，闸从登记里读不到任何可撤的东西，而本页的 .then 会被整页重载杀掉',
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

const createReplayTest = spawnSync(
  process.execPath,
  ['--test', resolve(kioskRoot, 'scripts/tests/scan-create-replay.test.mjs')],
  { encoding: 'utf8' },
)
assert.equal(
  createReplayTest.status,
  0,
  `scan create replay behaviour test failed: ${createReplayTest.stderr || createReplayTest.stdout}`,
)

const deliveryAckTest = spawnSync(
  process.execPath,
  ['--test', resolve(kioskRoot, 'scripts/tests/scan-delivery-ack.test.mjs')],
  { encoding: 'utf8' },
)
assert.equal(
  deliveryAckTest.status,
  0,
  `scan delivery ack behaviour test failed: ${deliveryAckTest.stderr || deliveryAckTest.stdout}`,
)

/* 落地核对的「静默失败」那一支没法用文本断言证明：setItem 不抛、返回值也不变，
 * 只有真的装起来跑一遍、把写入掐掉，才看得出它判 false。 */
const durabilityTest = spawnSync(
  process.execPath,
  ['--test', resolve(kioskRoot, 'scripts/tests/scan-workbench-session-durability.test.mjs')],
  { encoding: 'utf8' },
)
assert.equal(
  durabilityTest.status,
  0,
  `scan workbench session durability test failed: ${durabilityTest.stderr || durabilityTest.stdout}`,
)

/* 上面那几条 assert.match 只能证明源码长这个样子；撤销的上限是**行为**
 * （发几次、带什么、失败怎么吞），所以真的把模块装起来跑一遍。 */
const revokeTest = spawnSync(
  process.execPath,
  ['--test', resolve(kioskRoot, 'scripts/tests/scan-session-revoke.test.mjs')],
  { encoding: 'utf8' },
)
assert.equal(
  revokeTest.status,
  0,
  `scan session revoke behaviour test failed: ${revokeTest.stderr || revokeTest.stdout}`,
)

/* 「确认之前不许换人」是一条时序判据：谁先跑、等了多久、什么时候放行 ——
 * 源码断言一条都证明不了。真把模块装起来，用假时钟把退避、自然过期、
 * 「等创建回话」的上限全走一遍。 */
const cleanupGateTest = spawnSync(
  process.execPath,
  ['--test', resolve(kioskRoot, 'scripts/tests/scan-cleanup-gate.test.mjs')],
  { encoding: 'utf8' },
)
assert.equal(
  cleanupGateTest.status,
  0,
  `scan cleanup gate behaviour test failed: ${cleanupGateTest.stderr || cleanupGateTest.stdout}`,
)

console.log('ALL PASS scan session truth contract')
