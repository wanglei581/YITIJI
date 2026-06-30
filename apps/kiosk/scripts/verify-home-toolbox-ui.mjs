/**
 * 首页百宝箱布局守卫。
 *
 * 约束：
 *   A. 首页渲染动态百宝箱模块，但默认关闭 / 空配置不占位。
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
const terminalConfig = read('src/services/api/terminalConfig.ts')
const packageJson = read('package.json')

console.log('\n=== 首页百宝箱布局验证 ===')

const toolboxRender = home.indexOf('<ToolboxSection />')
const smartCampusRender = home.indexOf('<SmartCampusHorizontalSection />')

if (
  home.includes('function ToolboxSection()') &&
  home.includes('if (!config.enabled || items.length === 0) return null') &&
  !home.includes('待配置') &&
  !home.includes('后续功能上线后将在这里展示')
) {
  pass('A. 首页百宝箱默认关闭或空配置时整块不渲染')
} else {
  fail('A. 首页百宝箱默认关闭或空配置时必须整块不渲染')
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
  home.includes('QrLaunchModal')
) {
  pass('C. 百宝箱从统一终端配置读取并支持站内 / 外部 H5 / 二维码启动方式')
} else {
  fail('C. 百宝箱统一终端配置或启动方式支持缺失')
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

if (terminalConfig.includes('toolbox: { enabled: false, items: [] }')) {
  pass('E. Kiosk OFF_CONFIG 默认关闭百宝箱')
} else {
  fail('E. Kiosk OFF_CONFIG 必须默认关闭百宝箱')
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
