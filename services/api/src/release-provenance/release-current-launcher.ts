import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { ReleaseProvenanceError } from './release-provenance'

const GUARDED_ENTRYPOINT = 'services/api/dist/release-provenance/release-guard.js'
const SHA256 = /^[0-9a-f]{64}$/

export type SpawnGuard = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

export type CurrentLauncherOptions = {
  currentLink: string
  artifactRoot: string
  launcherPath: string
  launcherSha256: string
  spawnGuard?: SpawnGuard
}

function fail(code: string): never {
  throw new ReleaseProvenanceError(code)
}

function resolveCurrentRelease(currentLink: string): string {
  if (!isAbsolute(currentLink)) fail('RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
  try {
    if (!lstatSync(currentLink).isSymbolicLink()) fail('RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
    return realpathSync(currentLink)
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    fail('RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
  }
}

function assertLauncherSelf(launcherPath: string, launcherSha256: string): void {
  if (!isAbsolute(launcherPath) || !SHA256.test(launcherSha256)) fail('RELEASE_PROVENANCE_LAUNCHER_SELF_HASH_INVALID')
  try {
    const stat = lstatSync(launcherPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || realpathSync(launcherPath) !== launcherPath) {
      fail('RELEASE_PROVENANCE_LAUNCHER_SELF_HASH_INVALID')
    }
    const actualSha256 = createHash('sha256').update(readFileSync(launcherPath)).digest('hex')
    if (actualSha256 !== launcherSha256) fail('RELEASE_PROVENANCE_LAUNCHER_SELF_HASH_INVALID')
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    fail('RELEASE_PROVENANCE_LAUNCHER_SELF_HASH_INVALID')
  }
}

function waitForChild(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    const forwardSigterm = (): void => {
      child.kill('SIGTERM')
    }
    const forwardSigint = (): void => {
      child.kill('SIGINT')
    }
    const cleanup = (): void => {
      process.removeListener('SIGTERM', forwardSigterm)
      process.removeListener('SIGINT', forwardSigint)
    }
    process.once('SIGTERM', forwardSigterm)
    process.once('SIGINT', forwardSigint)
    child.once('error', () => {
      cleanup()
      reject(new ReleaseProvenanceError('RELEASE_PROVENANCE_LAUNCHER_SPAWN_FAILED'))
    })
    child.once('exit', (code) => {
      cleanup()
      resolve(code ?? 1)
    })
  })
}

export function runCurrentLauncher(options: CurrentLauncherOptions): Promise<number> {
  if (!isAbsolute(options.artifactRoot) || /\s/.test(options.artifactRoot) || /\s/.test(options.currentLink)) fail('RELEASE_PROVENANCE_ARTIFACT_ROOT_INVALID')
  assertLauncherSelf(options.launcherPath, options.launcherSha256)
  const releaseRoot = resolveCurrentRelease(options.currentLink)
  const guardPath = join(releaseRoot, GUARDED_ENTRYPOINT)
  try {
    const guardStat = lstatSync(guardPath)
    if (!guardStat.isFile() || guardStat.isSymbolicLink() || realpathSync(guardPath) !== guardPath) {
      fail('RELEASE_PROVENANCE_GUARD_ENTRYPOINT_INVALID')
    }
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    fail('RELEASE_PROVENANCE_GUARD_ENTRYPOINT_INVALID')
  }
  const spawnGuard = options.spawnGuard ?? spawn
  const child = spawnGuard(process.execPath, [guardPath, '--release-root', releaseRoot, '--artifact-root', options.artifactRoot], {
    cwd: releaseRoot,
    env: process.env,
    stdio: 'inherit',
  })
  return waitForChild(child)
}

function printError(error: unknown): void {
  const code = error instanceof ReleaseProvenanceError ? error.code : 'RELEASE_PROVENANCE_LAUNCHER_FAILED'
  process.stderr.write(`${code}\n`)
}

if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.length !== 6 || args[0] !== '--current-link' || args[2] !== '--artifact-root' || args[4] !== '--launcher-sha256' || !args[1] || !args[3] || !args[5]) {
    printError(new ReleaseProvenanceError('RELEASE_PROVENANCE_LAUNCHER_ARGUMENT_INVALID'))
    process.exitCode = 1
  } else {
    runCurrentLauncher({ currentLink: args[1], artifactRoot: args[3], launcherPath: realpathSync(process.argv[1]), launcherSha256: args[5] }).then(
      (code) => {
        process.exitCode = code
      },
      (error: unknown) => {
        printError(error)
        process.exitCode = 1
      },
    )
  }
}
