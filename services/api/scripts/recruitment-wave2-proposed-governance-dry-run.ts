import 'dotenv/config'
import { createHash } from 'node:crypto'
import {
  buildRecruitmentWave2ProposedGovernancePlan,
  type RecruitmentWave2ProposedGovernancePlan,
} from '../src/recruitment-content/recruitment-wave2-proposed-governance-plan'
import { parseRecruitmentWave2ProposedGovernance } from '../src/recruitment-content/recruitment-wave2-proposed-governance.types'
import { canonicalJson, digest, type RecruitmentWave2Manifest } from '../src/recruitment-content/recruitment-wave2-plan'
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
import { collectFullInventory } from './support/recruitment-wave2-full-inventory'
import { loadRecruitmentWave2GovernanceExtras } from './support/recruitment-wave2-governance-readonly'
import {
  parseInventoryEvidence,
  readRestrictedJson,
} from './support/recruitment-wave2-proposed-governance-input'

const BATCH_SIZES = [1, 100, 1000] as const

async function main(): Promise<void> {
  const paths = parseArgs(process.argv.slice(2))
  if (!['restored-isolated', 'ci-fixture'].includes(process.env['RECRUITMENT_WAVE2_TARGET'] ?? '')) {
    throw new Error('RECRUITMENT_WAVE2_PROPOSED_RESTORED_TARGET_REQUIRED')
  }
  const config = resolveRecruitmentWave2Target()
  const reportInput = readRestrictedJson(paths.inventoryReport, 'INVENTORY_REPORT')
  const evidenceInput = readRestrictedJson(paths.evidencePack, 'EVIDENCE_PACK')
  const manifestInput = readRestrictedJson(paths.legacyManifest, 'LEGACY_MANIFEST')
  const report = parseInventoryEvidence(reportInput)
  const governance = parseRecruitmentWave2ProposedGovernance(evidenceInput.value)
  const legacyManifest = manifestInput.value as unknown as RecruitmentWave2Manifest
  if (governance.sourceInventoryReportSha256 !== reportInput.sha256
    || governance.sourceDatabaseSnapshotDigest !== report.snapshots.databaseB) {
    throw new Error('RECRUITMENT_WAVE2_PROPOSED_SOURCE_EVIDENCE_MISMATCH')
  }
  if (governance.restoreSnapshotSha256 !== config.snapshotSha256) {
    throw new Error('RECRUITMENT_WAVE2_PROPOSED_RESTORE_SNAPSHOT_MISMATCH')
  }
  const evaluatedAt = new Date()
  if (new Date(report.executedAt) > new Date(governance.preparedAt)
    || new Date(governance.preparedAt) > evaluatedAt) {
    throw new Error('RECRUITMENT_WAVE2_PROPOSED_TIME_CONTEXT_INVALID')
  }
  const result = await withRecruitmentWave2Readonly(config, async (query, identity) => {
    if (!identity.snapshotAsOf || governance.asOf !== identity.snapshotAsOf
      || new Date(governance.asOf) > new Date(governance.preparedAt)) {
      throw new Error('RECRUITMENT_WAVE2_PROPOSED_TIME_CONTEXT_INVALID')
    }
    const databaseA = await collectFullInventory(query, identity, report.fairDemoExclusion)
    if (databaseA.snapshotDigest !== report.snapshots.databaseB
      || databaseA.queryPlanSha256 !== report.queryPlanSha256) {
      throw new Error('RECRUITMENT_WAVE2_PROPOSED_DATABASE_REPORT_MISMATCH')
    }
    const auditIds = databaseA.issues['audit_negative_action_reason_missing_candidate'] ?? []
    const evidenceFileIds = governance.qualifications.map((row) => row.evidenceFileId)
    const plans: RecruitmentWave2ProposedGovernancePlan[] = []
    const snapshotDigests: string[] = []
    for (const batchSize of BATCH_SIZES) {
      const snapshot = await loadRecruitmentWave2Snapshot(query, batchSize)
      const extras = await loadRecruitmentWave2GovernanceExtras(query, batchSize, auditIds, evidenceFileIds)
      snapshotDigests.push(digest(canonicalJson({ snapshot, extras })))
      plans.push(buildRecruitmentWave2ProposedGovernancePlan({
        governance, inventory: databaseA, snapshot, extras, legacyManifest,
        context: { snapshotAsOf: identity.snapshotAsOf, evaluatedAt },
      }))
    }
    const databaseB = await collectFullInventory(query, identity, report.fairDemoExclusion)
    if (databaseA.snapshotDigest !== databaseB.snapshotDigest
      || new Set(snapshotDigests).size !== 1
      || new Set(plans.map((plan) => plan.combinedValidationChecksum)).size !== 1
      || new Set(plans.map((plan) => canonicalJson(plan.coverage))).size !== 1) {
      throw new Error('RECRUITMENT_WAVE2_PROPOSED_BATCH_INVARIANT_FAILED')
    }
    const inventory = await collectRecruitmentWave2Inventory(query, identity)
    return { identity, inventory, databaseSnapshotDigest: databaseB.snapshotDigest,
      snapshotDigest: snapshotDigests[0]!, plan: plans[0]! }
  })
  const output = JSON.stringify({
    check: 'recruitment-wave2-proposed-governance-dry-run',
    mode: 'restored-read-only-memory-proposal',
    simulatedOnly: true,
    databaseWrites: 0,
    executedAt: evaluatedAt.toISOString(),
    authorizationRefDigest: sha256(config.authorizationRef),
    inputs: { inventoryReportSha256: reportInput.sha256, evidencePackSha256: evidenceInput.sha256,
      legacyManifestSha256: manifestInput.sha256 },
    batchSizes: BATCH_SIZES,
    invariants: { databaseSnapshotStable: true, batchPlansStable: true,
      databaseSnapshotDigest: result.databaseSnapshotDigest, loadedSnapshotDigest: result.snapshotDigest },
    inventory: { queryPlanSha256: result.inventory.queryPlanSha256,
      countsDigest: digest(canonicalJson(result.inventory.inventory)),
      blockerCountsDigest: digest(canonicalJson(result.inventory.blockers)) },
    plan: summarizePlan(result.plan),
  }, null, 2)
  assertRecruitmentWave2ExecutionWindow(config, new Date(), new Date(result.identity.markerExpiresAt!))
  await verifyRecruitmentWave2FreshExecutionState(config, result.identity)
  console.log(output)
  process.exitCode = result.plan.recommendedExitCode
}

function parseArgs(args: string[]): { inventoryReport: string; evidencePack: string; legacyManifest: string } {
  if (args.some((arg) => /^--(?:apply|execute|write|fix|seed|commit)(?:=|$)/u.test(arg))) {
    throw new Error('RECRUITMENT_WAVE2_PROPOSED_WRITE_ARGUMENT_FORBIDDEN')
  }
  const values = new Map<string, string>()
  const allowed = new Set(['--inventory-report', '--evidence-pack', '--legacy-manifest'])
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] ?? ''
    const value = args[index + 1] ?? ''
    if (!allowed.has(flag) || !value || value.startsWith('--') || values.has(flag)) {
      throw new Error('RECRUITMENT_WAVE2_PROPOSED_ARGUMENT_INVALID')
    }
    values.set(flag, value)
  }
  if (values.size !== 3) throw new Error('RECRUITMENT_WAVE2_PROPOSED_ARGUMENT_INVALID')
  return { inventoryReport: values.get('--inventory-report')!, evidencePack: values.get('--evidence-pack')!,
    legacyManifest: values.get('--legacy-manifest')! }
}

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }

function summarizePlan(plan: RecruitmentWave2ProposedGovernancePlan) {
  const blockerMap = new Map<string, { scope: string; reasonCodes: string[]; ids: string[]; total: number }>()
  for (const blocker of plan.blockers) {
    const key = `${blocker.scope}\u0000${blocker.reasonCodes.join('\u0000')}`
    const group = blockerMap.get(key) ?? { scope: blocker.scope, reasonCodes: blocker.reasonCodes, ids: [], total: 0 }
    group.total += 1
    if (blocker.targetId) group.ids.push(blocker.targetId)
    blockerMap.set(key, group)
  }
  const groups = [...blockerMap.values()].sort((a, b) => a.scope.localeCompare(b.scope)
    || a.reasonCodes.join().localeCompare(b.reasonCodes.join())).map((group) => {
    const ids = [...new Set(group.ids)].sort()
    return { scope: group.scope, reasonCodes: group.reasonCodes, total: group.total,
      ids: ids.slice(0, 100), idsSha256: sha256(ids.join('\n')), truncated: ids.length > 100 }
  })
  const legacy = (group: RecruitmentWave2ProposedGovernancePlan['legacyCurrentPlan']['agencies']) => {
    const items = [...group.items].sort((a, b) => a.legacyId.localeCompare(b.legacyId))
    return { total: group.total, candidate: group.candidate, blocker: group.blocker,
      archivedSkipped: group.archivedSkipped, items: items.slice(0, 100),
      itemsSha256: digest(canonicalJson(items)), truncated: items.length > 100 }
  }
  return { simulatedOnly: plan.simulatedOnly, currentFactsApplied: plan.currentFactsApplied,
    databaseWrites: plan.databaseWrites, writeAuthorized: plan.writeAuthorized, writerEligible: plan.writerEligible,
    publicationDecision: plan.publicationDecision, readyForOwnerApproval: plan.readyForOwnerApproval,
    fairTargetSafe: plan.fairTargetSafe,
    recommendedExitCode: plan.recommendedExitCode, proposalChecksum: plan.proposalChecksum,
    combinedValidationChecksum: plan.combinedValidationChecksum, coverage: plan.coverage,
    blockers: { total: plan.blockers.length, groups: groups.slice(0, 100),
      groupsSha256: digest(canonicalJson(groups)), truncated: groups.length > 100 },
    legacyCurrentPlan: { agencies: legacy(plan.legacyCurrentPlan.agencies), jobs: legacy(plan.legacyCurrentPlan.jobs) },
    hypotheticalProposalConsistency: plan.hypotheticalProposalConsistency,
    hypotheticalAfterExecution: plan.hypotheticalAfterExecution }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  console.error(JSON.stringify({ check: 'recruitment-wave2-proposed-governance-dry-run',
    errorCode: /^RECRUITMENT_WAVE2_[A-Z0-9_]+$/u.test(message)
      ? message : 'RECRUITMENT_WAVE2_PROPOSED_EXECUTION_FAILED' }))
  process.exit(1)
})
