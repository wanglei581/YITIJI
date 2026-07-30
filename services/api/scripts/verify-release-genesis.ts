import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
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
import { join } from 'node:path'
import { activateRelease, type CommandRunner } from '../src/release-provenance/release-activation'
import {
  runReleaseGenesis,
  type GenesisRunner,
  type ManagedProcessStart,
} from '../src/release-provenance/release-genesis'
import { parseGenesisArgs, runReleaseGenesisCli } from '../src/release-provenance/release-genesis-cli'
import { ReleaseProvenanceError } from '../src/release-provenance/release-provenance'
import { assertLocalHealthUrl, type ApprovedRuntimeEnvironment, type HealthProbe, type Pm2ProcessSnapshot } from '../src/release-provenance/release-runtime-contract'
import {
  createFixture,
  createManifest,
  createRuntimeEnvironmentContract,
  replaceManifestCopies,
  writeFixtureFile,
  type Fixture,
} from './release-provenance-fixture'

const R1_RELEASE_ID = 'release-20260716-genesis-r1'
const R2_RELEASE_ID = 'release-20260716-genesis-r2'
const PM2_NAME = 'fixture-genesis-api'
const MANAGED_HEALTH_URL = 'http://127.0.0.1:3011/api/v1/health'
const LEGACY_HEALTH_URL = 'http://127.0.0.1:3010/api/v1/health'
const HEALTH_URL = LEGACY_HEALTH_URL
const REJECTED_HEALTH_URLS = [
  LEGACY_HEALTH_URL, 'http://127.0.0.1:3012/api/v1/health',
  'http://localhost:3011/api/v1/health', 'http://0.0.0.0:3011/api/v1/health',
  'http://[::1]:3011/api/v1/health', 'http://api.local:3011/api/v1/health',
  'https://127.0.0.1:3011/api/v1/health', 'http://127.0.0.1:3011/health',
  'http://127.0.0.1:3011/api/v1/health/', 'http://user:pass@127.0.0.1:3011/api/v1/health',
  'http://127.0.0.1:3011/api/v1/health?probe=1', 'http://127.0.0.1:3011/api/v1/health#probe',
  'http://169.254.169.254/latest/meta-data/',
] as const

type TrafficTarget = 'legacy' | 'managed'

class FakeTrafficController {
  target: TrafficTarget = 'legacy'
  cutoverRequests = 0

  requestCutover(state: string): void {
    this.cutoverRequests += 1
    if (state === 'PARALLEL_SERVING_R2') this.target = 'managed'
  }
}

type GenesisFixture = {
  workspace: string
  r1: Fixture
  r2: Fixture
  legacyRoot: string
  legacyTouches: { count: number }
  managedCurrentLink: string
  controlRoot: string
  healthUrl: string
  launcherCwd: string
  launcherPath: string
  launcherSha256: string
  runtimeEnvContractPath: string
  runtimeEnvContractSha256: string
  traffic: FakeTrafficController
}

type FakeGenesisRunner = GenesisRunner & {
  starts: ManagedProcessStart[]
  stops: string[]
  inspections: number
  process: Pm2ProcessSnapshot | null
  stopShouldFail: boolean
  startSnapshotOverride: Pm2ProcessSnapshot | null
}

async function expectCodeAsync(expectedCode: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
    assert.fail(`expected ${expectedCode}`)
  } catch (error) {
    assert.ok(error instanceof ReleaseProvenanceError)
    assert.equal(error.code, expectedCode)
  }
}

function verifyManagedHealthUrlContract(): void {
  assert.doesNotThrow(() => assertLocalHealthUrl(MANAGED_HEALTH_URL))
  for (const value of REJECTED_HEALTH_URLS) {
    assert.throws(
      () => assertLocalHealthUrl(value),
      (error: unknown) =>
        error instanceof ReleaseProvenanceError &&
        error.code === 'RELEASE_PROVENANCE_HEALTH_URL_INVALID',
    )
  }
  console.log('  PASS managed health URL accepts only exact loopback port 3011')
}

function pm2Snapshot(
  cwd: string,
  execPath: string,
  currentLink: string,
  artifactRoot: string,
  launcherSha256: string,
): Pm2ProcessSnapshot {
  return {
    name: PM2_NAME,
    status: 'online',
    cwd,
    execPath,
    scriptArgs: `--current-link ${currentLink} --artifact-root ${artifactRoot} --launcher-sha256 ${launcherSha256}`,
  }
}

function createFakeGenesisRunner(fixture: GenesisFixture): FakeGenesisRunner {
  const runner: FakeGenesisRunner = {
    starts: [],
    stops: [],
    inspections: 0,
    process: null,
    stopShouldFail: false,
    startSnapshotOverride: null,
    inspect(pm2Name) {
      runner.inspections += 1
      assert.equal(pm2Name, PM2_NAME)
      return runner.process
    },
    start(options) {
      assert.deepEqual(Object.keys(options.environment), ['PATH'])
      assert.equal(Object.getPrototypeOf(options.environment), null)
      runner.starts.push(options)
      runner.process = runner.startSnapshotOverride ?? pm2Snapshot(
        options.launcher.cwd,
        options.launcher.path,
        options.managedCurrentLink,
        options.artifactRoot,
        options.launcher.sha256,
      )
    },
    stop(pm2Name) {
      runner.stops.push(pm2Name)
      if (runner.stopShouldFail) throw new ReleaseProvenanceError('RELEASE_PROVENANCE_PM2_COMMAND_FAILED')
      runner.process = null
    },
  }
  return runner
}

function createGenesisFixture(): GenesisFixture {
  const workspace = mkdtempSync(join(tmpdir(), 'release-genesis-'))
  const r1 = createFixture({ workspace, releaseName: 'r1', sourceArchiveName: 'r1.tar.gz' })
  const r2 = createFixture({ workspace, releaseName: 'r2', sourceArchiveName: 'r2.tar.gz' })
  const legacyRoot = join(workspace, 'legacy')
  const legacyTouches = { count: 0 }
  mkdirSync(legacyRoot, { recursive: true })
  writeFixtureFile(join(legacyRoot, 'main.js'), 'legacy sentinel\n')
  const originalWrite = writeFileSync
  const managedCurrentLink = join(workspace, 'managed-current')
  const controlRoot = join(workspace, 'deployment-control')
  mkdirSync(controlRoot, { recursive: true })
  const launcherCwd = join(workspace, 'launcher')
  const launcherPath = join(launcherCwd, 'release-current-launcher.js')
  writeFixtureFile(launcherPath, 'console.log("fixture genesis launcher")\n')
  const runtimeEnvironmentContract = createRuntimeEnvironmentContract(workspace)
  createManifest(r1, R1_RELEASE_ID)
  createManifest(r2, R2_RELEASE_ID)
  const canonicalLauncherPath = realpathSync(launcherPath)
  const fixture: GenesisFixture = {
    workspace,
    r1,
    r2,
    legacyRoot,
    legacyTouches,
    managedCurrentLink,
    controlRoot: realpathSync(controlRoot),
    healthUrl: HEALTH_URL,
    launcherCwd: realpathSync(launcherCwd),
    launcherPath: canonicalLauncherPath,
    launcherSha256: createHash('sha256').update(readFileSync(canonicalLauncherPath)).digest('hex'),
    runtimeEnvContractPath: runtimeEnvironmentContract.path,
    runtimeEnvContractSha256: runtimeEnvironmentContract.sha256,
    traffic: new FakeTrafficController(),
  }
  // Track accidental writes into the legacy sentinel without wrapping global fs.
  const marker = join(legacyRoot, '.touch-counter')
  Object.defineProperty(fixture, 'markLegacyTouch', {
    value: () => {
      legacyTouches.count += 1
      originalWrite(marker, `${legacyTouches.count}\n`)
    },
  })
  return fixture
}

function genesisOptions(
  fixture: GenesisFixture,
  runner: GenesisRunner,
  healthProbe: HealthProbe,
): Parameters<typeof runReleaseGenesis>[0] {
  return {
    candidateRoot: fixture.r1.releaseRoot,
    managedCurrentLink: fixture.managedCurrentLink,
    artifactRoot: fixture.r1.artifactRoot,
    deploymentControlRoot: fixture.controlRoot,
    pm2Name: PM2_NAME,
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

async function verifyLegacyHealthUrlFailsBeforeGenesisSideEffects(): Promise<void> {
  const fixture = createGenesisFixture()
  try {
    fixture.healthUrl = LEGACY_HEALTH_URL
    const runner = createFakeGenesisRunner(fixture)
    let healthChecks = 0
    const healthProbe: HealthProbe = async () => {
      healthChecks += 1
      return true
    }

    await expectCodeAsync('RELEASE_PROVENANCE_HEALTH_URL_INVALID', () =>
      runReleaseGenesis(genesisOptions(fixture, runner, healthProbe)),
    )

    assert.equal(runner.inspections, 0)
    assert.equal(runner.starts.length, 0)
    assert.equal(runner.stops.length, 0)
    assert.equal(healthChecks, 0)
    assert.equal(existsSync(fixture.managedCurrentLink), false)
    assert.equal(existsSync(join(fixture.controlRoot, 'GENESIS.lock')), false)
    assert.equal(existsSync(join(fixture.controlRoot, 'GENESIS_INTENT.json')), false)
    assert.equal(existsSync(join(fixture.controlRoot, 'GENESIS_SUCCESS.json')), false)
    assert.equal(existsSync(join(fixture.controlRoot, 'GENESIS_FAILURE.json')), false)
    assertLegacyUntouched(fixture)
    console.log('  PASS legacy health URL fails before Genesis side effects')
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function assertFailureRecord(fixture: GenesisFixture, failureCode: string): void {
  const failurePath = join(fixture.controlRoot, 'GENESIS_FAILURE.json')
  assert.equal(existsSync(failurePath), true)
  const failure = readJson(failurePath)
  assert.equal(failure.schemaVersion, 1)
  assert.equal(failure.status, 'FAILED_CLOSED')
  assert.equal(failure.failureCode, failureCode)
  assert.equal(typeof failure.candidateRootSha256, 'string')
  assert.match(String(failure.candidateRootSha256), /^[0-9a-f]{64}$/)
  const text = readFileSync(failurePath, 'utf8')
  assert.equal(text.includes(fixture.r1.releaseRoot), false)
  assert.equal(text.includes(fixture.controlRoot), false)
  assert.equal(text.includes('PATH='), false)
  assert.equal(existsSync(fixture.managedCurrentLink), false)
}

function assertLegacyUntouched(fixture: GenesisFixture): void {
  assert.equal(fixture.legacyTouches.count, 0)
  assert.equal(readFileSync(join(fixture.legacyRoot, 'main.js'), 'utf8'), 'legacy sentinel\n')
}

async function scenario1TamperedProvenance(): Promise<void> {
  const cases: Array<{ label: string; mutate: (fixture: GenesisFixture) => void; code: string }> = [
    {
      label: 'runtime tree',
      code: 'RELEASE_PROVENANCE_RUNTIME_TREE_MISMATCH',
      mutate: (fixture) => writeFixtureFile(join(fixture.r1.releaseRoot, 'services/api/dist/main.js'), 'tampered\n'),
    },
    {
      label: 'source archive',
      code: 'RELEASE_PROVENANCE_SOURCE_ARCHIVE_MISMATCH',
      mutate: (fixture) => writeFileSync(join(fixture.r1.artifactRoot, R1_RELEASE_ID, 'r1.tar.gz'), 'tampered archive\n'),
    },
    {
      label: 'entrypoint',
      code: 'RELEASE_PROVENANCE_ENTRYPOINT_MISMATCH',
      mutate: (fixture) => replaceManifestCopies(fixture.r1, (manifest) => {
        const entrypoints = manifest.entrypoints as Record<string, string>
        entrypoints['services/api/dist/main.js'] = '0'.repeat(64)
      }, R1_RELEASE_ID),
    },
    {
      label: 'artifact manifest',
      code: 'RELEASE_PROVENANCE_ARTIFACT_MANIFEST_MISMATCH',
      mutate: (fixture) => {
        const artifactManifest = join(fixture.r1.artifactRoot, R1_RELEASE_ID, 'RELEASE_MANIFEST.json')
        writeFileSync(artifactManifest, `${JSON.stringify({ tampered: true })}\n`)
      },
    },
  ]
  for (const testCase of cases) {
    const fixture = createGenesisFixture()
    try {
      const runner = createFakeGenesisRunner(fixture)
      testCase.mutate(fixture)
      await expectCodeAsync(testCase.code, () => runReleaseGenesis(genesisOptions(fixture, runner, async () => true)))
      assert.equal(runner.starts.length, 0)
      assert.equal(runner.stops.length, 0)
      assert.equal(existsSync(fixture.managedCurrentLink), false)
      assertFailureRecord(fixture, testCase.code)
      assertLegacyUntouched(fixture)
    } finally {
      rmSync(fixture.workspace, { recursive: true, force: true })
    }
  }
  console.log('  PASS scenario1 tampered r1 provenance fails closed without start/stop')
}

async function scenario2PreexistingState(): Promise<void> {
  const fixture = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(fixture)
    writeFileSync(join(fixture.controlRoot, 'GENESIS_SUCCESS.json'), `${JSON.stringify({
      schemaVersion: 1,
      status: 'PARALLEL_SERVING_R1',
      timestamp: '2026-07-16T00:00:00.000Z',
      releaseId: R1_RELEASE_ID,
      pm2Name: PM2_NAME,
      launcherSha256: fixture.launcherSha256,
      candidateRootSha256: 'a'.repeat(64),
      managedCurrentLinkSha256: 'b'.repeat(64),
      artifactRootSha256: 'c'.repeat(64),
      deploymentControlRootSha256: 'd'.repeat(64),
      runtimeEnvContractSha256: fixture.runtimeEnvContractSha256,
      healthOk: true,
      failureCode: null,
    })}\n`)
    writeFileSync(join(fixture.controlRoot, 'GENESIS_INTENT.json'), `${JSON.stringify({
      schemaVersion: 1,
      status: 'PREPARING',
      timestamp: '2026-07-16T00:00:00.000Z',
      releaseId: null,
      pm2Name: PM2_NAME,
      launcherSha256: fixture.launcherSha256,
      candidateRootSha256: 'a'.repeat(64),
      managedCurrentLinkSha256: 'b'.repeat(64),
      artifactRootSha256: 'c'.repeat(64),
      deploymentControlRootSha256: 'd'.repeat(64),
      runtimeEnvContractSha256: fixture.runtimeEnvContractSha256,
      healthOk: null,
      failureCode: null,
    })}\n`)
    const successBefore = readFileSync(join(fixture.controlRoot, 'GENESIS_SUCCESS.json'), 'utf8')
    await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_ALREADY_INITIALIZED', () =>
      runReleaseGenesis(genesisOptions(fixture, runner, async () => true)),
    )
    assert.equal(runner.starts.length, 0)
    assert.equal(runner.stops.length, 0)
    assert.equal(readFileSync(join(fixture.controlRoot, 'GENESIS_SUCCESS.json'), 'utf8'), successBefore)
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }

  const locked = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(locked)
    writeFileSync(join(locked.controlRoot, 'GENESIS.lock'), 'foreign-lock\n')
    await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_LOCKED', () =>
      runReleaseGenesis(genesisOptions(locked, runner, async () => true)),
    )
    assert.equal(runner.starts.length, 0)
    assert.equal(existsSync(join(locked.controlRoot, 'GENESIS_INTENT.json')), false)
  } finally {
    rmSync(locked.workspace, { recursive: true, force: true })
  }

  const existingCurrent = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(existingCurrent)
    symlinkSync(existingCurrent.r1.releaseRoot, existingCurrent.managedCurrentLink)
    await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_MANAGED_CURRENT_EXISTS', () =>
      runReleaseGenesis(genesisOptions(existingCurrent, runner, async () => true)),
    )
    assert.equal(runner.starts.length, 0)
    assert.equal(runner.stops.length, 0)
    assert.equal(existsSync(existingCurrent.managedCurrentLink), true)
  } finally {
    rmSync(existingCurrent.workspace, { recursive: true, force: true })
  }

  const existingPm2 = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(existingPm2)
    runner.process = pm2Snapshot(
      existingPm2.launcherCwd,
      existingPm2.launcherPath,
      existingPm2.managedCurrentLink,
      existingPm2.r1.artifactRoot,
      existingPm2.launcherSha256,
    )
    await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_PM2_EXISTS', () =>
      runReleaseGenesis(genesisOptions(existingPm2, runner, async () => true)),
    )
    assert.equal(runner.starts.length, 0)
    assert.equal(runner.stops.length, 0)
  } finally {
    rmSync(existingPm2.workspace, { recursive: true, force: true })
  }

  const bareIntent = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(bareIntent)
    writeFileSync(join(bareIntent.controlRoot, 'GENESIS_INTENT.json'), `${JSON.stringify({
      schemaVersion: 1,
      status: 'PREPARING',
      timestamp: '2026-07-16T00:00:00.000Z',
      releaseId: null,
      pm2Name: PM2_NAME,
      launcherSha256: bareIntent.launcherSha256,
      candidateRootSha256: 'a'.repeat(64),
      managedCurrentLinkSha256: 'b'.repeat(64),
      artifactRootSha256: 'c'.repeat(64),
      deploymentControlRootSha256: 'd'.repeat(64),
      runtimeEnvContractSha256: bareIntent.runtimeEnvContractSha256,
      healthOk: null,
      failureCode: null,
    })}\n`)
    await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_CONTROL_STATE_INVALID', () =>
      runReleaseGenesis(genesisOptions(bareIntent, runner, async () => true)),
    )
    assert.equal(runner.starts.length, 0)
  } finally {
    rmSync(bareIntent.workspace, { recursive: true, force: true })
  }
  console.log('  PASS scenario2 preexisting control/current/pm2/lock fail closed')
}

async function scenario3PostStartMismatchCleanup(): Promise<void> {
  const fixture = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(fixture)
    runner.startSnapshotOverride = {
      ...pm2Snapshot(fixture.launcherCwd, fixture.launcherPath, fixture.managedCurrentLink, fixture.r1.artifactRoot, fixture.launcherSha256),
      scriptArgs: '--current-link /wrong --artifact-root /wrong --launcher-sha256 wrong',
    }
    await expectCodeAsync('RELEASE_PROVENANCE_PM2_PATH_MISMATCH', () =>
      runReleaseGenesis(genesisOptions(fixture, runner, async () => true)),
    )
    assert.equal(runner.starts.length, 1)
    assert.deepEqual(runner.stops, [PM2_NAME])
    assert.equal(existsSync(fixture.managedCurrentLink), false)
    assertFailureRecord(fixture, 'RELEASE_PROVENANCE_PM2_PATH_MISMATCH')
    assertLegacyUntouched(fixture)
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }

  const healthFail = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(healthFail)
    await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_HEALTH_FAILED', () =>
      runReleaseGenesis(genesisOptions(healthFail, runner, async () => false)),
    )
    assert.equal(runner.starts.length, 1)
    assert.deepEqual(runner.stops, [PM2_NAME])
    assert.equal(existsSync(healthFail.managedCurrentLink), false)
    assertFailureRecord(healthFail, 'RELEASE_PROVENANCE_GENESIS_HEALTH_FAILED')
  } finally {
    rmSync(healthFail.workspace, { recursive: true, force: true })
  }

  const launcherSha = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(launcherSha)
    const options = genesisOptions(launcherSha, runner, async () => true)
    options.launcherSha256 = '0'.repeat(64)
    await expectCodeAsync('RELEASE_PROVENANCE_LAUNCHER_INVALID', () => runReleaseGenesis(options))
    assert.equal(runner.starts.length, 0)
    assert.equal(runner.stops.length, 0)
    assert.equal(existsSync(join(launcherSha.controlRoot, 'GENESIS_INTENT.json')), false)
  } finally {
    rmSync(launcherSha.workspace, { recursive: true, force: true })
  }
  console.log('  PASS scenario3 launcher/snapshot/health mismatch cleans only this call')
}

async function scenario4CleanupUnverified(): Promise<void> {
  const stopFail = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(stopFail)
    runner.stopShouldFail = true
    await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_CLEANUP_UNVERIFIED', () =>
      runReleaseGenesis(genesisOptions(stopFail, runner, async () => false)),
    )
    assert.equal(runner.starts.length, 1)
    assert.equal(runner.stops.length, 1)
    assert.equal(existsSync(join(stopFail.controlRoot, 'GENESIS_FAILURE.json')), true)
  } finally {
    rmSync(stopFail.workspace, { recursive: true, force: true })
  }

  const replaced = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(replaced)
    const healthProbe: HealthProbe = async () => {
      unlinkSync(replaced.managedCurrentLink)
      symlinkSync(replaced.r2.releaseRoot, replaced.managedCurrentLink)
      return false
    }
    await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_CLEANUP_UNVERIFIED', () =>
      runReleaseGenesis(genesisOptions(replaced, runner, healthProbe)),
    )
    assert.equal(realpathSync(replaced.managedCurrentLink), realpathSync(replaced.r2.releaseRoot))
    assert.equal(existsSync(join(replaced.controlRoot, 'GENESIS_FAILURE.json')), true)
  } finally {
    rmSync(replaced.workspace, { recursive: true, force: true })
  }

  const failureWrite = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(failureWrite)
    const healthProbe: HealthProbe = async () => {
      mkdirSync(join(failureWrite.controlRoot, 'GENESIS_FAILURE.json'))
      return false
    }
    await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_CLEANUP_UNVERIFIED', () =>
      runReleaseGenesis(genesisOptions(failureWrite, runner, healthProbe)),
    )
  } finally {
    rmSync(failureWrite.workspace, { recursive: true, force: true })
  }
  console.log('  PASS scenario4 cleanup unverified preserves evidence')
}

async function scenario5SuccessAndReentry(): Promise<void> {
  const fixture = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(fixture)
    const result = await runReleaseGenesis(genesisOptions(fixture, runner, async () => true))
    assert.equal(result.status, 'parallel-serving-r1')
    assert.equal(result.releaseId, R1_RELEASE_ID)
    assert.equal(realpathSync(fixture.managedCurrentLink), realpathSync(fixture.r1.releaseRoot))
    assert.equal(runner.starts.length, 1)
    const start = runner.starts[0]
    assert.equal(start.pm2Name, PM2_NAME)
    assert.equal(start.launcher.path, fixture.launcherPath)
    assert.equal(start.managedCurrentLink, fixture.managedCurrentLink)
    assert.equal(start.artifactRoot, fixture.r1.artifactRoot)
    assert.deepEqual(Object.keys(start.environment as ApprovedRuntimeEnvironment), ['PATH'])
    const success = readJson(join(fixture.controlRoot, 'GENESIS_SUCCESS.json'))
    assert.equal(success.status, 'PARALLEL_SERVING_R1')
    assert.equal(success.healthOk, true)
    assert.equal(success.releaseId, R1_RELEASE_ID)
    fixture.traffic.requestCutover(String(success.status))
    assert.equal(fixture.traffic.cutoverRequests, 1)
    assert.equal(fixture.traffic.target, 'legacy')

    await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_ALREADY_INITIALIZED', () =>
      runReleaseGenesis(genesisOptions(fixture, runner, async () => true)),
    )
    assert.equal(runner.starts.length, 1)
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
  console.log('  PASS scenario5 success PARALLEL_SERVING_R1 and already-initialized reentry')
}

async function scenario6ActivateAfterGenesis(): Promise<void> {
  const tamperedPrevious = createGenesisFixture()
  try {
    const genesisRunner = createFakeGenesisRunner(tamperedPrevious)
    await runReleaseGenesis(genesisOptions(tamperedPrevious, genesisRunner, async () => true))
    writeFixtureFile(join(tamperedPrevious.r1.releaseRoot, 'services/api/dist/main.js'), 'r1 tampered after genesis\n')
    let reloads = 0
    const activationRunner: CommandRunner = {
      reload: () => {
        reloads += 1
      },
      inspect: () => pm2Snapshot(
        tamperedPrevious.launcherCwd,
        tamperedPrevious.launcherPath,
        tamperedPrevious.managedCurrentLink,
        tamperedPrevious.r2.artifactRoot,
        tamperedPrevious.launcherSha256,
      ),
    }
    await expectCodeAsync('RELEASE_PROVENANCE_RUNTIME_TREE_MISMATCH', () =>
      activateRelease({
        candidateRoot: tamperedPrevious.r2.releaseRoot,
        currentLink: tamperedPrevious.managedCurrentLink,
        artifactRoot: tamperedPrevious.r2.artifactRoot,
        pm2Name: PM2_NAME,
        healthUrl: tamperedPrevious.healthUrl,
        launcherCwd: tamperedPrevious.launcherCwd,
        launcherPath: tamperedPrevious.launcherPath,
        launcherSha256: tamperedPrevious.launcherSha256,
        runtimeEnvContractPath: tamperedPrevious.runtimeEnvContractPath,
        runtimeEnvContractSha256: tamperedPrevious.runtimeEnvContractSha256,
        runner: activationRunner,
        healthProbe: async () => true,
      }),
    )
    assert.equal(reloads, 0)
    assert.equal(realpathSync(tamperedPrevious.managedCurrentLink), realpathSync(tamperedPrevious.r1.releaseRoot))
    assertLegacyUntouched(tamperedPrevious)
  } finally {
    rmSync(tamperedPrevious.workspace, { recursive: true, force: true })
  }

  const rollback = createGenesisFixture()
  try {
    const genesisRunner = createFakeGenesisRunner(rollback)
    await runReleaseGenesis(genesisOptions(rollback, genesisRunner, async () => true))
    let reloads = 0
    const activationRunner: CommandRunner = {
      reload: () => {
        reloads += 1
      },
      inspect: () => pm2Snapshot(
        rollback.launcherCwd,
        rollback.launcherPath,
        rollback.managedCurrentLink,
        rollback.r2.artifactRoot,
        rollback.launcherSha256,
      ),
    }
    let healthChecks = 0
    const healthProbe: HealthProbe = async () => {
      healthChecks += 1
      return healthChecks > 1
    }
    await expectCodeAsync('RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK', () =>
      activateRelease({
        candidateRoot: rollback.r2.releaseRoot,
        currentLink: rollback.managedCurrentLink,
        artifactRoot: rollback.r2.artifactRoot,
        pm2Name: PM2_NAME,
        healthUrl: rollback.healthUrl,
        launcherCwd: rollback.launcherCwd,
        launcherPath: rollback.launcherPath,
        launcherSha256: rollback.launcherSha256,
        runtimeEnvContractPath: rollback.runtimeEnvContractPath,
        runtimeEnvContractSha256: rollback.runtimeEnvContractSha256,
        runner: activationRunner,
        healthProbe,
      }),
    )
    assert.equal(reloads, 2)
    assert.equal(realpathSync(rollback.managedCurrentLink), realpathSync(rollback.r1.releaseRoot))
    assertLegacyUntouched(rollback)
    assert.equal(rollback.traffic.target, 'legacy')
  } finally {
    rmSync(rollback.workspace, { recursive: true, force: true })
  }
  console.log('  PASS scenario6 activateRelease verifies r1 previous and rolls back only to r1')
}

async function scenario7CliContract(): Promise<void> {
  const messages: string[] = []
  const output = { write: (message: string) => { messages.push(message) } }
  await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_ARGUMENT_INVALID', () => runReleaseGenesisCli([], output))
  await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_ARGUMENT_INVALID', () =>
    runReleaseGenesisCli(['--candidate-root', '/abs', '--legacy-root', '/legacy'], output),
  )
  await expectCodeAsync('RELEASE_PROVENANCE_GENESIS_ARGUMENT_INVALID', () =>
    runReleaseGenesisCli([
      '--candidate-root', 'relative',
      '--managed-current-link', '/current',
      '--artifact-root', '/artifacts',
      '--deployment-control-root', '/control',
      '--pm2-name', 'x',
      '--health-url', HEALTH_URL,
      '--launcher-cwd', '/launcher',
      '--launcher-path', '/launcher/x.js',
      '--launcher-sha256', '0'.repeat(64),
      '--runtime-env-contract', '/env.json',
      '--runtime-env-contract-sha256', '0'.repeat(64),
    ], output),
  )

  const fixture = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(fixture)
    const args = [
      '--candidate-root', fixture.r1.releaseRoot,
      '--managed-current-link', fixture.managedCurrentLink,
      '--artifact-root', fixture.r1.artifactRoot,
      '--deployment-control-root', fixture.controlRoot,
      '--pm2-name', PM2_NAME,
      '--health-url', fixture.healthUrl,
      '--launcher-cwd', fixture.launcherCwd,
      '--launcher-path', fixture.launcherPath,
      '--launcher-sha256', fixture.launcherSha256,
      '--runtime-env-contract', fixture.runtimeEnvContractPath,
      '--runtime-env-contract-sha256', fixture.runtimeEnvContractSha256,
    ]
    assert.deepEqual(Object.keys(parseGenesisArgs(args)).sort(), [
      'artifactRoot',
      'candidateRoot',
      'deploymentControlRoot',
      'healthUrl',
      'launcherCwd',
      'launcherPath',
      'launcherSha256',
      'managedCurrentLink',
      'pm2Name',
      'runtimeEnvContractPath',
      'runtimeEnvContractSha256',
    ].sort())
    await runReleaseGenesisCli(args, output, { runner, healthProbe: async () => true })
    assert.deepEqual(messages, [`RELEASE_PROVENANCE_GENESIS_READY ${R1_RELEASE_ID}\n`])
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
  console.log('  PASS scenario7 CLI argument contract and ready marker')
}

function scenario8StaticNegativeScan(): void {
  const roots = [
    join(__dirname, '../src/release-provenance/release-genesis.ts'),
    join(__dirname, '../src/release-provenance/release-genesis-cli.ts'),
  ]
  const forbiddenPatterns: Array<{ label: string; pattern: RegExp }> = [
    { label: '.env file access', pattern: /['"`]\/?\.env['"`]|\/\.env\b/ },
    { label: 'DATABASE_URL', pattern: /DATABASE_URL/ },
    { label: 'Prisma', pattern: /\bPrisma\b/ },
    { label: 'Redis', pattern: /\bRedis\b/ },
    { label: 'apps/kiosk', pattern: /apps\/kiosk/ },
    { label: 'apps/admin', pattern: /apps\/admin/ },
    { label: 'legacy-root flag', pattern: /legacy-root|legacyRoot/ },
    { label: 'previous-root flag', pattern: /previous-root|previousRoot/ },
    { label: 'process.env', pattern: /process\.env/ },
    { label: 'env enumeration', pattern: /Object\.keys\(\s*process\.env|readdirSync\(\s*process\.env/ },
  ]
  for (const file of roots) {
    const source = readFileSync(file, 'utf8')
    for (const forbidden of forbiddenPatterns) {
      assert.equal(forbidden.pattern.test(source), false, `${file} must not contain ${forbidden.label}`)
    }
  }
  const loader = readFileSync(join(__dirname, '../src/release-provenance/release-runtime-contract.ts'), 'utf8')
  assert.equal(loader.includes('process.env[variable.name]'), true)
  console.log('  PASS scenario8 static negative scan rejects secret/legacy surfaces')
}

async function scenario9TrafficFake(): Promise<void> {
  const fixture = createGenesisFixture()
  try {
    const runner = createFakeGenesisRunner(fixture)
    const result = await runReleaseGenesis(genesisOptions(fixture, runner, async () => true))
    assert.equal(result.status, 'parallel-serving-r1')
    assert.equal(fixture.traffic.cutoverRequests, 0)
    assert.equal(fixture.traffic.target, 'legacy')
    fixture.traffic.requestCutover('PARALLEL_SERVING_R1')
    assert.equal(fixture.traffic.target, 'legacy')
    fixture.traffic.requestCutover('PARALLEL_SERVING_R2')
    assert.equal(fixture.traffic.target, 'managed')
    assert.equal(fixture.traffic.cutoverRequests, 2)
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
  console.log('  PASS scenario9 traffic fake never cut over from PARALLEL_SERVING_R1')
}

async function main(): Promise<void> {
  console.log('=== Release Genesis fixture ===')
  verifyManagedHealthUrlContract()
  await verifyLegacyHealthUrlFailsBeforeGenesisSideEffects()
  await scenario1TamperedProvenance()
  await scenario2PreexistingState()
  await scenario3PostStartMismatchCleanup()
  await scenario4CleanupUnverified()
  await scenario5SuccessAndReentry()
  await scenario6ActivateAfterGenesis()
  await scenario7CliContract()
  scenario8StaticNegativeScan()
  await scenario9TrafficFake()
  console.log('=== ALL PASS ===')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
