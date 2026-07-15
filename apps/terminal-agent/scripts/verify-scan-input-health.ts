import assert from 'node:assert/strict'
import fs, {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ScanInputHealth } from '../src/agent/types'

type CandidateNodeKind = 'file' | 'directory' | 'symbolic_link' | 'other'

interface CandidateSnapshot {
  name: string
  size: number
  mtimeMs: number
  nodeKind: CandidateNodeKind
}

interface ScanInputHealthModule {
  inspectScanInputFolder: (scanWatchFolder?: string) => ScanInputHealth
  classifyScanInputCandidate: (snapshot: CandidateSnapshot) => string
  isStableScanInputCandidate: (before: CandidateSnapshot, after: CandidateSnapshot) => boolean
}

let loadedModule: ScanInputHealthModule | undefined
try {
  loadedModule = require('../src/agent/scan-input/verified-folder') as ScanInputHealthModule
} catch {
  loadedModule = undefined
}

assert.ok(loadedModule, 'scan-input health module must export before tests run')

const {
  inspectScanInputFolder,
  classifyScanInputCandidate,
  isStableScanInputCandidate,
} = loadedModule

interface RuntimeStubs {
  platform?: NodeJS.Platform
  lstatSync?: typeof fs.lstatSync
  accessSync?: typeof fs.accessSync
}

const mutableFs = fs as unknown as {
  lstatSync: typeof fs.lstatSync
  accessSync: typeof fs.accessSync
}

function withRuntimeStubs<T>(stubs: RuntimeStubs, action: () => T): T {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const originalLstatSync = fs.lstatSync
  const originalAccessSync = fs.accessSync
  assert.ok(originalPlatform, 'process.platform must have a restorable descriptor')

  try {
    if (stubs.platform) Object.defineProperty(process, 'platform', { ...originalPlatform, value: stubs.platform })
    if (stubs.lstatSync) mutableFs.lstatSync = stubs.lstatSync
    if (stubs.accessSync) mutableFs.accessSync = stubs.accessSync
    return action()
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform)
    mutableFs.lstatSync = originalLstatSync
    mutableFs.accessSync = originalAccessSync
  }
}

function inspectWithUntrustedOptions(scanWatchFolder: string, options: unknown): ScanInputHealth {
  return (inspectScanInputFolder as unknown as (folder?: string, ignored?: unknown) => ScanInputHealth)(
    scanWatchFolder,
    options,
  )
}

function candidate(
  name: string,
  nodeKind: CandidateNodeKind = 'file',
  size = 10,
  mtimeMs = 1_000,
): CandidateSnapshot {
  return { name, nodeKind, size, mtimeMs }
}

function verifySourceSafety(): void {
  const source = readFileSync(join(__dirname, '../src/agent/scan-input/verified-folder.ts'), 'utf8')

  assert.match(source, /\blstatSync\s*\(/, 'health inspection must use lstatSync for the configured directory')
  assert.match(source, /\baccessSync\s*\(/, 'health inspection must use accessSync for directory readability')
  assert.doesNotMatch(source, /\breadFile(?:Sync)?\s*\(/, 'health inspection must not read candidate content')
  assert.doesNotMatch(source, /\breaddir(?:Sync)?\s*\(/, 'health inspection must not enumerate a directory')
  assert.doesNotMatch(source, /(?<!l)\bstatSync\s*\(/, 'health inspection must not follow links with statSync')
  assert.doesNotMatch(source, /\bunlink(?:Sync)?\s*\(/, 'health inspection must not remove files')
  assert.doesNotMatch(source, /\brename(?:Sync)?\s*\(/, 'health inspection must not move files')
  assert.doesNotMatch(source, /\baxios\b/i, 'health inspection must not call axios')
  assert.doesNotMatch(source, /\bhttps?\b/i, 'health inspection must not make HTTP calls')
}

function verifyPureCandidateRules(): void {
  assert.equal(
    classifyScanInputCandidate(candidate('scan.pdf')),
    'accepted',
    'an ordinary PDF candidate must be accepted',
  )
  assert.equal(
    classifyScanInputCandidate(candidate('linked.pdf', 'symbolic_link')),
    'rejected_symbolic_link',
    'a symbolic-link candidate must be rejected',
  )
  assert.equal(
    classifyScanInputCandidate(candidate('folder.pdf', 'directory')),
    'rejected_non_regular_file',
    'a non-regular candidate must be rejected',
  )
  assert.equal(
    classifyScanInputCandidate(candidate('scan.txt')),
    'rejected_non_pdf',
    'a non-PDF candidate must be rejected',
  )
  assert.equal(classifyScanInputCandidate(candidate('scan.PDF')), 'accepted', 'an uppercase PDF extension must be accepted')
  assert.equal(
    classifyScanInputCandidate(candidate('scan.pdf.exe')),
    'rejected_non_pdf',
    'a double extension must not be accepted as PDF',
  )

  const stable = candidate('stable.pdf')
  assert.equal(isStableScanInputCandidate(stable, { ...stable }), true, 'identical snapshots must be stable')
  assert.equal(
    isStableScanInputCandidate(stable, { ...stable, size: stable.size + 1 }),
    false,
    'a changed size must be unstable',
  )
  assert.equal(
    isStableScanInputCandidate(stable, { ...stable, mtimeMs: stable.mtimeMs + 1 }),
    false,
    'a changed modification time must be unstable',
  )
  assert.equal(
    isStableScanInputCandidate(stable, { ...stable, name: 'renamed.pdf' }),
    false,
    'a changed name must be unstable',
  )
  assert.equal(
    isStableScanInputCandidate(stable, { ...stable, nodeKind: 'other' }),
    false,
    'a changed node kind must be unstable',
  )
}

function verifyReadAndTraversePermissions(): void {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'scan-input-health-access-mode-'))
  try {
    const readyFolder = join(temporaryRoot, 'ready')
    mkdirSync(readyFolder)
    const accessModes: number[] = []

    assert.deepEqual(
      withRuntimeStubs({
        platform: 'darwin',
        accessSync: ((_: Parameters<typeof fs.accessSync>[0], mode: number) => {
          accessModes.push(mode)
        }) as typeof fs.accessSync,
      }, () => inspectScanInputFolder(readyFolder)),
      { status: 'ready', reason: 'ready' },
      'a normal directory must be ready',
    )
    assert.deepEqual(
      accessModes,
      [fs.constants.R_OK | fs.constants.X_OK],
      'a ready directory must require both read and traverse permissions',
    )
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

function verifyFolderHealth(): void {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'scan-input-health-'))
  try {
    assert.deepEqual(inspectScanInputFolder(), { status: 'unconfigured', reason: 'not_configured' })
    assert.deepEqual(inspectScanInputFolder('   '), { status: 'unconfigured', reason: 'not_configured' })

    const missingFolder = join(temporaryRoot, 'missing')
    assert.equal(inspectScanInputFolder(missingFolder).status, 'degraded', 'a missing folder must be degraded')

    const ordinaryFile = join(temporaryRoot, 'ordinary-file')
    writeFileSync(ordinaryFile, 'fixture')
    assert.deepEqual(inspectScanInputFolder(ordinaryFile), { status: 'degraded', reason: 'not_directory' })

    const readyFolder = join(temporaryRoot, 'ready')
    mkdirSync(readyFolder)
    assert.deepEqual(inspectScanInputFolder(readyFolder), { status: 'ready', reason: 'ready' })

    const linkedFolder = join(temporaryRoot, 'linked')
    symlinkSync(readyFolder, linkedFolder, 'dir')
    assert.deepEqual(
      inspectScanInputFolder(linkedFolder),
      { status: 'degraded', reason: 'reparse_point' },
      'a directory symbolic link must be degraded',
    )

    let windowsLstatCalls = 0
    let windowsAccessCalls = 0
    assert.deepEqual(
      withRuntimeStubs({
        platform: 'win32',
        lstatSync: (() => {
          windowsLstatCalls += 1
          throw new Error('directory IO must not occur on Windows')
        }) as typeof fs.lstatSync,
        accessSync: (() => {
          windowsAccessCalls += 1
          throw new Error('directory IO must not occur on Windows')
        }) as typeof fs.accessSync,
      }, () => inspectScanInputFolder(readyFolder)),
      { status: 'degraded', reason: 'reparse_point_unverifiable' },
      'Windows must fail closed before any directory IO',
    )
    assert.equal(windowsLstatCalls, 0, 'Windows must not lstat the configured directory')
    assert.equal(windowsAccessCalls, 0, 'Windows must not check configured-directory permissions')

    const fakeDirectory = {
      isDirectory: () => true,
      isSymbolicLink: () => false,
    } as unknown as ReturnType<typeof fs.lstatSync>
    assert.deepEqual(
      withRuntimeStubs({ platform: 'win32' }, () => inspectWithUntrustedOptions(readyFolder, {
        platform: 'darwin',
        lstatSync: () => fakeDirectory,
        accessSync: () => undefined,
      })),
      { status: 'degraded', reason: 'reparse_point_unverifiable' },
      'untrusted runtime options must not bypass Windows fail-closed behavior',
    )

    assert.deepEqual(
      withRuntimeStubs({
        platform: 'darwin',
        accessSync: (() => {
          throw new Error('simulated unreadable directory')
        }) as typeof fs.accessSync,
      }, () => inspectScanInputFolder(readyFolder)),
      { status: 'degraded', reason: 'not_readable' },
      'a runtime readability failure must be degraded',
    )

    rmSync(readyFolder, { recursive: true, force: true })
    assert.equal(
      inspectScanInputFolder(readyFolder).status,
      'degraded',
      'the same configured path must recompute from ready to degraded after removal',
    )
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

function verifyFailClosedMetadataAndFreshResults(): void {
  const failures: string[] = []

  try {
    const metadataFailure = withRuntimeStubs({
      platform: 'darwin',
      lstatSync: (() => ({
        isSymbolicLink: () => {
          throw new Error('simulated metadata failure')
        },
        isDirectory: () => true,
      })) as unknown as typeof fs.lstatSync,
    }, () => inspectScanInputFolder('configured-folder'))
    if (metadataFailure.status !== 'degraded' || metadataFailure.reason !== 'unavailable') {
      failures.push(`metadata failure returned ${metadataFailure.status}/${metadataFailure.reason}`)
    }
  } catch {
    failures.push('metadata method error escaped inspection')
  }

  try {
    const directoryCheckFailure = withRuntimeStubs({
      platform: 'darwin',
      lstatSync: (() => ({
        isSymbolicLink: () => false,
        isDirectory: () => {
          throw new Error('simulated metadata failure')
        },
      })) as unknown as typeof fs.lstatSync,
    }, () => inspectScanInputFolder('configured-folder'))
    if (directoryCheckFailure.status !== 'degraded' || directoryCheckFailure.reason !== 'unavailable') {
      failures.push(`directory metadata failure returned ${directoryCheckFailure.status}/${directoryCheckFailure.reason}`)
    }
  } catch {
    failures.push('directory metadata method error escaped inspection')
  }

  const firstUnconfigured = inspectScanInputFolder()
  ;(firstUnconfigured as { status: 'unconfigured' | 'degraded' | 'ready' }).status = 'ready'
  const secondUnconfigured = inspectScanInputFolder()
  if (secondUnconfigured.status !== 'unconfigured' || secondUnconfigured.reason !== 'not_configured') {
    failures.push(`a prior health result changed the next result to ${secondUnconfigured.status}/${secondUnconfigured.reason}`)
  }

  assert.deepEqual(failures, [], 'metadata errors must fail closed and health results must be fresh objects')
}

function verifyHealthTypeIsReadonly(health: ScanInputHealth): void {
  // @ts-expect-error ScanInputHealth must not permit callers to mutate a result.
  health.status = 'ready'
}

verifySourceSafety()
verifyPureCandidateRules()
verifyReadAndTraversePermissions()
verifyFolderHealth()
verifyFailClosedMetadataAndFreshResults()
void verifyHealthTypeIsReadonly

console.log('PASS scan-input health checks')
