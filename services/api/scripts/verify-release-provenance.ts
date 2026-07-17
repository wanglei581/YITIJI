import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildRuntimeTree,
  ReleaseProvenanceError,
  verifyReleaseProvenance,
} from '../src/release-provenance/release-provenance'
import { runReleaseManifestCli } from '../src/release-provenance/release-manifest-cli'
import { runReleaseGuard, type SpawnMain } from '../src/release-provenance/release-guard'
import { runCurrentLauncher, type SpawnGuard } from '../src/release-provenance/release-current-launcher'
import {
  activateRelease,
  runReleaseActivationCli,
  type CommandRunner,
  type HealthProbe,
  type Pm2ProcessSnapshot,
} from '../src/release-provenance/release-activation'
import {
  createFixture,
  createManifest,
  createRuntimeEnvironmentContract,
  GIT_COMMIT,
  RELEASE_ID,
  replaceManifestCopies,
  type Fixture,
  withFixture,
  writeFixtureFile,
} from './release-provenance-fixture'

const PREVIOUS_RELEASE_ID = 'release-20260716-previous'
const CANDIDATE_RELEASE_ID = 'release-20260716-candidate'

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

function pm2Snapshot(cwd: string, execPath: string, currentLink: string, artifactRoot: string, launcherSha256: string): Pm2ProcessSnapshot {
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
  runtimeEnvContractPath: string
  runtimeEnvContractSha256: string
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
  const runtimeEnvironmentContract = createRuntimeEnvironmentContract(workspace)
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
    runtimeEnvContractPath: runtimeEnvironmentContract.path,
    runtimeEnvContractSha256: runtimeEnvironmentContract.sha256,
  }
}

function runtimeEnvironmentContractText(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function replaceRuntimeEnvironmentContract(fixture: ActivationFixture, value: unknown): void {
  const content = runtimeEnvironmentContractText(value)
  writeFileSync(fixture.runtimeEnvContractPath, content)
  fixture.runtimeEnvContractSha256 = createHash('sha256').update(content, 'utf8').digest('hex')
}

function replaceRuntimeEnvironmentContractBytes(fixture: ActivationFixture, content: Buffer): void {
  writeFileSync(fixture.runtimeEnvContractPath, content)
  fixture.runtimeEnvContractSha256 = createHash('sha256').update(content).digest('hex')
}

function activationOptions(fixture: ActivationFixture, runner: CommandRunner, healthProbe: HealthProbe): Parameters<typeof activateRelease>[0] {
  return {
    candidateRoot: fixture.candidate.releaseRoot,
    currentLink: fixture.currentLink,
    artifactRoot: fixture.candidate.artifactRoot,
    pm2Name: 'fixture-api',
    healthUrl: fixture.healthUrl,
    launcherCwd: fixture.launcherCwd,
    launcherPath: fixture.launcherPath,
    launcherSha256: fixture.launcherSha256,
    runtimeEnvContractPath: fixture.runtimeEnvContractPath,
    runtimeEnvContractSha256: fixture.runtimeEnvContractSha256,
    runner,
    healthProbe,
  }
}

async function verifyActivationRuntimeEnvironmentContract(): Promise<void> {
  const rejectedCases: readonly {
    label: string
    code: string
    mutate(fixture: ActivationFixture): void
  }[] = [
    { label: 'missing contract', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => { fixture.runtimeEnvContractPath = join(fixture.workspace, 'missing-runtime-env-contract.json') } },
    { label: 'contract hash mismatch', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_MISMATCH', mutate: (fixture) => { fixture.runtimeEnvContractSha256 = '0'.repeat(64) } },
    { label: 'symlinked contract', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => {
      const target = join(fixture.workspace, 'runtime-env-contract-target.json')
      writeFileSync(target, readFileSync(fixture.runtimeEnvContractPath))
      unlinkSync(fixture.runtimeEnvContractPath)
      symlinkSync(target, fixture.runtimeEnvContractPath)
    } },
    { label: 'oversized contract', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => replaceRuntimeEnvironmentContractBytes(fixture, Buffer.alloc(64 * 1024 + 1, 0x20)) },
    { label: 'directory contract', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => { fixture.runtimeEnvContractPath = fixture.workspace } },
    { label: 'invalid utf8 contract', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => replaceRuntimeEnvironmentContractBytes(fixture, Buffer.from([0x7b, 0x80, 0x7d])) },
    { label: 'unsupported contract schema', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => replaceRuntimeEnvironmentContract(fixture, { schemaVersion: 2, variables: [{ name: 'PATH', purpose: 'Resolve Node.js and PM2 commands.' }] }) },
    { label: 'empty contract variables', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => replaceRuntimeEnvironmentContract(fixture, { schemaVersion: 1, variables: [] }) },
    { label: 'unknown contract field', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => replaceRuntimeEnvironmentContract(fixture, { schemaVersion: 1, variables: [{ name: 'PATH', purpose: 'Resolve Node.js and PM2 commands.' }], unexpected: true }) },
    { label: 'invalid contract variable name', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => replaceRuntimeEnvironmentContract(fixture, { schemaVersion: 1, variables: [{ name: 'path', purpose: 'Invalid lowercase variable name.' }] }) },
    { label: 'overlong contract purpose', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => replaceRuntimeEnvironmentContract(fixture, { schemaVersion: 1, variables: [{ name: 'PATH', purpose: 'x'.repeat(161) }] }) },
    { label: 'control character in contract purpose', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => replaceRuntimeEnvironmentContract(fixture, { schemaVersion: 1, variables: [{ name: 'PATH', purpose: 'Contains\nline break.' }] }) },
    { label: 'contract without PATH', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => replaceRuntimeEnvironmentContract(fixture, { schemaVersion: 1, variables: [{ name: 'NODE_ENV', purpose: 'Missing required PATH.' }] }) },
    { label: 'duplicate contract variable', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID', mutate: (fixture) => replaceRuntimeEnvironmentContract(fixture, { schemaVersion: 1, variables: [{ name: 'PATH', purpose: 'Resolve Node.js and PM2 commands.' }, { name: 'PATH', purpose: 'Duplicate name.' }] }) },
    { label: 'missing contract environment value', code: 'RELEASE_PROVENANCE_RUNTIME_ENV_VALUE_MISSING', mutate: (fixture) => replaceRuntimeEnvironmentContract(fixture, { schemaVersion: 1, variables: [{ name: 'PATH', purpose: 'Resolve Node.js and PM2 commands.' }, { name: 'RELEASE_PROVENANCE_FIXTURE_UNSET', purpose: 'Prove missing values fail closed.' }] }) },
  ]

  for (const rejected of rejectedCases) {
    const fixture = createActivationFixture()
    try {
      let reloads = 0
      const runner: CommandRunner = {
        reload: () => { reloads += 1 },
        inspect: () => pm2Snapshot(fixture.launcherCwd, fixture.launcherPath, fixture.currentLink, fixture.candidate.artifactRoot, fixture.launcherSha256),
      }
      rejected.mutate(fixture)
      await expectCodeAsync(rejected.code, () => activateRelease(activationOptions(fixture, runner, async () => true)))
      assert.equal(reloads, 0)
      assert.equal(realpathSync(fixture.currentLink), realpathSync(fixture.previous.releaseRoot))
      assert.equal(existsSync(`${fixture.currentLink}.activation.lock`), false)
    } finally {
      rmSync(fixture.workspace, { recursive: true, force: true })
    }
  }
  console.log('  PASS runtime environment contract rejects invalid inputs before switching or reloading')

  const fixture = createActivationFixture()
  try {
    const environments: unknown[] = []
    const runner: CommandRunner = {
      reload: (_pm2Name, environment) => { environments.push(environment) },
      inspect: (_pm2Name, environment) => {
        environments.push(environment)
        return pm2Snapshot(fixture.launcherCwd, fixture.launcherPath, fixture.currentLink, fixture.candidate.artifactRoot, fixture.launcherSha256)
      },
    }
    await activateRelease(activationOptions(fixture, runner, async () => true))
    assert.equal(environments.length, 2)
    assert.equal(environments[0], environments[1])
    assert.deepEqual(Object.keys(environments[0] as Record<string, string>), ['PATH'])
    assert.equal(Object.getPrototypeOf(environments[0]), null)
    assert.equal(Object.isFrozen(environments[0]), true)
    console.log('  PASS activation passes only the frozen null-prototype contract environment to the PM2 command runner')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}

async function verifyActivationCliRejectsLegacyArgumentCount(): Promise<void> {
  const output = { write: () => undefined }
  await expectCodeAsync('RELEASE_PROVENANCE_ACTIVATION_ARGUMENT_INVALID', () =>
    runReleaseActivationCli(['--candidate-root', 'relative', '--current-link', '/current', '--artifact-root', '/artifacts', '--pm2-name', 'fixture-api', '--health-url', 'http://127.0.0.1:3010/api/v1/health', '--launcher-cwd', '/launcher', '--launcher-path', '/launcher/release-current-launcher.js', '--launcher-sha256', '0'.repeat(64)], output),
  )
  console.log('  PASS activation CLI rejects the legacy 16-argument contract')
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
      activateRelease(activationOptions(fixture, noOpRunner, healthy)),
    )
    assert.equal(realpathSync(fixture.currentLink), realpathSync(fixture.previous.releaseRoot))
    assert.equal(existsSync(`${fixture.currentLink}.activation.lock`), false)
    console.log('  PASS candidate verification failure does not switch or reload')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}

async function verifyActivationLock(): Promise<void> {
  const fixture = createActivationFixture()
  try {
    const existingLockPath = `${fixture.currentLink}.activation.lock`
    const existingLockContent = 'another activation is in progress\n'
    writeFixtureFile(existingLockPath, existingLockContent)
    const noOpRunner: CommandRunner = {
      reload: () => {
        throw new Error('an existing activation lock must prevent PM2 reload')
      },
      inspect: () => {
        throw new Error('an existing activation lock must prevent PM2 inspection')
      },
    }
    await expectCodeAsync('RELEASE_PROVENANCE_ACTIVATION_LOCKED', () =>
      activateRelease(activationOptions(fixture, noOpRunner, async () => true)),
    )
    assert.equal(realpathSync(fixture.currentLink), realpathSync(fixture.previous.releaseRoot))
    assert.equal(existsSync(existingLockPath), true)
    assert.equal(readFileSync(existingLockPath, 'utf8'), existingLockContent)
    console.log('  PASS existing activation lock prevents switching or reloading')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}

async function verifyActivationRollbacks(): Promise<void> {
  const fixture = createActivationFixture()
  try {
    let reloads = 0
    const environments: unknown[] = []
    const runner: CommandRunner = {
      reload: (_pm2Name, environment) => {
        environments.push(environment)
        reloads += 1
      },
      inspect: (_pm2Name, environment) => {
        environments.push(environment)
        return pm2Snapshot(fixture.launcherCwd, fixture.launcherPath, fixture.currentLink, fixture.candidate.artifactRoot, fixture.launcherSha256)
      },
    }
    let healthChecks = 0
    const healthProbe: HealthProbe = async () => {
      healthChecks += 1
      return healthChecks > 1
    }
    await expectCodeAsync('RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK', () =>
      activateRelease(activationOptions(fixture, runner, healthProbe)),
    )
    assert.equal(reloads, 2)
    assert.equal(environments.length, 4)
    assert.equal(environments.every((environment) => environment === environments[0]), true)
    assert.equal(realpathSync(fixture.currentLink), realpathSync(fixture.previous.releaseRoot))
    assert.equal(existsSync(`${fixture.currentLink}.activation.lock`), false)
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
      activateRelease(activationOptions(unverified, runner, unhealthy)),
    )
    assert.equal(reloads, 1)
    assert.equal(realpathSync(unverified.currentLink), realpathSync(unverified.candidate.releaseRoot))
    assert.equal(existsSync(`${unverified.currentLink}.activation.lock`), false)
    console.log('  PASS unverified previous prevents rollback and remains NO-GO')
  } finally {
    rmSync(unverified.workspace, { recursive: true, force: true })
  }
}

async function verifyActivationRollsBackOnMissingPm2Snapshot(): Promise<void> {
  const fixture = createActivationFixture()
  try {
    let reloads = 0
    let inspections = 0
    const runner: CommandRunner = {
      reload: () => {
        reloads += 1
      },
      inspect: () => {
        inspections += 1
        if (inspections === 1) return null
        return pm2Snapshot(fixture.launcherCwd, fixture.launcherPath, fixture.currentLink, fixture.candidate.artifactRoot, fixture.launcherSha256)
      },
    }
    await expectCodeAsync('RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK', () =>
      activateRelease(activationOptions(fixture, runner, async () => true)),
    )
    assert.equal(reloads, 2)
    assert.equal(inspections, 2)
    assert.equal(realpathSync(fixture.currentLink), realpathSync(fixture.previous.releaseRoot))
    assert.equal(existsSync(`${fixture.currentLink}.activation.lock`), false)
    console.log('  PASS injected missing PM2 snapshot forces a verified rollback')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
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
    const result = await activateRelease(activationOptions(fixture, runner, healthy))
    assert.equal(result.status, 'activated')
    assert.equal(result.releaseId, CANDIDATE_RELEASE_ID)
    assert.equal(reloads, 1)
    assert.equal(realpathSync(fixture.currentLink), realpathSync(fixture.candidate.releaseRoot))
    assert.equal(existsSync(`${fixture.currentLink}.activation.lock`), false)
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
      activateRelease(activationOptions(fixture, runner, healthy)),
    )
    assert.equal(reloads, 2)
    assert.equal(realpathSync(fixture.currentLink), realpathSync(fixture.previous.releaseRoot))
    assert.equal(existsSync(`${fixture.currentLink}.activation.lock`), false)
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
  await verifyActivationRuntimeEnvironmentContract()
  await verifyActivationCliRejectsLegacyArgumentCount()
  await verifyActivationFixtures()
  await verifyActivationLock()
  await verifyActivationRollbacks()
  await verifyActivationRollsBackOnMissingPm2Snapshot()
  await verifyActivationSuccess()
  await verifyActivationRejectsWrongLauncherArgs()

  console.log('=== ALL PASS ===\n')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
