import type { Logger } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import { currentAiRequestContext, type AiCallerIdentity } from './ai-usage-context'

/** Start resolving the verified terminal and its organization at the service entrance. */
export function captureFactIdentity(): Promise<AiCallerIdentity | undefined> {
  try {
    return currentAiRequestContext()?.identity().catch(() => undefined) ?? Promise.resolve(undefined)
  } catch {
    return Promise.resolve(undefined)
  }
}

/** Best effort only; neither identity resolution nor database writes delay the result. */
export function recordAiServiceFact(
  prisma: PrismaService, logger: Logger, identity: Promise<AiCallerIdentity | undefined>,
  serviceType: 'resume_optimize' | 'mock_interview', serviceKey: string,
): void {
  const occurredAt = new Date()
  void Promise.resolve().then(async () => {
    const caller = await identity
    if (!caller?.terminalVerified || !caller.terminalId || !caller.orgId) return
    await prisma.aiServiceFact.create({ data: { serviceType, serviceKey, orgId: caller.orgId, terminalId: caller.terminalId, occurredAt } })
  }).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return
    logger.warn(`ai_service_fact_write_failed errorName=${error instanceof Error ? error.name : 'UnknownError'}`)
  })
}
