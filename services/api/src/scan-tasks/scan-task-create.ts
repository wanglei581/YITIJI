import { createHash, randomBytes } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import type { CreateScanTaskDto } from './dto/create-scan-task.dto'
import { buildScanDeviceCreateData, resolveScanStartParams } from './scan-device-protocol'
import {
  SCAN_TASK_TTL_MS,
  SCAN_TYPE_INSTRUCTIONS,
  timingSafeEqualHex,
  type ScanRetryCreateResult,
  type ScanType,
} from './scan-task-contracts'

/**
 * 第一次重扫创建在消费或挂接上输了竞态。调用方应找回已经提交的子任务，
 * 而不是再开一次授权。这不是 HTTP 异常，不能漏出 create()。
 */
export class RetryCreateRaceError extends Error {
  constructor() {
    super('SCAN_RETRY_CREATE_RACE')
    this.name = 'RetryCreateRaceError'
  }
}

const SCAN_RETRY_RECOVERABLE_CHILD_STATUSES = ['waiting', 'matched'] as const

type RetryEligibleStatus = 'failed' | 'cancelled' | 'expired'

export interface ScanRetryIdentityRow {
  endUserId: string | null
  terminalId: string
  scanType: string
  controlTokenHash: string | null
}

interface RetryAuthorityHooks {
  assertRetryIdentity: (prior: ScanRetryIdentityRow | null) => void
  throwRetryNotAuthorized: () => never
}

/** 建会话前确认终端存在、启用且处于 active。 */
export async function requireCreatableScanTerminal(
  prisma: PrismaService,
  terminalRef: string
): Promise<{ id: string; enabled: boolean; lifecycleStatus: string }> {
  const terminal = await prisma.terminal.findFirst({
    where: { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] },
    select: { id: true, enabled: true, lifecycleStatus: true },
  })
  if (!terminal) {
    throw new BadRequestException({
      error: { code: 'SCAN_TERMINAL_NOT_FOUND', message: '目标终端不存在' },
    })
  }
  if (!terminal.enabled) {
    throw new BadRequestException({
      error: { code: 'SCAN_TERMINAL_DISABLED', message: '目标终端已停用' },
    })
  }
  if (terminal.lifecycleStatus !== 'active') {
    throw new BadRequestException({
      error: { code: 'SCAN_TERMINAL_NOT_ACTIVE', message: '目标终端当前不可创建新扫描任务' },
    })
  }
  return terminal
}

/**
 * 在创建事务里消费上一次失败任务的重扫授权。
 * 返回写入子任务所需的控制凭据哈希、内容哈希和消费时刻。
 */
export async function consumeRetryAuthority(
  tx: Prisma.TransactionClient,
  args: {
    retryOfScanTaskId: string
    endUserId: string | null
    terminalId: string
    scanType: string
    retryControlToken: string | undefined
    eligibleStatuses: readonly RetryEligibleStatus[]
  },
  hooks: RetryAuthorityHooks
): Promise<{ controlTokenHash: string | null; lastAttemptHash: string; retryConsumedAt: Date }> {
  const prior = await tx.scanTask.findUnique({ where: { id: args.retryOfScanTaskId } })
  hooks.assertRetryIdentity(prior)
  if (!prior) hooks.throwRetryNotAuthorized()
  if (prior.retryConsumedAt) {
    throw new RetryCreateRaceError()
  }
  const retryConsumedAtCandidate = new Date()
  if (
    !args.eligibleStatuses.includes(prior.status as RetryEligibleStatus) ||
    !prior.retryAuthorityExpiresAt ||
    prior.retryAuthorityExpiresAt.getTime() <= retryConsumedAtCandidate.getTime() ||
    prior.fileId !== null ||
    !prior.lastAttemptHash
  ) {
    hooks.throwRetryNotAuthorized()
  }

  const retryConsumedAt = retryConsumedAtCandidate
  const consumed = await tx.scanTask.updateMany({
    where: {
      id: prior.id,
      terminalId: args.terminalId,
      scanType: args.scanType,
      endUserId: args.endUserId,
      status: { in: [...args.eligibleStatuses] },
      controlTokenHash: prior.controlTokenHash!,
      fileId: null,
      lastAttemptHash: prior.lastAttemptHash,
      retryConsumedAt: null,
      retryAuthorityExpiresAt: { gt: retryConsumedAt },
    },
    data: { retryConsumedAt },
  })
  if (consumed.count !== 1) {
    throw new RetryCreateRaceError()
  }
  return {
    controlTokenHash: prior.controlTokenHash,
    lastAttemptHash: prior.lastAttemptHash,
    retryConsumedAt,
  }
}

/**
 * 丢失响应或并发落败后，找回已经提交的重扫子任务。
 * 授权还没被消费时返回 null，让调用方继续做第一次 CAS。
 */
export async function loadRecoverableRetryChild(
  prisma: PrismaService,
  args: {
    retryOfScanTaskId: string
    retryControlToken: string
    endUserId: string | null
    terminalId: string
    scanType: string
  },
  hooks: RetryAuthorityHooks & { throwRetryChildNotRecoverable: () => never }
): Promise<{ id: string; expiresAt: Date } | null> {
  const prior = await prisma.scanTask.findUnique({
    where: { id: args.retryOfScanTaskId },
  })
  hooks.assertRetryIdentity(prior)
  if (!prior) hooks.throwRetryNotAuthorized()
  if (!prior.retryConsumedAt) return null
  if (!prior.retryConsumedByScanTaskId) return null

  const child = await prisma.scanTask.findUnique({
    where: { id: prior.retryConsumedByScanTaskId },
  })
  if (
    !child ||
    child.retryOfScanTaskId !== prior.id ||
    child.endUserId !== args.endUserId ||
    child.terminalId !== args.terminalId ||
    child.scanType !== args.scanType ||
    child.retryContentHash !== prior.lastAttemptHash ||
    !timingSafeEqualHex(args.retryControlToken, child.controlTokenHash)
  ) {
    hooks.throwRetryChildNotRecoverable()
  }
  if (
    !SCAN_RETRY_RECOVERABLE_CHILD_STATUSES.includes(
      child.status as (typeof SCAN_RETRY_RECOVERABLE_CHILD_STATUSES)[number]
    ) ||
    child.expiresAt.getTime() <= Date.now()
  ) {
    hooks.throwRetryChildNotRecoverable()
  }
  return { id: child.id, expiresAt: child.expiresAt }
}

export function scanRetryIdentityMatches(
  prior: ScanRetryIdentityRow | null,
  endUserId: string | null,
  terminalId: string,
  scanType: string,
  retryControlToken: string | undefined
): boolean {
  return Boolean(
    prior &&
    prior.endUserId === endUserId &&
    prior.terminalId === terminalId &&
    prior.scanType === scanType &&
    timingSafeEqualHex(retryControlToken, prior.controlTokenHash)
  )
}

/** 事务内锁住仍可用的终端行，避免并发建单穿过停用或非 active。 */
export async function lockActiveScanTerminal(
  tx: Prisma.TransactionClient,
  terminalId: string
): Promise<void> {
  const activeLock = await tx.terminal.updateMany({
    where: { id: terminalId, enabled: true, lifecycleStatus: 'active' },
    data: { lifecycleStatus: 'active' },
  })
  if (activeLock.count !== 1) {
    throw new BadRequestException({
      error: {
        code: 'SCAN_TERMINAL_NOT_ACTIVE',
        message: '目标终端状态已变化，当前不可创建新扫描任务',
      },
    })
  }
}

export async function insertScanTaskRow(
  tx: Prisma.TransactionClient,
  args: {
    terminalId: string
    scanType: string
    endUserId: string | null
    expiresAt: Date
    childControlTokenHash: string
    retryOfScanTaskId: string | null
    retryContentHash: string | null
    retryConsumedAt: Date | null
    deviceCreateData: ReturnType<typeof buildScanDeviceCreateData> | Record<string, never>
  }
): Promise<{ id: string }> {
  const created = await tx.scanTask.create({
    data: {
      terminalId: args.terminalId,
      scanType: args.scanType,
      endUserId: args.endUserId,
      expiresAt: args.expiresAt,
      controlTokenHash: args.childControlTokenHash,
      retryOfScanTaskId: args.retryOfScanTaskId,
      retryContentHash: args.retryContentHash,
      deliveryAckedAt: null,
      ...args.deviceCreateData,
    },
    select: { id: true },
  })
  if (args.retryOfScanTaskId && args.retryConsumedAt) {
    const linked = await tx.scanTask.updateMany({
      where: { id: args.retryOfScanTaskId, retryConsumedAt: args.retryConsumedAt },
      data: { retryConsumedByScanTaskId: created.id },
    })
    if (linked.count !== 1) throw new RetryCreateRaceError()
  }
  return created
}

interface ScanCreateErrorContext {
  retryOfScanTaskId?: string
  retryControlToken?: string
  endUserId: string | null
  terminalId: string
  scanType: string
}

interface ScanCreateHooks {
  assertQuiet: (terminalId: string) => Promise<void>
  assertUserTaskAllowed: (terminalId: string) => Promise<void>
  assertScanDeviceAllowed: (terminalId: string) => Promise<void>
  assertRetryRequestShape: (
    retryOfScanTaskId: string | undefined,
    retryControlToken: string | undefined
  ) => void
  recover: (args: {
    retryOfScanTaskId: string
    retryControlToken: string
    endUserId: string | null
    terminalId: string
    scanType: string
  }) => Promise<ScanRetryCreateResult | null>
  throwRetryNotAuthorized: () => never
  assertRetryIdentity: (
    prior: ScanRetryIdentityRow | null,
    endUserId: string | null,
    terminalId: string,
    scanType: string,
    retryControlToken: string | undefined
  ) => void
  bindChildControlToken: (prior: { controlTokenHash: string | null }) => string
  eligibleStatuses: readonly RetryEligibleStatus[]
  onCreateError: (
    error: unknown,
    context: ScanCreateErrorContext
  ) => Promise<ScanRetryCreateResult | undefined>
}

/** 建会话：静默期、能力、重扫形状由调用方按原顺序把关，事务只负责落库。 */
export async function executeScanCreate(
  prisma: PrismaService,
  dto: CreateScanTaskDto,
  endUserId: string | null,
  retryControlToken: string | undefined,
  hooks: ScanCreateHooks
): Promise<ScanRetryCreateResult> {
  const startParams = resolveScanStartParams(dto)
  const terminal = await requireCreatableScanTerminal(prisma, dto.terminalId.trim())
  await hooks.assertQuiet(terminal.id)
  await hooks.assertUserTaskAllowed(terminal.id)
  if (startParams.startMode === 'device') {
    await hooks.assertScanDeviceAllowed(terminal.id)
  }

  const retryOfScanTaskId = dto.retryOfScanTaskId?.trim() || undefined
  hooks.assertRetryRequestShape(retryOfScanTaskId, retryControlToken)
  if (retryOfScanTaskId && retryControlToken) {
    const recovered = await hooks.recover({
      retryOfScanTaskId,
      retryControlToken,
      endUserId,
      terminalId: terminal.id,
      scanType: dto.scanType,
    })
    if (recovered) return recovered
  }

  const controlToken =
    retryOfScanTaskId && retryControlToken ? retryControlToken : randomBytes(24).toString('hex')
  const controlTokenHash = createHash('sha256').update(controlToken).digest('hex')
  const expiresAt = new Date(Date.now() + SCAN_TASK_TTL_MS)
  const deviceCreateData =
    startParams.startMode === 'device' ? buildScanDeviceCreateData(startParams, new Date()) : {}

  let task: { id: string }
  try {
    task = await prisma.$transaction(async (tx) => {
      await lockActiveScanTerminal(tx, terminal.id)
      let retryContentHash: string | null = null
      let retryConsumedAt: Date | null = null
      let childControlTokenHash = controlTokenHash
      if (retryOfScanTaskId) {
        const prior = await consumeRetryAuthority(
          tx,
          {
            retryOfScanTaskId,
            endUserId,
            terminalId: terminal.id,
            scanType: dto.scanType,
            retryControlToken,
            eligibleStatuses: hooks.eligibleStatuses,
          },
          {
            assertRetryIdentity: (row) =>
              hooks.assertRetryIdentity(
                row,
                endUserId,
                terminal.id,
                dto.scanType,
                retryControlToken
              ),
            throwRetryNotAuthorized: () => hooks.throwRetryNotAuthorized(),
          }
        )
        retryConsumedAt = prior.retryConsumedAt
        retryContentHash = prior.lastAttemptHash
        childControlTokenHash = hooks.bindChildControlToken(prior)
      }
      return insertScanTaskRow(tx, {
        terminalId: terminal.id,
        scanType: dto.scanType,
        endUserId,
        expiresAt,
        childControlTokenHash,
        retryOfScanTaskId: retryOfScanTaskId ?? null,
        retryContentHash,
        retryConsumedAt,
        deviceCreateData,
      })
    })
  } catch (error) {
    const recovered = await hooks.onCreateError(error, {
      retryOfScanTaskId,
      retryControlToken,
      endUserId,
      terminalId: terminal.id,
      scanType: dto.scanType,
    })
    if (recovered) return recovered
    throw error
  }

  return {
    scanTaskId: task.id,
    controlToken,
    expiresAt: expiresAt.toISOString(),
    instructions: SCAN_TYPE_INSTRUCTIONS[dto.scanType as ScanType],
  }
}

const emptyRetryPreview = (): ScanRetryCreateResult => ({
  scanTaskId: '',
  controlToken: '',
  expiresAt: new Date(0).toISOString(),
  instructions: [],
})

/** 重放前只查找已提交的重扫子任务，不新建。找不到或出错都返回空号。 */
export async function previewScanRetryCreate(
  prisma: PrismaService,
  dto: { terminalId: string; scanType: string; retryOfScanTaskId?: string },
  endUserId: string | null,
  retryControlToken: string | undefined,
  recover: (args: {
    retryOfScanTaskId: string
    retryControlToken: string
    endUserId: string | null
    terminalId: string
    scanType: string
  }) => Promise<ScanRetryCreateResult | null>
): Promise<ScanRetryCreateResult> {
  const retryOfScanTaskId = dto.retryOfScanTaskId?.trim()
  if (!retryOfScanTaskId || !retryControlToken) return emptyRetryPreview()
  try {
    const terminalRef = dto.terminalId.trim()
    const terminal = await prisma.terminal.findFirst({
      where: { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] },
      select: { id: true },
    })
    if (!terminal) return emptyRetryPreview()
    return (
      (await recover({
        retryOfScanTaskId,
        retryControlToken,
        endUserId,
        terminalId: terminal.id,
        scanType: dto.scanType,
      })) ?? emptyRetryPreview()
    )
  } catch {
    return emptyRetryPreview()
  }
}
