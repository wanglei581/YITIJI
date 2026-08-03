import { isAbsolute } from 'node:path'
import { ReleaseProvenanceError } from './release-provenance'
import {
  runReleaseGenesis,
  type GenesisRunner,
  type ReleaseGenesisOptions,
} from './release-genesis'
import type { HealthProbe } from './release-runtime-contract'

type GenesisCliOutput = {
  write(message: string): unknown
}

type GenesisCliDependencies = {
  runner?: GenesisRunner
  healthProbe?: HealthProbe
}

const GENESIS_FLAGS = [
  '--candidate-root',
  '--managed-current-link',
  '--artifact-root',
  '--deployment-control-root',
  '--pm2-name',
  '--health-url',
  '--launcher-cwd',
  '--launcher-path',
  '--launcher-sha256',
  '--runtime-env-contract',
  '--runtime-env-contract-sha256',
] as const

const PATH_FLAGS = new Set<string>([
  '--candidate-root',
  '--managed-current-link',
  '--artifact-root',
  '--deployment-control-root',
  '--launcher-cwd',
  '--launcher-path',
  '--runtime-env-contract',
])

function fail(code: string): never {
  throw new ReleaseProvenanceError(code)
}

function assertCliPath(value: string): void {
  if (!isAbsolute(value) || /\s/.test(value)) fail('RELEASE_PROVENANCE_GENESIS_ARGUMENT_INVALID')
}

export function parseGenesisArgs(args: readonly string[]): Omit<ReleaseGenesisOptions, 'runner' | 'healthProbe'> {
  if (args.length !== 22) fail('RELEASE_PROVENANCE_GENESIS_ARGUMENT_INVALID')
  const values: Record<string, string> = {}
  const allowed = new Set<string>(GENESIS_FLAGS)
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag || !value || !allowed.has(flag) || values[flag] !== undefined) {
      fail('RELEASE_PROVENANCE_GENESIS_ARGUMENT_INVALID')
    }
    if (PATH_FLAGS.has(flag)) assertCliPath(value)
    values[flag] = value
  }
  for (const flag of GENESIS_FLAGS) {
    if (!values[flag]) fail('RELEASE_PROVENANCE_GENESIS_ARGUMENT_INVALID')
  }
  return {
    candidateRoot: values['--candidate-root'],
    managedCurrentLink: values['--managed-current-link'],
    artifactRoot: values['--artifact-root'],
    deploymentControlRoot: values['--deployment-control-root'],
    pm2Name: values['--pm2-name'],
    healthUrl: values['--health-url'],
    launcherCwd: values['--launcher-cwd'],
    launcherPath: values['--launcher-path'],
    launcherSha256: values['--launcher-sha256'],
    runtimeEnvContractPath: values['--runtime-env-contract'],
    runtimeEnvContractSha256: values['--runtime-env-contract-sha256'],
  }
}

export async function runReleaseGenesisCli(
  args: readonly string[],
  output: GenesisCliOutput = process.stdout,
  dependencies: GenesisCliDependencies = {},
): Promise<void> {
  const parsed = parseGenesisArgs(args)
  const result = await runReleaseGenesis({
    ...parsed,
    runner: dependencies.runner,
    healthProbe: dependencies.healthProbe,
  })
  output.write(`RELEASE_PROVENANCE_GENESIS_READY ${result.releaseId}\n`)
}

function printError(error: unknown): void {
  const code = error instanceof ReleaseProvenanceError ? error.code : 'RELEASE_PROVENANCE_GENESIS_FAILED'
  process.stderr.write(`${code}\n`)
}

if (require.main === module) {
  runReleaseGenesisCli(process.argv.slice(2)).catch((error: unknown) => {
    printError(error)
    process.exitCode = 1
  })
}
