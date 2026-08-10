import 'dotenv/config'
import { createHash } from 'node:crypto'
import {
  collectRecruitmentWave2Inventory,
  withRecruitmentWave2Readonly,
} from './support/recruitment-wave2-readonly-db'
import {
  assertRecruitmentWave2ExecutionWindow,
  resolveRecruitmentWave2Target,
} from '../src/recruitment-content/recruitment-wave2-target'

async function main(): Promise<void> {
  if (process.argv.slice(2).length) throw new Error('RECRUITMENT_WAVE2_INVENTORY_ARGUMENTS_FORBIDDEN')
  const config = resolveRecruitmentWave2Target()
  if (config.target !== 'authorized-readonly') throw new Error('RECRUITMENT_WAVE2_PRODUCTION_TARGET_REQUIRED')
  const report = await withRecruitmentWave2Readonly(config, collectRecruitmentWave2Inventory)
  const output = JSON.stringify({
    check: 'recruitment-wave2-production-backfill-probe',
    coverage: 'legacy-backfill-subset-not-full-production-inventory',
    wave2GoDecision: false,
    mode: 'repeatable-read-read-only',
    executedAt: new Date().toISOString(),
    authorizationRefDigest: digest(config.authorizationRef),
    ...report,
  }, null, 2)
  assertRecruitmentWave2ExecutionWindow(config)
  console.log(output)
  process.exitCode = Object.values(report.blockers).some((count) => count > 0) ? 2 : 0
}

function digest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    check: 'recruitment-wave2-production-backfill-probe',
    mode: 'repeatable-read-read-only',
    errorCode: safeErrorCode(error),
  }))
  process.exit(1)
})

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^RECRUITMENT_WAVE2_[A-Z0-9_]+$/u.test(message) ? message : 'RECRUITMENT_WAVE2_EXECUTION_FAILED'
}
