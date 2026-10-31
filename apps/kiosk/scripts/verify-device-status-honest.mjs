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
// 说明用无人值守标准句 3（copy/unattendedCopy.ts 的 machineUnusableLine，覆盖「暂停接单」），不写死，也不把人引向现场。
const QUEUE_GATE_NOTICE_CALL = 'printerNotice: machineUnusableLine()'
expectMatches(hookSrc, /import \{ machineUnusableLine \} from '\.\.\/copy\/unattendedCopy'/, 'hook 从无人值守文案模块取暂停接单说明')
if (/工作人员/.test(hookSrc)) fail('useTerminalDeviceStatus 不许出现「工作人员」：现场无人值守')
else pass('useTerminalDeviceStatus 不把人引向现场工作人员')
const hubPageSrc = read('src/pages/print-scan/PrintScanHomePage.tsx')
expectMatches(hubPageSrc, /device\.printer\.errorCode === 'paperEmpty'/, 'W-117 缺纸单独识别，不归入离线文案')
// 2026-10-28 触屏版第 5 版（稿 print / st-device-off）：状态由顶栏胶囊和卡片角标各说一次，提醒条只留标准句。
// 离线与异常的区别由真实设备状态词（device.printerLabel）承担，不再各写一句话；缺纸另有一版面（paperOff）。
// 断言随之改指新结构，强度不变：状态词写死、缺纸说明被删、求助不走服务电话，仍然会红。
expectMatches(
  hubPageSrc,
  /label:\s*device\.printerLabel,\s*notice:\s*machineCannotPrintLine\(contact\)/,
  'W-117 离线与异常的状态词取自真实设备状态，求助走服务电话（不找现场工作人员）',
)
expectMatches(hubPageSrc, /paperOff\s*=\s*hubState === 'device-off' && device\.printer\.errorCode === 'paperEmpty'/, 'W-117 缺纸只在确定缺纸时单独成版面，异常与离线不冒充缺纸')
const hubView = read('src/pages/print-scan/components/QxPrintHubView.tsx')
expectMatches(hubView, /打印机缺纸，这次出不了纸/, 'W-117 缺纸单独说明（稿 st-device-off）')
expectMatches(hubView, /transferCaps\.some\(\(item\) => item\.actionable\)/, 'W-117 「先传、稍后打印」只在传文件类入口真可用时才出现')
const uploadSrc = read('src/pages/print/PrintUploadPage.tsx')
const homeDomainSrc = read('src/pages/home/homeDomainStatus.ts')
const homeViewSrc = read('src/pages/home/components/HomeTouchView.tsx')
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
  if (!block.includes(QUEUE_GATE_NOTICE_CALL)) fail(`${status} 说明必须是「${QUEUE_GATE_NOTICE_CALL}」（无人值守标准句 3）`)
  else pass(`${status} 说明用无人值守标准句 3`)
}
// 服务联系方式（号码）比打印机状态晚到、或之后被后台改了：state 里存的是取状态那一刻算好的句子，
// hook 返回前必须按当前联系方式重算，否则要等下一次轮询（60 秒）才换，看起来就是「后台改了号码，一体机不认」。
// 读取归运行时根，hook 只订阅：页面停用 hook（enabled=false）时仍不发任何请求。
expectMatches(hookSrc, /import \{ useSupportContactSnapshot \} from '\.\/useSupportContact'/, 'hook 只读订阅服务联系方式')
expectMatches(hookSrc, /const notice = machineUnusableLine\(contact\)/, '暂停接单说明按当前联系方式重算')
expectMatches(
  hookSrc,
  /return useMemo\(\(\) => withLiveNotice\(view, contact\), \[view, contact\]\)/,
  'hook 返回的视图套用当前联系方式（号码晚到，说明不等下一次轮询）',
)
expectNotMatches(hookSrc, /loadSupportContact|refreshSupportContact/, 'hook 自己不读服务联系方式（读取归运行时根，停用时不发请求）')
const runtimeRootSrc = read('src/layouts/KioskRuntimeRoot.tsx')
expectMatches(runtimeRootSrc, /<SupportContactGuard\s*\/>/, '运行时根渲染服务联系方式守卫（没人读，说明里永远没有号码）')
expectMatches(
  runtimeRootSrc,
  /useEffect\(\(\) => startSupportContactKeeper\(\), \[\]\)/,
  '守卫挂载时读服务联系方式并续期，卸载时停',
)
expectMatches(
  hubPageSrc,
  /orderPaused \? device\.printerNotice/,
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
// 10/29 本机走查 I-31：首页对「打印机离线」「服务断了」不预告。壳层那一个 hook 读得更勤、请求有超时、
// 读不到就如实标 requestFailed；首页只递「马上重读」的信号（不自己起轮询），页头与打印磁贴在读不到时写「服务暂时连不上」，
// 并且不再说「上传与文件加工仍可用」（服务断了它们一样走不通）。
expectMatches(hookSrc, /const REFRESH_MS = 20_000/, 'hook 轮询 20 秒一次（原 60 秒：打印机掉线要等一分钟首页才知道）')
expectMatches(hookSrc, /const REQUEST_TIMEOUT_MS = 8_000/, 'hook 一次读状态最长等 8 秒，不回就当连不上')
expectMatches(
  hookSrc,
  /window\.setTimeout\(\(\) => request\.abort\(\), REQUEST_TIMEOUT_MS\)/,
  'hook 的超时真的会中断这次请求（不是只定义了常量）',
)
expectMatches(
  hookSrc,
  /catch \{[\s\S]{0,400}requestFailed: true/,
  '请求失败（网络不通、超时）标 requestFailed:true，不冒充「打印机离线」',
)
expectMatches(hookSrc, /export function requestDeviceStatusRefresh\(\): void/, 'hook 导出「马上重读」信号')
expectMatches(
  homeSrc,
  /import \{ requestDeviceStatusRefresh, type TerminalDeviceStatusView \} from '\.\.\/\.\.\/hooks\/useTerminalDeviceStatus'[\s\S]*useEffect\(\(\) => \{\s*requestDeviceStatusRefresh\(\)\s*\}, \[\]\)/,
  'HomePage 一挂上就递「马上重读」信号（人从别的页回来不等下一次轮询）',
)
expectMatches(
  homeSrc,
  /device\.requestFailed\s*\? \{ tone: 'warn' as const, label: '服务暂时连不上' \}/,
  'HomePage 读状态的请求没回来时页头写「服务暂时连不上」',
)
expectMatches(
  homeViewSrc,
  /const serviceDown = !device\.loading && device\.requestFailed === true/,
  '打印磁贴按 requestFailed 判服务连不上',
)
expectMatches(
  homeDomainSrc,
  /if \(input\.serviceDown\) \{\s*return \{\s*note: '服务暂时连不上 · 打印、扫描和传文件暂不开放'/,
  '服务连不上时打印磁贴说「打印、扫描和传文件暂不开放」（不沿用「上传与文件加工仍可用」）',
)
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
