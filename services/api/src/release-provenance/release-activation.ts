import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync } from 'node:fs'
import { get } from 'node:http'
import { isAbsolute, join } from 'node:path'
import { ReleaseProvenanceError, verifyReleaseProvenance } from './release-provenance'

const LOCAL_HEALTH_URL = 'http://127.0.0.1:3010/api/v1/health'
const SAFE_PM2_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SHA256 = /^[0-9a-f]{64}$/

export type Pm2ProcessSnapshot = {
  name: string
  status: string
  cwd: string
  execPath: string
  scriptArgs: string
}

export type CommandRunner = {
  reload(pm2Name: string): void
  inspect(pm2Name: string): Pm2ProcessSnapshot
}

export type HealthProbe = (healthUrl: string) => Promise<boolean>

export type ReleaseActivationOptions = {
  candidateRoot: string
  currentLink: string
  artifactRoot: string
  pm2Name: string
  healthUrl: string
  launcherCwd: string
  launcherPath: string
  launcherSha256: string
  runner?: CommandRunner
  healthProbe?: HealthProbe
}

function fail(code: string): never {
  throw new ReleaseProvenanceError(code)
}

function assertAbsolute(value: string, code: string): void {
  if (!isAbsolute(value)) fail(code)
}

function assertPm2ArgumentPath(value: string, code: string): void {
  assertAbsolute(value, code)
  if (/\s/.test(value)) fail(code)
}

function assertHealthUrl(healthUrl: string): void {
  if (healthUrl !== LOCAL_HEALTH_URL) fail('RELEASE_PROVENANCE_HEALTH_URL_INVALID')
}

function assertPm2Name(pm2Name: string): void {
  if (!SAFE_PM2_NAME.test(pm2Name)) fail('RELEASE_PROVENANCE_PM2_NAME_INVALID')
}

function assertApprovedLauncher(launcherCwd: string, launcherPath: string, launcherSha256: string): { cwd: string; path: string; sha256: string } {
  if (!isAbsolute(launcherCwd) || !isAbsolute(launcherPath) || !SHA256.test(launcherSha256)) {
    fail('RELEASE_PROVENANCE_LAUNCHER_INVALID')
  }
  try {
    const cwdStat = lstatSync(launcherCwd)
    const launcherStat = lstatSync(launcherPath)
    if (!cwdStat.isDirectory() || cwdStat.isSymbolicLink() || !launcherStat.isFile() || launcherStat.isSymbolicLink() || launcherStat.size > 1024 * 1024) {
      fail('RELEASE_PROVENANCE_LAUNCHER_INVALID')
    }
    const cwd = realpathSync(launcherCwd)
    const path = realpathSync(launcherPath)
    const actualSha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (actualSha256 !== launcherSha256) fail('RELEASE_PROVENANCE_LAUNCHER_INVALID')
    return { cwd, path, sha256: launcherSha256 }
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    fail('RELEASE_PROVENANCE_LAUNCHER_INVALID')
  }
}

function readCurrentRelease(currentLink: string): string {
  assertAbsolute(currentLink, 'RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
  try {
    if (!lstatSync(currentLink).isSymbolicLink()) fail('RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
    return realpathSync(currentLink)
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    fail('RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
  }
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

function runPm2(args: readonly string[]): string {
  const result = spawnSync('pm2', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (result.error || result.status !== 0) fail('RELEASE_PROVENANCE_PM2_COMMAND_FAILED')
  return result.stdout ?? ''
}

const systemRunner: CommandRunner = {
  reload(pm2Name: string): void {
    runPm2(['reload', pm2Name, '--update-env'])
  },
  inspect(pm2Name: string): Pm2ProcessSnapshot {
    return parsePm2Describe(runPm2(['describe', pm2Name, '--no-color']))
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

function assertPm2Snapshot(
  snapshot: Pm2ProcessSnapshot,
  pm2Name: string,
  expectedLauncher: { cwd: string; path: string; sha256: string },
  currentLink: string,
  artifactRoot: string,
): void {
  let cwd: string
  let execPath: string
  try {
    cwd = realpathSync(snapshot.cwd)
    execPath = realpathSync(isAbsolute(snapshot.execPath) ? snapshot.execPath : join(snapshot.cwd, snapshot.execPath))
  } catch {
    fail('RELEASE_PROVENANCE_PM2_PATH_MISMATCH')
  }
  const expectedScriptArgs = `--current-link ${currentLink} --artifact-root ${artifactRoot} --launcher-sha256 ${expectedLauncher.sha256}`
  if (
    snapshot.name !== pm2Name ||
    snapshot.status !== 'online' ||
    cwd !== expectedLauncher.cwd ||
    execPath !== expectedLauncher.path ||
    snapshot.scriptArgs !== expectedScriptArgs
  ) {
    fail('RELEASE_PROVENANCE_PM2_PATH_MISMATCH')
  }
}

async function rollback(
  previousRoot: string,
  currentLink: string,
  artifactRoot: string,
  pm2Name: string,
  healthUrl: string,
  runner: CommandRunner,
  healthProbe: HealthProbe,
  launcher: { cwd: string; path: string; sha256: string },
): Promise<never> {
  try {
    verifyReleaseProvenance({ releaseRoot: previousRoot, artifactRoot })
    replaceCurrentLink(currentLink, previousRoot)
    if (readCurrentRelease(currentLink) !== previousRoot) fail('RELEASE_PROVENANCE_CURRENT_LINK_MISMATCH')
    runner.reload(pm2Name)
    assertPm2Snapshot(runner.inspect(pm2Name), pm2Name, launcher, currentLink, artifactRoot)
    if (!await healthProbe(healthUrl)) fail('RELEASE_PROVENANCE_POST_SWITCH_HEALTH_FAILED')
  } catch {
    fail('RELEASE_PROVENANCE_ROLLBACK_UNVERIFIED')
  }
  fail('RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK')
}

export async function activateRelease(options: ReleaseActivationOptions): Promise<{ status: 'activated'; releaseId: string }> {
  assertAbsolute(options.candidateRoot, 'RELEASE_PROVENANCE_RELEASE_ROOT_INVALID')
  assertPm2ArgumentPath(options.currentLink, 'RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
  assertPm2ArgumentPath(options.artifactRoot, 'RELEASE_PROVENANCE_ARTIFACT_ROOT_INVALID')
  assertPm2Name(options.pm2Name)
  assertHealthUrl(options.healthUrl)
  const launcher = assertApprovedLauncher(options.launcherCwd, options.launcherPath, options.launcherSha256)
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
    runner.reload(options.pm2Name)
    assertPm2Snapshot(runner.inspect(options.pm2Name), options.pm2Name, launcher, options.currentLink, options.artifactRoot)
    if (!await healthProbe(options.healthUrl)) fail('RELEASE_PROVENANCE_POST_SWITCH_HEALTH_FAILED')
  } catch {
    return rollback(previousRoot, options.currentLink, options.artifactRoot, options.pm2Name, options.healthUrl, runner, healthProbe, launcher)
  }
  return { status: 'activated', releaseId: candidate.releaseId }
}

type ActivationCliOutput = {
  write(message: string): unknown
}

function parseActivationArgs(args: readonly string[]): Omit<ReleaseActivationOptions, 'runner' | 'healthProbe'> {
  if (args.length !== 16) fail('RELEASE_PROVENANCE_ACTIVATION_ARGUMENT_INVALID')
  const values: Record<string, string> = {}
  const allowed = new Set(['--candidate-root', '--current-link', '--artifact-root', '--pm2-name', '--health-url', '--launcher-cwd', '--launcher-path', '--launcher-sha256'])
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
  if (!candidateRoot || !currentLink || !artifactRoot || !pm2Name || !healthUrl || !launcherCwd || !launcherPath || !launcherSha256) fail('RELEASE_PROVENANCE_ACTIVATION_ARGUMENT_INVALID')
  return { candidateRoot, currentLink, artifactRoot, pm2Name, healthUrl, launcherCwd, launcherPath, launcherSha256 }
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
