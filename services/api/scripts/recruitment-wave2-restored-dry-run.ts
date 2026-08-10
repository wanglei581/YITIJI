import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import {
  buildRecruitmentWave2Plan,
  type RecruitmentWave2Manifest,
} from '../src/recruitment-content/recruitment-wave2-plan'
import {
  assertRecruitmentWave2ExecutionWindow,
  resolveRecruitmentWave2Target,
} from '../src/recruitment-content/recruitment-wave2-target'
import {
  collectRecruitmentWave2Inventory,
  loadRecruitmentWave2Snapshot,
  verifyRecruitmentWave2FreshExecutionState,
  withRecruitmentWave2Readonly,
} from './support/recruitment-wave2-readonly-db'

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024

async function main(): Promise<void> {
  const { manifestPath, batchSize } = parseArgs(process.argv.slice(2))
  const config = resolveRecruitmentWave2Target()
  if (config.target !== 'restored-isolated' && config.target !== 'ci-fixture') {
    throw new Error('RECRUITMENT_WAVE2_RESTORED_TARGET_REQUIRED')
  }
  const manifest = readManifest(manifestPath)
  if (manifest.snapshotSha256 !== config.snapshotSha256) {
    throw new Error('RECRUITMENT_WAVE2_MANIFEST_TARGET_SNAPSHOT_MISMATCH')
  }
  const result = await withRecruitmentWave2Readonly(config, async (query, identity) => {
    const inventory = await collectRecruitmentWave2Inventory(query, identity)
    const snapshot = await loadRecruitmentWave2Snapshot(query, batchSize)
    if (!identity.snapshotAsOf) throw new Error('RECRUITMENT_WAVE2_RESTORE_MARKER_TIME_INVALID')
    return {
      inventory,
      plan: buildRecruitmentWave2Plan(snapshot, manifest, {
        snapshotAsOf: identity.snapshotAsOf,
        evaluatedAt: new Date(),
      }),
    }
  })
  const output = JSON.stringify({
    check: 'recruitment-wave2-restored-dry-run',
    mode: 'repeatable-read-read-only',
    executedAt: new Date().toISOString(),
    authorizationRefDigest: digest(config.authorizationRef),
    batchSize,
    ...result,
  }, null, 2)
  assertRecruitmentWave2ExecutionWindow(
    config,
    new Date(),
    result.inventory.identity.markerExpiresAt ? new Date(result.inventory.identity.markerExpiresAt) : null,
  )
  await verifyRecruitmentWave2FreshExecutionState(config, result.inventory.identity)
  console.log(output)
  process.exitCode = result.plan.agencies.blocker + result.plan.jobs.blocker > 0 ? 2 : 0
}

function parseArgs(args: string[]): { manifestPath: string; batchSize: number } {
  const forbidden = args.find((arg) => /^--(?:apply|execute|write|fix)(?:=|$)/u.test(arg))
  if (forbidden) throw new Error('RECRUITMENT_WAVE2_WRITE_ARGUMENT_FORBIDDEN')
  let manifestPath = ''
  let batchSize = 100
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--manifest') manifestPath = args[++index] ?? ''
    else if (arg === '--batch-size') batchSize = Number(args[++index])
    else throw new Error('RECRUITMENT_WAVE2_ARGUMENT_INVALID')
  }
  if (!manifestPath) throw new Error('RECRUITMENT_WAVE2_MANIFEST_REQUIRED')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('RECRUITMENT_WAVE2_BATCH_SIZE_INVALID')
  }
  return { manifestPath, batchSize }
}

function readManifest(path: string): RecruitmentWave2Manifest {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error('RECRUITMENT_WAVE2_MANIFEST_FILE_INVALID')
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RecruitmentWave2Manifest
  } catch {
    throw new Error('RECRUITMENT_WAVE2_MANIFEST_JSON_INVALID')
  }
}

function digest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    check: 'recruitment-wave2-restored-dry-run',
    mode: 'repeatable-read-read-only',
    errorCode: safeErrorCode(error),
  }))
  process.exit(1)
})

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^RECRUITMENT_WAVE2_[A-Z0-9_]+$/u.test(message) ? message : 'RECRUITMENT_WAVE2_EXECUTION_FAILED'
}
