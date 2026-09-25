import { readFileSync } from 'node:fs'
import ts from 'typescript'

// ============================================================
// 源码「可见文字」读取器 —— 给文案类门禁用（首个消费方 verify-kiosk-ai-label-copy）。
//
// 判断「屏上写了什么」不能拿整份源码做 includes：注释会被当成可见文字，
// 常量引用（COMPLIANCE_COPY.X）又会被漏掉。这里按 TypeScript AST 取：
//   · 字符串字面量、模板串（插值里的共享文案常量会解析成取值）；
//   · JSX 文本（按 JSX 规则折行）与 JSX 元素拼起来的整段文字（子元素算在内，
//     「法律<b>意见</b>」拆开写也读得出来）；
//   · JSX 属性值；
//   · 对共享文案对象的引用（`SHARED_NAME.KEY`）与调用方登记的组件文字（如 <AigcMark />）。
// 注释不是 AST 节点，所以永远不算可见文字。
// ============================================================

export function parseSource(absolutePath) {
  const kind = absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'), ts.ScriptTarget.Latest, true, kind)
}

export function unwrap(expression) {
  let current = expression
  while (current && (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current))) {
    current = current.expression
  }
  return current
}

export function findConstInitializer(sourceFile, name) {
  let found = null
  const visit = (node) => {
    if (found) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found = node.initializer
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/** `export const NAME = { KEY: '…' } as const` → Map(KEY → 字符串)；取不到对象字面量返回 null。 */
export function stringObject(sourceFile, name) {
  const initializer = unwrap(findConstInitializer(sourceFile, name))
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) return null
  const map = new Map()
  for (const property of initializer.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) continue
    const value = unwrap(property.initializer)
    map.set(property.name.text, ts.isStringLiteralLike(value) ? value.text : null)
  }
  return map
}

/** JSX 文本按 JSX 规则折行：带换行的空白收成一个空格，首尾整行空白去掉。 */
export function normalizeJsxText(raw) {
  const lines = raw.split(/\r?\n/)
  if (lines.length === 1) return raw
  return lines
    .map((line, index) => {
      let text = line
      if (index > 0) text = text.replace(/^[ \t]+/, '')
      if (index < lines.length - 1) text = text.replace(/[ \t]+$/, '')
      return text
    })
    .filter((text) => text.length > 0)
    .join(' ')
}

export function jsxTagName(node) {
  const opening = ts.isJsxElement(node) ? node.openingElement : node
  return opening.tagName.getText()
}

/**
 * @param {Record<string, Map<string, string | null>>} shared 共享文案对象名 → 键值表
 * @returns 绑定这套共享文案的读取器；`componentText` 登记「渲染出来是一句固定文字」的组件（如 AigcMark）。
 */
export function createVisibleCopyReader(shared) {
  const componentText = new Map()

  function isSharedAccess(expression, objectName, key) {
    const node = unwrap(expression)
    return Boolean(
      node &&
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === objectName &&
        (key === undefined || node.name.text === key),
    )
  }

  function resolveText(expression, bindings = {}) {
    const node = unwrap(expression)
    if (!node) return null
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text
      for (const span of node.templateSpans) text += (resolveText(span.expression, bindings) ?? '') + span.literal.text
      return text
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && shared[node.expression.text]) {
      return shared[node.expression.text].get(node.name.text) ?? null
    }
    if (ts.isIdentifier(node) && Object.hasOwn(bindings, node.text)) return bindings[node.text]
    return null
  }

  function jsxTextContent(node, bindings) {
    if (ts.isJsxText(node)) return normalizeJsxText(node.text)
    if (ts.isJsxExpression(node)) return node.expression ? (resolveText(node.expression, bindings) ?? '') : ''
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) return node.children.map((child) => jsxTextContent(child, bindings)).join('')
    if (ts.isJsxSelfClosingElement(node)) return componentText.get(jsxTagName(node)) ?? ''
    return ''
  }

  /**
   * 收集一段源码（整文件或某个 JSX 子树）里用户看得到的文字。
   * - `units`：拼好的文字单元（整个 JSX 元素的文字、整条模板串、属性值…），用来判断「有没有」。
   *   同一处文字会出现在多个单元里（外层元素包含内层），所以**不能拿 units 计数**。
   * - `sites`：每个源码位置只记一次的叶子（字符串、模板片段、JSX 文本、共享文案引用、绑定常量、登记组件），
   *   用来判断「出现了几处」。
   * - `sharedRefs`：引用了哪些共享文案键（`OBJECT.KEY`）；`tags`：渲染了哪些 JSX 标签。
   */
  function collectVisible(root, bindings = {}) {
    const units = []
    const sites = []
    const sharedRefs = []
    const tags = []
    const site = (node, text) => {
      if (text) sites.push({ pos: node.getStart(), text })
    }
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        units.push(node.text)
        site(node, node.text)
      } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        site(node, node.text)
      } else if (ts.isTemplateExpression(node)) {
        units.push(resolveText(node, bindings) ?? '')
      } else if (ts.isJsxText(node)) {
        site(node, normalizeJsxText(node.text).trim())
      } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && shared[node.expression.text]) {
        sharedRefs.push(`${node.expression.text}.${node.name.text}`)
        const value = shared[node.expression.text].get(node.name.text)
        if (typeof value === 'string') {
          units.push(value)
          site(node, value)
        }
      } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
        units.push(jsxTextContent(node, bindings))
      } else if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const value = resolveText(node.initializer.expression, bindings)
        if (value) units.push(value)
      } else if (ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression) && Object.hasOwn(bindings, node.expression.text)) {
        units.push(bindings[node.expression.text])
        site(node, bindings[node.expression.text])
      }
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const name = node.tagName.getText()
        tags.push(name)
        const text = componentText.get(name)
        if (text) {
          units.push(text)
          site(node, text)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(root)
    return { units: units.filter((unit) => unit.length > 0), sites, sharedRefs, tags }
  }

  return { componentText, isSharedAccess, resolveText, collectVisible }
}

/**
 * 读 markdown 里某个加粗标题下面的第一张表。表头与期望列不一致、列数不齐或没有数据行都抛错
 * （调用方按 fail-closed 处理：解析不到就红，不静默放行）。
 * @returns {{ table: string, index: number, line: number, cells: string[] }[]} `index` 从 1 起，`line` 是文件行号。
 */
export function parseMarkdownTable(lines, heading, expectedColumns) {
  const headingIndex = lines.findIndex((line) => line.includes(heading))
  if (headingIndex === -1) throw new Error(`找不到表格标题 ${heading}`)
  let cursor = headingIndex + 1
  while (cursor < lines.length && !lines[cursor].startsWith('|')) cursor += 1
  const header = lines[cursor]?.split('|').slice(1, -1).map((cell) => cell.trim()) ?? []
  if (header.join('|') !== expectedColumns.join('|')) {
    throw new Error(`${heading} 表头变了（实测 ${header.join(' / ')}），先对齐门禁的列定义`)
  }
  const rows = []
  for (let lineIndex = cursor + 2; lineIndex < lines.length && lines[lineIndex].startsWith('|'); lineIndex += 1) {
    const cells = lines[lineIndex].split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length !== expectedColumns.length) throw new Error(`${heading} 第 ${rows.length + 1} 行列数不对（L${lineIndex + 1}）`)
    rows.push({ table: heading, index: rows.length + 1, line: lineIndex + 1, cells })
  }
  if (rows.length === 0) throw new Error(`${heading} 没有数据行`)
  return rows
}
