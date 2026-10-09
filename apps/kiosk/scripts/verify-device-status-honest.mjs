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
const confirmSrc = read('src/pages/print/PrintConfirmPage.tsx')
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

// 打印闸门合上：两个心跳值各走自己的 case，不掉进 default（default 是「状态未知」，入口不会停）。
// 2026-10-06：闸门说明改为渲染时的标准句 3（machineUnusableLine），不再把旧的找人句子冻在常量里。
// 缺纸 / 异常仍靠短标题分开；说明统一为标准句 2。缺纸传感器报不准，屏上不写「找人补纸」。
const hubPageSrc = read('src/pages/print-scan/PrintScanHomePage.tsx')
expectMatches(hookSrc, /case 'paper_empty':/, 'W-117 缺纸单独一条映射，不掉进离线')
expectMatches(hookSrc, /printerLabel: '打印机缺纸'/, 'W-117 缺纸短标题不说成离线')
expectMatches(hookSrc, /errorCode: 'paperEmpty'/, 'W-117 缺纸保留 paperEmpty，供其他页识别')
expectMatches(hookSrc, /printerLabel: '打印机异常'/, 'W-117 真实异常短标题不说成离线')
expectNotMatches(hubPageSrc, /找现场工作人员加纸|找人补纸|缺纸时一体机会自动停止接单/, 'W-117 缺纸不再叫人补纸，也不写自动停单')
expectMatches(hubPageSrc, /notice: machineCannotPrintLine\(contact\)/, 'W-117 出纸暂停说明用标准句 2')
const hubView = read('src/pages/print-scan/components/QxPrintHubView.tsx')
expectMatches(hubView, /capabilities\.filter\(\(item\) => item\.actionable/, 'W-117 提示条只声明真可用的服务')
expectMatches(hubView, /usableServices=.*usableServices/, 'W-117 可用服务进入设备异常提示条')
const uploadSrc = read('src/pages/print/PrintUploadPage.tsx')
const homeDomainSrc = read('src/pages/home/homeDomainStatus.ts')
const homeViewSrc = read('src/pages/home/components/QxHomeView.tsx')
for (const status of ['queue_cleanup_failed', 'queue_pause_failed']) {
  const marker = `case '${status}':`
  const idx = hookSrc.indexOf(marker)
  if (idx < 0) {
    fail(`mapTerminalPrinterStatus 缺少 ${status}`)
    continue
  }
  const slice = hookSrc.slice(idx, idx + 900)
  const retAt = slice.search(/return\s*\{/)
  const block = retAt < 0 ? '' : slice.slice(retAt, retAt + 520)
  if (!block) {
    fail(`${status} 没有映射 return`)
    continue
  }
  if (!/kind:\s*'error'/.test(block)) fail(`${status} kind 必须沿用 error`)
  else pass(`${status} kind=error`)
  if (!/printerReady:\s*false/.test(block)) fail(`${status} printerReady 必须是 false，打印入口才停`)
  else pass(`${status} printerReady=false`)
  if (!/deviceStatus:\s*'error'/.test(block)) fail(`${status} deviceStatus 必须是 error`)
  else pass(`${status} deviceStatus=error`)
  if (!block.includes("printerLabel: '暂停接单'")) fail(`${status} 入口短标题必须是「暂停接单」`)
  else pass(`${status} 文案「暂停接单」`)
  if (!block.includes('printerNotice: machineUnusableLine()')) fail(`${status} 说明必须在返回时调用 machineUnusableLine()，不能冻住旧的找人句子`)
  else pass(`${status} 说明调用 machineUnusableLine()`)
}
expectMatches(
  hubPageSrc,
  /orderPaused\s*\?\s*device\.printerNotice/,
  '打印扫描首页在闸门合上时用 printerNotice 作停用说明',
)
expectMatches(
  hubPageSrc,
  /unavailableBadge: orderPaused/,
  '打印扫描首页在闸门合上时入口短标题改为暂停接单',
)
expectMatches(
  hubPageSrc,
  /available: false/,
  '打印扫描首页停用卡保持 available:false',
)
expectMatches(uploadSrc, /device\.printerNotice/, '打印上传页展示暂停接单说明')
expectMatches(
  read('src/pages/print/file-source/FileSourceView.tsx'),
  /orderPausedNotice/,
  '上传页把暂停接单说明放到看得见的状态块（页头说明在本页只留给读屏）',
)
expectMatches(homeDomainSrc, /deviceNotice/, '首页说明接 printerNotice')
expectMatches(homeViewSrc, /device\.printerNotice/, '首页把 printerNotice 传给打印入口说明')

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
expectMatches(
  confirmSrc,
  /useTerminalDeviceStatus/,
  'PrintConfirmPage 消费 useTerminalDeviceStatus',
)
expectMatches(confirmSrc, /printerReady/, 'PrintConfirmPage 以 printerReady 门控放行')
expectMatches(confirmSrc, /打印机不可用/, 'PrintConfirmPage 打印机未就绪时主按钮中文禁用态')

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
