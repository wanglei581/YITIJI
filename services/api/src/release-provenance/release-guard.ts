import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { ReleaseProvenanceError, verifyReleaseProvenance } from './release-provenance'

const API_ENTRYPOINT = 'services/api/dist/main.js'

export type SpawnMain = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

export type ReleaseGuardOptions = {
  releaseRoot: string
  artifactRoot: string
  spawnMain?: SpawnMain
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
      reject(new ReleaseProvenanceError('RELEASE_PROVENANCE_GUARD_SPAWN_FAILED'))
    })
    child.once('exit', (code) => {
      cleanup()
      resolve(code ?? 1)
    })
  })
}

export function runReleaseGuard(options: ReleaseGuardOptions): Promise<number> {
  verifyReleaseProvenance({ releaseRoot: options.releaseRoot, artifactRoot: options.artifactRoot })
  const releaseRoot = realpathSync(options.releaseRoot)
  const spawnMain = options.spawnMain ?? spawn
  const child = spawnMain(process.execPath, [API_ENTRYPOINT], {
    cwd: releaseRoot,
    env: process.env,
    stdio: 'inherit',
  })
  return waitForChild(child)
}

function printError(error: unknown): void {
  const code = error instanceof ReleaseProvenanceError ? error.code : 'RELEASE_PROVENANCE_GUARD_FAILED'
  process.stderr.write(`${code}\n`)
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const values: Record<string, string> = {}
  if (args.length !== 4 || args[0] !== '--release-root' || args[2] !== '--artifact-root' || !args[1] || !args[3]) {
    printError(new ReleaseProvenanceError('RELEASE_PROVENANCE_GUARD_ARGUMENT_INVALID'))
    process.exitCode = 1
  } else {
    values['--release-root'] = args[1]
    values['--artifact-root'] = args[3]
    runReleaseGuard({ releaseRoot: values['--release-root'], artifactRoot: values['--artifact-root'] })
      .then((code) => {
        process.exitCode = code
      })
      .catch((error) => {
        printError(error)
        process.exitCode = 1
      })
  }
}
