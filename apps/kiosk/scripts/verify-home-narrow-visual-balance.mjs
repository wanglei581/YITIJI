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
  const matchingIndexes = []
  const properties = new Map()
  const importantProperties = new Set()
  rules.forEach((rule, index) => {
    if (!rule.selectors.some((selector) => targets.has(selector))) return
    matchingIndexes.push(index)
    for (const declaration of topLevelDeclarations(rule.body)) {
      properties.set(declaration.name.toLowerCase(), declaration.value)
      if (/!\s*important\s*$/i.test(declaration.value)) importantProperties.add(declaration.name.toLowerCase())
    }
  })
  return {
    count: matchingIndexes.length,
    matchingIndexes,
    importantProperties,
    property: (name) => properties.get(name.toLowerCase()) ?? '',
  }
}
const cascadedRule = (source, targetSelectors) => cascadedRules(cssRules(source), targetSelectors)
const scopedSelectors = (group, selector) => [
  `.kpv1 .card[data-group-id='${group}'] ${selector}`,
  `.kpv1 .card[data-group-id="${group}"] ${selector}`,
]
const scopedRule = (source, group, selector) => cascadedRule(source, scopedSelectors(group, selector))

const CONTRACT = {
  printGrid: { group: 'print-scan', accent: 'a-slate', selector: '.tiles.c5', kind: 'grid', properties: ['grid-template-columns', 'gap'] },
  printTile: { group: 'print-scan', accent: 'a-slate', selector: '.tile.col', kind: 'tile-col', properties: ['flex-direction', 'min-height', 'text-align'] },
  printText: { group: 'print-scan', accent: 'a-slate', selector: '.tile.col .t-text', kind: 'tile-text', properties: ['text-align'] },
  printLast: { group: 'print-scan', accent: 'a-slate', selector: '.tile:last-child', kind: 'tile-last', properties: ['grid-column'] },
  jobPrimary: { group: 'job-fairs', accent: 'a-wheat', selector: '.tile.primary', kind: 'tile-primary', properties: ['background', 'border-color'] },
  baseGrid: { group: null, accent: null, selector: '.kpv1 .tiles.c5', kind: 'grid', properties: ['grid-template-columns'] },
  baseCol: { group: null, accent: null, selector: '.kpv1 .tile.col', kind: 'tile-col', properties: ['min-height'] },
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
    case 'tile-last': return /:last-child(?![\w-])/.test(selector) && (tile || scoped)
    case 'tile-primary': return (tile && hasClass(selector, 'primary')) || (scoped && (tile || hasClass(selector, 'primary')))
    default: return false
  }
}

function potentialOverrides(rules, contract, cascade = null) {
  const exactIndexes = new Set(cascade?.matchingIndexes ?? [])
  const firstTarget = cascade?.matchingIndexes[0] ?? -1
  const properties = new Set(contract.properties.map((name) => name.toLowerCase()))
  return rules.flatMap((rule, index) => {
    if (exactIndexes.has(index)) return []
    if (!rule.selectors.some((selector) => selectorCouldAffect(selector, contract))) return []
    const declarations = topLevelDeclarations(rule.body).filter((declaration) =>
      properties.has(declaration.name.toLowerCase()) &&
      (index > firstTarget || /!\s*important\s*$/i.test(declaration.value)),
    )
    return declarations.map((declaration) => ({ rule, declaration }))
  })
}

const contractOverrideSafe = (rules, contract, cascade = null) =>
  !(cascade && contract.properties.some((name) => cascade.importantProperties.has(name.toLowerCase()))) &&
  potentialOverrides(rules, contract, cascade).length === 0

function mediaAppliesAt(block, width, height) {
  const query = block.prelude.replace(/\s+/g, '').toLowerCase()
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

  const repeated = cascadedRule(`${target} { gap: 10px } ${target}\n{ gap: 8px }`, [target])
  helperAssert(repeated.count === 2 && normalizeCssValue(repeated.property('gap')) === '8px', 'repeated rules use final value')

  for (const suffix of ['.wide { gap: 20px }', '.wide { gap: 20px !important }']) {
    const rules = cssRules(`${target} { gap: 8px } ${target}${suffix}`)
    const cascade = cascadedRules(rules, [target])
    helperAssert(potentialOverrides(rules, contract, cascade).length === 1, `more-specific override ${suffix}`)
  }
  const importantRules = cssRules(`${target} { gap: 8px } ${target} { gap: 20px !important }`)
  const important = cascadedRules(importantRules, [target])
  helperAssert(!contractOverrideSafe(importantRules, contract, important), 'same-selector important override')
  const earlierImportantRules = cssRules(`${target}.wide { gap: 20px !important } ${target} { gap: 8px }`)
  const earlierImportant = cascadedRules(earlierImportantRules, [target])
  helperAssert(!contractOverrideSafe(earlierImportantRules, contract, earlierImportant), 'earlier important override')

  const unrelated420 = cssRules(`[data-group-id='print-scan'] .t-text span { font-size: 11px }`)
  helperAssert(
    Object.values(CONTRACT).every((item) => potentialOverrides(unrelated420, item).length === 0),
    '420 unrelated property is allowed',
  )
  pass('CSS helper 内建自检：词法、重复规则、specific/important 覆盖与无关属性')
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
expect(serviceCardRootHasContract(homeAst), 'ServiceCard 返回根 section.card 暴露 data-group-id={group.id}')

const narrowMedia = mediaBlocks(css, 'max-width:760px')
const narrow = narrowMedia.map((block) => block.body).join('\n')
const narrowRules = cssRules(narrow)
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
expect(contractOverrideSafe(narrowRules, CONTRACT.printGrid, printGrid), '760px 后写/important 规则不覆盖打印扫描网格合同属性')

const printTile = cascadedRules(narrowRules, contractSelectors(CONTRACT.printTile))
expect(normalizeCssKeywordValue(printTile.property('flex-direction')) === 'row', '窄屏打印扫描 .tile.col 最终为横向排列')
expect(normalizeCssValue(printTile.property('min-height')) === '68px', '窄屏打印扫描 .tile.col 最终 min-height=68px')
expect(normalizeCssKeywordValue(printTile.property('text-align')) === 'left', '窄屏打印扫描 .tile.col 最终文字左对齐')
expect(contractOverrideSafe(narrowRules, CONTRACT.printTile, printTile), '760px 后写/important 规则不覆盖打印扫描 tile.col 合同属性')

const printText = cascadedRules(narrowRules, contractSelectors(CONTRACT.printText))
expect(normalizeCssKeywordValue(printText.property('text-align')) === 'left', '窄屏打印扫描 .t-text 最终明确左对齐')
expect(contractOverrideSafe(narrowRules, CONTRACT.printText, printText), '760px 后写/important 规则不覆盖打印扫描文字对齐')

const printLast = cascadedRules(narrowRules, contractSelectors(CONTRACT.printLast))
expect(normalizeCssValue(printLast.property('grid-column')) === '1/-1', '窄屏打印扫描最后一项最终通栏')
expect(contractOverrideSafe(narrowRules, CONTRACT.printLast, printLast), '760px 后写/important 规则不覆盖打印扫描末项通栏')

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
expect(contractOverrideSafe(narrowRules, CONTRACT.jobPrimary, jobFairPrimary), '760px 后写/important 规则不覆盖招聘会 primary 配色')

const narrowSelectors = narrowRules.flatMap((rule) => rule.selectors)
expect(!narrowSelectors.some((selector) => /:nth-child\s*\(/i.test(selector)), '窄屏业务选择器不使用 :nth-child 定位')
expect(!narrowSelectors.some((selector) => selector.includes('.a-wheat')), '窄屏业务选择器不使用任何裸 .a-wheat 定位')

const mobileMedia = mediaBlocks(css, 'max-width:420px')
const mobile = mobileMedia.map((block) => block.body).join('\n')
const mobileRules = cssRules(mobile)
const lastNarrowIndex = narrowMedia.at(-1)?.open ?? -1
expect(mobileMedia.length > 0, '可按词法安全块扫描提取 @media (max-width: 420px)')
expect(mobileMedia.every((block) => block.open > lastNarrowIndex), '420px media 位于 760px media 之后')
for (const [name, contract] of Object.entries(CONTRACT).filter(([name]) => !name.startsWith('base'))) {
  expect(contractOverrideSafe(mobileRules, contract), `390px 核心视口合同属性不被 420px media 覆盖：${name}`)
}

const rules1080 = rulesForViewport(css, 1080, 1920)
const baseC5 = cascadedRules(rules1080, contractSelectors(CONTRACT.baseGrid))
const baseCol = cascadedRules(rules1080, contractSelectors(CONTRACT.baseCol))
expect(normalizeCssKeywordValue(baseC5.property('grid-template-columns')) === 'repeat(5,1fr)', '1080 基础 .tiles.c5 保持五列')
expect(normalizeCssValue(baseCol.property('min-height')) === '90px', '1080 基础 .tile.col 保持 90px')
expect(contractOverrideSafe(rules1080, CONTRACT.baseGrid, baseC5), '1080 后写/important 适用规则不覆盖 c5 五列')
expect(contractOverrideSafe(rules1080, CONTRACT.baseCol, baseCol), '1080 后写/important 适用规则不覆盖 tile.col 90px')

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
