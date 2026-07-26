// verify-home-narrow-visual-balance · 首页原型外窄屏视觉合同
//
// 01-home 原型的 1080×1920 真值继续由 verify-home-prototype-v1 守护；
// 本守卫只约束生产窄屏的分组精确适配，并防止该适配反向破坏基础画布。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '')

let failures = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => {
  failures += 1
  console.error(`  FAIL ${message}`)
}
const expect = (condition, message) => (condition ? pass(message) : fail(message))
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 从起点后的第一个左花括号开始按深度抽取完整块，避免正则越过嵌套
// @media 或相邻 CSS rule 后产生误命中。
function balancedBlock(source, start) {
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  if (open < 0) return ''

  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return ''
}

function mediaBlock(source, condition) {
  const match = new RegExp(`@media\\s*\\(\\s*${escapeRegExp(condition)}\\s*\\)`).exec(source)
  return match ? balancedBlock(source, match.index) : ''
}

function cssRule(source, selector) {
  for (const separator of [' {', '{']) {
    const start = source.indexOf(`${selector}${separator}`)
    if (start >= 0) return balancedBlock(source, start)
  }
  return ''
}

function property(rule, name) {
  const match = rule.match(new RegExp(`(?:^|[\\n{;])\\s*${escapeRegExp(name)}\\s*:\\s*([^;}]*)`))
  return match?.[1].trim() ?? ''
}

const normalizeCssValue = (value) => value.replace(/\s+/g, '').toLowerCase()
const scopedRule = (source, suffix) =>
  cssRule(source, `.kpv1 .card[data-group-id='${suffix.group}'] ${suffix.selector}`) ||
  cssRule(source, `.kpv1 .card[data-group-id="${suffix.group}"] ${suffix.selector}`)

console.log('\n=== 首页原型外窄屏视觉合同 ===')

const home = read('src/pages/home/HomePage.tsx')
const css = read('src/styles/prototype-v1.css')
const serviceGroups = read('src/pages/home/serviceGroups.ts')
const pkg = read('package.json')

expect(home.length > 0, 'HomePage.tsx 可读')
expect(css.length > 0, 'prototype-v1.css 可读')
expect(serviceGroups.length > 0, 'serviceGroups.ts 可读')
expect(home.includes('data-group-id={group.id}'), 'ServiceCard 暴露稳定 data-group-id={group.id}')

const narrow = mediaBlock(css, 'max-width: 760px')
expect(narrow.length > 0, '可按花括号深度抽取 @media (max-width: 760px)')

const printGrid = scopedRule(narrow, { group: 'print-scan', selector: '.tiles.c5' })
expect(printGrid.length > 0, '窄屏打印扫描网格使用 data-group-id 精确作用域')
expect(
  ['repeat(2,1fr)', 'repeat(2,minmax(0,1fr))'].includes(
    normalizeCssValue(property(printGrid, 'grid-template-columns')),
  ),
  '窄屏打印扫描网格为两列',
)
expect(normalizeCssValue(property(printGrid, 'gap')) === '8px', '窄屏打印扫描网格 gap=8px')

const printTile = scopedRule(narrow, { group: 'print-scan', selector: '.tile.col' })
expect(normalizeCssValue(property(printTile, 'flex-direction')) === 'row', '窄屏打印扫描 .tile.col 改为横向排列')
expect(normalizeCssValue(property(printTile, 'min-height')) === '68px', '窄屏打印扫描 .tile.col min-height=68px')
expect(normalizeCssValue(property(printTile, 'text-align')) === 'left', '窄屏打印扫描 .tile.col 文字左对齐')

const printText = scopedRule(narrow, { group: 'print-scan', selector: '.tile.col .t-text' })
expect(normalizeCssValue(property(printText, 'text-align')) === 'left', '窄屏打印扫描 .t-text 明确左对齐')

const printLast = scopedRule(narrow, { group: 'print-scan', selector: '.tile:last-child' })
expect(normalizeCssValue(property(printLast, 'grid-column')) === '1/-1', '窄屏打印扫描最后一项通栏')

const jobFairPrimary = scopedRule(css, { group: 'job-fairs', selector: '.tile.primary' })
const jobFairBackground = property(jobFairPrimary, 'background')
expect(jobFairPrimary.length > 0, '招聘会 primary 使用 data-group-id 精确作用域')
expect(
  /color-mix\([^;{}]*var\(--pv-wheat-soft\)[^;{}]*\)/.test(jobFairBackground),
  '招聘会 primary 使用含 --pv-wheat-soft 的 color-mix 轻背景',
)

expect(!/:nth-child\s*\(/.test(narrow), '窄屏业务样式不使用 :nth-child 定位')
expect(!/\.a-wheat(?=[\s.#:[,{])/.test(narrow), '窄屏业务样式不使用裸 .a-wheat 定位')

const beforeResponsive = css.slice(0, css.indexOf('@media (prefers-reduced-motion: reduce)'))
const baseC5 = cssRule(beforeResponsive, '.kpv1 .tiles.c5')
const baseCol = cssRule(beforeResponsive, '.kpv1 .tile.col')
expect(normalizeCssValue(property(baseC5, 'grid-template-columns')) === 'repeat(5,1fr)', '1080 基础 .tiles.c5 保持五列')
expect(normalizeCssValue(property(baseCol, 'min-height')) === '90px', '1080 基础 .tile.col 保持 90px')

expect(!/title:\s*'云打印'/.test(serviceGroups), '云打印入口保持删除')
expect((serviceGroups.match(/disabled:\s*Boolean\(true\)/g) ?? []).length === 2, 'SERVICE_GROUPS 保持两个 disabled 入口')
expect(home.includes('即将上线'), 'HomePage 保留禁用入口「即将上线」标签')
expect(
  pkg.includes('"verify:home-narrow-visual-balance": "node scripts/verify-home-narrow-visual-balance.mjs"'),
  'package.json 注册窄屏视觉合同命令',
)

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项 — 首页原型外窄屏视觉合同未满足\n`)
  process.exit(1)
}

console.log('\nALL PASS — 首页原型外窄屏视觉合同满足\n')
