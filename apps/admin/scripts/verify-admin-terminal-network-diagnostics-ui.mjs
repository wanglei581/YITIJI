import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const page = readFileSync(join(root, 'src/routes/terminals/index.tsx'), 'utf8')
const detail = readFileSync(join(root, 'src/routes/terminals/TerminalDetailDrawer.tsx'), 'utf8')
const terminalUi = `${page}\n${detail}`
const componentPath = join(root, 'src/routes/terminals/TerminalNetworkDiagnostics.tsx')
const component = existsSync(componentPath) ? readFileSync(componentPath, 'utf8') : ''
const types = readFileSync(join(root, 'src/services/api/types.ts'), 'utf8')
// 2026-09-29：扫描输入的原因码中文表与 scanInputView 从终端页挪到共用词表，
// 终端 / 打印机 / 外设三个页签共用一份（外设页不另起词表）。断言随之改读词表文件，强度不变；
// 终端页仍须从词表引入并逐行渲染，外设页同样只读、不给远程解除入口。
const views = readFileSync(join(root, 'src/routes/terminals/terminalStatusViews.ts'), 'utf8')
const peripherals = readFileSync(join(root, 'src/routes/peripherals/index.tsx'), 'utf8')

assert.ok(component, 'network diagnostics component is missing')
assert.match(terminalUi, /TerminalNetworkDiagnostics/)
assert.match(terminalUi, /链路诊断/)
assert.match(component, /云端已连/)
assert.match(component, /网线已连/)
assert.match(component, /打印机可达/)
assert.match(component, /aria-label="只读网络链路诊断"/)
assert.match(component, /online \? wiredStatus\(wiredNetworkStatus\) : 'unknown'/)
assert.match(component, /online \? printerStatus\(printerNetworkStatus\) : 'unknown'/)
assert.doesNotMatch(component, /(?:密码|SSID|网关|printerHostAddress|ipAddress|localApiBridgeToken|agentToken|bindCode)/)
assert.doesNotMatch(terminalUi, /(?:updateNetwork|saveWifi|configureAdapter|setNetIPAddress)/)
assert.match(types, /wiredNetworkStatus/)
assert.match(types, /printerNetworkStatus/)

// ─── 扫描输入闸门遥测（Agent fail-closed 状态）────────────────────────────────
//
// 这一组是 2026-09-13 扫描隐私候选补的：Agent 锁死扫描输入之后，此前数据只走到
// AdminTerminalView 就停住了，后台一个像素都不渲染 —— 运维看不出这台机器的扫描
// 已经停了，只能等用户来投诉。下面把「看得见」钉死在既有终端表里，同时钉死
// 「只呈现、不远程解除」这条边界。
//
// 刻意不新开页面/路由：验收判据是运维在既有终端管理页上就能分辨
// healthy / locked_out / restart_required 并看到原因与时间。

assert.match(types, /scanInputHealth/, 'AdminTerminalRecord must carry scanInputHealth')
assert.match(types, /scanInputAction/, 'AdminTerminalRecord must carry scanInputAction')
assert.match(types, /scanInputReason/, 'AdminTerminalRecord must carry scanInputReason')
assert.match(types, /scanInputObservedAt/, 'AdminTerminalRecord must carry scanInputObservedAt')

// 表里要有这一列，并且要真的从记录里取值渲染（不是只加个表头）。
//
// 本脚本和同目录其它 verify-admin-*-ui.mjs 一样是**文本门禁**：它读源码、不执行组件。
// 所以它能钉住的是「这一列存在、取值来自记录、状态分得开、没有远程解除入口」，
// 钉不住「某个分支被改成了死代码」——那种改法字面量还在，文本门禁必然看不出来。
// 这一列目前没有可执行覆盖（admin 侧没有终端页的浏览器用例），这是已知边界。
assert.match(terminalUi, /'扫描输入'|>扫描输入</, 'the terminal detail drawer must expose 扫描输入')
assert.match(views, /export function scanInputView/, 'the shared vocabulary must derive a scan-input view')
assert.match(
  terminalUi,
  /import \{[^}]*\bscanInputView\b[^}]*\} from '\.\/terminalStatusViews'/,
  'the terminals page must take scanInputView from the shared vocabulary',
)
assert.match(terminalUi, /const scan = scanInputView\(terminal\)/, 'the scan-input view must be computed for the selected terminal')
// 算出来之后必须真的进 DOM：只算不渲染，运维照样什么都看不到。
assert.match(
  terminalUi,
  /data-testid="terminal-scan-input"[\s\S]{0,600}?StatusBadge dot status=\{scan\.badge\} label=\{scan\.label\}/,
  'the computed scan-input view must actually be rendered in the detail drawer',
)
assert.match(terminalUi, /\{scan\.detail &&/, 'the lockout reason must be rendered next to the badge')
assert.match(terminalUi, /\{scan\.restart &&/, 'restart_required must be rendered next to the badge')
assert.match(terminalUi, /terminal\.scanInputObservedAt &&/, 'the observation time must be rendered next to the badge')
assert.match(views, /t\.scanInputHealth/)
assert.match(views, /t\.scanInputAction/)
assert.match(views, /t\.scanInputReason/)
assert.match(terminalUi, /scanInputObservedAt/)

// 终端离线时，打印机与扫描输入只能显示中性的「终端离线」；若有离线前上报，
// 必须把原标签与相对时间放在小字里，并用完整北京时间作为悬停值，不能把旧值继续写成「正常」。
assert.match(detail, /function OfflineReportedStatus\(/)
assert.match(detail, /status="default" label="终端离线"/)
assert.match(detail, /离线前最后一次上报：/)
assert.match(detail, /formatRelativeTime\(observedAt\)/)
assert.match(detail, /title=\{observedAt \? formatDateTime\(observedAt\) : undefined\}/)
assert.match(detail, /terminal\.online \? <StatusBadge dot status=\{printer\.badge\}/)
assert.match(detail, /terminal\.online \? <><StatusBadge dot status=\{scan\.badge\}/)
assert.match(detail, /import \{[^}]*\bisParkedOrgType\b[^}]*\} from '\.\.\/partners\/orgTypeOptions'/)
assert.match(detail, /isParkedOrgType\(terminal\.orgType\)/)
assert.match(detail, /类型已停放，请改绑/)
assert.match(detail, /当前不可选/)
assert.doesNotMatch(detail, /const PARKED_ORG_TYPES\s*=/)

// 三种状态必须分得开，且缺数据时说「未上报」而不是「正常」——
// 把没测到说成健康，正是这条遥测要防的事。
assert.match(views, /'已锁死'/, 'locked_out must be rendered as a distinct state')
assert.match(views, /'未上报'/, 'missing telemetry must read as 未上报, never as healthy')
assert.match(views, /restart_required/, 'restart_required must be distinguishable')
assert.match(terminalUi, /需重启终端程序（Terminal Agent）恢复（不支持远程解除）/)
assert.match(views, /badge: 'error' as const,\s*\n\s*label: '已锁死'/, 'locked_out must not render as a neutral badge')

// 原因码走白名单中文表（枚举，不是自由文本），未知码原样显示，不拼接任意载荷。
assert.match(views, /SCAN_INPUT_REASON_LABELS/, 'reason codes must go through an enum label table')
for (const reason of ['root_identity_changed', 'watcher_error', 'readdir_failed', 'startup_incomplete']) {
  assert.match(views, new RegExp(`\\b${reason}\\b`), `reason code ${reason} must have a label`)
}
for (const [name, source] of [['terminals page', terminalUi], ['shared vocabulary', views], ['peripherals page', peripherals]]) {
  assert.doesNotMatch(
    source,
    /dangerouslySetInnerHTML|scanInputPayload|scanInputRaw|JSON\.stringify\(t\)/,
    `${name}: scan input telemetry must never be rendered as a raw arbitrary payload`,
  )
  // 闸门是 fail-closed 的隐私防线：后台只呈现，不给远程解除/放宽的入口。
  assert.doesNotMatch(
    source,
    /(?:unlockScanInput|resetScanInput|clearScanLockout|overrideScanInput|forceScanInput)/,
    `${name}: the admin console must not offer a remote way to release the scan input lockout`,
  )
}
// 外设页复用同一份词表，不另起一套扫描 / 打印机状态文案。
assert.match(peripherals, /from '\.\.\/terminals\/terminalStatusViews'/)
assert.doesNotMatch(peripherals, /SCAN_INPUT_REASON_LABELS\s*[:=]|PRINTER_STATUS_MAP\s*[:=]/)
console.log('ALL PASS: Admin renders enum-only, read-only terminal network + scan-input diagnostics')

// ─── 打印队列（只读；终端程序问 Windows 的原值）──────────────────────────────
const queueComponentPath = join(root, 'src/routes/terminals/TerminalPrinterQueue.tsx')
const queueViewPath = join(root, 'src/routes/terminals/printerQueueView.ts')
assert.ok(existsSync(queueComponentPath), 'printer queue component is missing')
assert.ok(existsSync(queueViewPath), 'printer queue view is missing')
const queueComponent = readFileSync(queueComponentPath, 'utf8')
const queueView = readFileSync(queueViewPath, 'utf8')
assert.match(detail, /TerminalPrinterQueue/)
assert.match(detail, /链路诊断[\s\S]{0,500}TerminalPrinterQueue/)
assert.match(detail, /online=\{terminal\.online\}/)
assert.match(queueComponent, /打印队列/)
assert.match(queueComponent, /终端程序问 Windows 得到的原值，用来分清是打印机、打印队列还是 Windows 打印服务出了问题；后台只看不改。/)
assert.match(queueComponent, /view\.current \?/)
assert.match(queueComponent, /离线前最后一次上报/)
assert.doesNotMatch(queueComponent, /describePrinterQueue\(\s*true/)
assert.doesNotMatch(`${queueComponent}\n${queueView}`, /密码|SSID|网关|printerHostAddress|ipAddress|agentToken|bindCode|fail-closed|printerStatus|Kiosk|Terminal Agent 心跳上报/)
assert.doesNotMatch(`${queueComponent}\n${queueView}`, /\b\d{1,3}(?:\.\d{1,3}){3}\b/)
assert.doesNotMatch(queueComponent, /地址/)

const queueJs = ts.transpileModule(queueView, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'printerQueueView.ts',
}).outputText
const queueModule = { exports: {} }
const queueContext = createContext({
  module: queueModule,
  exports: queueModule.exports,
  require(specifier) {
    throw new Error(`printerQueueView.ts must not import ${specifier}`)
  },
})
new Script(queueJs, { filename: 'printerQueueView.ts' }).runInContext(queueContext)
const { describePrinterQueue } = queueModule.exports
assert.equal(typeof describePrinterQueue, 'function')

const usbRunning = {
  printerQueueName: '前台',
  printerQueuePortKind: 'usb',
  printerQueuePortName: 'USB001',
  printerQueueRawStatus: '3,0,False,0,0',
  printerQueueSpooler: 'running',
}
const live = describePrinterQueue(true, usbRunning)
const liveText = `${live.portText}\n${live.spoolerLabel}\n${live.rawText}`
assert.match(liveText, /USB001（USB 直连）/)
assert.match(liveText, /正在运行/)
assert.match(liveText, /空闲/)
assert.equal(live.spoolerBadge, 'success')
assert.match(live.rawTitle, /PrinterStatus=3, DetectedErrorState=0, WorkOffline=False, PrinterState=0, ExtendedPrinterStatus=0/)

const stopped = describePrinterQueue(true, {
  ...usbRunning,
  printerQueueRawStatus: 'query_failed',
  printerQueueSpooler: 'stopped',
})
assert.match(`${stopped.spoolerLabel}\n${stopped.spoolerDetail}`, /已停止/)
assert.match(stopped.spoolerDetail, /现场/)
assert.equal(stopped.spoolerBadge, 'error')
assert.match(stopped.rawText, /查询打印机失败（Windows 打印服务可能没在运行）/)

const notFound = describePrinterQueue(true, { ...usbRunning, printerQueueRawStatus: 'not_found' })
assert.match(notFound.rawText, /Windows 里找不到这个打印队列（队列名可能被改过，或驱动没装好）/)

const missing = describePrinterQueue(true, null)
assert.match(missing.missing, /未上报（终端程序升级到新版本后才上报）/)

const offline = describePrinterQueue(false, usbRunning)
assert.equal(offline.current, false)
assert.equal(offline.statusLabel, '终端离线')
assert.equal(offline.portText, null)
assert.equal(offline.spoolerLabel, null)
assert.equal(offline.rawText, null)
assert.doesNotMatch(offline.statusLabel, /正在运行|USB001/)

console.log('ALL PASS: Admin printer queue view is read-only, hides stale reports while offline, and does not show an address')
