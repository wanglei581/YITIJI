// 管理员后台「外设」页的状态推导门禁：在沙箱里真跑 peripheralViews.ts（连同它依赖的 terminalStatusViews.ts）。
//
// 锁住的行为（CLAUDE.md §9 不伪造能力）：
//   A. 只有「网线已连接」且「打印机可达或走 USB」才显示绿色「正常」；
//      Agent 报 unknown 显示「未知」、旧 Agent 不上报显示「未上报」，都用中性色，也不给「无需处理」。
//   B. 终端离线时，除 Terminal Agent 外每一项都给「先恢复终端连接」的建议，不落到「无需处理」。
//   C. 抽屉只在状态为正常时才兜底写「无需处理」；外设页刷新失败保留旧数据时必须明说。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
let failures = 0

function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS ${label}`)
  else {
    failures += 1
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function load(rel, requireMap) {
  const out = ts.transpileModule(readFileSync(join(root, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: rel,
  })
  const module = { exports: {} }
  const context = createContext({
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier in requireMap) return requireMap[specifier]
      throw new Error(`Unexpected module in ${rel}: ${specifier}`)
    },
  })
  new Script(out.outputText, { filename: rel }).runInContext(context)
  return module.exports
}

const statusViews = load('src/routes/terminals/terminalStatusViews.ts', {})
const views = load('src/routes/peripherals/peripheralViews.ts', { '../terminals/terminalStatusViews': statusViews })

const base = {
  id: 't-1',
  terminalCode: 'KSK-001',
  online: true,
  lastHeartbeatAt: '2026-09-29T08:00:00.000Z',
  agentVersion: '1.0.0',
  printerStatus: 'ready',
  scanInputHealth: 'ok',
  scanInputReason: null,
  scanInputObservedAt: null,
  wiredNetworkStatus: 'connected',
  printerNetworkStatus: 'reachable',
  localTaskDatabaseAvailable: true,
  diskFreeGb: 50,
}
const net = (patch) => views.networkView({ ...base, ...patch })
const item = (patch, key) => views.peripheralItems({ ...base, ...patch }).find((i) => i.key === key)

// ─── A. 网络判定 ─────────────────────────────────────────────────────────────
check('A1 网线已连接 + 打印机可达 → 正常', net({}).badge === 'success' && net({}).label === '正常')
check('A2 网线已连接 + 打印机走 USB → 正常并注明无网络链路',
  net({ printerNetworkStatus: 'not_network_printer' }).badge === 'success'
    && /USB/.test(net({ printerNetworkStatus: 'not_network_printer' }).reason ?? ''))
for (const [label, patch, expectLabel] of [
  ['网线 unknown', { wiredNetworkStatus: 'unknown' }, '未知'],
  ['打印机链路 unknown', { printerNetworkStatus: 'unknown' }, '未知'],
  ['网线未上报（旧 Agent）', { wiredNetworkStatus: null }, '未知'],
  ['两项都未上报（旧 Agent）', { wiredNetworkStatus: null, printerNetworkStatus: null }, '未上报'],
  ['无法识别的取值', { wiredNetworkStatus: 'weird' }, '未知'],
]) {
  const v = net(patch)
  check(`A3 ${label} → 中性色「${expectLabel}」、不算正常、给出处置建议`,
    v.badge === 'default' && v.label === expectLabel && typeof v.advice === 'string' && v.advice.length > 0,
    JSON.stringify(v))
  check(`A4 ${label} → 不计入「网络异常」也不冒充正常`, views.hasNetworkIssue({ ...base, ...patch }) === false && v.badge !== 'success')
}
check('A5 网线未连 → 异常', net({ wiredNetworkStatus: 'disconnected' }).badge === 'error' && views.hasNetworkIssue({ ...base, wiredNetworkStatus: 'disconnected' }))
check('A6 打印机不可达 → 异常', net({ printerNetworkStatus: 'unreachable' }).badge === 'error')
check('A7 原因里逐项写出未上报 / 未知',
  /网线：未上报/.test(net({ wiredNetworkStatus: null }).reason ?? '') && /打印机链路：未知/.test(net({ printerNetworkStatus: 'unknown' }).reason ?? ''))

// ─── B. 离线 ────────────────────────────────────────────────────────────────
{
  const offline = views.peripheralItems({ ...base, online: false })
  const nonAgent = offline.filter((i) => i.key !== 'agent')
  check('B1 离线时各项都给「先恢复终端连接」建议', nonAgent.every((i) => i.advice === views.OFFLINE_ITEM_ADVICE),
    JSON.stringify(nonAgent.map((i) => [i.key, i.advice])))
  check('B2 离线时各项都不是绿色', nonAgent.every((i) => i.badge !== 'success'))
  check('B3 离线时 Agent 一项给出检查建议', typeof offline.find((i) => i.key === 'agent')?.advice === 'string')
}
check('B4 在线且正常时网络项没有建议（抽屉才会写「无需处理」）', item({}, 'network').advice === null && item({}, 'network').badge === 'success')

// ─── C. 页面接线 ─────────────────────────────────────────────────────────────
const drawer = readFileSync(join(root, 'src/routes/peripherals/PeripheralDrawer.tsx'), 'utf8')
const page = readFileSync(join(root, 'src/routes/peripherals/index.tsx'), 'utf8')
check('C1 抽屉只在正常时兜底「无需处理」', drawer.includes("item.advice ?? (item.badge === 'success' ? '无需处理' : '—')") && !drawer.includes("item.advice ?? '无需处理'"))
check('C2 外设页刷新失败保留旧数据时明说', /staleAfterError = status === 'error' && terminals\.length > 0/.test(page) && page.includes('刷新失败，以下为上次成功获取的数据'))

if (failures > 0) {
  console.error(`\n${failures} FAIL`)
  process.exit(1)
}
console.log('\nALL PASS: 外设状态推导不把未知与未上报说成正常')
