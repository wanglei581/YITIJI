// 合作机构后台「终端数据」：统计期内没上报心跳的终端不能说成「0 次 · 没有未恢复的故障」（CLAUDE.md §9）。
// 在沙箱里真跑 terminalOpsFormat.ts（导出与合计判定），再查卡片、抽屉、表格三处接线。

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
  new Script(out.outputText, { filename: rel }).runInContext(createContext({
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier in requireMap) return requireMap[specifier]
      throw new Error(`Unexpected module in ${rel}: ${specifier}`)
    },
  }))
  return module.exports
}

const csv = load('src/lib/csv.ts', {})
const shared = load('../../packages/shared/src/formatDateTime.ts', {})
const fmt = load('src/routes/terminals/terminalOpsFormat.ts', {
  '../../lib/csv': csv,
  '@ai-job-print/shared': shared,
})

const zeroFaults = { offlineCount: 0, offlineMinutes: 0, printerFaultCount: 0, printerFaultMinutes: 0, recoveredCount: 0, avgRecoveryMinutes: null, longestMinutes: null }
const output = { printed: 0, settled: 0, unconfirmed: 0, successRate: null }
const row = (code, reported, over = {}) => ({
  terminalId: code, terminalCode: code, displayName: null, locationLabel: null,
  online: reported, lastHeartbeatAt: reported ? '2026-09-29T08:00:00.000Z' : null,
  visitCount: 0, serviceCount: 0, output,
  faults: { ...zeroFaults, unrecovered: false, reportedInWindow: reported, ...over },
})
function view(rows) {
  const silent = rows.filter((r) => !r.faults.reportedInWindow).length
  return {
    dataMode: 'live', timezone: 'Asia/Shanghai', period: 'week',
    window: { from: '2026-09-22T16:00:00.000Z', to: '2026-09-29T16:00:00.000Z' },
    visitCount: { available: true, recordingStarted: true },
    aiAvailability: { available: false, reason: 'ai_calls_not_attributed_to_terminal' },
    terminals: rows,
    totals: {
      terminalCount: rows.length, onlineTerminals: rows.length - silent, unrecoveredTerminals: 0, silentTerminals: silent,
      visitCount: 0, serviceCount: 0, output, faults: zeroFaults,
    },
  }
}

const NOT = fmt.FAULTS_NOT_REPORTED
check('A0 常量是一句说明而不是数字', typeof NOT === 'string' && /没有上报/.test(NOT))

// 一台上报、一台静默
{
  const data = view([row('KSK-001', true), row('KSK-002', false)])
  const text = fmt.buildTerminalOpsCsv(data)
  const lines = text.split(/\r?\n/)
  const silentLine = lines.find((l) => l.includes('KSK-002')) ?? ''
  const reportedLine = lines.find((l) => l.includes('KSK-001')) ?? ''
  check('A1 静默终端导出行写明无法统计', silentLine.includes(NOT), silentLine)
  check('A2 静默终端导出行只在「统计期内有上报」一列写「否」（不说没有未恢复）', (silentLine.match(/"否"/g) ?? []).length === 1 && silentLine.endsWith('"否"'), silentLine)
  check('A3 上报过的终端仍导出真实计数', !reportedLine.includes(NOT) && /"0","0","0","0","0","","","否","是"$/.test(reportedLine), reportedLine)
  check('A3b 最后心跳走共享北京时间，UTC 08:00 显示为 16:00', reportedLine.includes('2026-09-29 16:00') && !reportedLine.includes('08:00'), reportedLine)
  check('A4 部分静默时合计仍可统计', fmt.totalsFaultsReported(data) === true)
}
// 全部静默
{
  const data = view([row('KSK-003', false), row('KSK-004', false)])
  const totalLine = fmt.buildTerminalOpsCsv(data).split(/\r?\n/).find((l) => /^"?合计/.test(l)) ?? ''
  check('A5 全部静默时合计判为无法统计', fmt.totalsFaultsReported(data) === false)
  check('A6 全部静默时导出合计行写明无法统计', totalLine.includes(NOT), totalLine)
}
check('A7 没有终端时合计判为无法统计', fmt.totalsFaultsReported(view([])) === false)
{
  const now = Date.parse('2026-06-20T01:03:00.000Z')
  const future = fmt.relativeTime('2099-01-01T00:00:00.000Z', now)
  const recent = fmt.relativeTime('2026-06-20T01:00:00.000Z', now)
  check('A8 未来心跳不写成刚刚，改为完整北京时间', future === '2099-01-01 08:00', future)
  check('A9 三分钟前仍是相对时间', recent === '3 分钟前', recent)
  check('A10 没有心跳仍写从未上报', fmt.relativeTime(null, now) === '从未上报')
}

// 页面接线
const cards = readFileSync(join(root, 'src/routes/terminals/TerminalOpsCards.tsx'), 'utf8')
const drawer = readFileSync(join(root, 'src/routes/terminals/TerminalOpsDrawer.tsx'), 'utf8')
const page = readFileSync(join(root, 'src/routes/terminals/index.tsx'), 'utf8')
check('B1 指标卡：合计无法统计时不显示计数', /!totalsFaultsReported\(data\) \?/.test(cards) && cards.includes('无法统计'))
check('B2 指标卡：部分静默时注明另有 N 台未计入', /totals\.silentTerminals > 0 &&/.test(cards) && cards.includes('未计入以上数字'))
check('B3 指标卡：有静默终端时不说「当前没有未恢复的故障」', cards.includes("totals.silentTerminals > 0 ? '已上报的终端当前没有未恢复的故障'"))
check('B4 抽屉：本终端没上报时不列 0 次', /!faults\.reportedInWindow \?/.test(drawer) && drawer.includes('FAULTS_NOT_REPORTED'))
for (const [id, heading] of [['offline', '离线'], ['printerFault', '打印机故障'], ['unrecovered', '未恢复']]) {
  const line = page.split('\n').find((source) => source.includes(`id: '${id}'`)) ?? ''
  check(`B5 ${heading}：未上报时显示短词并以 title 保留完整说明`,
    line.includes('title={FAULTS_NOT_REPORTED}>无法统计</span>'), line)
}
for (const heading of ['终端', '当前状态', '服务人次', '打印扫描次数', '出纸成功率', '未确认出纸', '离线', '打印机故障', '未恢复']) {
  check(`B6 业务列「${heading}」存在`, page.includes(`header: '${heading}'`))
}
check('B6 表格使用统一 ConsoleTable', page.includes('ConsoleTable'))

if (failures > 0) {
  console.error(`\n${failures} FAIL`)
  process.exit(1)
}
console.log('\nALL PASS: 终端数据不把「没上报」说成「没故障」')
