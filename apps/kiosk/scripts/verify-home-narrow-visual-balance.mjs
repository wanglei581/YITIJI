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
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ruleFromBlock = (block) => ({
  ...block,
  selectors: splitSelectorList(block.prelude).map(normalizeSelector),
})
function cssRules(source) {
  return topLevelBlocks(source)
    .filter((block) => !block.prelude.trimStart().startsWith('@'))
    .map(ruleFromBlock)
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
function cascadedRules(rules, targetSelectors) {
  const targets = new Set(targetSelectors.map(normalizeSelector))
  let count = 0
  const properties = new Map()
  rules.forEach((rule) => {
    if (!rule.selectors.some((selector) => targets.has(selector))) return
    count += 1
    for (const declaration of topLevelDeclarations(rule.body)) {
      properties.set(declaration.name.toLowerCase(), declaration.value)
    }
  })
  return {
    count,
    property: (name) => properties.get(name.toLowerCase()) ?? '',
  }
}
const cascadedRule = (source, targetSelectors) => cascadedRules(cssRules(source), targetSelectors)
const scopedSelectors = (group, selector) => [
  `.kpv1 .card[data-group-id='${group}'] ${selector}`,
  `.kpv1 .card[data-group-id="${group}"] ${selector}`,
]

const CONTRACT = {
  printGrid: { group: 'print-scan', accent: 'a-slate', selector: '.tiles.c5', kind: 'grid', expected: { 'grid-template-columns': ['repeat(2,1fr)', 'repeat(2,minmax(0,1fr))'], gap: ['8px'] } },
  printTile: { group: 'print-scan', accent: 'a-slate', selector: '.tile.col', kind: 'tile-col', expected: { 'flex-direction': ['row'], 'min-height': ['68px'], 'text-align': ['left'] } },
  printText: { group: 'print-scan', accent: 'a-slate', selector: '.tile.col .t-text', kind: 'tile-text', expected: { 'text-align': ['left'] } },
  printDisabled: { group: 'print-scan', accent: 'a-slate', selector: '.tile.col.disabled', kind: 'tile-disabled', expected: { opacity: ['1'], background: ['var(--pv-surface)'], 'border-color': ['var(--pv-line)'] } },
  printLast: { group: 'print-scan', accent: 'a-slate', selector: '.tile:last-child', kind: 'tile-last', expected: { 'grid-column': ['1/-1'] } },
  jobPrimary: { group: 'job-fairs', accent: 'a-wheat', selector: '.tile.primary', kind: 'tile-primary', expected: { background: ['color-mix(insrgb,var(--pv-wheat-soft)72%,var(--pv-paper))'], 'border-color': ['color-mix(insrgb,var(--pv-wheat)24%,transparent)'] } },
  baseGrid: { group: null, accent: null, selector: '.kpv1 .tiles.c5', kind: 'grid', expected: { 'grid-template-columns': ['repeat(5,1fr)'] } },
  baseCol: { group: null, accent: null, selector: '.kpv1 .tile.col', kind: 'tile-col', expected: { 'min-height': ['90px'] } },
}

const contractSelectors = (contract) => contract.group
  ? scopedSelectors(contract.group, contract.selector)
  : [contract.selector]
const hasClass = (selector, className) => new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`).test(selector)
const hasGroup = (selector, group) => new RegExp(
  `\\[\\s*data-group-id\\s*=\\s*(?:['"]${escapeRegExp(group)}['"]|${escapeRegExp(group)})\\s*\\]`,
).test(selector)

function selectorCouldAffect(selector, contract) {
  const scoped = Boolean(
    (contract.group && hasGroup(selector, contract.group)) ||
    (contract.accent && hasClass(selector, contract.accent)),
  )
  const tile = hasClass(selector, 'tile')
  switch (contract.kind) {
    case 'grid': return (hasClass(selector, 'tiles') && hasClass(selector, 'c5')) || (scoped && (hasClass(selector, 'tiles') || hasClass(selector, 'c5')))
    case 'tile-col': return (tile && hasClass(selector, 'col')) || (scoped && (tile || hasClass(selector, 'col')))
    case 'tile-text': return hasClass(selector, 't-text') && ((tile && hasClass(selector, 'col')) || scoped)
    case 'tile-disabled': return (tile && hasClass(selector, 'disabled')) || (scoped && (tile || hasClass(selector, 'disabled')))
    case 'tile-last': return /:last-child(?![\w-])/.test(selector) && (tile || scoped)
    case 'tile-primary': return (tile && hasClass(selector, 'primary')) || (scoped && (tile || hasClass(selector, 'primary')))
    default: return false
  }
}

function matchingPair(source, open, opening, closing) {
  if (source[open] !== opening) return -1
  let depth = 1
  let index = open + 1
  while (index < source.length) {
    if (source.startsWith('/*', index)) { index = skipComment(source, index); continue }
    if (source[index] === '"' || source[index] === "'") { index = skipString(source, index); continue }
    if (source[index] === '\\') { index += 2; continue }
    if (source[index] === opening) depth += 1
    if (source[index] === closing && --depth === 0) return index
    index += 1
  }
  return -1
}
const addSpecificity = (left, right) => left.map((value, index) => value + right[index])
const maxSpecificity = (values) => values.reduce(
  (best, value) => compareSpecificity(value, best) > 0 ? value : best,
  [0, 0, 0],
)
const compareSpecificity = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}
function consumeIdentifier(source, start) {
  let index = start
  while (index < source.length) {
    if (source[index] === '\\') { index += 2; continue }
    if (!/[\w-]/.test(source[index]) && source.charCodeAt(index) < 128) break
    index += 1
  }
  return index
}
// 当前合同所需的 Selectors Level 4 specificity：ID / class+attr+pseudo / type+pseudo-element。
// :is()/:not()/:has() 取参数列表最大值，:where() 为零。
function selectorSpecificity(selector) {
  const source = stripCssComments(selector)
  let specificity = [0, 0, 0]
  let index = 0
  while (index < source.length) {
    if (source[index] === '\\') { index += 2; continue }
    if (source[index] === '#') { specificity[0] += 1; index = consumeIdentifier(source, index + 1); continue }
    if (source[index] === '.') { specificity[1] += 1; index = consumeIdentifier(source, index + 1); continue }
    if (source[index] === '[') {
      specificity[1] += 1
      const close = matchingPair(source, index, '[', ']')
      index = close < 0 ? source.length : close + 1
      continue
    }
    if (source[index] === ':') {
      const pseudoElement = source[index + 1] === ':'
      const nameStart = index + (pseudoElement ? 2 : 1)
      const nameEnd = consumeIdentifier(source, nameStart)
      const name = source.slice(nameStart, nameEnd).toLowerCase()
      const legacyElement = ['before', 'after', 'first-line', 'first-letter'].includes(name)
      if (source[nameEnd] === '(') {
        const close = matchingPair(source, nameEnd, '(', ')')
        const args = close < 0 ? '' : source.slice(nameEnd + 1, close)
        if (name !== 'where' && ['is', 'not', 'has'].includes(name)) {
          specificity = addSpecificity(specificity, maxSpecificity(splitSelectorList(args).map(selectorSpecificity)))
        } else if (name !== 'where') {
          specificity[pseudoElement || legacyElement ? 2 : 1] += 1
        }
        index = close < 0 ? source.length : close + 1
        continue
      }
      specificity[pseudoElement || legacyElement ? 2 : 1] += 1
      index = nameEnd
      continue
    }
    if (/[A-Za-z_\u0080-\uFFFF-]/.test(source[index])) {
      specificity[2] += 1
      index = consumeIdentifier(source, index)
      continue
    }
    index += 1
  }
  return specificity
}
const declarationImportance = (value) => ({
  important: /!\s*important\s*$/i.test(value),
  value: value.replace(/!\s*important\s*$/i, '').trim(),
})
function candidateWins(candidate, winner) {
  if (!winner) return true
  if (candidate.important !== winner.important) return candidate.important
  const specificityOrder = compareSpecificity(candidate.specificity, winner.specificity)
  return specificityOrder > 0 || (specificityOrder === 0 && candidate.order > winner.order)
}

function cascadeWinner(rules, contract, property) {
  let winner = null
  let order = 0
  for (const rule of rules) {
    const selectors = rule.selectors.filter((selector) => selectorCouldAffect(selector, contract))
    for (const declaration of topLevelDeclarations(rule.body)) {
      order += 1
      if (declaration.name.toLowerCase() !== property.toLowerCase()) continue
      const parsed = declarationImportance(declaration.value)
      for (const selector of selectors) {
        const candidate = { ...parsed, selector, specificity: selectorSpecificity(selector), order }
        if (candidateWins(candidate, winner)) winner = candidate
      }
    }
  }
  return winner
}

const winnerValue = (rules, contract, property) => cascadeWinner(rules, contract, property)?.value ?? ''
const contractWinnersMatch = (rules, contract) => Object.entries(contract.expected).every(
  ([property, approved]) => approved.includes(normalizeCssValue(winnerValue(rules, contract, property))),
)

function mediaAppliesAt(block, width, height) {
  const query = block.prelude.replace(/\s+/g, '').toLowerCase()
  if (/^@media(?:only)?print(?:and|\(|$)/.test(query) || /^@medianotscreen(?:and|\(|$)/.test(query)) return false
  if (query.includes('orientation:portrait') && width > height) return false
  if (query.includes('orientation:landscape') && height > width) return false
  const maxWidth = query.match(/max-width:(\d+(?:\.\d+)?)px/)
  const minWidth = query.match(/min-width:(\d+(?:\.\d+)?)px/)
  const exactWidth = query.match(/(?:@media|\()width:(\d+(?:\.\d+)?)px/)
  const exactHeight = query.match(/(?:@media|\()height:(\d+(?:\.\d+)?)px/)
  return (!maxWidth || width <= Number(maxWidth[1])) &&
    (!minWidth || width >= Number(minWidth[1])) &&
    (!exactWidth || width === Number(exactWidth[1])) &&
    (!exactHeight || height === Number(exactHeight[1]))
}

function rulesForViewport(source, width, height) {
  return topLevelBlocks(source).flatMap((block) => {
    if (!block.prelude.trimStart().startsWith('@')) return [ruleFromBlock(block)]
    if (block.prelude.trimStart().toLowerCase().startsWith('@media') && !mediaAppliesAt(block, width, height)) return []
    return rulesForViewport(block.body, width, height)
  })
}

function helperAssert(condition, message) {
  if (!condition) throw new Error(`CSS helper self-check failed: ${message}`)
}

function runHelperSelfChecks() {
  const contract = CONTRACT.printGrid
  const target = contractSelectors(contract)[0]
  const lexical = cascadedRule(`/* } { */ ${target} { content: "} {"; gap: 8px; }`, [target])
  helperAssert(lexical.count === 1 && normalizeCssValue(lexical.property('gap')) === '8px', 'comment/string braces')
  const gapWinner = (source) => normalizeCssValue(winnerValue(cssRules(source), contract, 'gap'))
  helperAssert(gapWinner(`${target} { gap: 10px } ${target}\n{ gap: 8px }`) === '8px', 'same specificity later wins')
  helperAssert(gapWinner(`${target}.wide { gap: 20px } ${target} { gap: 8px }`) === '20px', 'earlier more-specific wins')
  helperAssert(gapWinner(`${target} { gap: 8px } .kpv1 .tiles.c5 { gap: 20px }`) === '8px', 'later lower-specificity loses')
  for (const source of [
    `.kpv1 .tiles.c5 { gap: 20px !important } ${target} { gap: 8px }`,
    `${target} { gap: 8px } .kpv1 .tiles.c5 { gap: 20px !important }`,
  ]) helperAssert(gapWinner(source) === '20px', 'important wins in both source directions')
  helperAssert(gapWinner(`${target}.wide { gap: 20px } ${target} { gap: 8px !important }`) === '8px', 'important beats specificity')
  helperAssert(compareSpecificity(selectorSpecificity("section[data-x] .tile:last-child"), [0, 3, 1]) === 0, 'attribute/class/pseudo specificity')
  helperAssert(compareSpecificity(selectorSpecificity('section:not(.x, #winner)'), [1, 0, 1]) === 0, ':not() max specificity')
  helperAssert(compareSpecificity(selectorSpecificity('section:is(.x, [data-x])'), [0, 1, 1]) === 0, ':is() max specificity')
  helperAssert(gapWinner(`${target} { gap: 8px } [data-group-id='print-scan'] .t-text span { font-size: 11px }`) === '8px', '420 unrelated property allowed')
  pass('CSS helper 内建自检：词法、specificity、source order、important 与无关属性')
}

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

function findNamedFunction(sourceFile, name) {
  let result = null
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      result = node
      return
    }
    if (!result) ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return result
}

function findVariable(functionNode, name) {
  for (const statement of functionNode?.body?.statements ?? []) {
    if (!ts.isVariableStatement(statement)) continue
    const match = statement.declarationList.declarations.find(
      (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
    )
    if (match) return match
  }
  return null
}

const isIdentifierNamed = (node, name) => Boolean(node && ts.isIdentifier(node) && node.text === name)
const isStringNamed = (node, value) => Boolean(node && ts.isStringLiteralLike(node) && node.text === value)

function kioskShellContract(sourceFile) {
  const shellFunction = findNamedFunction(sourceFile, 'KioskShell')
  const statements = shellFunction?.body?.statements ?? []
  const viewportBinding = statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) =>
      ts.isObjectBindingPattern(declaration.name) &&
      declaration.name.elements.some((element) => element.name.text === 'viewportW') &&
      declaration.initializer &&
      ts.isCallExpression(declaration.initializer) &&
      isIdentifierNamed(declaration.initializer.expression, 'useKioskStageFit'),
    )
  const responsive = findVariable(shellFunction, 'isResponsiveHome')?.initializer
  const responsiveBoundary = Boolean(
    responsive &&
    ts.isBinaryExpression(responsive) &&
    responsive.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
    ts.isBinaryExpression(responsive.left) &&
    responsive.left.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    isIdentifierNamed(responsive.left.left, 'pathname') &&
    isStringNamed(responsive.left.right, '/') &&
    ts.isBinaryExpression(responsive.right) &&
    responsive.right.operatorToken.kind === ts.SyntaxKind.LessThanEqualsToken &&
    isIdentifierNamed(responsive.right.left, 'viewportW') &&
    ts.isNumericLiteral(responsive.right.right) &&
    responsive.right.right.text === '760',
  )
  const shell = findVariable(shellFunction, 'shell')?.initializer
  let shellExpression = shell
  while (shellExpression && ts.isParenthesizedExpression(shellExpression)) shellExpression = shellExpression.expression
  const layoutOpening = shellExpression && ts.isJsxElement(shellExpression) ? shellExpression.openingElement : null
  const viewportAttribute = layoutOpening ? jsxAttribute(layoutOpening, 'viewport', sourceFile) : null
  const viewportExpression = viewportAttribute?.initializer && ts.isJsxExpression(viewportAttribute.initializer)
    ? viewportAttribute.initializer.expression
    : null
  const responsiveViewport = Boolean(
    layoutOpening?.tagName.getText(sourceFile) === 'KioskLayout' &&
    viewportExpression &&
    ts.isConditionalExpression(viewportExpression) &&
    isIdentifierNamed(viewportExpression.condition, 'isResponsiveHome') &&
    isStringNamed(viewportExpression.whenTrue, 'mobile') &&
    isStringNamed(viewportExpression.whenFalse, 'kiosk'),
  )
  const classNameAttribute = layoutOpening ? jsxAttribute(layoutOpening, 'className', sourceFile) : null
  const classNameExpression = classNameAttribute?.initializer && ts.isJsxExpression(classNameAttribute.initializer)
    ? classNameAttribute.initializer.expression
    : null
  const responsiveHeight = Boolean(
    classNameExpression &&
    ts.isConditionalExpression(classNameExpression) &&
    isIdentifierNamed(classNameExpression.condition, 'isResponsiveHome') &&
    isIdentifierNamed(classNameExpression.whenTrue, 'undefined') &&
    isStringNamed(classNameExpression.whenFalse, 'h-full'),
  )
  const directHome = statements.some((statement) =>
    ts.isIfStatement(statement) &&
    isIdentifierNamed(statement.expression, 'isResponsiveHome') &&
    ts.isReturnStatement(statement.thenStatement) &&
    isIdentifierNamed(statement.thenStatement.expression, 'shell'),
  )
  const stagedFallback = statements.some((statement) => {
    if (!ts.isReturnStatement(statement)) return false
    let expression = statement.expression
    while (expression && ts.isParenthesizedExpression(expression)) expression = expression.expression
    if (!expression || !ts.isJsxElement(expression) || expression.openingElement.tagName.getText(sourceFile) !== 'KioskStageFit') return false
    return expression.children.some((child) =>
      ts.isJsxExpression(child) && isIdentifierNamed(child.expression, 'shell'),
    )
  })
  return { viewportBinding: Boolean(viewportBinding), responsiveBoundary, responsiveViewport, responsiveHeight, directHome, stagedFallback }
}

function jsxAttribute(opening, name, sourceFile) {
  return opening.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === name,
  )
}

function expressionHasClassToken(node, token) {
  let found = false
  const tokenPattern = new RegExp(`(^|\\s)${escapeRegExp(token)}(?=\\s|$)`)
  const textKinds = new Set([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
  ])
  const visit = (current) => {
    if (found) return
    if (textKinds.has(current.kind) && tokenPattern.test(current.text ?? '')) found = true
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function openingHasClass(opening, className, sourceFile) {
  const attribute = jsxAttribute(opening, 'className', sourceFile)
  if (!attribute?.initializer) return false
  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text.split(/\s+/).includes(className)
  }
  return ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression
    ? expressionHasClassToken(attribute.initializer.expression, className)
    : false
}

function serviceCardRootOpening(sourceFile) {
  const serviceCard = findNamedFunction(sourceFile, 'ServiceCard')
  const returnStatement = serviceCard?.body?.statements.find(ts.isReturnStatement)
  let expression = returnStatement?.expression
  while (expression && ts.isParenthesizedExpression(expression)) expression = expression.expression
  return expression && ts.isJsxElement(expression) ? expression.openingElement : null
}

function serviceCardRootHasContract(sourceFile) {
  const opening = serviceCardRootOpening(sourceFile)
  const className = opening ? jsxAttribute(opening, 'className', sourceFile) : null
  const classExpression = className?.initializer && ts.isJsxExpression(className.initializer)
    ? className.initializer.expression
    : null
  if (
    !opening ||
    opening.tagName.getText(sourceFile) !== 'section' ||
    !classExpression ||
    !expressionHasClassToken(classExpression, 'card')
  ) {
    return false
  }
  const attribute = jsxAttribute(opening, 'data-group-id', sourceFile)
  const expression = attribute?.initializer && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : null
  return Boolean(
    expression &&
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'group' &&
    expression.name.text === 'id',
  )
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

function tileButtonHasConditionalSoon(button, sourceFile) {
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
  visit(button)
  return found
}

function serviceCardHasConditionalSoonTag(sourceFile) {
  const serviceCard = findNamedFunction(sourceFile, 'ServiceCard')
  let found = false
  const visit = (node) => {
    if (found) return
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(sourceFile) === 'button' &&
      openingHasClass(node.openingElement, 'tile', sourceFile) &&
      tileButtonHasConditionalSoon(node, sourceFile)
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  if (serviceCard) visit(serviceCard)
  return found
}

function runAstHelperSelfChecks() {
  const parse = (source) => ts.createSourceFile('self-check.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const rootGood = parse("function ServiceCard(){return (<section className={'card'} data-group-id={group.id}></section>)}")
  const rootBad = parse("function ServiceCard(){return (<section className={'card'}><div data-group-id={group.id}/></section>)}")
  helperAssert(serviceCardRootHasContract(rootGood), 'ServiceCard root contract accepted')
  helperAssert(!serviceCardRootHasContract(rootBad), 'ServiceCard child data-group-id rejected')

  const soonGood = parse("function ServiceCard(){return (<section><button className={'tile'}>{tile.disabled && <span className=\"tag-soon\">即将上线</span>}</button></section>)}")
  const soonBad = parse("function ServiceCard(){return (<section>{tile.disabled && <span className=\"tag-soon\">即将上线</span>}</section>)}")
  helperAssert(serviceCardHasConditionalSoonTag(soonGood), 'tile button conditional soon tag accepted')
  helperAssert(!serviceCardHasConditionalSoonTag(soonBad), 'conditional soon tag outside tile button rejected')
  pass('AST helper 内建自检：ServiceCard 根属性与磁贴条件标签作用域')
}

runHelperSelfChecks()
runAstHelperSelfChecks()
console.log('\n=== 首页原型外窄屏视觉合同 ===')

const home = read('src/pages/home/HomePage.tsx')
const kioskRoot = read('src/layouts/KioskRoot.tsx')
const css = read('src/styles/prototype-v1.css')
const serviceGroups = read('src/pages/home/serviceGroups.ts')
const pkg = read('package.json')
const homeAst = ts.createSourceFile('HomePage.tsx', home, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const kioskRootAst = ts.createSourceFile('KioskRoot.tsx', kioskRoot, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const groupsAst = ts.createSourceFile('serviceGroups.ts', serviceGroups, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const packageJson = (() => {
  try { return JSON.parse(pkg) } catch { return null }
})()

expect(home.length > 0 && homeAst.parseDiagnostics.length === 0, 'HomePage.tsx 可读且可解析')
expect(kioskRoot.length > 0 && kioskRootAst.parseDiagnostics.length === 0, 'KioskRoot.tsx 可读且可解析')
expect(css.length > 0, 'prototype-v1.css 可读')
expect(serviceGroups.length > 0 && groupsAst.parseDiagnostics.length === 0, 'serviceGroups.ts 可读且可解析')
expect(serviceCardRootHasContract(homeAst), 'ServiceCard 返回根 section.card 暴露 data-group-id={group.id}')

const shellContract = kioskShellContract(kioskRootAst)
expect(shellContract.viewportBinding, 'KioskShell 复用 useKioskStageFit() 的 viewportW')
expect(shellContract.responsiveBoundary, '仅 pathname===\'/\' 且 viewportW<=760 进入首页手机分支')
expect(shellContract.responsiveViewport, '首页手机分支使用 mobile viewport，其余保持 kiosk viewport')
expect(shellContract.responsiveHeight, '首页手机分支不传 h-full，其余 staged 页保持 h-full')
expect(shellContract.directHome, '首页手机分支直接返回 KioskLayout shell')
expect(shellContract.stagedFallback, '其余路由与 1080 首页继续使用 KioskStageFit')

const narrowMedia = mediaBlocks(css, 'max-width:760px')
const narrow = narrowMedia.map((block) => block.body).join('\n')
const narrowRules = cssRules(narrow)
const rules390 = rulesForViewport(css, 390, 844)
expect(narrowMedia.length > 0, '可按词法安全块扫描提取 @media (max-width: 760px)')

const printGrid = cascadedRules(narrowRules, contractSelectors(CONTRACT.printGrid))
expect(printGrid.count > 0, '窄屏打印扫描网格使用 data-group-id 精确作用域')
expect(
  ['repeat(2,1fr)', 'repeat(2,minmax(0,1fr))'].includes(
    normalizeCssKeywordValue(printGrid.property('grid-template-columns')),
  ),
  '窄屏打印扫描网格最终值为两列',
)
expect(normalizeCssValue(printGrid.property('gap')) === '8px', '窄屏打印扫描网格最终 gap=8px')
expect(contractWinnersMatch(rules390, CONTRACT.printGrid), '390px 级联 winner 保持打印扫描两列与 8px gap')

const printTile = cascadedRules(narrowRules, contractSelectors(CONTRACT.printTile))
expect(normalizeCssKeywordValue(printTile.property('flex-direction')) === 'row', '窄屏打印扫描 .tile.col 最终为横向排列')
expect(normalizeCssValue(printTile.property('min-height')) === '68px', '窄屏打印扫描 .tile.col 最终 min-height=68px')
expect(normalizeCssKeywordValue(printTile.property('text-align')) === 'left', '窄屏打印扫描 .tile.col 最终文字左对齐')
expect(contractWinnersMatch(rules390, CONTRACT.printTile), '390px 级联 winner 保持 tile.col 横向、68px、左对齐')

const printText = cascadedRules(narrowRules, contractSelectors(CONTRACT.printText))
expect(normalizeCssKeywordValue(printText.property('text-align')) === 'left', '窄屏打印扫描 .t-text 最终明确左对齐')
expect(contractWinnersMatch(rules390, CONTRACT.printText), '390px 级联 winner 保持打印扫描文字左对齐')

const printDisabled = cascadedRules(narrowRules, contractSelectors(CONTRACT.printDisabled))
expect(normalizeCssValue(printDisabled.property('opacity')) === '1', '窄屏打印扫描 disabled 显式覆写 opacity=1')
expect(normalizeCssValue(printDisabled.property('background')) === 'var(--pv-surface)', '窄屏打印扫描 disabled 使用明确中性背景')
expect(normalizeCssValue(printDisabled.property('border-color')) === 'var(--pv-line)', '窄屏打印扫描 disabled 使用明确中性边界')
expect(contractWinnersMatch(rules390, CONTRACT.printDisabled), '390px 级联 winner 保持 disabled 不透明中性态')
const disabledTitle = cascadedRules(narrowRules, scopedSelectors('print-scan', '.tile.col.disabled .t-text b'))
const disabledDescription = cascadedRules(narrowRules, scopedSelectors('print-scan', '.tile.col.disabled .t-text span'))
const disabledStatus = cascadedRules(narrowRules, scopedSelectors('print-scan', '.tile.col.disabled .tag-soon'))
expect(normalizeCssValue(disabledTitle.property('color')) === 'var(--pv-ink)', 'disabled 标题显式使用可读中性色')
expect(normalizeCssValue(disabledDescription.property('color')) === 'var(--pv-muted)', 'disabled 说明显式使用可读中性色')
expect(normalizeCssValue(disabledStatus.property('color')) === 'var(--pv-muted)', 'disabled 状态标签显式使用可读中性色')

const printLast = cascadedRules(narrowRules, contractSelectors(CONTRACT.printLast))
expect(normalizeCssValue(printLast.property('grid-column')) === '1/-1', '窄屏打印扫描最后一项最终通栏')
expect(contractWinnersMatch(rules390, CONTRACT.printLast), '390px 级联 winner 保持打印扫描末项通栏')

const jobFairPrimary = cascadedRules(narrowRules, contractSelectors(CONTRACT.jobPrimary))
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
expect(contractWinnersMatch(rules390, CONTRACT.jobPrimary), '390px 级联 winner 保持招聘会批准配色')

const narrowSelectors = narrowRules.flatMap((rule) => rule.selectors)
expect(!narrowSelectors.some((selector) => /:nth-child\s*\(/i.test(selector)), '窄屏业务选择器不使用 :nth-child 定位')
expect(!narrowSelectors.some((selector) => selector.includes('.a-wheat')), '窄屏业务选择器不使用任何裸 .a-wheat 定位')

const mobileMedia = mediaBlocks(css, 'max-width:420px')
const lastNarrowIndex = narrowMedia.at(-1)?.open ?? -1
expect(mobileMedia.length > 0, '可按词法安全块扫描提取 @media (max-width: 420px)')
expect(mobileMedia.every((block) => block.open > lastNarrowIndex), '420px media 位于 760px media 之后')
const compact = mobileMedia.map((block) => block.body).join('\n')
const compactRules = cssRules(compact)
const compactRule = (...selectors) => cascadedRules(compactRules, selectors)
const compactValue = (rule, property) => normalizeCssValue(rule.property(property))

const mobileTopbar = compactRule("[data-kiosk-viewport='mobile'] .ui-kiosk-topbar")
expect(compactValue(mobileTopbar, 'padding') === '014px', '420px mobile 顶栏 padding=0 14px')
expect(compactValue(mobileTopbar, 'gap') === '8px', '420px mobile 顶栏 gap=8px')
const mobileBrand = compactRule("[data-kiosk-viewport='mobile'] .ui-kiosk-topbar__brand")
expect(compactValue(mobileBrand, 'flex') === '1', '420px mobile 品牌区 flex=1')
expect(compactValue(mobileBrand, 'min-width') === '0', '420px mobile 品牌区允许文字收缩')
const mobileBrandTitle = compactRule("[data-kiosk-viewport='mobile'] .ui-kiosk-topbar__brand b")
expect(compactValue(mobileBrandTitle, 'font-size') === '16px', '420px mobile 主标题字号=16px')
expect(compactValue(mobileBrandTitle, 'overflow') === 'hidden', '420px mobile 主标题隐藏溢出')
expect(compactValue(mobileBrandTitle, 'text-overflow') === 'ellipsis', '420px mobile 主标题使用 ellipsis')
expect(compactValue(mobileBrandTitle, 'white-space') === 'nowrap', '420px mobile 主标题不换行')
const mobileBrandSubtitle = compactRule("[data-kiosk-viewport='mobile'] .ui-kiosk-topbar__brand span")
const mobileClock = compactRule("[data-kiosk-viewport='mobile'] .ui-kiosk-topbar__clock")
expect(compactValue(mobileBrandSubtitle, 'display') === 'none', '420px mobile 隐藏品牌副标题')
expect(compactValue(mobileClock, 'display') === 'none', '420px mobile 隐藏时钟')
const mobileRight = compactRule("[data-kiosk-viewport='mobile'] .ui-kiosk-topbar__right")
expect(compactValue(mobileRight, 'flex') === 'none', '420px mobile 顶栏右侧 flex=none')
expect(compactValue(mobileRight, 'gap') === '0', '420px mobile 顶栏右侧 gap=0')
const mobileStatus = compactRule("[data-kiosk-viewport='mobile'] .k-status-chip")
expect(compactValue(mobileStatus, 'font-size') === '13px', '420px mobile 设备状态字号=13px')
expect(compactValue(mobileStatus, 'padding') === '6px10px', '420px mobile 设备状态 padding=6px 10px')
const mobileStatusDot = compactRule("[data-kiosk-viewport='mobile'] .k-status-chip__dot")
expect(compactValue(mobileStatusDot, 'width') === '8px' && compactValue(mobileStatusDot, 'height') === '8px', '420px mobile 设备状态点=8px')

const compactCard = compactRule('.kpv1 .groups .card')
expect(compactValue(compactCard, 'padding') === '16px', '420px 首页分组卡 padding=16px')
const compactCardHead = compactRule('.kpv1 .groups .card-head')
expect(compactValue(compactCardHead, 'gap') === '10px', '420px 首页组头 gap=10px')
const compactGroupIcon = compactRule('.kpv1 .groups .card-head .g-icon')
expect(compactValue(compactGroupIcon, 'width') === '44px' && compactValue(compactGroupIcon, 'height') === '44px', '420px 首页组头图标=44px')
const compactGroupTitle = compactRule('.kpv1 .groups .card-head h2')
expect(compactValue(compactGroupTitle, 'font-size') === '24px', '420px 首页组标题=24px')
const compactGroupSubtitle = compactRule('.kpv1 .groups .card-head .sub')
expect(compactValue(compactGroupSubtitle, 'font-size') === '15px', '420px 首页组副标题=15px')
const compactGroupCopy = compactRule('.kpv1 .groups .card-head > div')
expect(compactValue(compactGroupCopy, 'flex') === '1' && compactValue(compactGroupCopy, 'min-width') === '0', '420px 首页组标题容器可收缩')
const compactBadge = compactRule('.kpv1 .groups .card-head .badge')
expect(compactValue(compactBadge, 'font-size') === '13px' && compactValue(compactBadge, 'white-space') === 'nowrap', '420px 首页徽标=13px 且不换行')

for (const group of ['resume', 'jobs']) {
  const scope = `.kpv1 .card[data-group-id='${group}']`
  const grid = compactRule(`${scope} .tiles`)
  const tile = compactRule(`${scope} .tile`)
  const icon = compactRule(`${scope} .tile .t-icon`)
  const title = compactRule(`${scope} .tile .t-text b`)
  const description = compactRule(`${scope} .tile .t-text span`)
  const text = compactRule(`${scope} .tile .t-text`)
  expect(compactValue(grid, 'grid-template-columns') === 'repeat(2,1fr)', `420px ${group} 保持两列`)
  expect(Number.parseFloat(tile.property('min-height')) >= 72, `420px ${group} 磁贴高度不低于 72px`)
  expect(compactValue(tile, 'padding') === '8px' && compactValue(tile, 'gap') === '8px', `420px ${group} 磁贴 padding/gap=8px`)
  expect(compactValue(icon, 'width') === '38px' && compactValue(icon, 'height') === '38px', `420px ${group} 磁贴图标=38px`)
  expect(compactValue(title, 'font-size') === '17px', `420px ${group} 磁贴标题=17px`)
  expect(compactValue(description, 'font-size') === '12px', `420px ${group} 磁贴说明=12px`)
  expect(compactValue(text, 'min-width') === '0', `420px ${group} 磁贴文字可收缩`)
}
const compactSelectors = compactRules.flatMap((rule) => rule.selectors)
expect(!compactSelectors.includes('.kpv1 .tiles.c3'), '420px 两列规则不使用会串组的裸 .tiles.c3')

const compactContinue = compactRule('.kpv1 .continue')
expect(compactValue(compactContinue, 'margin-left') === '14px' && compactValue(compactContinue, 'margin-right') === '14px', '420px continue 左右 margin=14px')
expect(compactValue(compactContinue, 'display') === 'grid', '420px continue 改为 grid')
expect(compactValue(compactContinue, 'grid-template-columns') === '48pxminmax(0,1fr)', '420px continue 使用 48px+弹性文字列')
const compactContinueIcon = compactRule('.kpv1 .continue .c-icon')
expect(compactValue(compactContinueIcon, 'width') === '48px' && compactValue(compactContinueIcon, 'height') === '48px', '420px continue 图标=48px')
const compactContinueCopy = compactRule('.kpv1 .continue .c-copy')
expect(compactValue(compactContinueCopy, 'min-width') === '0', '420px continue 文字列可收缩')
const compactContinueTitle = compactRule('.kpv1 .continue .c-copy strong')
const compactContinueDescription = compactRule('.kpv1 .continue .c-copy p')
expect(compactValue(compactContinueTitle, 'font-size') === '18px', '420px continue 标题=18px')
expect(compactValue(compactContinueDescription, 'font-size') === '14px', '420px continue 正文=14px')
const compactContinueButton = compactRule('.kpv1 .continue .btn')
expect(compactValue(compactContinueButton, 'grid-column') === '1/-1', '420px continue 按钮下移后通栏')
expect(Number.parseFloat(compactContinueButton.property('min-height')) >= 56, '420px continue 按钮高度不低于 56px')

const compactPrintSoon = compactRule(".kpv1 .card[data-group-id='print-scan'] .tile.col.disabled .tag-soon")
expect(Number.parseFloat(compactPrintSoon.property('font-size')) >= 12, '420px 打印扫描即将上线标签字号不低于 12px')

const rules1080 = rulesForViewport(css, 1080, 1920)
const baseC5 = cascadedRules(rules1080, contractSelectors(CONTRACT.baseGrid))
const baseCol = cascadedRules(rules1080, contractSelectors(CONTRACT.baseCol))
expect(normalizeCssKeywordValue(baseC5.property('grid-template-columns')) === 'repeat(5,1fr)', '1080 基础 .tiles.c5 保持五列')
expect(normalizeCssValue(baseCol.property('min-height')) === '90px', '1080 基础 .tile.col 保持 90px')
expect(contractWinnersMatch(rules1080, CONTRACT.baseGrid), '1080 级联 winner 保持 c5 五列')
expect(contractWinnersMatch(rules1080, CONTRACT.baseCol), '1080 级联 winner 保持 tile.col 90px')

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
expect(serviceCardHasConditionalSoonTag(homeAst), 'ServiceCard 磁贴 button 内「即将上线」绑定 tile.disabled && 条件渲染')
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
