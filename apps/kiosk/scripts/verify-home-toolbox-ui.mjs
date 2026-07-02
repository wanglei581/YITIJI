/**
 * 首页百宝箱布局守卫。
 *
 * 约束：
 *   A. 首页固定渲染百宝箱模块，空配置保留待配置占位。
 *   B. 百宝箱必须排在智慧校园前面。
 *   C. 智慧校园保留终端开关隐藏逻辑，并能渲染后台投放应用项。
 *
 * 运行：pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

let failed = 0
function pass(msg) { console.log(`  PASS ${msg}`) }
function fail(msg) { console.error(`  FAIL ${msg}`); failed++ }

const home = read('src/pages/home/HomePage.tsx')
const launchModals = read('src/pages/home/components/ToolboxLaunchModals.tsx')
const terminalConfig = read('src/services/api/terminalConfig.ts')
const toolboxLaunchEvents = read('src/services/api/toolboxLaunchEvents.ts')
const packageJson = read('package.json')

console.log('\n=== 首页百宝箱布局验证 ===')

const toolboxRender = home.indexOf('<ToolboxSection />')
const smartCampusRender = home.indexOf('<SmartCampusHorizontalSection />')

if (
  home.includes('function ToolboxSection()') &&
  home.includes('if (!config.enabled) return null') &&
  !home.includes('items.length === 0) return null') &&
  home.includes('待配置') &&
  home.includes('后续功能上线后将在这里展示')
) {
  pass('A. 首页百宝箱默认启用且空配置保留待配置占位')
} else {
  fail('A. 首页百宝箱必须默认启用且空配置保留待配置占位')
}

if (toolboxRender >= 0 && smartCampusRender >= 0 && toolboxRender < smartCampusRender) {
  pass('B. 百宝箱渲染顺序在智慧校园之前')
} else {
  fail('B. 百宝箱必须排在智慧校园之前')
}

if (
  home.includes('getCachedKioskTerminalConfig(terminalId)') &&
  home.includes('terminalConfig.toolbox') &&
  home.includes('launchKioskAppItem') &&
  home.includes('QrLaunchModal') &&
  home.includes('ExternalLaunchModal') &&
  home.includes('onExternal(item)') &&
  launchModals.includes('function targetLabel') &&
  launchModals.includes('运营方声明目标') &&
  launchModals.includes('即将进入第三方服务') &&
  launchModals.includes('返回首页') &&
  launchModals.includes('role="dialog"') &&
  launchModals.includes("target.split('?')[0]") &&
  launchModals.includes('本终端不记录你在第三方页面的办理结果') &&
  launchModals.includes("action: 'show_qr'") &&
  launchModals.includes("action: 'open_external_notice'") &&
  launchModals.includes("action: 'open_external_confirmed'") &&
  launchModals.includes("action: 'cancel_external'") &&
  launchModals.includes('recordToolboxLaunchEventBeforeUnload')
) {
  pass('C. 百宝箱从统一终端配置读取并支持站内 / 外部 H5 / 二维码启动方式、扫码提示、外部离场确认和匿名事件上报')
} else {
  fail('C. 百宝箱统一终端配置、启动方式、扫码提示、外部离场确认或匿名事件上报缺失')
}

if (!home.includes('window.location.assign(item.externalUrl)')) {
  pass('C2. 百宝箱卡片点击不会直接整页跳出到第三方 H5')
} else {
  fail('C2. 百宝箱外部 H5 必须先展示离场提示,不得在 HomePage 点击时直接跳转')
}

if (
  home.includes('useSmartCampusConfig()') &&
  home.includes('if (!config.enabled || (enabledTiles.length === 0 && campusItems.length === 0)) return null') &&
  home.includes('config.items ?? []') &&
  home.includes('accent="blue"')
) {
  pass('D. 智慧校园保留终端开关隐藏逻辑并渲染后台投放应用项')
} else {
  fail('D. 智慧校园终端开关隐藏逻辑或投放项渲染缺失')
}

if (terminalConfig.includes('toolbox: { enabled: true, items: [] }')) {
  pass('E. Kiosk OFF_CONFIG 默认启用百宝箱空占位')
} else {
  fail('E. Kiosk OFF_CONFIG 必须默认启用百宝箱空占位')
}

if (
  toolboxLaunchEvents.includes('navigator.sendBeacon') &&
  toolboxLaunchEvents.includes('keepalive: true') &&
  toolboxLaunchEvents.includes("credentials: 'omit'") &&
  toolboxLaunchEvents.includes("API_MODE !== 'http'") &&
  toolboxLaunchEvents.includes('getTerminalId()') &&
  !toolboxLaunchEvents.includes('targetHost') &&
  !toolboxLaunchEvents.includes('externalUrl')
) {
  pass('E2. Kiosk 百宝箱事件上报使用 sendBeacon/keepalive 且不发送 URL/host')
} else {
  fail('E2. Kiosk 百宝箱事件上报必须可靠且不得发送 URL/host')
}

if (packageJson.includes('"verify:home-toolbox-ui"')) {
  pass('F. package.json 注册 verify:home-toolbox-ui')
} else {
  fail('F. package.json 缺少 verify:home-toolbox-ui')
}

console.log('')
if (failed > 0) {
  console.error(`FAIL ${failed} 项失败：首页百宝箱布局验证未通过\n`)
  process.exit(1)
}
console.log('ALL PASS：首页百宝箱布局符合预期\n')
