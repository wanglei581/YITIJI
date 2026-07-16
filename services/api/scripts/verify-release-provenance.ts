import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import {
  buildRuntimeTree,
  createReleaseManifest,
  ReleaseProvenanceError,
  verifyReleaseProvenance,
} from '../src/release-provenance/release-provenance'
import { runReleaseManifestCli } from '../src/release-provenance/release-manifest-cli'
import { runReleaseGuard, type SpawnMain } from '../src/release-provenance/release-guard'
import { runCurrentLauncher, type SpawnGuard } from '../src/release-provenance/release-current-launcher'
import {
  activateRelease,
  type CommandRunner,
  type HealthProbe,
} from '../src/release-provenance/release-activation'

const RELEASE_ID = 'release-20260716-a1b2c3d4'
const GIT_COMMIT = 'a'.repeat(40)
const PREVIOUS_RELEASE_ID = 'release-20260716-previous'
const CANDIDATE_RELEASE_ID = 'release-20260716-candidate'

type Fixture = {
  artifactRoot: string
  pnpmLinkPath: string
  releaseRoot: string
  sourceArchivePath: string
  workspace: string
}

function writeFixtureFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function createFixture(options: { workspace?: string; releaseName?: string; sourceArchiveName?: string } = {}): Fixture {
  const workspace = options.workspace ?? mkdtempSync(join(tmpdir(), 'release-provenance-'))
  const releaseRoot = join(workspace, options.releaseName ?? 'release')
  const artifactRoot = join(workspace, 'artifacts')
  const sourceArchivePath = join(workspace, options.sourceArchiveName ?? 'source.tar.gz')
  const pnpmPackagePath = join(releaseRoot, 'node_modules/.pnpm/fixture@1.0.0/node_modules/@fixture/pkg')
  const pnpmLinkPath = join(releaseRoot, 'services/api/node_modules/@fixture/pkg')

  for (const path of [
    'services/api/dist',
    'services/api/node_modules',
    'node_modules/.pnpm',
    'apps/kiosk/dist',
    'apps/admin/dist',
    'apps/partner/dist',
  ]) {
    mkdirSync(join(releaseRoot, path), { recursive: true })
  }

  writeFixtureFile(join(releaseRoot, 'services/api/dist/main.js'), 'console.log("fixture main")\n')
  writeFixtureFile(join(releaseRoot, 'services/api/dist/release-provenance/release-guard.js'), 'console.log("fixture guard")\n')
  writeFixtureFile(join(releaseRoot, 'apps/kiosk/dist/index.html'), '<main>kiosk</main>\n')
  writeFixtureFile(join(releaseRoot, 'apps/admin/dist/index.html'), '<main>admin</main>\n')
  writeFixtureFile(join(releaseRoot, 'apps/partner/dist/index.html'), '<main>partner</main>\n')
  writeFixtureFile(join(pnpmPackagePath, 'index.js'), 'module.exports = "fixture"\n')
  mkdirSync(dirname(pnpmLinkPath), { recursive: true })
  symlinkSync(relative(dirname(pnpmLinkPath), pnpmPackagePath), pnpmLinkPath)
  writeFileSync(sourceArchivePath, 'fixture source archive\n')

  return { artifactRoot, pnpmLinkPath, releaseRoot, sourceArchivePath, workspace }
}

function createManifest(fixture: Fixture, releaseId = RELEASE_ID): void {
  const created = createReleaseManifest({
    releaseRoot: fixture.releaseRoot,
    artifactRoot: fixture.artifactRoot,
    releaseId,
    gitCommit: GIT_COMMIT,
    previousReleaseId: null,
    sourceArchivePath: fixture.sourceArchivePath,
    createdAt: '2026-07-16T00:00:00.000Z',
    toolchain: { node: process.version, pnpm: 'test' },
  })

  assert.equal(created.manifest.schemaVersion, 1)
  assert.equal(created.manifest.releaseId, releaseId)
  assert.ok(created.manifest.entrypoints['services/api/dist/main.js'])
  assert.ok(created.manifest.entrypoints['services/api/dist/release-provenance/release-guard.js'])
}

async function expectCodeAsync(expectedCode: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch (error) {
    assert.ok(error instanceof ReleaseProvenanceError)
    assert.equal(error.code, expectedCode)
    return
  }
  assert.fail(`expected ${expectedCode}`)
}

function createCommand(fixture: Fixture, overrides: Partial<Record<string, string>> = {}): string[] {
  const values = {
    '--release-root': fixture.releaseRoot,
    '--artifact-root': fixture.artifactRoot,
    '--release-id': RELEASE_ID,
    '--git-commit': GIT_COMMIT,
    '--source-archive': fixture.sourceArchivePath,
    '--created-at': '2026-07-16T00:00:00.000Z',
    '--pnpm-version': 'test',
    ...overrides,
  }
  return ['create', ...Object.entries(values).flatMap(([flag, value]) => [flag, value])]
}

function expectCode(expectedCode: string, action: () => unknown): void {
  try {
    action()
  } catch (error) {
    assert.ok(error instanceof ReleaseProvenanceError)
    assert.equal(error.code, expectedCode)
    return
  }
  assert.fail(`expected ${expectedCode}`)
}

function replaceManifestCopies(fixture: Fixture, mutate: (manifest: Record<string, unknown>) => void): void {
  const manifestPath = join(fixture.releaseRoot, 'RELEASE_MANIFEST.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  mutate(manifest)
  const manifestText = `${JSON.stringify(manifest)}\n`
  const sidecar = `${createHash('sha256').update(manifestText, 'utf8').digest('hex')}  RELEASE_MANIFEST.json\n`
  for (const root of [fixture.releaseRoot, join(fixture.artifactRoot, RELEASE_ID)]) {
    writeFileSync(join(root, 'RELEASE_MANIFEST.json'), manifestText)
    writeFileSync(join(root, 'RELEASE_MANIFEST.sha256'), sidecar)
  }
}

function withFixture(action: (fixture: Fixture) => void): void {
  const fixture = createFixture()
  try {
    action(fixture)
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}

async function verifyGuardLaunch(): Promise<void> {
  const fixture = createFixture()
  try {
    createManifest(fixture)
    const child = new EventEmitter() as EventEmitter & { kill(signal?: NodeJS.Signals): boolean }
    child.kill = () => true
    let spawned = false
    const spawnMain: SpawnMain = (command, args, options) => {
      spawned = true
      assert.equal(command, process.execPath)
      assert.deepEqual(args, ['services/api/dist/main.js'])
      assert.equal(options.cwd, realpathSync(fixture.releaseRoot))
      assert.equal(options.stdio, 'inherit')
      queueMicrotask(() => child.emit('exit', 0, null))
      return child as ReturnType<SpawnMain>
    }
    assert.equal(await runReleaseGuard({ releaseRoot: fixture.releaseRoot, artifactRoot: fixture.artifactRoot, spawnMain }), 0)
    assert.equal(spawned, true)
    console.log('  PASS guard starts only the fixed API entrypoint from the canonical release root')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}

async function verifyCurrentLauncher(): Promise<void> {
  const fixture = createFixture()
  const currentLink = join(fixture.workspace, 'current')
  const launcherPath = realpathSync(join(__dirname, '../src/release-provenance/release-current-launcher.ts'))
  const launcherSha256 = createHash('sha256').update(readFileSync(launcherPath)).digest('hex')
  try {
    createManifest(fixture)
    symlinkSync(fixture.releaseRoot, currentLink)
    const child = new EventEmitter() as EventEmitter & { kill(signal?: NodeJS.Signals): boolean }
    child.kill = () => true
    const spawnGuard: SpawnGuard = (command, args, options) => {
      const releaseRoot = realpathSync(fixture.releaseRoot)
      assert.equal(command, process.execPath)
      assert.deepEqual(args, [
        join(releaseRoot, 'services/api/dist/release-provenance/release-guard.js'),
        '--release-root',
        releaseRoot,
        '--artifact-root',
        fixture.artifactRoot,
      ])
      assert.equal(options.cwd, releaseRoot)
      assert.equal(options.stdio, 'inherit')
      queueMicrotask(() => child.emit('exit', 0, null))
      return child as ReturnType<SpawnGuard>
    }
    assert.equal(await runCurrentLauncher({ currentLink, artifactRoot: fixture.artifactRoot, launcherPath, launcherSha256, spawnGuard }), 0)
    console.log('  PASS stable launcher resolves current and starts only its release guard')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}

async function verifyCurrentLauncherSelfHash(): Promise<void> {
  const fixture = createFixture()
  const currentLink = join(fixture.workspace, 'current')
  const launcherPath = realpathSync(join(__dirname, '../src/release-provenance/release-current-launcher.ts'))
  try {
    createManifest(fixture)
    symlinkSync(fixture.releaseRoot, currentLink)
    let spawned = false
    const spawnGuard: SpawnGuard = () => {
      spawned = true
      throw new Error('mismatched launcher hash must not spawn a guard')
    }
    await expectCodeAsync('RELEASE_PROVENANCE_LAUNCHER_SELF_HASH_INVALID', () =>
      runCurrentLauncher({ currentLink, artifactRoot: fixture.artifactRoot, launcherPath, launcherSha256: '0'.repeat(64), spawnGuard }),
    )
    assert.equal(spawned, false)
    console.log('  PASS stable launcher self-hash mismatch fails before guard spawn')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}

function pm2Snapshot(cwd: string, execPath: string, currentLink: string, artifactRoot: string, launcherSha256: string): ReturnType<CommandRunner['inspect']> {
  return {
    name: 'fixture-api',
    status: 'online',
    cwd,
    execPath,
    scriptArgs: `--current-link ${currentLink} --artifact-root ${artifactRoot} --launcher-sha256 ${launcherSha256}`,
  }
}

type ActivationFixture = {
  workspace: string
  previous: Fixture
  candidate: Fixture
  currentLink: string
  healthUrl: string
  launcherCwd: string
  launcherPath: string
  launcherSha256: string
}

function createActivationFixture(): ActivationFixture {
  const workspace = mkdtempSync(join(tmpdir(), 'release-activation-'))
  const previous = createFixture({ workspace, releaseName: 'previous', sourceArchiveName: 'previous.tar.gz' })
  const candidate = createFixture({ workspace, releaseName: 'candidate', sourceArchiveName: 'candidate.tar.gz' })
  const currentLink = join(workspace, 'current')
  const healthUrl = 'http://127.0.0.1:3010/api/v1/health'
  const launcherCwd = join(workspace, 'launcher')
  const launcherPath = join(launcherCwd, 'release-current-launcher.js')
  writeFixtureFile(launcherPath, 'console.log("fixture launcher")\n')
  createManifest(previous, PREVIOUS_RELEASE_ID)
  createManifest(candidate, CANDIDATE_RELEASE_ID)
  symlinkSync(previous.releaseRoot, currentLink)
  const canonicalLauncherPath = realpathSync(launcherPath)
  return {
    workspace,
    previous,
    candidate,
    currentLink,
    healthUrl,
    launcherCwd: realpathSync(launcherCwd),
    launcherPath: canonicalLauncherPath,
    launcherSha256: createHash('sha256').update(readFileSync(canonicalLauncherPath)).digest('hex'),
  }
}

async function verifyActivationFixtures(): Promise<void> {
  const fixture = createActivationFixture()
  try {
    const noOpRunner: CommandRunner = {
      reload: () => {
        throw new Error('candidate verification failure must not reload PM2')
      },
      inspect: () => {
        throw new Error('candidate verification failure must not inspect PM2')
      },
    }
    const healthy: HealthProbe = async () => true
    writeFixtureFile(join(fixture.candidate.releaseRoot, 'services/api/dist/main.js'), 'candidate tampered\n')
    await expectCodeAsync('RELEASE_PROVENANCE_RUNTIME_TREE_MISMATCH', () =>
      activateRelease({ candidateRoot: fixture.candidate.releaseRoot, currentLink: fixture.currentLink, artifactRoot: fixture.candidate.artifactRoot, pm2Name: 'fixture-api', healthUrl: fixture.healthUrl, launcherCwd: fixture.launcherCwd, launcherPath: fixture.launcherPath, launcherSha256: fixture.launcherSha256, runner: noOpRunner, healthProbe: healthy }),
    )
    assert.equal(realpathSync(fixture.currentLink), realpathSync(fixture.previous.releaseRoot))
    console.log('  PASS candidate verification failure does not switch or reload')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}

async function verifyActivationRollbacks(): Promise<void> {
  const fixture = createActivationFixture()
  try {
    let reloads = 0
    const runner: CommandRunner = {
      reload: () => {
        reloads += 1
      },
      inspect: () => pm2Snapshot(fixture.launcherCwd, fixture.launcherPath, fixture.currentLink, fixture.candidate.artifactRoot, fixture.launcherSha256),
    }
    let healthChecks = 0
    const healthProbe: HealthProbe = async () => {
      healthChecks += 1
      return healthChecks > 1
    }
    await expectCodeAsync('RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK', () =>
      activateRelease({ candidateRoot: fixture.candidate.releaseRoot, currentLink: fixture.currentLink, artifactRoot: fixture.candidate.artifactRoot, pm2Name: 'fixture-api', healthUrl: fixture.healthUrl, launcherCwd: fixture.launcherCwd, launcherPath: fixture.launcherPath, launcherSha256: fixture.launcherSha256, runner, healthProbe }),
    )
    assert.equal(reloads, 2)
    assert.equal(realpathSync(fixture.currentLink), realpathSync(fixture.previous.releaseRoot))
    console.log('  PASS post-switch health failure rolls back only to verified previous')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }

  const unverified = createActivationFixture()
  try {
    let reloads = 0
    const runner: CommandRunner = {
      reload: () => {
        reloads += 1
        if (reloads === 1) writeFixtureFile(join(unverified.previous.releaseRoot, 'services/api/dist/main.js'), 'previous tampered\n')
      },
      inspect: () => pm2Snapshot(unverified.launcherCwd, unverified.launcherPath, unverified.currentLink, unverified.candidate.artifactRoot, unverified.launcherSha256),
    }
    const unhealthy: HealthProbe = async () => false
    await expectCodeAsync('RELEASE_PROVENANCE_ROLLBACK_UNVERIFIED', () =>
      activateRelease({ candidateRoot: unverified.candidate.releaseRoot, currentLink: unverified.currentLink, artifactRoot: unverified.candidate.artifactRoot, pm2Name: 'fixture-api', healthUrl: unverified.healthUrl, launcherCwd: unverified.launcherCwd, launcherPath: unverified.launcherPath, launcherSha256: unverified.launcherSha256, runner, healthProbe: unhealthy }),
    )
    assert.equal(reloads, 1)
    assert.equal(realpathSync(unverified.currentLink), realpathSync(unverified.candidate.releaseRoot))
    console.log('  PASS unverified previous prevents rollback and remains NO-GO')
  } finally {
    rmSync(unverified.workspace, { recursive: true, force: true })
  }
}

async function verifyActivationSuccess(): Promise<void> {
  const fixture = createActivationFixture()
  try {
    let reloads = 0
    const runner: CommandRunner = {
      reload: () => {
        reloads += 1
      },
      inspect: () => pm2Snapshot(fixture.launcherCwd, fixture.launcherPath, fixture.currentLink, fixture.candidate.artifactRoot, fixture.launcherSha256),
    }
    const healthy: HealthProbe = async () => true
    const result = await activateRelease({ candidateRoot: fixture.candidate.releaseRoot, currentLink: fixture.currentLink, artifactRoot: fixture.candidate.artifactRoot, pm2Name: 'fixture-api', healthUrl: fixture.healthUrl, launcherCwd: fixture.launcherCwd, launcherPath: fixture.launcherPath, launcherSha256: fixture.launcherSha256, runner, healthProbe: healthy })
    assert.equal(result.status, 'activated')
    assert.equal(result.releaseId, CANDIDATE_RELEASE_ID)
    assert.equal(reloads, 1)
    assert.equal(realpathSync(fixture.currentLink), realpathSync(fixture.candidate.releaseRoot))
    console.log('  PASS activation accepts only the approved stable PM2 launcher')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}

async function verifyActivationRejectsWrongLauncherArgs(): Promise<void> {
  const fixture = createActivationFixture()
  try {
    let reloads = 0
    const runner: CommandRunner = {
      reload: () => {
        reloads += 1
      },
      inspect: () => ({
        ...pm2Snapshot(fixture.launcherCwd, fixture.launcherPath, fixture.currentLink, fixture.candidate.artifactRoot, fixture.launcherSha256),
        scriptArgs: '--current-link /wrong --artifact-root /wrong',
      }),
    }
    const healthy: HealthProbe = async () => true
    await expectCodeAsync('RELEASE_PROVENANCE_ROLLBACK_UNVERIFIED', () =>
      activateRelease({ candidateRoot: fixture.candidate.releaseRoot, currentLink: fixture.currentLink, artifactRoot: fixture.candidate.artifactRoot, pm2Name: 'fixture-api', healthUrl: fixture.healthUrl, launcherCwd: fixture.launcherCwd, launcherPath: fixture.launcherPath, launcherSha256: fixture.launcherSha256, runner, healthProbe: healthy }),
    )
    assert.equal(reloads, 2)
    assert.equal(realpathSync(fixture.currentLink), realpathSync(fixture.previous.releaseRoot))
    console.log('  PASS mismatched stable launcher arguments force NO-GO rollback status')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  console.log('\n=== release provenance verification ===')

  withFixture((fixture) => {
    createManifest(fixture)
    const runtimeTree = buildRuntimeTree(fixture.releaseRoot)
    const pnpmLink = runtimeTree.entries.find((entry) => entry.kind === 'link' && entry.path === 'services/api/node_modules/@fixture/pkg')
    assert.deepEqual(pnpmLink, {
      kind: 'link',
      path: 'services/api/node_modules/@fixture/pkg',
      target: 'node_modules/.pnpm/fixture@1.0.0/node_modules/@fixture/pkg',
      sha256: pnpmLink?.sha256,
    })
    assert.equal(verifyReleaseProvenance({ releaseRoot: fixture.releaseRoot, artifactRoot: fixture.artifactRoot }).status, 'verified')
    assert.equal(JSON.parse(readFileSync(join(fixture.releaseRoot, 'RELEASE_MANIFEST.json'), 'utf8')).releaseId, RELEASE_ID)
    console.log('  PASS verified manifest and root-contained pnpm link')
  })

  withFixture((fixture) => {
    createManifest(fixture)
    writeFixtureFile(join(fixture.releaseRoot, 'services/api/dist/main.js'), 'tampered\n')
    expectCode('RELEASE_PROVENANCE_RUNTIME_TREE_MISMATCH', () =>
      verifyReleaseProvenance({ releaseRoot: fixture.releaseRoot, artifactRoot: fixture.artifactRoot }),
    )
    console.log('  PASS rejects runtime file tampering')
  })

  withFixture((fixture) => {
    createManifest(fixture)
    unlinkSync(join(fixture.artifactRoot, RELEASE_ID, 'RELEASE_MANIFEST.sha256'))
    expectCode('RELEASE_PROVENANCE_ARTIFACT_MANIFEST_MISSING', () =>
      verifyReleaseProvenance({ releaseRoot: fixture.releaseRoot, artifactRoot: fixture.artifactRoot }),
    )
    console.log('  PASS rejects missing artifact manifest sidecar')
  })

  withFixture((fixture) => {
    createManifest(fixture)
    replaceManifestCopies(fixture, (manifest) => {
      manifest.zzUnexpected = 'must not be accepted'
    })
    expectCode('RELEASE_PROVENANCE_MANIFEST_INVALID', () =>
      verifyReleaseProvenance({ releaseRoot: fixture.releaseRoot, artifactRoot: fixture.artifactRoot }),
    )
    console.log('  PASS rejects manifest fields outside the whitelist')
  })

  withFixture((fixture) => {
    createManifest(fixture)
    writeFileSync(join(fixture.artifactRoot, RELEASE_ID, 'source.tar.gz'), 'tampered source archive\n')
    expectCode('RELEASE_PROVENANCE_SOURCE_ARCHIVE_MISMATCH', () =>
      verifyReleaseProvenance({ releaseRoot: fixture.releaseRoot, artifactRoot: fixture.artifactRoot }),
    )
    console.log('  PASS rejects source archive tampering')
  })

  withFixture((fixture) => {
    createManifest(fixture)
    const artifactDirectory = join(fixture.artifactRoot, RELEASE_ID)
    rmSync(artifactDirectory, { recursive: true, force: true })
    symlinkSync(fixture.releaseRoot, artifactDirectory)
    expectCode('RELEASE_PROVENANCE_ARTIFACT_RELEASE_INVALID', () =>
      verifyReleaseProvenance({ releaseRoot: fixture.releaseRoot, artifactRoot: fixture.artifactRoot }),
    )
    console.log('  PASS rejects a symlinked artifact release directory')
  })

  withFixture((fixture) => {
    unlinkSync(fixture.pnpmLinkPath)
    const outsidePath = join(fixture.workspace, 'outside.js')
    writeFileSync(outsidePath, 'outside\n')
    symlinkSync(outsidePath, fixture.pnpmLinkPath)
    expectCode('RELEASE_PROVENANCE_SYMLINK_ESCAPES_ROOT', () => buildRuntimeTree(fixture.releaseRoot))
    console.log('  PASS rejects root-escaping link')
  })

  withFixture((fixture) => {
    const cycleA = join(fixture.releaseRoot, 'services/api/node_modules/cycle-a')
    const cycleB = join(fixture.releaseRoot, 'services/api/node_modules/cycle-b')
    symlinkSync('cycle-b', cycleA)
    symlinkSync('cycle-a', cycleB)
    expectCode('RELEASE_PROVENANCE_SYMLINK_CYCLE', () => buildRuntimeTree(fixture.releaseRoot))
    console.log('  PASS rejects cyclic links')
  })

  withFixture((fixture) => {
    expectCode('RELEASE_PROVENANCE_CLI_ARGUMENT_MISSING', () => runReleaseManifestCli(['create', '--artifact-root', fixture.artifactRoot]))
    expectCode('RELEASE_PROVENANCE_CLI_PATH_INVALID', () => runReleaseManifestCli(createCommand(fixture, { '--artifact-root': 'relative/artifacts' })))
    expectCode('RELEASE_PROVENANCE_RELEASE_ID_INVALID', () => runReleaseManifestCli(createCommand(fixture, { '--release-id': '../invalid' })))
    expectCode('RELEASE_PROVENANCE_GIT_COMMIT_INVALID', () => runReleaseManifestCli(createCommand(fixture, { '--git-commit': 'not-a-full-commit' })))
    expectCode('RELEASE_PROVENANCE_SOURCE_ARCHIVE_INVALID', () => runReleaseManifestCli(createCommand(fixture, { '--source-archive': join(fixture.workspace, 'missing.tar.gz') })))
    console.log('  PASS CLI rejects incomplete or unsafe create inputs')
  })

  withFixture((fixture) => {
    createManifest(fixture)
    writeFixtureFile(join(fixture.releaseRoot, 'services/api/dist/main.js'), 'tampered before guard\n')
    let spawnedEntrypoints = 0
    const spawnMain: SpawnMain = () => {
      spawnedEntrypoints += 1
      throw new Error('guard must not spawn on a failed verification')
    }
    expectCode('RELEASE_PROVENANCE_RUNTIME_TREE_MISMATCH', () =>
      runReleaseGuard({ releaseRoot: fixture.releaseRoot, artifactRoot: fixture.artifactRoot, spawnMain }),
    )
    assert.equal(spawnedEntrypoints, 0)
    console.log('  PASS guard fails closed before spawning API')
  })

  await verifyGuardLaunch()
  await verifyCurrentLauncher()
  await verifyCurrentLauncherSelfHash()
  await verifyActivationFixtures()
  await verifyActivationRollbacks()
  await verifyActivationSuccess()
  await verifyActivationRejectsWrongLauncherArgs()

  console.log('=== ALL PASS ===\n')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
