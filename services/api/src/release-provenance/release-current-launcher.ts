import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { ReleaseProvenanceError } from './release-provenance'

const GUARDED_ENTRYPOINT = 'services/api/dist/release-provenance/release-guard.js'

export type SpawnGuard = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

export type CurrentLauncherOptions = {
  currentLink: string
  artifactRoot: string
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
  if (!isAbsolute(options.artifactRoot)) fail('RELEASE_PROVENANCE_ARTIFACT_ROOT_INVALID')
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
  if (args.length !== 4 || args[0] !== '--current-link' || args[2] !== '--artifact-root' || !args[1] || !args[3]) {
    printError(new ReleaseProvenanceError('RELEASE_PROVENANCE_LAUNCHER_ARGUMENT_INVALID'))
    process.exitCode = 1
  } else {
    runCurrentLauncher({ currentLink: args[1], artifactRoot: args[3] }).then(
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
