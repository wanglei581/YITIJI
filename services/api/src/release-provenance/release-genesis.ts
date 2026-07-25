import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { get } from 'node:http'
import { isAbsolute, join } from 'node:path'
import { ReleaseProvenanceError, verifyReleaseProvenance } from './release-provenance'
import {
  assertApprovedLauncher,
  assertLocalHealthUrl,
  assertPm2ArgumentPath,
  assertPm2Name,
  assertPm2Snapshot,
  loadApprovedRuntimeEnvironment,
  readCurrentRelease,
  type ApprovedRuntimeEnvironment,
  type HealthProbe,
  type Pm2ProcessSnapshot,
  type StableLauncher,
} from './release-runtime-contract'

export type ManagedProcessStart = {
  pm2Name: string
  launcher: StableLauncher
  managedCurrentLink: string
  artifactRoot: string
  environment: ApprovedRuntimeEnvironment
}

export type GenesisRunner = {
  inspect(pm2Name: string, environment: ApprovedRuntimeEnvironment): Pm2ProcessSnapshot | null
  start(options: ManagedProcessStart): void
  stop(pm2Name: string): void
}

export type ReleaseGenesisOptions = {
  candidateRoot: string
  managedCurrentLink: string
  artifactRoot: string
  deploymentControlRoot: string
  pm2Name: string
  healthUrl: string
  launcherCwd: string
  launcherPath: string
  launcherSha256: string
  runtimeEnvContractPath: string
  runtimeEnvContractSha256: string
  runner?: GenesisRunner
  healthProbe?: HealthProbe
}

export type GenesisResult = {
  status: 'parallel-serving-r1'
  releaseId: string
}

const INTENT_FILE = 'GENESIS_INTENT.json'
const SUCCESS_FILE = 'GENESIS_SUCCESS.json'
const FAILURE_FILE = 'GENESIS_FAILURE.json'
const LOCK_FILE = 'GENESIS.lock'

type GenesisLock = {
  path: string
  token: string
}

type ControlStatus = 'PREPARING' | 'PARALLEL_SERVING_R1' | 'FAILED_CLOSED'

type GenesisControlRecord = {
  schemaVersion: 1
  status: ControlStatus
  timestamp: string
  releaseId: string | null
  pm2Name: string
  launcherSha256: string
  candidateRootSha256: string
  managedCurrentLinkSha256: string
  artifactRootSha256: string
  deploymentControlRootSha256: string
  runtimeEnvContractSha256: string
  healthOk: boolean | null
  failureCode: string | null
}

type Pm2CommandResult = {
  status: number | null
  stdout: string
  stderr: string
}

function fail(code: string): never {
  throw new ReleaseProvenanceError(code)
}

function pathIdentity(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const expectedKeys = [...expected].sort()
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertDeploymentControlRoot(value: string): string {
  assertPm2ArgumentPath(value, 'RELEASE_PROVENANCE_GENESIS_CONTROL_ROOT_INVALID')
  try {
    const stat = lstatSync(value)
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('RELEASE_PROVENANCE_GENESIS_CONTROL_ROOT_INVALID')
    return realpathSync(value)
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    fail('RELEASE_PROVENANCE_GENESIS_CONTROL_ROOT_INVALID')
  }
}

function controlPath(controlRoot: string, name: string): string {
  return join(controlRoot, name)
}

function readControlRecord(path: string): GenesisControlRecord | 'missing' | 'invalid' {
  try {
    if (!existsSync(path)) return 'missing'
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) return 'invalid'
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(parsed) || !hasExactKeys(parsed, [
      'schemaVersion',
      'status',
      'timestamp',
      'releaseId',
      'pm2Name',
      'launcherSha256',
      'candidateRootSha256',
      'managedCurrentLinkSha256',
      'artifactRootSha256',
      'deploymentControlRootSha256',
      'runtimeEnvContractSha256',
      'healthOk',
      'failureCode',
    ])) {
      return 'invalid'
    }
    if (
      parsed.schemaVersion !== 1 ||
      (parsed.status !== 'PREPARING' && parsed.status !== 'PARALLEL_SERVING_R1' && parsed.status !== 'FAILED_CLOSED') ||
      typeof parsed.timestamp !== 'string' ||
      !(parsed.releaseId === null || typeof parsed.releaseId === 'string') ||
      typeof parsed.pm2Name !== 'string' ||
      typeof parsed.launcherSha256 !== 'string' ||
      typeof parsed.candidateRootSha256 !== 'string' ||
      typeof parsed.managedCurrentLinkSha256 !== 'string' ||
      typeof parsed.artifactRootSha256 !== 'string' ||
      typeof parsed.deploymentControlRootSha256 !== 'string' ||
      typeof parsed.runtimeEnvContractSha256 !== 'string' ||
      !(parsed.healthOk === null || typeof parsed.healthOk === 'boolean') ||
      !(parsed.failureCode === null || typeof parsed.failureCode === 'string')
    ) {
      return 'invalid'
    }
    return parsed as GenesisControlRecord
  } catch {
    return 'invalid'
  }
}

function assertControlStateUninitialized(controlRoot: string): void {
  const intent = readControlRecord(controlPath(controlRoot, INTENT_FILE))
  const success = readControlRecord(controlPath(controlRoot, SUCCESS_FILE))
  const failure = readControlRecord(controlPath(controlRoot, FAILURE_FILE))

  if (intent === 'invalid' || success === 'invalid' || failure === 'invalid') {
    fail('RELEASE_PROVENANCE_GENESIS_CONTROL_STATE_INVALID')
  }
  if (intent === 'missing' && success === 'missing' && failure === 'missing') return
  if (
    intent !== 'missing' &&
    intent.status === 'PREPARING' &&
    success !== 'missing' &&
    success.status === 'PARALLEL_SERVING_R1' &&
    failure === 'missing'
  ) {
    fail('RELEASE_PROVENANCE_GENESIS_ALREADY_INITIALIZED')
  }
  fail('RELEASE_PROVENANCE_GENESIS_CONTROL_STATE_INVALID')
}

function assertManagedCurrentAbsent(managedCurrentLink: string): void {
  try {
    lstatSync(managedCurrentLink)
    fail('RELEASE_PROVENANCE_GENESIS_MANAGED_CURRENT_EXISTS')
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    fail('RELEASE_PROVENANCE_GENESIS_MANAGED_CURRENT_EXISTS')
  }
}

function writeControlRecordWx(path: string, record: GenesisControlRecord): void {
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8')
  } finally {
    closeSync(descriptor)
  }
}

function buildControlRecord(input: {
  status: ControlStatus
  releaseId: string | null
  pm2Name: string
  launcherSha256: string
  candidateRoot: string
  managedCurrentLink: string
  artifactRoot: string
  deploymentControlRoot: string
  runtimeEnvContractSha256: string
  healthOk: boolean | null
  failureCode: string | null
}): GenesisControlRecord {
  return {
    schemaVersion: 1,
    status: input.status,
    timestamp: new Date().toISOString(),
    releaseId: input.releaseId,
    pm2Name: input.pm2Name,
    launcherSha256: input.launcherSha256,
    candidateRootSha256: pathIdentity(input.candidateRoot),
    managedCurrentLinkSha256: pathIdentity(input.managedCurrentLink),
    artifactRootSha256: pathIdentity(input.artifactRoot),
    deploymentControlRootSha256: pathIdentity(input.deploymentControlRoot),
    runtimeEnvContractSha256: input.runtimeEnvContractSha256,
    healthOk: input.healthOk,
    failureCode: input.failureCode,
  }
}

function acquireGenesisLock(controlRoot: string): GenesisLock {
  const path = controlPath(controlRoot, LOCK_FILE)
  const token = randomUUID()
  try {
    const descriptor = openSync(path, 'wx', 0o600)
    try {
      writeFileSync(descriptor, `${token}\n`, 'utf8')
    } finally {
      closeSync(descriptor)
    }
    return { path, token }
  } catch {
    fail('RELEASE_PROVENANCE_GENESIS_LOCKED')
  }
}

function releaseGenesisLock(lock: GenesisLock): void {
  try {
    const stat = lstatSync(lock.path)
    if (!stat.isFile() || stat.isSymbolicLink() || readFileSync(lock.path, 'utf8') !== `${lock.token}\n`) {
      fail('RELEASE_PROVENANCE_GENESIS_LOCK_RELEASE_FAILED')
    }
    unlinkSync(lock.path)
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    fail('RELEASE_PROVENANCE_GENESIS_LOCK_RELEASE_FAILED')
  }
}

function createManagedCurrent(managedCurrentLink: string, candidateRoot: string): void {
  try {
    symlinkSync(candidateRoot, managedCurrentLink)
  } catch {
    fail('RELEASE_PROVENANCE_GENESIS_CURRENT_CREATE_FAILED')
  }
  if (readCurrentRelease(managedCurrentLink) !== candidateRoot) {
    fail('RELEASE_PROVENANCE_GENESIS_CURRENT_CREATE_FAILED')
  }
}

function parsePm2Describe(output: string): Pm2ProcessSnapshot {
  const fields = new Map<string, string>()
  for (const rawLine of output.split('\n')) {
    const cells = rawLine
      .split('│')
      .map((cell) => cell.trim())
      .filter(Boolean)
    if (cells.length < 2) continue
    for (let index = 0; index + 1 < cells.length; index += 2) {
      fields.set(cells[index].toLowerCase(), cells[index + 1])
    }
  }
  const name = fields.get('name')
  const status = fields.get('status')
  const cwd = fields.get('exec cwd')
  const execPath = fields.get('script path')
  const scriptArgs = fields.get('script args')
  if (!name || !status || !cwd || !execPath || !scriptArgs) fail('RELEASE_PROVENANCE_PM2_INSPECT_INVALID')
  return { name, status, cwd, execPath, scriptArgs }
}

function runPm2(args: readonly string[], environment: ApprovedRuntimeEnvironment): Pm2CommandResult {
  const result = spawnSync('pm2', args, {
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) fail('RELEASE_PROVENANCE_PM2_COMMAND_FAILED')
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  }
}

function isExactMissingPm2Process(result: Pm2CommandResult, pm2Name: string): boolean {
  const message = `[PM2][WARN] ${pm2Name} doesn't exist\n`
  return (
    (result.status === 0 || result.status === 1) &&
    ((result.stdout === message && result.stderr === '') || (result.stdout === '' && result.stderr === message))
  )
}

function createSystemRunner(): GenesisRunner {
  let startEnvironment: ApprovedRuntimeEnvironment | undefined
  return {
    inspect(pm2Name, environment) {
      const result = runPm2(['describe', pm2Name, '--no-color'], environment)
      if (isExactMissingPm2Process(result, pm2Name)) return null
      if (result.status !== 0) fail('RELEASE_PROVENANCE_PM2_COMMAND_FAILED')
      return parsePm2Describe(result.stdout)
    },
    start(options) {
      startEnvironment = options.environment
      const result = runPm2(
        [
          'start',
          options.launcher.path,
          '--name',
          options.pm2Name,
          '--cwd',
          options.launcher.cwd,
          '--',
          '--current-link',
          options.managedCurrentLink,
          '--artifact-root',
          options.artifactRoot,
          '--launcher-sha256',
          options.launcher.sha256,
        ],
        options.environment,
      )
      if (result.status !== 0) fail('RELEASE_PROVENANCE_PM2_COMMAND_FAILED')
    },
    stop(pm2Name) {
      if (!startEnvironment) fail('RELEASE_PROVENANCE_PM2_COMMAND_FAILED')
      const result = runPm2(['delete', pm2Name], startEnvironment)
      if (result.status !== 0) fail('RELEASE_PROVENANCE_PM2_COMMAND_FAILED')
    },
  }
}

const systemHealthProbe: HealthProbe = async (healthUrl) =>
  new Promise((resolve) => {
    let settled = false
    const finish = (healthy: boolean): void => {
      if (settled) return
      settled = true
      resolve(healthy)
    }
    const request = get(healthUrl, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 16 * 1024) {
          response.destroy()
          finish(false)
          return
        }
        chunks.push(chunk)
      })
      response.on('error', () => finish(false))
      response.on('end', () => {
        if (response.statusCode !== 200) return finish(false)
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            success?: unknown
            data?: { status?: unknown; db?: unknown }
          }
          finish(body.success === true && body.data?.status === 'ok' && body.data.db === 'postgres')
        } catch {
          finish(false)
        }
      })
    })
    request.setTimeout(5_000, () => {
      request.destroy()
      finish(false)
    })
    request.on('error', () => finish(false))
  })

function errorCode(error: unknown): string {
  return error instanceof ReleaseProvenanceError ? error.code : 'RELEASE_PROVENANCE_GENESIS_FAILED'
}

function cleanupGenesis(input: {
  startedByThisCall: boolean
  createdCurrent: boolean
  runner: GenesisRunner
  pm2Name: string
  managedCurrentLink: string
  candidateRoot: string
  controlRoot: string
  failureCode: string
  launcherSha256: string
  artifactRoot: string
  runtimeEnvContractSha256: string
  releaseId: string | null
}): void {
  let cleanupUnverified = false

  if (input.startedByThisCall) {
    try {
      input.runner.stop(input.pm2Name)
    } catch {
      cleanupUnverified = true
    }
  }

  if (input.createdCurrent) {
    try {
      const current = readCurrentRelease(input.managedCurrentLink)
      if (current !== input.candidateRoot) {
        cleanupUnverified = true
      } else {
        unlinkSync(input.managedCurrentLink)
      }
    } catch {
      cleanupUnverified = true
    }
  }

  try {
    writeControlRecordWx(
      controlPath(input.controlRoot, FAILURE_FILE),
      buildControlRecord({
        status: 'FAILED_CLOSED',
        releaseId: input.releaseId,
        pm2Name: input.pm2Name,
        launcherSha256: input.launcherSha256,
        candidateRoot: input.candidateRoot,
        managedCurrentLink: input.managedCurrentLink,
        artifactRoot: input.artifactRoot,
        deploymentControlRoot: input.controlRoot,
        runtimeEnvContractSha256: input.runtimeEnvContractSha256,
        healthOk: false,
        failureCode: input.failureCode,
      }),
    )
  } catch {
    cleanupUnverified = true
  }

  if (cleanupUnverified) fail('RELEASE_PROVENANCE_GENESIS_CLEANUP_UNVERIFIED')
}

export async function runReleaseGenesis(options: ReleaseGenesisOptions): Promise<GenesisResult> {
  if (!isAbsolute(options.candidateRoot) || /\s/.test(options.candidateRoot)) {
    fail('RELEASE_PROVENANCE_RELEASE_ROOT_INVALID')
  }
  assertPm2ArgumentPath(options.managedCurrentLink, 'RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
  assertPm2ArgumentPath(options.artifactRoot, 'RELEASE_PROVENANCE_ARTIFACT_ROOT_INVALID')
  assertPm2Name(options.pm2Name)
  assertLocalHealthUrl(options.healthUrl)
  const controlRoot = assertDeploymentControlRoot(options.deploymentControlRoot)
  const launcher = assertApprovedLauncher(options.launcherCwd, options.launcherPath, options.launcherSha256)
  const candidateRoot = realpathSync(options.candidateRoot)
  const runner = options.runner ?? createSystemRunner()
  const healthProbe = options.healthProbe ?? systemHealthProbe
  const lock = acquireGenesisLock(controlRoot)

  let startedByThisCall = false
  let createdCurrent = false
  let intentWritten = false
  let releaseId: string | null = null
  let succeeded = false
  let result: GenesisResult | undefined

  try {
    const environment = loadApprovedRuntimeEnvironment(options.runtimeEnvContractPath, options.runtimeEnvContractSha256)
    assertControlStateUninitialized(controlRoot)
    assertManagedCurrentAbsent(options.managedCurrentLink)
    if (runner.inspect(options.pm2Name, environment) !== null) {
      fail('RELEASE_PROVENANCE_GENESIS_PM2_EXISTS')
    }

    writeControlRecordWx(
      controlPath(controlRoot, INTENT_FILE),
      buildControlRecord({
        status: 'PREPARING',
        releaseId: null,
        pm2Name: options.pm2Name,
        launcherSha256: launcher.sha256,
        candidateRoot,
        managedCurrentLink: options.managedCurrentLink,
        artifactRoot: options.artifactRoot,
        deploymentControlRoot: controlRoot,
        runtimeEnvContractSha256: options.runtimeEnvContractSha256,
        healthOk: null,
        failureCode: null,
      }),
    )
    intentWritten = true

    try {
      const verified = verifyReleaseProvenance({ releaseRoot: candidateRoot, artifactRoot: options.artifactRoot })
      releaseId = verified.releaseId
      createManagedCurrent(options.managedCurrentLink, candidateRoot)
      createdCurrent = true
      runner.start({
        pm2Name: options.pm2Name,
        launcher,
        managedCurrentLink: options.managedCurrentLink,
        artifactRoot: options.artifactRoot,
        environment,
      })
      startedByThisCall = true
      const snapshot = runner.inspect(options.pm2Name, environment)
      if (snapshot === null) fail('RELEASE_PROVENANCE_PM2_INSPECT_INVALID')
      assertPm2Snapshot(snapshot, options.pm2Name, launcher, options.managedCurrentLink, options.artifactRoot)
      if (!await healthProbe(options.healthUrl)) fail('RELEASE_PROVENANCE_GENESIS_HEALTH_FAILED')
      writeControlRecordWx(
        controlPath(controlRoot, SUCCESS_FILE),
        buildControlRecord({
          status: 'PARALLEL_SERVING_R1',
          releaseId,
          pm2Name: options.pm2Name,
          launcherSha256: launcher.sha256,
          candidateRoot,
          managedCurrentLink: options.managedCurrentLink,
          artifactRoot: options.artifactRoot,
          deploymentControlRoot: controlRoot,
          runtimeEnvContractSha256: options.runtimeEnvContractSha256,
          healthOk: true,
          failureCode: null,
        }),
      )
      succeeded = true
      result = { status: 'parallel-serving-r1', releaseId }
    } catch (error) {
      if (!intentWritten) throw error
      const code = errorCode(error)
      cleanupGenesis({
        startedByThisCall,
        createdCurrent,
        runner,
        pm2Name: options.pm2Name,
        managedCurrentLink: options.managedCurrentLink,
        candidateRoot,
        controlRoot,
        failureCode: code,
        launcherSha256: launcher.sha256,
        artifactRoot: options.artifactRoot,
        runtimeEnvContractSha256: options.runtimeEnvContractSha256,
        releaseId,
      })
      fail(code)
    }
  } finally {
    if (succeeded) {
      releaseGenesisLock(lock)
    } else {
      try {
        releaseGenesisLock(lock)
      } catch {
        // Keep the primary genesis failure code for callers.
      }
    }
  }

  if (!result) fail('RELEASE_PROVENANCE_GENESIS_FAILED')
  return result
}
