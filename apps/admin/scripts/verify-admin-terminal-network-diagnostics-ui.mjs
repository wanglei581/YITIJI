import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const page = readFileSync(join(root, 'src/routes/terminals/index.tsx'), 'utf8')
const componentPath = join(root, 'src/routes/terminals/TerminalNetworkDiagnostics.tsx')
const component = existsSync(componentPath) ? readFileSync(componentPath, 'utf8') : ''
const types = readFileSync(join(root, 'src/services/api/types.ts'), 'utf8')

assert.ok(component, 'network diagnostics component is missing')
assert.match(page, /TerminalNetworkDiagnostics/)
assert.match(page, /链路诊断/)
assert.match(component, /云端已连/)
assert.match(component, /网线已连/)
assert.match(component, /打印机可达/)
assert.match(component, /aria-label="只读网络链路诊断"/)
assert.match(component, /online \? wiredStatus\(wiredNetworkStatus\) : 'unknown'/)
assert.match(component, /online \? printerStatus\(printerNetworkStatus\) : 'unknown'/)
assert.doesNotMatch(component, /(?:密码|SSID|网关|printerHostAddress|ipAddress|localApiBridgeToken|agentToken|bindCode)/)
assert.doesNotMatch(page, /(?:updateNetwork|saveWifi|configureAdapter|setNetIPAddress)/)
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
assert.match(page, /'扫描输入'/, 'the terminals table must have a 扫描输入 column')
assert.match(page, /function scanInputView/, 'the terminals page must derive a scan-input view')
assert.match(page, /const scanInput = scanInputView\(t\)/, 'the scan-input view must be computed per row')
// 算出来之后必须真的进 DOM：只算不渲染，运维照样什么都看不到。
assert.match(
  page,
  /data-testid="terminal-scan-input"[\s\S]{0,600}?StatusBadge dot status=\{scanInput\.badge\} label=\{scanInput\.label\}/,
  'the computed scan-input view must actually be rendered in that column',
)
assert.match(page, /\{scanInput\.detail &&/, 'the lockout reason must be rendered next to the badge')
assert.match(page, /\{scanInput\.restart &&/, 'restart_required must be rendered next to the badge')
assert.match(page, /\{t\.scanInputObservedAt &&/, 'the observation time must be rendered next to the badge')
assert.match(page, /t\.scanInputHealth/)
assert.match(page, /t\.scanInputAction/)
assert.match(page, /t\.scanInputReason/)
assert.match(page, /t\.scanInputObservedAt/)

// 三种状态必须分得开，且缺数据时说「未上报」而不是「正常」——
// 把没测到说成健康，正是这条遥测要防的事。
assert.match(page, /'已锁死'/, 'locked_out must be rendered as a distinct state')
assert.match(page, /'未上报'/, 'missing telemetry must read as 未上报, never as healthy')
assert.match(page, /restart_required/, 'restart_required must be distinguishable')
assert.match(page, /需重启 Agent 恢复（不支持远程解除）/)
assert.match(page, /badge: 'error' as const,\s*\n\s*label: '已锁死'/, 'locked_out must not render as a neutral badge')

// 原因码走白名单中文表（枚举，不是自由文本），未知码原样显示，不拼接任意载荷。
assert.match(page, /SCAN_INPUT_REASON_LABELS/, 'reason codes must go through an enum label table')
for (const reason of ['root_identity_changed', 'watcher_error', 'readdir_failed', 'startup_incomplete']) {
  assert.match(page, new RegExp(`\\b${reason}\\b`), `reason code ${reason} must have a label`)
}
assert.doesNotMatch(
  page,
  /dangerouslySetInnerHTML|scanInputPayload|scanInputRaw|JSON\.stringify\(t\)/,
  'scan input telemetry must never be rendered as a raw arbitrary payload',
)

// 闸门是 fail-closed 的隐私防线：后台只呈现，不给远程解除/放宽的入口。
assert.doesNotMatch(
  page,
  /(?:unlockScanInput|resetScanInput|clearScanLockout|overrideScanInput|forceScanInput)/,
  'the admin console must not offer a remote way to release the scan input lockout',
)
console.log('ALL PASS: Admin renders enum-only, read-only terminal network + scan-input diagnostics')
