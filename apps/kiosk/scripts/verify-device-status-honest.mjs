import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:device-status-honest — Kiosk 设备状态去伪守卫（P0-2）
//
// 硬约束（CLAUDE.md §9 不伪造能力）：
// 1) PrintPreview 不得再内联 mapPrinterStatus / 假耗材 100% / fail-open default
// 2) PrintPreview / KioskRoot /（可选）KioskDeviceStatusPills 统一消费 useTerminalDeviceStatus
// 3) hook 必须走 API_BASE_URL + /terminals/:id/printer-status，禁止 /admin/*
// 4) mapTerminalPrinterStatus 的 default 不得返回 isOnline:true
// 5) HomePage 不得硬编码「打印机在线」「网络正常」（设备态由共享顶栏展示）
// 6) KioskRoot 不得 useState('idle') 英文徽标
// ============================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

let failures = 0
function pass(message) {
  console.log(`  PASS ${message}`)
}
function fail(message) {
  failures += 1
  console.error(`  FAIL ${message}`)
}
function expectMatches(source, pattern, message) {
  if (pattern.test(source)) pass(message)
  else fail(`${message} — pattern ${pattern} not found`)
}
function expectNotMatches(source, pattern, message) {
  if (!pattern.test(source)) pass(message)
  else fail(`${message} — forbidden pattern ${pattern} found`)
}

console.log('\n=== Kiosk 设备状态去伪守卫 ===')

const hookSrc = read('src/hooks/useTerminalDeviceStatus.ts')
const previewSrc = read('src/pages/print/PrintPreviewPage.tsx')
const homeSrc = read('src/pages/home/HomePage.tsx')
const warmOverrideSrc = read('src/styles/warm-professional-override.css')
const pillsSrc = read('src/components/KioskDeviceStatusPills.tsx')
const rootSrc = read('src/layouts/KioskRoot.tsx')

expectMatches(
  hookSrc,
  /export function mapTerminalPrinterStatus/,
  'hook 导出 mapTerminalPrinterStatus 纯函数',
)
expectMatches(
  hookSrc,
  /export function useTerminalDeviceStatus/,
  'hook 导出 useTerminalDeviceStatus',
)
expectMatches(
  hookSrc,
  /API_BASE_URL/,
  'hook fetch 使用 API_BASE_URL',
)
expectMatches(
  hookSrc,
  /\/terminals\/\$\{encodeURIComponent\(terminalId\)\}\/printer-status/,
  'hook 请求公开 printer-status 端点',
)
expectNotMatches(
  hookSrc,
  /fetch\([\s\S]{0,200}\/admin\//,
  'hook fetch 禁止请求 Admin 路径',
)
expectMatches(
  hookSrc,
  /禁止为此调用 Admin/,
  'hook 注释声明禁止 Admin 接口',
)
expectNotMatches(
  hookSrc,
  /black:\s*100|cyan:\s*100|magenta:\s*100|yellow:\s*100/,
  'hook 不得伪造耗材 100%',
)

// default 分支 fail-closed：定位 default: 后紧邻的 return 块不得含 isOnline: true
const defaultIdx = hookSrc.search(/default:\s*(?:\/\/[^\n]*\n\s*)*return\s*\{/)
if (defaultIdx < 0) {
  fail('mapTerminalPrinterStatus 缺少 default 分支 return')
} else {
  const slice = hookSrc.slice(defaultIdx, defaultIdx + 450)
  if (/isOnline:\s*true/.test(slice)) {
    fail('mapTerminalPrinterStatus default 不得返回 isOnline:true')
  } else if (/kind:\s*'unknown'/.test(slice) && /printerReady:\s*false/.test(slice)) {
    pass('mapTerminalPrinterStatus default 为 unknown + printerReady:false')
  } else {
    fail('mapTerminalPrinterStatus default 未明确 fail-closed（unknown + printerReady:false）')
  }
}

expectMatches(hookSrc, /tonerKnown:\s*false/, 'hook 声明 tonerKnown=false（Agent 未上报耗材）')
expectMatches(hookSrc, /网络正常/, 'hook 含「网络正常」文案（仅 API 可达时）')
expectMatches(hookSrc, /状态未知/, 'hook 含「状态未知」文案')

expectNotMatches(previewSrc, /function mapPrinterStatus/, 'PrintPreview 已删除内联 mapPrinterStatus')
expectNotMatches(previewSrc, /function usePrinterStatus/, 'PrintPreview 已删除内联 usePrinterStatus')
expectNotMatches(
  previewSrc,
  /black:\s*100|cyan:\s*100|magenta:\s*100|yellow:\s*100/,
  'PrintPreview 不得硬编码耗材 100%',
)
expectMatches(
  previewSrc,
  /useTerminalDeviceStatus/,
  'PrintPreview 消费 useTerminalDeviceStatus',
)
// 当前打印能力白名单仅开放黑白；PrintPreview 已删除彩色墨粉告警，不应为了满足
// 旧静态断言重新读取虚构的 0 值耗材。未来开放彩色时，再恢复 tonerKnown 门控。
expectNotMatches(
  previewSrc,
  /tonerKnown|tonerLevels|墨粉不足/,
  'PrintPreview 在仅黑白能力下不读取或推导未知耗材告警',
)
expectMatches(previewSrc, /printerReady/, 'PrintPreview 以 printerReady 门控放行')

expectNotMatches(
  homeSrc,
  /打印机在线[\s\S]{0,80}网络正常/,
  'HomePage 不得硬编码「打印机在线」+「网络正常」静态药丸',
)
for (const copy of ['文档打印就绪', '材料扫描就绪', '自动双面可用']) {
  expectNotMatches(homeSrc, new RegExp(copy), `HomePage 不得硬编码「${copy}」`)
}
expectMatches(
  homeSrc,
  /useOutletContext<TerminalDeviceStatusView>/,
  'HomePage 复用共享壳的真实设备状态',
)
expectNotMatches(
  homeSrc,
  /useTerminalDeviceStatus\s*\(/,
  'HomePage 不得再次启动独立设备状态轮询',
)
expectNotMatches(homeSrc, /function KioskTopBar/, 'HomePage 不再自绘顶栏（设备态由共享壳展示）')
expectMatches(
  warmOverrideSrc,
  /\.dc-dot\[data-state='ready'\]/,
  '暖色主题只有 ready 状态使用语义绿',
)
expectMatches(
  warmOverrideSrc,
  /\.dc-dot\[data-state='unavailable'\]/,
  '暖色主题为离线/异常状态提供非绿色状态点',
)

expectMatches(
  pillsSrc,
  /useTerminalDeviceStatus/,
  'KioskDeviceStatusPills 仍消费 useTerminalDeviceStatus（备用组件）',
)
expectNotMatches(pillsSrc, /\/admin\//, '状态药丸组件禁止 /admin/*')

expectMatches(rootSrc, /useTerminalDeviceStatus/, 'KioskRoot 消费 useTerminalDeviceStatus')
expectMatches(
  rootSrc,
  /useTerminalDeviceStatus\(\s*true\s*\)/,
  'KioskRoot 共享顶栏始终轮询真实设备状态（首页不再自绘顶栏）',
)
expectMatches(
  hookSrc,
  /export function useTerminalDeviceStatus\(enabled = true\)/,
  'hook 支持 enabled 门控',
)
expectMatches(hookSrc, /if\s*\(\s*!enabled\s*\)\s*return/, 'hook 停用时不发请求')
expectNotMatches(
  rootSrc,
  /useState<\s*DeviceStatus\s*>\(\s*['"]idle['"]\s*\)/,
  'KioskRoot 不得 useState(idle) 伪状态',
)
expectMatches(rootSrc, /printerLabel/, 'KioskRoot 顶栏使用中文 printerLabel')
expectMatches(
  rootSrc,
  /<Outlet context=\{deviceStatus\}\s*\/>/,
  'KioskRoot 向首页复用同一份设备状态',
)
expectNotMatches(
  rootSrc,
  /label=\{deviceStatus\}/,
  'KioskRoot 不得把英文 DeviceStatus 原样当徽标文案',
)

console.log('')
if (failures > 0) {
  console.error(`=== FAILED: ${failures} assertion(s) ===\n`)
  process.exit(1)
}
console.log('=== ALL PASS ===\n')
