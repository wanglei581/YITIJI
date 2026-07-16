import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const RUNTIME_ROOTS = [
  'services/api/dist',
  'services/api/node_modules',
  'node_modules/.pnpm',
  'apps/kiosk/dist',
  'apps/admin/dist',
  'apps/partner/dist',
] as const

const MANIFEST_FILE = 'RELEASE_MANIFEST.json'
const MANIFEST_SIDECAR_FILE = 'RELEASE_MANIFEST.sha256'
const RUNTIME_TREE_FILE = 'RUNTIME_TREE.sha256'
const ENTRYPOINTS = [
  'services/api/dist/main.js',
  'services/api/dist/release-provenance/release-guard.js',
] as const
const SAFE_RELEASE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/
const SAFE_ARCHIVE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.tar\.gz$/
const SHA256 = /^[0-9a-f]{64}$/
const GIT_COMMIT = /^[0-9a-f]{40}$/

export type RuntimeTreeEntry =
  | { kind: 'file'; path: string; sha256: string }
  | { kind: 'link'; path: string; target: string; sha256: string }

export type ReleaseManifest = {
  schemaVersion: 1
  releaseId: string
  gitCommit: string
  createdAt: string
  previousReleaseId: string | null
  sourceArchive: {
    basename: string
    sha256: string
  }
  runtimeTree: {
    basename: typeof RUNTIME_TREE_FILE
    sha256: string
  }
  entrypoints: Record<(typeof ENTRYPOINTS)[number], string>
  toolchain: {
    node: string
    pnpm: string
  }
}

export type CreateReleaseManifestOptions = {
  releaseRoot: string
  artifactRoot: string
  releaseId: string
  gitCommit: string
  createdAt: string
  previousReleaseId: string | null
  sourceArchivePath: string
  toolchain: {
    node: string
    pnpm: string
  }
}

export type VerifyReleaseProvenanceOptions = {
  releaseRoot: string
  artifactRoot: string
}

export class ReleaseProvenanceError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'ReleaseProvenanceError'
  }
}

function fail(code: string): never {
  throw new ReleaseProvenanceError(code)
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function sha256File(path: string): string {
  const hash = createHash('sha256')
  const descriptor = openSync(path, 'r')
  const chunk = Buffer.allocUnsafe(64 * 1024)
  try {
    let offset = 0
    for (;;) {
      const bytesRead = readSync(descriptor, chunk, 0, chunk.length, offset)
      if (bytesRead === 0) break
      hash.update(chunk.subarray(0, bytesRead))
      offset += bytesRead
    }
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('hex')
}

function assertSafeReleaseId(releaseId: string): void {
  if (!SAFE_RELEASE_ID.test(releaseId) || releaseId.includes('..')) fail('RELEASE_PROVENANCE_RELEASE_ID_INVALID')
}

function assertSha256(value: unknown, code: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(code)
}

function assertGitCommit(value: string): void {
  if (!GIT_COMMIT.test(value)) fail('RELEASE_PROVENANCE_GIT_COMMIT_INVALID')
}

function assertCreatedAt(value: string): void {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail('RELEASE_PROVENANCE_CREATED_AT_INVALID')
}

function assertToolchainValue(value: string, code: string): void {
  if (!value || /[\r\n\0]/.test(value)) fail(code)
}

function assertAbsoluteNonSymlinkDirectory(path: string, code: string): string {
  if (!isAbsolute(path)) fail(code)
  const lexical = resolve(path)
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(lexical)
  } catch {
    fail(code)
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code)
  let canonical: string
  try {
    canonical = realpathSync(lexical)
  } catch {
    fail(code)
  }
  return canonical
}

function ensureAbsoluteNonSymlinkDirectory(path: string, code: string): string {
  if (!isAbsolute(path)) fail(code)
  const lexical = resolve(path)
  mkdirSync(lexical, { recursive: true })
  return assertAbsoluteNonSymlinkDirectory(lexical, code)
}

function assertArtifactReleaseDirectory(artifactRoot: string, releaseId: string): string {
  const artifactDirectory = join(artifactRoot, releaseId)
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(artifactDirectory)
  } catch {
    fail('RELEASE_PROVENANCE_ARTIFACT_RELEASE_INVALID')
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('RELEASE_PROVENANCE_ARTIFACT_RELEASE_INVALID')
  let canonicalDirectory: string
  try {
    canonicalDirectory = realpathSync(artifactDirectory)
  } catch {
    fail('RELEASE_PROVENANCE_ARTIFACT_RELEASE_INVALID')
  }
  if (!isWithinRoot(artifactRoot, canonicalDirectory)) fail('RELEASE_PROVENANCE_ARTIFACT_RELEASE_INVALID')
  return canonicalDirectory
}

function assertRegularFile(path: string, code: string): void {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) fail(code)
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    fail(code)
  }
}

function requiredFile(path: string, code: string): Buffer {
  assertRegularFile(path, code)
  return readFileSync(path)
}

function normalizedEntryPath(root: string, path: string, code: string): string {
  const entryPath = relative(root, path)
  if (!entryPath || isAbsolute(entryPath)) fail(code)
  const segments = entryPath.split(sep)
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) fail(code)
  return segments.join('/')
}

function isWithinRoot(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`)
}

function isRuntimePath(path: string): boolean {
  return RUNTIME_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))
}

function isExcludedPath(path: string): boolean {
  const segments = path.split('/')
  const name = segments[segments.length - 1] ?? ''
  return (
    name === MANIFEST_FILE ||
    name === MANIFEST_SIDECAR_FILE ||
    name === RUNTIME_TREE_FILE ||
    name === '.env' ||
    name.endsWith('.log') ||
    segments.some((segment) => ['storage', 'uploads', 'tmp', 'temp', 'cache', '.cache'].includes(segment))
  )
}

function normalizeLinkTarget(root: string, linkPath: string, rawTarget: string): string {
  if (isAbsolute(rawTarget)) fail('RELEASE_PROVENANCE_SYMLINK_ESCAPES_ROOT')
  let canonicalTarget: string
  try {
    canonicalTarget = realpathSync(linkPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') fail('RELEASE_PROVENANCE_SYMLINK_CYCLE')
    fail('RELEASE_PROVENANCE_SYMLINK_UNRESOLVED')
  }
  if (!isWithinRoot(root, canonicalTarget)) fail('RELEASE_PROVENANCE_SYMLINK_ESCAPES_ROOT')
  const target = normalizedEntryPath(root, canonicalTarget, 'RELEASE_PROVENANCE_SYMLINK_ESCAPES_ROOT')
  if (!isRuntimePath(target) || isExcludedPath(target)) fail('RELEASE_PROVENANCE_SYMLINK_TARGET_UNCONTROLLED')
  return target
}

function serializeTree(entries: readonly RuntimeTreeEntry[]): string {
  return entries
    .map((entry) =>
      entry.kind === 'file'
        ? `file\t${entry.sha256}\t${entry.path}\n`
        : `link\t${entry.sha256}\t${entry.path}\t${entry.target}\n`,
    )
    .join('')
}

function walkRuntimeDirectory(root: string, directory: string, entries: RuntimeTreeEntry[], seenPaths: Set<string>): void {
  const children = readdirSync(directory).sort(compareUtf8)
  for (const child of children) {
    const absolutePath = join(directory, child)
    const path = normalizedEntryPath(root, absolutePath, 'RELEASE_PROVENANCE_RUNTIME_PATH_INVALID')
    if (isExcludedPath(path)) continue
    const stat = lstatSync(absolutePath)
    if (stat.isDirectory()) {
      walkRuntimeDirectory(root, absolutePath, entries, seenPaths)
      continue
    }
    if (seenPaths.has(path)) fail('RELEASE_PROVENANCE_RUNTIME_TREE_DUPLICATE')
    seenPaths.add(path)
    if (stat.isFile()) {
      entries.push({ kind: 'file', path, sha256: sha256File(absolutePath) })
      continue
    }
    if (stat.isSymbolicLink()) {
      const rawTarget = readlinkSync(absolutePath)
      entries.push({ kind: 'link', path, target: normalizeLinkTarget(root, absolutePath, rawTarget), sha256: sha256Text(rawTarget) })
      continue
    }
    fail('RELEASE_PROVENANCE_RUNTIME_FILE_TYPE_UNSUPPORTED')
  }
}

export function buildRuntimeTree(releaseRoot: string): { entries: RuntimeTreeEntry[]; text: string; sha256: string } {
  const root = assertAbsoluteNonSymlinkDirectory(releaseRoot, 'RELEASE_PROVENANCE_RELEASE_ROOT_INVALID')
  const entries: RuntimeTreeEntry[] = []
  const seenPaths = new Set<string>()
  for (const runtimeRoot of RUNTIME_ROOTS) {
    const absolutePath = join(root, runtimeRoot)
    let stat: ReturnType<typeof lstatSync>
    try {
      stat = lstatSync(absolutePath)
    } catch {
      fail('RELEASE_PROVENANCE_RUNTIME_ROOT_MISSING')
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('RELEASE_PROVENANCE_RUNTIME_ROOT_INVALID')
    walkRuntimeDirectory(root, absolutePath, entries, seenPaths)
  }
  entries.sort((left, right) => compareUtf8(left.path, right.path))
  const text = serializeTree(entries)
  return { entries, text, sha256: sha256Text(text) }
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort(compareUtf8).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort(compareUtf8)
  const allowed = [...expected].sort(compareUtf8)
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
  }
}

function writeManifestSidecar(path: string, manifestText: string): void {
  writeFileSync(path, `${sha256Text(manifestText)}  ${MANIFEST_FILE}\n`)
}

function assertEntrypoint(tree: { entries: RuntimeTreeEntry[] }, path: string): string {
  const entry = tree.entries.find((candidate) => candidate.kind === 'file' && candidate.path === path)
  if (!entry || entry.kind !== 'file') fail('RELEASE_PROVENANCE_ENTRYPOINT_MISSING')
  return entry.sha256
}

export function createReleaseManifest(options: CreateReleaseManifestOptions): {
  manifest: ReleaseManifest
  manifestPath: string
  runtimeTreePath: string
  artifactDirectory: string
} {
  const releaseRoot = assertAbsoluteNonSymlinkDirectory(options.releaseRoot, 'RELEASE_PROVENANCE_RELEASE_ROOT_INVALID')
  const artifactRoot = ensureAbsoluteNonSymlinkDirectory(options.artifactRoot, 'RELEASE_PROVENANCE_ARTIFACT_ROOT_INVALID')
  assertSafeReleaseId(options.releaseId)
  assertGitCommit(options.gitCommit)
  assertCreatedAt(options.createdAt)
  if (options.previousReleaseId !== null) assertSafeReleaseId(options.previousReleaseId)
  assertToolchainValue(options.toolchain.node, 'RELEASE_PROVENANCE_NODE_VERSION_INVALID')
  assertToolchainValue(options.toolchain.pnpm, 'RELEASE_PROVENANCE_PNPM_VERSION_INVALID')
  const sourceArchiveName = basename(options.sourceArchivePath)
  if (!isAbsolute(options.sourceArchivePath) || !SAFE_ARCHIVE_FILENAME.test(sourceArchiveName)) {
    fail('RELEASE_PROVENANCE_SOURCE_ARCHIVE_INVALID')
  }
  assertRegularFile(options.sourceArchivePath, 'RELEASE_PROVENANCE_SOURCE_ARCHIVE_INVALID')

  const tree = buildRuntimeTree(releaseRoot)
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    releaseId: options.releaseId,
    gitCommit: options.gitCommit,
    createdAt: options.createdAt,
    previousReleaseId: options.previousReleaseId,
    sourceArchive: {
      basename: sourceArchiveName,
      sha256: sha256File(options.sourceArchivePath),
    },
    runtimeTree: {
      basename: RUNTIME_TREE_FILE,
      sha256: tree.sha256,
    },
    entrypoints: {
      'services/api/dist/main.js': assertEntrypoint(tree, 'services/api/dist/main.js'),
      'services/api/dist/release-provenance/release-guard.js': assertEntrypoint(tree, 'services/api/dist/release-provenance/release-guard.js'),
    },
    toolchain: {
      node: options.toolchain.node,
      pnpm: options.toolchain.pnpm,
    },
  }
  const runtimeTreePath = join(releaseRoot, RUNTIME_TREE_FILE)
  const manifestPath = join(releaseRoot, MANIFEST_FILE)
  const manifestSidecarPath = join(releaseRoot, MANIFEST_SIDECAR_FILE)
  const manifestText = `${canonicalJson(manifest)}\n`
  writeFileSync(runtimeTreePath, tree.text)
  writeFileSync(manifestPath, manifestText)
  writeManifestSidecar(manifestSidecarPath, manifestText)

  const artifactDirectory = join(artifactRoot, options.releaseId)
  if (existsSync(artifactDirectory)) fail('RELEASE_PROVENANCE_ARTIFACT_RELEASE_EXISTS')
  mkdirSync(artifactDirectory)
  const canonicalArtifactDirectory = assertArtifactReleaseDirectory(artifactRoot, options.releaseId)
  for (const filename of [MANIFEST_FILE, RUNTIME_TREE_FILE, MANIFEST_SIDECAR_FILE]) {
    copyFileSync(join(releaseRoot, filename), join(canonicalArtifactDirectory, filename))
  }
  copyFileSync(options.sourceArchivePath, join(canonicalArtifactDirectory, sourceArchiveName))

  return { manifest, manifestPath, runtimeTreePath, artifactDirectory }
}

function parseManifest(manifestText: string): ReleaseManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestText)
  } catch {
    fail('RELEASE_PROVENANCE_MANIFEST_INVALID_JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
  if (`${canonicalJson(parsed)}\n` !== manifestText) fail('RELEASE_PROVENANCE_MANIFEST_NOT_CANONICAL')
  assertExactKeys(parsed, [
    'schemaVersion',
    'releaseId',
    'gitCommit',
    'createdAt',
    'previousReleaseId',
    'sourceArchive',
    'runtimeTree',
    'entrypoints',
    'toolchain',
  ])
  const manifest = parsed as Partial<ReleaseManifest>
  if (manifest.schemaVersion !== 1) fail('RELEASE_PROVENANCE_SCHEMA_UNSUPPORTED')
  if (typeof manifest.releaseId !== 'string') fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
  assertSafeReleaseId(manifest.releaseId)
  if (typeof manifest.gitCommit !== 'string') fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
  assertGitCommit(manifest.gitCommit)
  if (typeof manifest.createdAt !== 'string') fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
  assertCreatedAt(manifest.createdAt)
  if (manifest.previousReleaseId !== null && typeof manifest.previousReleaseId !== 'string') fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
  if (typeof manifest.previousReleaseId === 'string') assertSafeReleaseId(manifest.previousReleaseId)
  if (!manifest.sourceArchive || typeof manifest.sourceArchive !== 'object') fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
  assertExactKeys(manifest.sourceArchive, ['basename', 'sha256'])
  if (typeof manifest.sourceArchive.basename !== 'string' || !SAFE_ARCHIVE_FILENAME.test(manifest.sourceArchive.basename)) {
    fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
  }
  assertSha256(manifest.sourceArchive.sha256, 'RELEASE_PROVENANCE_MANIFEST_INVALID')
  if (!manifest.runtimeTree || typeof manifest.runtimeTree !== 'object' || manifest.runtimeTree.basename !== RUNTIME_TREE_FILE) fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
  assertExactKeys(manifest.runtimeTree, ['basename', 'sha256'])
  assertSha256(manifest.runtimeTree.sha256, 'RELEASE_PROVENANCE_MANIFEST_INVALID')
  if (!manifest.entrypoints || typeof manifest.entrypoints !== 'object') fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
  assertExactKeys(manifest.entrypoints, ENTRYPOINTS)
  for (const path of ENTRYPOINTS) assertSha256(manifest.entrypoints[path], 'RELEASE_PROVENANCE_MANIFEST_INVALID')
  if (!manifest.toolchain || typeof manifest.toolchain !== 'object' || typeof manifest.toolchain.node !== 'string' || typeof manifest.toolchain.pnpm !== 'string') {
    fail('RELEASE_PROVENANCE_MANIFEST_INVALID')
  }
  assertExactKeys(manifest.toolchain, ['node', 'pnpm'])
  assertToolchainValue(manifest.toolchain.node, 'RELEASE_PROVENANCE_MANIFEST_INVALID')
  assertToolchainValue(manifest.toolchain.pnpm, 'RELEASE_PROVENANCE_MANIFEST_INVALID')
  return manifest as ReleaseManifest
}

function verifySidecar(content: Buffer, sidecar: Buffer, code: string): void {
  const expected = `${sha256Text(content.toString('utf8'))}  ${MANIFEST_FILE}\n`
  if (sidecar.toString('utf8') !== expected) fail(code)
}

export function verifyReleaseProvenance(options: VerifyReleaseProvenanceOptions): { status: 'verified'; releaseId: string } {
  const releaseRoot = assertAbsoluteNonSymlinkDirectory(options.releaseRoot, 'RELEASE_PROVENANCE_RELEASE_ROOT_INVALID')
  const artifactRoot = assertAbsoluteNonSymlinkDirectory(options.artifactRoot, 'RELEASE_PROVENANCE_ARTIFACT_ROOT_INVALID')
  const manifestPath = join(releaseRoot, MANIFEST_FILE)
  const releaseManifest = requiredFile(manifestPath, 'RELEASE_PROVENANCE_MANIFEST_MISSING')
  const manifest = parseManifest(releaseManifest.toString('utf8'))
  const artifactDirectory = assertArtifactReleaseDirectory(artifactRoot, manifest.releaseId)
  const artifactManifest = requiredFile(join(artifactDirectory, MANIFEST_FILE), 'RELEASE_PROVENANCE_ARTIFACT_MANIFEST_MISSING')
  const releaseSidecar = requiredFile(join(releaseRoot, MANIFEST_SIDECAR_FILE), 'RELEASE_PROVENANCE_MANIFEST_SIDECAR_MISSING')
  const artifactSidecar = requiredFile(join(artifactDirectory, MANIFEST_SIDECAR_FILE), 'RELEASE_PROVENANCE_ARTIFACT_MANIFEST_MISSING')
  if (!artifactManifest.equals(releaseManifest)) fail('RELEASE_PROVENANCE_ARTIFACT_MANIFEST_MISMATCH')
  verifySidecar(releaseManifest, releaseSidecar, 'RELEASE_PROVENANCE_MANIFEST_SIDECAR_MISMATCH')
  verifySidecar(artifactManifest, artifactSidecar, 'RELEASE_PROVENANCE_ARTIFACT_MANIFEST_MISMATCH')

  const releaseTree = requiredFile(join(releaseRoot, RUNTIME_TREE_FILE), 'RELEASE_PROVENANCE_RUNTIME_TREE_MISSING')
  const artifactTree = requiredFile(join(artifactDirectory, RUNTIME_TREE_FILE), 'RELEASE_PROVENANCE_ARTIFACT_RUNTIME_TREE_MISSING')
  if (!artifactTree.equals(releaseTree)) fail('RELEASE_PROVENANCE_ARTIFACT_RUNTIME_TREE_MISMATCH')
  if (sha256Text(releaseTree.toString('utf8')) !== manifest.runtimeTree.sha256) fail('RELEASE_PROVENANCE_RUNTIME_TREE_MISMATCH')

  const sourceArchive = join(artifactDirectory, manifest.sourceArchive.basename)
  assertRegularFile(sourceArchive, 'RELEASE_PROVENANCE_SOURCE_ARCHIVE_MISSING')
  if (sha256File(sourceArchive) !== manifest.sourceArchive.sha256) fail('RELEASE_PROVENANCE_SOURCE_ARCHIVE_MISMATCH')

  const currentTree = buildRuntimeTree(releaseRoot)
  if (currentTree.text !== releaseTree.toString('utf8') || currentTree.sha256 !== manifest.runtimeTree.sha256) {
    fail('RELEASE_PROVENANCE_RUNTIME_TREE_MISMATCH')
  }
  for (const path of ENTRYPOINTS) {
    if (assertEntrypoint(currentTree, path) !== manifest.entrypoints[path]) fail('RELEASE_PROVENANCE_ENTRYPOINT_MISMATCH')
  }
  return { status: 'verified', releaseId: manifest.releaseId }
}
