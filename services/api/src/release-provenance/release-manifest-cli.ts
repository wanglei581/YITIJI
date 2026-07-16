import { isAbsolute } from 'node:path'
import {
  createReleaseManifest,
  ReleaseProvenanceError,
  verifyReleaseProvenance,
} from './release-provenance'

type CliOutput = {
  write(message: string): unknown
}

type CreateArguments = {
  releaseRoot: string
  artifactRoot: string
  releaseId: string
  gitCommit: string
  sourceArchivePath: string
  createdAt: string
  previousReleaseId: string | null
  pnpmVersion: string
}

type VerifyArguments = {
  releaseRoot: string
  artifactRoot: string
}

function fail(code: string): never {
  throw new ReleaseProvenanceError(code)
}

function parseFlags(args: readonly string[], allowedFlags: readonly string[]): Record<string, string> {
  if (args.length % 2 !== 0) fail('RELEASE_PROVENANCE_CLI_ARGUMENT_INVALID')
  const values: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag || !value || !allowedFlags.includes(flag) || values[flag] !== undefined) {
      fail('RELEASE_PROVENANCE_CLI_ARGUMENT_INVALID')
    }
    values[flag] = value
  }
  return values
}

function required(values: Record<string, string>, flag: string): string {
  const value = values[flag]
  if (!value) fail('RELEASE_PROVENANCE_CLI_ARGUMENT_MISSING')
  return value
}

function absolute(value: string): string {
  if (!isAbsolute(value)) fail('RELEASE_PROVENANCE_CLI_PATH_INVALID')
  return value
}

function parseCreate(args: readonly string[]): CreateArguments {
  const values = parseFlags(args, [
    '--release-root',
    '--artifact-root',
    '--release-id',
    '--git-commit',
    '--source-archive',
    '--created-at',
    '--previous-release-id',
    '--pnpm-version',
  ])
  return {
    releaseRoot: absolute(required(values, '--release-root')),
    artifactRoot: absolute(required(values, '--artifact-root')),
    releaseId: required(values, '--release-id'),
    gitCommit: required(values, '--git-commit'),
    sourceArchivePath: absolute(required(values, '--source-archive')),
    createdAt: required(values, '--created-at'),
    previousReleaseId: values['--previous-release-id'] ?? null,
    pnpmVersion: required(values, '--pnpm-version'),
  }
}

function parseVerify(args: readonly string[]): VerifyArguments {
  const values = parseFlags(args, ['--release-root', '--artifact-root'])
  return {
    releaseRoot: absolute(required(values, '--release-root')),
    artifactRoot: absolute(required(values, '--artifact-root')),
  }
}

export function runReleaseManifestCli(args: readonly string[], output: CliOutput = process.stdout): void {
  const command = args[0]
  if (command === 'create') {
    const values = parseCreate(args.slice(1))
    const created = createReleaseManifest({
      releaseRoot: values.releaseRoot,
      artifactRoot: values.artifactRoot,
      releaseId: values.releaseId,
      gitCommit: values.gitCommit,
      sourceArchivePath: values.sourceArchivePath,
      createdAt: values.createdAt,
      previousReleaseId: values.previousReleaseId,
      toolchain: { node: process.version, pnpm: values.pnpmVersion },
    })
    output.write(`RELEASE_PROVENANCE_MANIFEST_CREATED ${created.manifest.releaseId}\n`)
    return
  }
  if (command === 'verify') {
    const values = parseVerify(args.slice(1))
    const verified = verifyReleaseProvenance(values)
    output.write(`RELEASE_PROVENANCE_VERIFIED ${verified.releaseId}\n`)
    return
  }
  fail('RELEASE_PROVENANCE_CLI_COMMAND_INVALID')
}

function printUsage(output: CliOutput): void {
  output.write('release:manifest create|verify --release-root ABSOLUTE --artifact-root ABSOLUTE\n')
}

function printError(error: unknown): void {
  const code = error instanceof ReleaseProvenanceError ? error.code : 'RELEASE_PROVENANCE_CLI_FAILED'
  process.stderr.write(`${code}\n`)
}

if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    printUsage(process.stdout)
  } else {
    try {
      runReleaseManifestCli(args)
    } catch (error) {
      printError(error)
      process.exitCode = 1
    }
  }
}
