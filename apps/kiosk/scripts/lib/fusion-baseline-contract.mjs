import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'

const HTML_COMMENT = /<!--[\s\S]*?-->/g
const HTML_TAG = /<([a-z][\w:-]*)\b([^<>]*?)>/gi
const HTML_REFERENCE_ATTRIBUTE = /(?:^|\s)(href|src)\s*=\s*(["'])(.*?)\2/gi
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

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = resolve(root, entry.name)
    if (entry.isDirectory()) return await listFiles(absolute)
    return entry.isFile() ? [absolute] : []
  }))
  return nested.flat()
}

export async function findForbiddenFusionReferences(srcRoot) {
  const files = (await listFiles(srcRoot)).filter((file) => /\.[cm]?[jt]sx?$/.test(file))
  const offenders = []
  for (const file of files) {
    if ((await readFile(file, 'utf8')).includes(FUSION_MARKER)) {
      offenders.push(relative(srcRoot, file))
    }
  }
  return offenders.sort()
}
