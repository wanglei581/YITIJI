import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { isAbsolute } from 'node:path'
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

export type { HealthProbe, Pm2ProcessSnapshot } from './release-runtime-contract'

export type CommandRunner = {
  reload(pm2Name: string, environment: ApprovedRuntimeEnvironment): void
  inspect(pm2Name: string, environment: ApprovedRuntimeEnvironment): Pm2ProcessSnapshot | null
}

export type ReleaseActivationOptions = {
  candidateRoot: string
  currentLink: string
  artifactRoot: string
  pm2Name: string
  healthUrl: string
  launcherCwd: string
  launcherPath: string
  launcherSha256: string
  runtimeEnvContractPath: string
  runtimeEnvContractSha256: string
  runner?: CommandRunner
  healthProbe?: HealthProbe
}

type ActivationLock = {
  path: string
  token: string
}

type Pm2CommandResult = {
  status: number | null
  stdout: string
  stderr: string
}

function fail(code: string): never {
  throw new ReleaseProvenanceError(code)
}

function replaceCurrentLink(currentLink: string, targetRoot: string): void {
  const temporaryLink = `${currentLink}.next-${randomUUID()}`
  try {
    symlinkSync(targetRoot, temporaryLink)
    renameSync(temporaryLink, currentLink)
  } catch (error) {
    try {
      unlinkSync(temporaryLink)
    } catch {
      // The failed temporary link is never used as the current release.
    }
    if (error instanceof ReleaseProvenanceError) throw error
    fail('RELEASE_PROVENANCE_LINK_SWITCH_FAILED')
  }
}

function acquireActivationLock(currentLink: string): ActivationLock {
  const path = `${currentLink}.activation.lock`
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
    fail('RELEASE_PROVENANCE_ACTIVATION_LOCKED')
  }
}

function releaseActivationLock(lock: ActivationLock): void {
  try {
    const stat = lstatSync(lock.path)
    if (!stat.isFile() || stat.isSymbolicLink() || readFileSync(lock.path, 'utf8') !== `${lock.token}\n`) {
      fail('RELEASE_PROVENANCE_ACTIVATION_LOCK_RELEASE_FAILED')
    }
    unlinkSync(lock.path)
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    fail('RELEASE_PROVENANCE_ACTIVATION_LOCK_RELEASE_FAILED')
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

function assertPresentPm2Snapshot(snapshot: Pm2ProcessSnapshot | null): Pm2ProcessSnapshot {
  if (snapshot === null) fail('RELEASE_PROVENANCE_PM2_INSPECT_INVALID')
  return snapshot
}

const systemRunner: CommandRunner = {
  reload(pm2Name: string, environment: ApprovedRuntimeEnvironment): void {
    const result = runPm2(['reload', pm2Name, '--update-env'], environment)
    if (result.status !== 0) fail('RELEASE_PROVENANCE_PM2_COMMAND_FAILED')
  },
  inspect(pm2Name: string, environment: ApprovedRuntimeEnvironment): Pm2ProcessSnapshot | null {
    const result = runPm2(['describe', pm2Name, '--no-color'], environment)
    if (isExactMissingPm2Process(result, pm2Name)) return null
    if (result.status !== 0) fail('RELEASE_PROVENANCE_PM2_COMMAND_FAILED')
    return parsePm2Describe(result.stdout)
  },
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
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { success?: unknown; data?: { status?: unknown; db?: unknown } }
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

async function rollback(
  previousRoot: string,
  currentLink: string,
  artifactRoot: string,
  pm2Name: string,
  healthUrl: string,
  environment: ApprovedRuntimeEnvironment,
  runner: CommandRunner,
  healthProbe: HealthProbe,
  launcher: StableLauncher,
): Promise<never> {
  try {
    verifyReleaseProvenance({ releaseRoot: previousRoot, artifactRoot })
    replaceCurrentLink(currentLink, previousRoot)
    if (readCurrentRelease(currentLink) !== previousRoot) fail('RELEASE_PROVENANCE_CURRENT_LINK_MISMATCH')
    verifyReleaseProvenance({ releaseRoot: previousRoot, artifactRoot })
    runner.reload(pm2Name, environment)
    assertPm2Snapshot(assertPresentPm2Snapshot(runner.inspect(pm2Name, environment)), pm2Name, launcher, currentLink, artifactRoot)
    if (!await healthProbe(healthUrl)) fail('RELEASE_PROVENANCE_POST_SWITCH_HEALTH_FAILED')
  } catch {
    fail('RELEASE_PROVENANCE_ROLLBACK_UNVERIFIED')
  }
  fail('RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK')
}

export async function activateRelease(options: ReleaseActivationOptions): Promise<{ status: 'activated'; releaseId: string }> {
  if (!isAbsolute(options.candidateRoot)) fail('RELEASE_PROVENANCE_RELEASE_ROOT_INVALID')
  assertPm2ArgumentPath(options.currentLink, 'RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
  assertPm2ArgumentPath(options.artifactRoot, 'RELEASE_PROVENANCE_ARTIFACT_ROOT_INVALID')
  assertPm2Name(options.pm2Name)
  assertLocalHealthUrl(options.healthUrl)
  const launcher = assertApprovedLauncher(options.launcherCwd, options.launcherPath, options.launcherSha256)
  const environment = loadApprovedRuntimeEnvironment(options.runtimeEnvContractPath, options.runtimeEnvContractSha256)
  const activationLock = acquireActivationLock(options.currentLink)
  try {
    const candidate = verifyReleaseProvenance({ releaseRoot: options.candidateRoot, artifactRoot: options.artifactRoot })
    const candidateRoot = realpathSync(options.candidateRoot)
    const previousRoot = readCurrentRelease(options.currentLink)
    if (candidateRoot === previousRoot) fail('RELEASE_PROVENANCE_CANDIDATE_IS_CURRENT')
    verifyReleaseProvenance({ releaseRoot: previousRoot, artifactRoot: options.artifactRoot })

    const runner = options.runner ?? systemRunner
    const healthProbe = options.healthProbe ?? systemHealthProbe
    replaceCurrentLink(options.currentLink, candidateRoot)
    try {
      if (readCurrentRelease(options.currentLink) !== candidateRoot) fail('RELEASE_PROVENANCE_CURRENT_LINK_MISMATCH')
      verifyReleaseProvenance({ releaseRoot: candidateRoot, artifactRoot: options.artifactRoot })
      runner.reload(options.pm2Name, environment)
      assertPm2Snapshot(assertPresentPm2Snapshot(runner.inspect(options.pm2Name, environment)), options.pm2Name, launcher, options.currentLink, options.artifactRoot)
      if (!await healthProbe(options.healthUrl)) fail('RELEASE_PROVENANCE_POST_SWITCH_HEALTH_FAILED')
    } catch {
      return rollback(previousRoot, options.currentLink, options.artifactRoot, options.pm2Name, options.healthUrl, environment, runner, healthProbe, launcher)
    }
    return { status: 'activated', releaseId: candidate.releaseId }
  } finally {
    releaseActivationLock(activationLock)
  }
}

type ActivationCliOutput = {
  write(message: string): unknown
}

function parseActivationArgs(args: readonly string[]): Omit<ReleaseActivationOptions, 'runner' | 'healthProbe'> {
  if (args.length !== 20) fail('RELEASE_PROVENANCE_ACTIVATION_ARGUMENT_INVALID')
  const values: Record<string, string> = {}
  const allowed = new Set([
    '--candidate-root',
    '--current-link',
    '--artifact-root',
    '--pm2-name',
    '--health-url',
    '--launcher-cwd',
    '--launcher-path',
    '--launcher-sha256',
    '--runtime-env-contract-path',
    '--runtime-env-contract-sha256',
  ])
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag || !value || !allowed.has(flag) || values[flag] !== undefined) fail('RELEASE_PROVENANCE_ACTIVATION_ARGUMENT_INVALID')
    values[flag] = value
  }
  const candidateRoot = values['--candidate-root']
  const currentLink = values['--current-link']
  const artifactRoot = values['--artifact-root']
  const pm2Name = values['--pm2-name']
  const healthUrl = values['--health-url']
  const launcherCwd = values['--launcher-cwd']
  const launcherPath = values['--launcher-path']
  const launcherSha256 = values['--launcher-sha256']
  const runtimeEnvContractPath = values['--runtime-env-contract-path']
  const runtimeEnvContractSha256 = values['--runtime-env-contract-sha256']
  if (!candidateRoot || !currentLink || !artifactRoot || !pm2Name || !healthUrl || !launcherCwd || !launcherPath || !launcherSha256 || !runtimeEnvContractPath || !runtimeEnvContractSha256) {
    fail('RELEASE_PROVENANCE_ACTIVATION_ARGUMENT_INVALID')
  }
  return {
    candidateRoot,
    currentLink,
    artifactRoot,
    pm2Name,
    healthUrl,
    launcherCwd,
    launcherPath,
    launcherSha256,
    runtimeEnvContractPath,
    runtimeEnvContractSha256,
  }
}

export async function runReleaseActivationCli(args: readonly string[], output: ActivationCliOutput = process.stdout): Promise<void> {
  const result = await activateRelease(parseActivationArgs(args))
  output.write(`RELEASE_PROVENANCE_ACTIVATED ${result.releaseId}\n`)
}

function printError(error: unknown): void {
  const code = error instanceof ReleaseProvenanceError ? error.code : 'RELEASE_PROVENANCE_ACTIVATION_FAILED'
  process.stderr.write(`${code}\n`)
}

if (require.main === module) {
  runReleaseActivationCli(process.argv.slice(2)).catch((error: unknown) => {
    printError(error)
    process.exitCode = 1
  })
}
