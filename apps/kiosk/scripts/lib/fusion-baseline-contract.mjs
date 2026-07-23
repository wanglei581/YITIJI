import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

const LOCAL_REFERENCE = /(href|src)=["']([^"']+)["']/g
const ROUTE_PATH = /(?:^|[{,]\s*)path:\s*(['"])(.*?)\1/gm
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
  return [...source.matchAll(ROUTE_PATH)]
    .map((match) => match[2])
    .map((routePath) => routePath === '/' || routePath.startsWith('/') ? routePath : `/${routePath}`)
    .filter((routePath, index, routes) => routes.indexOf(routePath) === index)
    .sort()
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
  const references = [...html.matchAll(LOCAL_REFERENCE)].map((match) => ({
    attribute: match[1],
    reference: match[2],
  }))
  const localReferences = references.filter(({ attribute, reference }) =>
    !(attribute === 'href' && reference.startsWith('/')) &&
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
    try {
      await access(resolve(dirname(htmlPath), pathOnly))
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
    return entry.isDirectory() ? await listFiles(absolute) : [absolute]
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
