import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'

const HTML_COMMENT = /<!--[\s\S]*?-->/g
const HTML_TAG = /<([a-z][\w:-]*)\b([^<>]*?)>/gi
const HTML_REFERENCE_ATTRIBUTE = /(?:^|\s)(href|src)\s*=\s*(["'])(.*?)\2/gi
const HTML_VALUE_ATTRIBUTE = /(?:^|\s)value\s*=\s*(["'])(.*?)\1/i
const ROUTE_MANIFEST = /export const productionRoutePatterns = \[([\s\S]*?)\] as const/
const FUSION_MARKER = 'docs/design/kiosk-proto-2026-07-fusion'

export async function sha256File(filePath) {
  return await new Promise((resolveDigest, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveDigest(hash.digest('hex')))
  })
}

export function extractDeclaredRoutePatterns(source) {
  const sourceFile = ts.createSourceFile('routes.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const routes = []
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'path' &&
      ts.isStringLiteral(node.initializer)
    ) {
      const routePath = node.initializer.text
      routes.push(routePath === '/' || routePath.startsWith('/') ? routePath : `/${routePath}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return routes.sort()
}

function getPropertyAssignment(objectLiteral, propertyName) {
  return objectLiteral.properties.find((property) =>
    ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
    property.name.text === propertyName,
  )
}

function unwrapExpression(expression) {
  let current = expression
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function hasReplaceAttribute(element) {
  const replace = element.attributes.properties.find((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.text === 'replace',
  )
  if (!replace || !ts.isJsxAttribute(replace)) return false
  if (replace.initializer === undefined) return true
  return (
    ts.isJsxExpression(replace.initializer) &&
    replace.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword
  )
}

function assertUniqueRedirectSources(entries) {
  const sources = entries.map(([source]) => source)
  if (entries.length === new Set(sources).size) return
  const duplicateSources = [...new Set(
    sources.filter((source, index) => sources.indexOf(source) !== index),
  )].sort()
  throw new Error(`duplicate redirect source: ${duplicateSources.join(', ')}`)
}

export function extractDeclaredRedirects(source) {
  const sourceFile = ts.createSourceFile('routes.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const redirects = []
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const pathProperty = getPropertyAssignment(node, 'path')
      const elementProperty = getPropertyAssignment(node, 'element')
      if (
        pathProperty &&
        elementProperty &&
        ts.isStringLiteral(pathProperty.initializer)
      ) {
        const element = unwrapExpression(elementProperty.initializer)
        if (
          ts.isJsxSelfClosingElement(element) &&
          ts.isIdentifier(element.tagName) &&
          element.tagName.text === 'Navigate' &&
          hasReplaceAttribute(element)
        ) {
          const toAttribute = element.attributes.properties.find((attribute) =>
            ts.isJsxAttribute(attribute) && attribute.name.text === 'to',
          )
          if (
            toAttribute &&
            ts.isJsxAttribute(toAttribute) &&
            toAttribute.initializer &&
            ts.isStringLiteral(toAttribute.initializer)
          ) {
            const routePath = pathProperty.initializer.text
            redirects.push([
              routePath === '/' || routePath.startsWith('/') ? routePath : `/${routePath}`,
              toAttribute.initializer.text,
            ])
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assertUniqueRedirectSources(redirects)
  return Object.fromEntries(redirects.sort(([left], [right]) => left.localeCompare(right)))
}

export function extractManifestRedirects(source) {
  const sourceFile = ts.createSourceFile(
    'route-manifest.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue
    }
    const declaration = statement.declarationList.declarations.find((candidate) =>
      ts.isIdentifier(candidate.name) && candidate.name.text === 'compatibilityRedirects',
    )
    if (!declaration?.initializer) continue
    const initializer = unwrapExpression(declaration.initializer)
    if (!ts.isObjectLiteralExpression(initializer)) return {}
    const redirects = initializer.properties.flatMap((property) => {
      if (
        !ts.isPropertyAssignment(property) ||
        !ts.isStringLiteral(property.name) ||
        !ts.isStringLiteral(property.initializer)
      ) {
        return []
      }
      return [[property.name.text, property.initializer.text]]
    })
    assertUniqueRedirectSources(redirects)
    return Object.fromEntries(redirects.sort(([left], [right]) => left.localeCompare(right)))
  }
  return {}
}

export function extractManifestRoutePatterns(source) {
  const body = source.match(ROUTE_MANIFEST)?.[1]
  if (!body) return []
  return [...body.matchAll(/(['"])(.*?)\1/g)]
    .map((match) => match[2])
    .filter((routePath, index, routes) => routes.indexOf(routePath) === index)
    .sort()
}

export async function collectMissingLocalReferences(htmlPath) {
  const html = await readFile(htmlPath, 'utf8')
  const references = []
  for (const tagMatch of html.replace(HTML_COMMENT, '').matchAll(HTML_TAG)) {
    const tag = tagMatch[1].toLowerCase()
    for (const attributeMatch of tagMatch[2].matchAll(HTML_REFERENCE_ATTRIBUTE)) {
      references.push({
        tag,
        attribute: attributeMatch[1].toLowerCase(),
        reference: attributeMatch[3],
      })
    }
  }
  const localReferences = references.filter(({ tag, attribute, reference }) =>
    !reference.startsWith('//') &&
    !(tag === 'a' && attribute === 'href' && reference.startsWith('/')) &&
    !reference.startsWith('#') &&
    !reference.startsWith('data:') &&
    !reference.startsWith('http://') &&
    !reference.startsWith('https://') &&
    !reference.startsWith('mailto:') &&
    !reference.startsWith('javascript:'),
  )
  const missing = []
  for (const { reference } of localReferences) {
    const pathOnly = reference.split('#')[0].split('?')[0]
    if (!pathOnly) continue
    const localPath = pathOnly.startsWith('/') ? `.${pathOnly}` : pathOnly
    try {
      await access(resolve(dirname(htmlPath), localPath))
    } catch {
      missing.push(reference)
    }
  }
  return [...new Set(missing)].sort()
}

export function findSensitivePrototypeInputValues(html) {
  const issues = []
  for (const tagMatch of html.replace(HTML_COMMENT, '').matchAll(HTML_TAG)) {
    if (tagMatch[1].toLowerCase() !== 'input') continue
    const value = tagMatch[2].match(HTML_VALUE_ATTRIBUTE)?.[2]
    if (value === undefined) continue
    const normalizedValue = value.replace(/[\s-]/g, '')
    if (/^1[3-9][0-9]{9}$/.test(normalizedValue)) {
      issues.push('complete-mainland-mobile-number-input-value')
    } else if (/^[0-9]{6}$/.test(normalizedValue)) {
      issues.push('complete-six-digit-code-input-value')
    }
  }
  return issues
}

export async function listRegularFilesRecursively(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = resolve(root, entry.name)
    if (entry.isDirectory()) return await listRegularFilesRecursively(absolute)
    return entry.isFile() ? [absolute] : []
  }))
  return nested.flat().sort()
}

export async function findForbiddenFusionReferences(srcRoot) {
  const files = (await listRegularFilesRecursively(srcRoot))
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
  const offenders = []
  for (const file of files) {
    if ((await readFile(file, 'utf8')).includes(FUSION_MARKER)) {
      offenders.push(relative(srcRoot, file))
    }
  }
  return offenders.sort()
}
