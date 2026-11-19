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
  } finally {
    await prisma.onModuleDestroy()
  }
  console.log('verify:pickup-arrival-price:postgres ok')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
