import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  PASS ${message}`)
}

const home = read('src/pages/home/HomePage.tsx')
const terminalConfig = read('src/services/api/terminalConfig.ts')
const packageJson = read('package.json')

console.log('\n=== Kiosk 首页百宝箱 UI 验证 ===')

assert(home.includes('function ToolboxSection()'), 'HomePage 定义 ToolboxSection')
assert(home.includes('<ToolboxSection />'), '首页渲染百宝箱模块')
assert(home.indexOf('<ToolboxSection />') < home.indexOf('<SmartCampusHorizontalSection />'), '百宝箱位于智慧校园上方')
assert(home.includes('if (!config.enabled || items.length === 0) return null'), '百宝箱关闭或空配置时整块不渲染')
assert(!home.includes('待配置') && !home.includes('后续功能上线后将在这里展示'), '百宝箱不保留空配置占位')
assert(home.includes('getCachedKioskTerminalConfig(terminalId)') && home.includes('terminalConfig.toolbox'), '百宝箱从统一终端配置读取')
assert(home.includes('launchKioskAppItem') && home.includes('QrLaunchModal'), '百宝箱支持站内、外部 H5、二维码启动方式')
assert(home.includes('config.items ?? []') && home.includes('accent="blue"'), '智慧校园模块渲染后台投放应用项')
assert(terminalConfig.includes('toolbox: { enabled: false, items: [] }'), 'Kiosk OFF_CONFIG 默认关闭百宝箱')
assert(packageJson.includes('"verify:home-toolbox-ui"'), 'package.json 注册 verify:home-toolbox-ui')

console.log('\n✅ ALL PASS — Kiosk 首页百宝箱 UI 验证通过\n')
