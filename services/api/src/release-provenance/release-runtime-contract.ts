import { createHash } from 'node:crypto'
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { ReleaseProvenanceError } from './release-provenance'

const LOCAL_HEALTH_URL = 'http://127.0.0.1:3010/api/v1/health'
const SAFE_PM2_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SHA256 = /^[0-9a-f]{64}$/
const ENVIRONMENT_VARIABLE_NAME = /^[A-Z][A-Z0-9_]{0,127}$/
const MAX_RUNTIME_ENV_CONTRACT_BYTES = 64 * 1024

export type Pm2ProcessSnapshot = {
  name: string
  status: string
  cwd: string
  execPath: string
  scriptArgs: string
}

export type StableLauncher = {
  cwd: string
  path: string
  sha256: string
}

export type HealthProbe = (healthUrl: string) => Promise<boolean>

export type ApprovedRuntimeEnvironment = Readonly<Record<string, string>>

type RuntimeEnvironmentVariable = {
  name: string
  purpose: string
}

function fail(code: string): never {
  throw new ReleaseProvenanceError(code)
}

function assertAbsolute(value: string, code: string): void {
  if (!isAbsolute(value)) fail(code)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const expectedKeys = [...expected].sort()
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}

export function assertPm2ArgumentPath(value: string, code: string): void {
  assertAbsolute(value, code)
  if (/\s/.test(value)) fail(code)
}

export function assertLocalHealthUrl(value: string): void {
  if (value !== LOCAL_HEALTH_URL) fail('RELEASE_PROVENANCE_HEALTH_URL_INVALID')
}

export function assertPm2Name(value: string): void {
  if (!SAFE_PM2_NAME.test(value)) fail('RELEASE_PROVENANCE_PM2_NAME_INVALID')
}

export function assertApprovedLauncher(launcherCwd: string, launcherPath: string, launcherSha256: string): StableLauncher {
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

export function readCurrentRelease(currentLink: string): string {
  assertAbsolute(currentLink, 'RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
  try {
    if (!lstatSync(currentLink).isSymbolicLink()) fail('RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
    return realpathSync(currentLink)
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    fail('RELEASE_PROVENANCE_CURRENT_LINK_INVALID')
  }
}

export function assertPm2Snapshot(
  snapshot: Pm2ProcessSnapshot,
  pm2Name: string,
  launcher: StableLauncher,
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
  const expectedScriptArgs = `--current-link ${currentLink} --artifact-root ${artifactRoot} --launcher-sha256 ${launcher.sha256}`
  if (
    snapshot.name !== pm2Name ||
    snapshot.status !== 'online' ||
    cwd !== launcher.cwd ||
    execPath !== launcher.path ||
    snapshot.scriptArgs !== expectedScriptArgs
  ) {
    fail('RELEASE_PROVENANCE_PM2_PATH_MISMATCH')
  }
}

function readRuntimeEnvironmentContract(path: string): Buffer {
  assertPm2ArgumentPath(path, 'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
  const noFollow = fsConstants.O_NOFOLLOW
  if (typeof noFollow !== 'number') fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
  let descriptor: number | undefined
  let bytes: Buffer | undefined
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | noFollow)
    const stat = fstatSync(descriptor)
    if (!stat.isFile() || stat.size > MAX_RUNTIME_ENV_CONTRACT_BYTES) {
      fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
    }
    bytes = readFileSync(descriptor)
    if (bytes.length > MAX_RUNTIME_ENV_CONTRACT_BYTES) {
      fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
    }
  } catch (error) {
    if (error instanceof ReleaseProvenanceError) throw error
    fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
      }
    }
  }
  if (bytes === undefined) fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
  return bytes
}

function parseRuntimeEnvironmentContract(bytes: Buffer): RuntimeEnvironmentVariable[] {
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
  }
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'variables']) || value.schemaVersion !== 1 || !Array.isArray(value.variables) || value.variables.length === 0) {
    fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
  }
  const names = new Set<string>()
  const variables: RuntimeEnvironmentVariable[] = []
  for (const variable of value.variables) {
    if (!isRecord(variable) || !hasExactKeys(variable, ['name', 'purpose']) || typeof variable.name !== 'string' || typeof variable.purpose !== 'string') {
      fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
    }
    if (!ENVIRONMENT_VARIABLE_NAME.test(variable.name) || variable.purpose.length === 0 || variable.purpose.length > 160 || hasControlCharacter(variable.purpose) || names.has(variable.name)) {
      fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
    }
    names.add(variable.name)
    variables.push({ name: variable.name, purpose: variable.purpose })
  }
  if (!names.has('PATH')) fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID')
  return variables
}

export function loadApprovedRuntimeEnvironment(path: string, sha256: string): ApprovedRuntimeEnvironment {
  if (!SHA256.test(sha256)) fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_MISMATCH')
  const bytes = readRuntimeEnvironmentContract(path)
  const actualSha256 = createHash('sha256').update(bytes).digest('hex')
  if (actualSha256 !== sha256) fail('RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_MISMATCH')
  const variables = parseRuntimeEnvironmentContract(bytes)
  const environment = Object.create(null) as Record<string, string>
  for (const variable of variables) {
    const value = process.env[variable.name]
    if (!value) fail('RELEASE_PROVENANCE_RUNTIME_ENV_VALUE_MISSING')
    environment[variable.name] = value
  }
  return Object.freeze(environment)
}
