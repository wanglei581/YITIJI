import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'

const MAX_INPUT_BYTES = 2 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/u

export interface RestrictedJsonInput {
  value: Record<string, unknown>
  sha256: string
}

export interface RecruitmentWave2InventoryEvidence extends Record<string, unknown> {
  check: 'recruitment-wave2-full-production-inventory'
  coverage: 'frozen-section-6-current-reader-diff-and-target-safety-evidence'
  mode: 'db-read-only-public-api-no-auth'
  wave2GoDecision: false
  executedAt: string
  fairDemoExclusion: boolean
  queryPlanSha256: string
  counts: Record<string, number>
  issues: Record<string, RecruitmentWave2InventoryIdSummary>
  snapshots: {
    databaseA: string
    databaseB: string
    publicApiA: string
    publicApiB: string
    publicRequestCountPerPass: number
  }
}

export interface RecruitmentWave2InventoryIdSummary {
  count: number
  ids: string[]
  idsSha256: string
  truncated: boolean
}

export function readRestrictedJson(
  path: string,
  kind: 'INVENTORY_REPORT' | 'EVIDENCE_PACK' | 'LEGACY_MANIFEST',
): RestrictedJsonInput {
  let fd: number | undefined
  try {
    const before = lstatSync(path)
    if (before.isSymbolicLink() || !before.isFile()) fail(kind, 'FILE_INVALID')
    if ((before.mode & 0o777) !== 0o600) fail(kind, 'FILE_MODE_INVALID')
    if (before.size <= 0 || before.size > MAX_INPUT_BYTES) fail(kind, 'FILE_SIZE_INVALID')
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) fail(kind, 'FILE_CHANGED')
    if ((opened.mode & 0o777) !== 0o600 || opened.size !== before.size) fail(kind, 'FILE_CHANGED')
    const bytes = readFileSync(fd)
    if (bytes.byteLength !== opened.size) fail(kind, 'FILE_CHANGED')
    const value: unknown = JSON.parse(bytes.toString('utf8'))
    if (!isRecord(value)) fail(kind, 'JSON_INVALID')
    return { value, sha256: createHash('sha256').update(bytes).digest('hex') }
  } catch (error) {
    if (isStableError(error)) throw error
    fail(kind, error instanceof SyntaxError ? 'JSON_INVALID' : 'FILE_INVALID')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  throw new Error(`RECRUITMENT_WAVE2_PROPOSED_${kind}_FILE_INVALID`)
}

export function parseInventoryEvidence(input: RestrictedJsonInput): RecruitmentWave2InventoryEvidence {
  const report = input.value
  if (report['check'] !== 'recruitment-wave2-full-production-inventory'
    || report['coverage'] !== 'frozen-section-6-current-reader-diff-and-target-safety-evidence'
    || report['mode'] !== 'db-read-only-public-api-no-auth' || report['wave2GoDecision'] !== false) failReport()
  const executedAt = exactDate(report['executedAt'])
  const fairDemoExclusion = report['fairDemoExclusion']
  const queryPlanSha256 = report['queryPlanSha256']
  const counts = report['counts']
  const issues = report['issues']
  const snapshots = report['snapshots']
  if (!executedAt || typeof fairDemoExclusion !== 'boolean' || !isSha(queryPlanSha256)
    || !isCountMap(counts) || !isRecord(issues) || !isRecord(snapshots)) failReport()
  const parsedIssues: Record<string, RecruitmentWave2InventoryIdSummary> = {}
  for (const [key, value] of Object.entries(issues)) {
    if (!/^[a-z][a-z0-9_]{2,127}$/u.test(key) || !isIdSummary(value)) failReport()
    parsedIssues[key] = value
  }
  const parsedSnapshots = {
    databaseA: snapshots['databaseA'], databaseB: snapshots['databaseB'],
    publicApiA: snapshots['publicApiA'], publicApiB: snapshots['publicApiB'],
    publicRequestCountPerPass: snapshots['publicRequestCountPerPass'],
  }
  if (!isSha(parsedSnapshots.databaseA) || !isSha(parsedSnapshots.databaseB)
    || parsedSnapshots.databaseA !== parsedSnapshots.databaseB
    || !isSha(parsedSnapshots.publicApiA) || !isSha(parsedSnapshots.publicApiB)
    || parsedSnapshots.publicApiA !== parsedSnapshots.publicApiB
    || !Number.isSafeInteger(parsedSnapshots.publicRequestCountPerPass)
    || Number(parsedSnapshots.publicRequestCountPerPass) < 1) failReport()
  return { ...report, check: 'recruitment-wave2-full-production-inventory',
    coverage: 'frozen-section-6-current-reader-diff-and-target-safety-evidence',
    mode: 'db-read-only-public-api-no-auth', wave2GoDecision: false, executedAt,
    fairDemoExclusion, queryPlanSha256, counts, issues: parsedIssues,
    snapshots: parsedSnapshots as RecruitmentWave2InventoryEvidence['snapshots'] }
}

function isIdSummary(value: unknown): value is RecruitmentWave2InventoryIdSummary {
  if (!isRecord(value) || !Number.isSafeInteger(value['count']) || Number(value['count']) < 0
    || !Array.isArray(value['ids']) || value['ids'].length > 100
    || value['ids'].some((id) => typeof id !== 'string' || !id || id.length > 191)
    || !isSha(value['idsSha256']) || typeof value['truncated'] !== 'boolean') return false
  const ids = value['ids'] as string[]
  const count = Number(value['count'])
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) return false
  return ids.length === Math.min(count, 100) && value['truncated'] === (count > 100)
}

function isCountMap(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.keys(value).length > 0 && Object.entries(value).every(
    ([key, count]) => /^[a-z][A-Za-z0-9]{1,63}$/u.test(key)
      && Number.isSafeInteger(count) && Number(count) >= 0)
}
function exactDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null
}
function isSha(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value) }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isStableError(error: unknown): boolean {
  return error instanceof Error && /^RECRUITMENT_WAVE2_PROPOSED_[A-Z0-9_]+$/u.test(error.message)
}
function fail(kind: string, code: string): never { throw new Error(`RECRUITMENT_WAVE2_PROPOSED_${kind}_${code}`) }
function failReport(): never { throw new Error('RECRUITMENT_WAVE2_PROPOSED_INVENTORY_REPORT_INVALID') }
