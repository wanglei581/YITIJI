// verify-home-narrow-visual-balance · 首页原型外窄屏视觉合同
//
// 01-home 原型的 1080×1920 真值继续由 verify-home-prototype-v1 守护；
// 本守卫只约束生产窄屏的分组精确适配，并防止该适配反向破坏基础画布。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '')
let failures = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => {
  failures += 1
  console.error(`  FAIL ${message}`)
}
const expect = (condition, message) => (condition ? pass(message) : fail(message))

function skipComment(source, start) {
  const close = source.indexOf('*/', start + 2)
  return close < 0 ? source.length : close + 2
}
function skipString(source, start) {
  const quote = source[start]
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === quote) return index + 1
    index += 1
  }
  return source.length
}
function stripCssComments(source) {
  let result = ''
  let index = 0
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      index = skipComment(source, index)
      continue
    }
    if (source[index] === '"' || source[index] === "'") {
      const end = skipString(source, index)
      result += source.slice(index, end)
      index = end
      continue
    }
    result += source[index]
    index += 1
  }
  return result
}
// 花括号扫描忽略注释、单双引号字符串及所有反斜杠转义字符。
function matchingBrace(source, open) {
  if (source[open] !== '{') return -1
  let depth = 1
  let index = open + 1
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      index = skipComment(source, index)
      continue
    }
    if (source[index] === '"' || source[index] === "'") {
      index = skipString(source, index)
      continue
    }
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
    index += 1
  }
  return -1
}
// 只收集当前 source 顶层的块；规则体和 @media 体均作为整体跳过。
function topLevelBlocks(source) {
  const blocks = []
  let segmentStart = 0
  let parenDepth = 0
  let bracketDepth = 0
  let index = 0
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      index = skipComment(source, index)
      continue
    }
    if (source[index] === '"' || source[index] === "'") {
      index = skipString(source, index)
      continue
    }
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === '(') parenDepth += 1
    if (source[index] === ')') parenDepth = Math.max(0, parenDepth - 1)
    if (source[index] === '[') bracketDepth += 1
    if (source[index] === ']') bracketDepth = Math.max(0, bracketDepth - 1)

    if (source[index] === '{' && parenDepth === 0 && bracketDepth === 0) {
      const close = matchingBrace(source, index)
      if (close < 0) break
      const prelude = stripCssComments(source.slice(segmentStart, index)).trim()
      if (prelude) {
        blocks.push({
          prelude,
          body: source.slice(index + 1, close),
          start: segmentStart,
          open: index,
          close,
        })
      }
      segmentStart = close + 1
      index = close + 1
      parenDepth = 0
      bracketDepth = 0
      continue
    }
    if (source[index] === ';' && parenDepth === 0 && bracketDepth === 0) segmentStart = index + 1
    index += 1
  }
  return blocks
}
function splitSelectorList(prelude) {
  const source = stripCssComments(prelude)
  const selectors = []
  let start = 0
  let parenDepth = 0
  let bracketDepth = 0
  let index = 0
  while (index < source.length) {
    if (source[index] === '"' || source[index] === "'") {
      index = skipString(source, index)
      continue
    }
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === '(') parenDepth += 1
    if (source[index] === ')') parenDepth = Math.max(0, parenDepth - 1)
    if (source[index] === '[') bracketDepth += 1
    if (source[index] === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    if (source[index] === ',' && parenDepth === 0 && bracketDepth === 0) {
      selectors.push(source.slice(start, index).trim())
      start = index + 1
    }
    index += 1
  }
  selectors.push(source.slice(start).trim())
  return selectors.filter(Boolean)
}

const normalizeSelector = (selector) => selector.replace(/\s+/g, ' ').trim()
const normalizeCssValue = (value) => value.replace(/\s+/g, '')
const normalizeCssKeywordValue = (value) => normalizeCssValue(value).toLowerCase()
function cssRules(source) {
  return topLevelBlocks(source)
    .filter((block) => !block.prelude.trimStart().startsWith('@'))
    .map((block) => ({ ...block, selectors: splitSelectorList(block.prelude).map(normalizeSelector) }))
}
function mediaBlocks(source, condition) {
  const expected = `@media(${condition})`.replace(/\s+/g, '').toLowerCase()
  return topLevelBlocks(source).filter(
    (block) => block.prelude.replace(/\s+/g, '').toLowerCase() === expected,
  )
}
function findTopLevelColon(segment) {
  let parenDepth = 0
  let bracketDepth = 0
  let index = 0
  while (index < segment.length) {
    if (segment.startsWith('/*', index)) {
      index = skipComment(segment, index)
      continue
    }
    if (segment[index] === '"' || segment[index] === "'") {
      index = skipString(segment, index)
      continue
    }
    if (segment[index] === '\\') {
      index += 2
      continue
    }
    if (segment[index] === '(') parenDepth += 1
    if (segment[index] === ')') parenDepth = Math.max(0, parenDepth - 1)
    if (segment[index] === '[') bracketDepth += 1
    if (segment[index] === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    if (segment[index] === ':' && parenDepth === 0 && bracketDepth === 0) return index
    index += 1
  }
  return -1
}
function declarationFromSegment(segment) {
  const colon = findTopLevelColon(segment)
  if (colon < 0) return null
  const name = stripCssComments(segment.slice(0, colon)).trim()
  const value = stripCssComments(segment.slice(colon + 1)).trim()
  return name && value ? { name, value } : null
}
// 只读取规则体顶层声明；遇到 CSS nesting 块时整块跳过。
function topLevelDeclarations(body) {
  const declarations = []
  let segmentStart = 0
  let parenDepth = 0
  let bracketDepth = 0
  let index = 0
  const addSegment = (end) => {
    const declaration = declarationFromSegment(body.slice(segmentStart, end))
    if (declaration) declarations.push(declaration)
  }
  while (index < body.length) {
    if (body.startsWith('/*', index)) {
      index = skipComment(body, index)
      continue
    }
    if (body[index] === '"' || body[index] === "'") {
      index = skipString(body, index)
      continue
    }
    if (body[index] === '\\') {
      index += 2
      continue
    }
    if (body[index] === '(') parenDepth += 1
    if (body[index] === ')') parenDepth = Math.max(0, parenDepth - 1)
    if (body[index] === '[') bracketDepth += 1
    if (body[index] === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    if (body[index] === '{' && parenDepth === 0 && bracketDepth === 0) {
      const close = matchingBrace(body, index)
      if (close < 0) break
      segmentStart = close + 1
      index = close + 1
      continue
    }
    if (body[index] === ';' && parenDepth === 0 && bracketDepth === 0) {
      addSegment(index)
      segmentStart = index + 1
    }
    index += 1
  }
  addSegment(body.length)
  return declarations
}
// selector 必须是选择器列表中的完整成员；所有同名规则/声明按源码顺序合并取最终值。
function cascadedRule(source, targetSelectors) {
  const targets = new Set(targetSelectors.map(normalizeSelector))
  const matchingRules = cssRules(source).filter((rule) => rule.selectors.some((selector) => targets.has(selector)))
  const properties = new Map()
  for (const rule of matchingRules) {
    for (const declaration of topLevelDeclarations(rule.body)) {
      properties.set(declaration.name.toLowerCase(), declaration.value)
    }
  }
  return { count: matchingRules.length, property: (name) => properties.get(name.toLowerCase()) ?? '' }
}
const scopedSelectors = (group, selector) => [
  `.kpv1 .card[data-group-id='${group}'] ${selector}`,
  `.kpv1 .card[data-group-id="${group}"] ${selector}`,
]
const scopedRule = (source, group, selector) => cascadedRule(source, scopedSelectors(group, selector))

function propertyName(node, sourceFile) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  return node.getText(sourceFile)
}
function objectProperty(object, name, sourceFile) {
  return object?.properties.find(
    (property) => ts.isPropertyAssignment(property) && propertyName(property.name, sourceFile) === name,
  )
}
function stringValue(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null
}

function findServiceGroupsArray(sourceFile) {
  let result = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'SERVICE_GROUPS' &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      result = node.initializer
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return result
}

function groupTiles(group, sourceFile) {
  const tiles = objectProperty(group, 'tiles', sourceFile)
  return tiles && ts.isArrayLiteralExpression(tiles.initializer)
    ? tiles.initializer.elements.filter(ts.isObjectLiteralExpression)
    : []
}

function tileTitle(tile, sourceFile) {
  const title = objectProperty(tile, 'title', sourceFile)
  return title ? stringValue(title.initializer) : null
}

function disabledIsBooleanTrue(tile, sourceFile) {
  const disabled = objectProperty(tile, 'disabled', sourceFile)
  const initializer = disabled?.initializer
  return Boolean(
    initializer &&
      ts.isCallExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      initializer.expression.text === 'Boolean' &&
      initializer.arguments.length === 1 &&
      initializer.arguments[0].kind === ts.SyntaxKind.TrueKeyword,
  )
}

function serviceCardHasGroupIdAttribute(sourceFile) {
  let found = false
  const inspectServiceCard = (node) => {
    if (found) return
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'data-group-id') {
      const expression = node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : null
      if (
        expression &&
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'group' &&
        expression.name.text === 'id'
      ) {
        found = true
      }
    }
    ts.forEachChild(node, inspectServiceCard)
  }
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'ServiceCard') inspectServiceCard(node)
    if (!found) ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function jsxHasSoonTag(node, sourceFile) {
  let found = false
  const visit = (current) => {
    if (found) return
    if (ts.isJsxElement(current) && current.openingElement.tagName.getText(sourceFile) === 'span') {
      const className = current.openingElement.attributes.properties.find(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'className',
      )
      const hasClass = className?.initializer && ts.isStringLiteral(className.initializer) && className.initializer.text === 'tag-soon'
      const hasCopy = current.children.some((child) => ts.isJsxText(child) && child.text.includes('即将上线'))
      if (hasClass && hasCopy) found = true
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function hasConditionalSoonTag(sourceFile) {
  let found = false
  const visit = (node) => {
    if (found) return
    if (ts.isJsxExpression(node) && node.expression && ts.isBinaryExpression(node.expression)) {
      const expression = node.expression
      const guardedByDisabled =
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        ts.isPropertyAccessExpression(expression.left) &&
        ts.isIdentifier(expression.left.expression) &&
        expression.left.expression.text === 'tile' &&
        expression.left.name.text === 'disabled'
      if (guardedByDisabled && jsxHasSoonTag(expression.right, sourceFile)) found = true
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

console.log('\n=== 首页原型外窄屏视觉合同 ===')

const home = read('src/pages/home/HomePage.tsx')
const css = read('src/styles/prototype-v1.css')
const serviceGroups = read('src/pages/home/serviceGroups.ts')
const pkg = read('package.json')
const homeAst = ts.createSourceFile('HomePage.tsx', home, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const groupsAst = ts.createSourceFile('serviceGroups.ts', serviceGroups, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const packageJson = (() => {
  try { return JSON.parse(pkg) } catch { return null }
})()

expect(home.length > 0 && homeAst.parseDiagnostics.length === 0, 'HomePage.tsx 可读且可解析')
expect(css.length > 0, 'prototype-v1.css 可读')
expect(serviceGroups.length > 0 && groupsAst.parseDiagnostics.length === 0, 'serviceGroups.ts 可读且可解析')
expect(serviceCardHasGroupIdAttribute(homeAst), 'ServiceCard 暴露稳定 data-group-id={group.id}')

const narrowMedia = mediaBlocks(css, 'max-width:760px')
const narrow = narrowMedia.map((block) => block.body).join('\n')
expect(narrowMedia.length > 0, '可按词法安全块扫描提取 @media (max-width: 760px)')

const printGrid = scopedRule(narrow, 'print-scan', '.tiles.c5')
expect(printGrid.count > 0, '窄屏打印扫描网格使用 data-group-id 精确作用域')
expect(
  ['repeat(2,1fr)', 'repeat(2,minmax(0,1fr))'].includes(
    normalizeCssKeywordValue(printGrid.property('grid-template-columns')),
  ),
  '窄屏打印扫描网格最终值为两列',
)
expect(normalizeCssValue(printGrid.property('gap')) === '8px', '窄屏打印扫描网格最终 gap=8px')

const printTile = scopedRule(narrow, 'print-scan', '.tile.col')
expect(normalizeCssKeywordValue(printTile.property('flex-direction')) === 'row', '窄屏打印扫描 .tile.col 最终为横向排列')
expect(normalizeCssValue(printTile.property('min-height')) === '68px', '窄屏打印扫描 .tile.col 最终 min-height=68px')
expect(normalizeCssKeywordValue(printTile.property('text-align')) === 'left', '窄屏打印扫描 .tile.col 最终文字左对齐')

const printText = scopedRule(narrow, 'print-scan', '.tile.col .t-text')
expect(normalizeCssKeywordValue(printText.property('text-align')) === 'left', '窄屏打印扫描 .t-text 最终明确左对齐')

const printLast = scopedRule(narrow, 'print-scan', '.tile:last-child')
expect(normalizeCssValue(printLast.property('grid-column')) === '1/-1', '窄屏打印扫描最后一项最终通栏')

const jobFairPrimary = scopedRule(narrow, 'job-fairs', '.tile.primary')
expect(jobFairPrimary.count > 0, '窄屏招聘会 primary 使用 data-group-id 精确作用域')
expect(
  normalizeCssValue(jobFairPrimary.property('background')) ===
    'color-mix(insrgb,var(--pv-wheat-soft)72%,var(--pv-paper))',
  '窄屏招聘会 primary 使用批准的 --pv-wheat-soft 72% 轻背景',
)
expect(
  normalizeCssValue(jobFairPrimary.property('border-color')) ===
    'color-mix(insrgb,var(--pv-wheat)24%,transparent)',
  '窄屏招聘会 primary 使用批准的 --pv-wheat 24% 边框',
)

const narrowSelectors = cssRules(narrow).flatMap((rule) => rule.selectors)
expect(!narrowSelectors.some((selector) => /:nth-child\s*\(/i.test(selector)), '窄屏业务选择器不使用 :nth-child 定位')
expect(!narrowSelectors.some((selector) => selector.includes('.a-wheat')), '窄屏业务选择器不使用任何裸 .a-wheat 定位')

const mobileMedia = mediaBlocks(css, 'max-width:420px')
const mobile = mobileMedia.map((block) => block.body).join('\n')
const mobileSelectors = cssRules(mobile).flatMap((rule) => rule.selectors)
const lastNarrowIndex = narrowMedia.at(-1)?.open ?? -1
expect(mobileMedia.length > 0, '可按词法安全块扫描提取 @media (max-width: 420px)')
expect(mobileMedia.every((block) => block.open > lastNarrowIndex), '420px media 位于 760px media 之后')
for (const group of ['print-scan', 'job-fairs']) {
  const groupSelector = new RegExp(`\\[\\s*data-group-id\\s*=\\s*(?:['"]${group}['"]|${group})\\s*\\]`)
  expect(!mobileSelectors.some((selector) => groupSelector.test(selector)), `390px 核心视口不被 420px media 覆盖：${group}`)
}

const baseC5 = cascadedRule(css, ['.kpv1 .tiles.c5'])
const baseCol = cascadedRule(css, ['.kpv1 .tile.col'])
expect(normalizeCssKeywordValue(baseC5.property('grid-template-columns')) === 'repeat(5,1fr)', '1080 基础 .tiles.c5 保持五列')
expect(normalizeCssValue(baseCol.property('min-height')) === '90px', '1080 基础 .tile.col 保持 90px')

const serviceGroupsArray = findServiceGroupsArray(groupsAst)
const groups = serviceGroupsArray?.elements.filter(ts.isObjectLiteralExpression) ?? []
const printScanGroup = groups.find((group) => {
  const id = objectProperty(group, 'id', groupsAst)
  return id && stringValue(id.initializer) === 'print-scan'
})
const printScanTiles = groupTiles(printScanGroup, groupsAst)
const tileByTitle = (title) => printScanTiles.find((tile) => tileTitle(tile, groupsAst) === title)
expect(Boolean(printScanGroup), '可从 SERVICE_GROUPS AST 精确定位 print-scan 组')
for (const title of ['证件复印', '证件照打印']) {
  expect(disabledIsBooleanTrue(tileByTitle(title), groupsAst), `打印扫描组「${title}」保持 disabled: Boolean(true)`)
}
const allTiles = groups.flatMap((group) => groupTiles(group, groupsAst))
expect(allTiles.filter((tile) => disabledIsBooleanTrue(tile, groupsAst)).length === 2, 'SERVICE_GROUPS 仍仅有两个 Boolean(true) 禁用入口')
expect(!printScanTiles.some((tile) => tileTitle(tile, groupsAst) === '云打印'), '打印扫描组不含任意引号形式的「云打印」入口')
expect(hasConditionalSoonTag(homeAst), '「即将上线」标签绑定 tile.disabled && 条件渲染')
expect(
  packageJson?.scripts?.['verify:home-narrow-visual-balance'] ===
    'node scripts/verify-home-narrow-visual-balance.mjs',
  'package.json 注册窄屏视觉合同命令',
)

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项 — 首页原型外窄屏视觉合同未满足\n`)
  process.exit(1)
}

console.log('\nALL PASS — 首页原型外窄屏视觉合同满足\n')
