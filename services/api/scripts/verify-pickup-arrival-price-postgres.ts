/**
 * 到机补价与明确没出纸自动退。真 PostgreSQL，跑完删掉本轮写入的行。
 * DATABASE_URL 不是 PostgreSQL 时直接失败。
 */
process.env['NODE_ENV'] ||= 'test'
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'

import { randomBytes } from 'node:crypto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgresql://') || url.startsWith('postgres://')
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? ''
  if (!isPostgresUrl(url)) {
    throw new Error('PICKUP_ARRIVAL_PRICE_VERIFY_POSTGRES_REQUIRED: DATABASE_URL must be PostgreSQL')
  }
  assertIsolatedVerificationDatabase()
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { runPickupArrivalPriceCases } = await import('./support/pickup-arrival-price-cases')
  const { runP2b8ChannelFaultCases } = await import('./support/pickup-arrival-p2b8-channel-fault-cases')
  const { runP2b8ChannelStepsCases } = await import('./support/pickup-arrival-p2b8-channel-steps-cases')
  const prisma = new PrismaService()
  if (prisma.dbKind !== 'postgres') {
    throw new Error('PICKUP_ARRIVAL_PRICE_VERIFY_POSTGRES_REQUIRED')
  }
  await prisma.onModuleInit()
  try {
    await runPickupArrivalPriceCases(prisma, randomBytes(4).toString('hex'))
    await runP2b8ChannelFaultCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    await runP2b8ChannelStepsCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b8VerifyRaceCases } = await import('./support/pickup-arrival-p2b8-verify-race-cases')
    await runP2b8VerifyRaceCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b8CloseRaceCases } = await import('./support/pickup-arrival-p2b8-close-race-cases')
    await runP2b8CloseRaceCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b8SumClaimCases } = await import('./support/pickup-arrival-p2b8-sum-claim-cases')
    await runP2b8SumClaimCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b8ReleaseOutcomeCases } = await import('./support/pickup-arrival-p2b8-release-outcome-cases')
    await runP2b8ReleaseOutcomeCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b8ChannelBusinessCases } = await import('./support/pickup-arrival-p2b8-channel-business-cases')
    await runP2b8ChannelBusinessCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b8FaultTextCases } = await import('./support/pickup-arrival-p2b8-fault-text-cases')
    await runP2b8FaultTextCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9ChannelSubmittedCases } = await import('./support/pickup-arrival-p2b9-channel-submitted-cases')
    await runP2b9ChannelSubmittedCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9SubmitWriteCases } = await import('./support/pickup-arrival-p2b9-submit-write-cases')
    await runP2b9SubmitWriteCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9LocalWriteCases } = await import('./support/pickup-arrival-p2b9-local-write-cases')
    await runP2b9LocalWriteCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9MultiRefundCases } = await import('./support/pickup-arrival-p2b9-multi-refund-cases')
    await runP2b9MultiRefundCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9ChannelAmountCases } = await import('./support/pickup-arrival-p2b9-channel-amount-cases')
    await runP2b9ChannelAmountCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9VerifyReasonCases } = await import('./support/pickup-arrival-p2b9-verify-reason-cases')
    await runP2b9VerifyReasonCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9AbnormalCases } = await import('./support/pickup-arrival-p2b9-abnormal-cases')
    await runP2b9AbnormalCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9DetailFlagCases } = await import('./support/pickup-arrival-p2b9-detail-flag-cases')
    await runP2b9DetailFlagCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9AnswerOutsideCases } = await import('./support/pickup-arrival-p2b9-answer-outside-cases')
    await runP2b9AnswerOutsideCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9RegistrationCases } = await import('./support/pickup-arrival-p2b9-registration-cases')
    await runP2b9RegistrationCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9dConflictCases } = await import('./support/pickup-arrival-p2b9d-conflict-cases')
    await runP2b9dConflictCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9dVerifiedGuardCases } = await import('./support/pickup-arrival-p2b9d-verified-guard-cases')
    await runP2b9dVerifiedGuardCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b9dMultiFailCases } = await import('./support/pickup-arrival-p2b9d-multi-fail-cases')
    await runP2b9dMultiFailCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runServiceOrderP2b9dAbnormalCases } = await import('./support/service-order-p2b9d-abnormal-cases')
    await runServiceOrderP2b9dAbnormalCases(prisma, randomBytes(4).toString('hex'))
  } finally {
    await prisma.onModuleDestroy()
  }
  console.log('verify:pickup-arrival-price:postgres ok')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
