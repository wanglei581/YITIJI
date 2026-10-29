import type { PrismaService } from '../prisma/prisma.service'
import { suppressAggregateCount } from './console-screen.metric'
import { usageTimeBounds } from './console-screen.usage.queries'

export async function loadPartnerAiServices(prisma: PrismaService, orgId: string, from: Date, to: Date) {
  const rows = await prisma.aiServiceFact.groupBy({
    by: ['serviceType'],
    where: { orgId, occurredAt: usageTimeBounds(from, to), serviceType: { in: ['resume_optimize', 'mock_interview'] } },
    _count: { _all: true },
  })
  const count = (type: string) => suppressAggregateCount(rows.find((row) => row.serviceType === type)?._count._all ?? 0)
  return { resumeOptimize: count('resume_optimize'), mockInterview: count('mock_interview') }
}
