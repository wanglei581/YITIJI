import 'dotenv/config'
import { createHash } from 'node:crypto'
import {
  collectFullInventory,
  type FullInventorySnapshot,
} from './support/recruitment-wave2-full-inventory'
import {
  collectPublicSnapshot,
  comparePublicSnapshots,
  diffIdSets,
  resolveRecruitmentPublicTarget,
  verifyPublicTargetHealth,
  type PublicEntity,
} from './support/recruitment-wave2-public-snapshot'
import { withRecruitmentWave2Readonly } from './support/recruitment-wave2-readonly-db'
import {
  assertRecruitmentWave2ExecutionWindow,
  resolveRecruitmentWave2Target,
} from '../src/recruitment-content/recruitment-wave2-target'

async function main(): Promise<void> {
  if (process.argv.slice(2).length)
    throw new Error('RECRUITMENT_WAVE2_FULL_INVENTORY_ARGUMENTS_FORBIDDEN')
  const config = resolveRecruitmentWave2Target()
  if (config.target !== 'authorized-readonly' && config.target !== 'ci-fixture') {
    throw new Error('RECRUITMENT_WAVE2_FULL_INVENTORY_TARGET_INVALID')
  }
  const publicTarget = await resolveRecruitmentPublicTarget(config)
  const dbA = await withRecruitmentWave2Readonly(config, (query, identity) =>
    collectFullInventory(query, identity, publicTarget.excludeDemoFairData)
  )
  const apiA = await collectPublicSnapshot(config, publicTarget)
  const apiB = await collectPublicSnapshot(config, publicTarget)
  comparePublicSnapshots(apiA, apiB)
  const dbB = await withRecruitmentWave2Readonly(config, (query, identity) =>
    collectFullInventory(query, identity, publicTarget.excludeDemoFairData)
  )
  if (dbA.snapshotDigest !== dbB.snapshotDigest)
    throw new Error('RECRUITMENT_WAVE2_DATABASE_SNAPSHOT_DRIFT')

  const currentReaderDiff = diffIdSets(dbB.currentReaderIds, apiB.ids)
  const targetSafeLeak = {
    jobs: summarizeIds(apiB.ids.jobs.filter((id) => !dbB.targetSafeIds.jobs.includes(id))),
    jobFairs: { status: 'not_defined_in_frozen_target_model' },
    policies: { status: 'not_defined_in_frozen_target_model' },
    offlineAgencies: { status: 'legacy_reader_not_target_profile_reader' },
    offlineJobs: { status: 'legacy_reader_not_canonical_job_reader' },
  }
  const report = {
    check: 'recruitment-wave2-full-production-inventory',
    coverage: 'frozen-section-6-current-reader-diff-and-target-safety-evidence',
    mode: 'db-read-only-public-api-no-auth',
    wave2GoDecision: false,
    executedAt: new Date().toISOString(),
    authorizationRefDigest: sha256(config.authorizationRef),
    publicOriginDigest: publicTarget.originDigest,
    fairDemoExclusion: publicTarget.excludeDemoFairData,
    identity: dbB.identity,
    queryPlanSha256: dbB.queryPlanSha256,
    counts: dbB.counts,
    grouped: dbB.grouped,
    issues: summarizeIssueMap(dbB.issues),
    sets: {
      currentReader: summarizeSet(dbB.currentReaderIds),
      publicApi: summarizeSet(apiB.ids),
      currentReaderDiff: summarizeDiff(currentReaderDiff),
      targetSafeSupport: dbB.targetSafeSupport,
      publicApiOutsideTargetSafe: targetSafeLeak,
    },
    snapshots: {
      databaseA: dbA.snapshotDigest,
      databaseB: dbB.snapshotDigest,
      publicApiA: apiA.snapshotDigest,
      publicApiB: apiB.snapshotDigest,
      publicRequestCountPerPass: apiB.requestCount,
    },
    endpointContracts: {
      onlinePlatformDirectories: 'endpoint_absent',
      offlineAgencyProfiles: 'endpoint_absent',
    },
  }
  const output = JSON.stringify(report, null, 2)
  assertRecruitmentWave2ExecutionWindow(config)
  await verifyPublicTargetHealth(config, publicTarget)
  await withRecruitmentWave2Readonly(config, async () => null)
  assertRecruitmentWave2ExecutionWindow(config)
  console.log(output)
  process.exitCode = hasBusinessBlockers(dbB, currentReaderDiff, targetSafeLeak.jobs) ? 2 : 0
}

function hasBusinessBlockers(
  snapshot: FullInventorySnapshot,
  diff: ReturnType<typeof diffIdSets>,
  targetLeak: ReturnType<typeof summarizeIds>
): boolean {
  const issueBlocker = Object.entries(snapshot.issues).some(
    ([key, value]) =>
      value.length > 0 && !key.endsWith('_information') && !key.endsWith('_candidate')
  )
  const readerDiff = Object.values(diff).some(
    (value) => value.missingFromApi.length || value.unexpectedInApi.length
  )
  return issueBlocker || readerDiff || targetLeak.count > 0
}

function summarizeIssueMap(value: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(value).map(([key, ids]) => [key, summarizeIds(ids)]))
}

function summarizeSet(value: Record<PublicEntity, string[]>) {
  return Object.fromEntries(
    (Object.keys(value) as PublicEntity[]).map((key) => [key, summarizeIds(value[key])])
  )
}

function summarizeDiff(value: ReturnType<typeof diffIdSets>) {
  return Object.fromEntries(
    (Object.keys(value) as PublicEntity[]).map((key) => [
      key,
      {
        missingFromApi: summarizeIds(value[key].missingFromApi),
        unexpectedInApi: summarizeIds(value[key].unexpectedInApi),
      },
    ])
  )
}

function summarizeIds(ids: string[]) {
  const sorted = [...ids].sort()
  return {
    count: sorted.length,
    ids: sorted.slice(0, 100),
    idsSha256: sha256(sorted.join('\n')),
    truncated: sorted.length > 100,
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      check: 'recruitment-wave2-full-production-inventory',
      errorCode: safeErrorCode(error),
    })
  )
  process.exit(1)
})

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^RECRUITMENT_WAVE2_[A-Z0-9_]+$/u.test(message)
    ? message
    : 'RECRUITMENT_WAVE2_EXECUTION_FAILED'
}
