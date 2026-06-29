/**
 * 首页百宝箱布局守卫。
 *
 * 约束:
 *   A. 首页固定渲染百宝箱占位模块。
 *   B. 百宝箱必须排在智慧校园前面。
 *   C. 智慧校园仍按终端配置关闭时整块不渲染。
 *
 * 运行: pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = readFileSync(join(ROOT, 'src/pages/home/HomePage.tsx'), 'utf8')

let failed = 0
function pass(msg) { console.log(`  PASS ${msg}`) }
function fail(msg) { console.error(`  FAIL ${msg}`); failed++ }

console.log('\n=== 首页百宝箱布局验证 ===')

const toolboxComponent = home.indexOf('function ToolboxSection()')
const smartCampusComponent = home.indexOf('function SmartCampusHorizontalSection()')
const toolboxRender = home.indexOf('<ToolboxSection />')
const smartCampusRender = home.indexOf('<SmartCampusHorizontalSection />')

if (toolboxComponent >= 0 && home.includes('aria-label="百宝箱"') && home.includes('待配置')) {
  pass('A. 首页包含固定百宝箱占位模块')
} else {
  fail('A. 首页缺少百宝箱占位模块')
}

if (toolboxRender >= 0 && smartCampusRender >= 0 && toolboxRender < smartCampusRender) {
  pass('B. 百宝箱渲染顺序在智慧校园之前')
} else {
  fail('B. 百宝箱必须排在智慧校园之前')
}

if (
  smartCampusComponent >= 0 &&
  home.includes('useSmartCampusConfig()') &&
  home.includes('if (!config.enabled || enabledTiles.length === 0) return null')
) {
  pass('C. 智慧校园保留终端开关隐藏逻辑')
} else {
  fail('C. 智慧校园开关隐藏逻辑缺失或被改动')
}

console.log('')
if (failed > 0) {
  console.error(`FAIL ${failed} 项失败：首页百宝箱布局验证未通过\n`)
  process.exit(1)
}
console.log('ALL PASS：首页百宝箱布局符合预期\n')
