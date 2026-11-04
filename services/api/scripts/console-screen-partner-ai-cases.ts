import { Logger } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { captureFactIdentity, recordAiServiceFact } from '../src/ai/usage/ai-service-fact'
import { runWithAiRequestContext, type AiCallerIdentity } from '../src/ai/usage/ai-usage-context'
import { loadPartnerAiServices } from '../src/console-screen/console-screen.partner-ai'
import { ConsoleScreenUsageService } from '../src/console-screen/console-screen.usage.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { assert } from './console-screen-usage-cases-01'

export async function verifyPartnerAiServices(prisma: PrismaService) {
  const orgA = 'fact-test-a', orgB = 'fact-test-b', terminalId = 'fact-test-terminal'
  const now = new Date('2026-01-15T02:07:30Z'), from = new Date('2026-01-07T16:00:00Z'), to = new Date('2026-01-14T16:00:00Z')
  await prisma.organization.createMany({ data: [{ id: orgA, name: 'A', type: 'public_employment_service' }, { id: orgB, name: 'B', type: 'public_employment_service' }] })
  await prisma.terminal.create({ data: { id: terminalId, terminalCode: terminalId, agentToken: 'test', deviceFingerprint: 'test', orgId: orgA } })
  const identity: AiCallerIdentity = { endUserId: null, terminalId, terminalVerified: true, orgId: orgA }
  const snapshot = runWithAiRequestContext({ identity: async () => ({ ...identity }) }, captureFactIdentity)
  await prisma.terminal.update({ where: { id: terminalId }, data: { orgId: orgB } })
  const logger = new Logger('FactTest')
  recordAiServiceFact(prisma, logger, snapshot, 'resume_optimize', 'snapshot')
  recordAiServiceFact(prisma, logger, snapshot, 'resume_optimize', 'snapshot')
  recordAiServiceFact(prisma, logger, Promise.resolve({ ...identity, terminalVerified: false }), 'resume_optimize', 'unverified')
  recordAiServiceFact(prisma, logger, Promise.resolve({ ...identity, terminalId: null }), 'resume_optimize', 'phone')
  recordAiServiceFact(prisma, logger, Promise.resolve({ ...identity, orgId: null }), 'resume_optimize', 'unbound')
  await new Promise((resolve) => setTimeout(resolve, 100))
  const rows = await prisma.aiServiceFact.findMany({ where: { serviceKey: { in: ['snapshot', 'unverified', 'phone', 'unbound'] } } })
  assert('AI 服务计次去重、验签、手机、机构快照', rows.length === 1 && rows[0]?.orgId === orgA)
  await prisma.aiServiceFact.createMany({ data: [
    ...Array.from({ length: 5 }, (_, i) => ({ serviceType: 'resume_optimize', serviceKey: `window-a-${i}`, orgId: orgA, terminalId, occurredAt: i === 0 ? from : new Date(from.getTime() + 1000) })),
    { serviceType: 'resume_optimize', serviceKey: 'end-exclusive', orgId: orgA, terminalId, occurredAt: to },
    { serviceType: 'resume_optimize', serviceKey: 'before-start', orgId: orgA, terminalId, occurredAt: new Date(from.getTime() - 1) },
    { serviceType: 'mock_interview', serviceKey: 'one', orgId: orgA, terminalId, occurredAt: from },
    { serviceType: 'mock_interview', serviceKey: 'other', orgId: orgB, terminalId, occurredAt: from },
  ] })
  const a = await loadPartnerAiServices(prisma, orgA, from, to)
  const b = await loadPartnerAiServices(prisma, orgB, from, to)
  assert('AI 服务窗口边界、逐类抑制及机构隔离', a.resumeOptimize === 5 && a.mockInterview === null && b.resumeOptimize === 0 && b.mockInterview === null)
  const broken = Object.create(prisma) as PrismaService
  Object.defineProperty(broken, 'aiServiceFact', { value: { groupBy: async () => { throw new Error('test') } } })
  const usage = new ConsoleScreenUsageService(broken, new ScreenSnapshotCache())
  const result = await usage.getPartnerUsage(orgA, '7d', now)
  assert('AI 切片查询失败不可用而非零', result.metrics.partnerAiServices?.available === false && result.metrics.partnerContent?.available === true)
  let warned = false
  recordAiServiceFact({ aiServiceFact: { create: () => { throw new Error('test') } } } as unknown as PrismaService, { warn: () => { warned = true } } as unknown as Logger, snapshot, 'mock_interview', 'write-error')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert('AI 计次写入异常被捕获', warned)
}
