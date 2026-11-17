import type { PrismaService } from '../prisma/prisma.service'
import { SERVICE_RETRY_WINDOW_MS, SERVICE_SCAN_PENDING_LIMIT_MS } from './service-order.policy'
import { markServiceOrderNotMade, type ServiceOrderSettleDeps } from './service-order.settle'

type Headers = Record<string, string | string[] | undefined> | undefined
type OrderRow = NonNullable<Awaited<ReturnType<PrismaService['serviceOrder']['findUnique']>>>

function headerOf(headers: Headers, name: string): string | null {
  const raw = headers?.[name]
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (Array.isArray(raw) && raw[0]?.trim()) return raw[0].trim()
  return null
}

/** 扫描没出文件时当场改回可再试，不等下一拍清扫。只有回到已付才让这次认领重试。 */
export async function reclaimFailedScan(deps: ServiceOrderSettleDeps, row: OrderRow): Promise<boolean> {
  if (row.serviceKey !== 'scan' || row.status !== 'consumed') return false
  const ref = row.consumedRef
  const pendingTooLong = Boolean(
    row.consumedAt && row.consumedAt.getTime() < Date.now() - SERVICE_SCAN_PENDING_LIMIT_MS,
  )
  let notMade = false
  if (!ref || ref === 'pending') {
    notMade = pendingTooLong
  } else {
    const task = await deps.prisma.scanTask.findUnique({
      where: { id: ref },
      select: { fileId: true, status: true, expiresAt: true },
    })
    if (task?.fileId) return false
    if (!task) {
      notMade = pendingTooLong
    } else {
      const dead = task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired'
      const sessionOver = task.expiresAt.getTime() <= Date.now()
      notMade = dead || sessionOver
    }
  }
  if (!notMade) return false
  await markServiceOrderNotMade(deps, row.id, 'scan_no_file')
  const fresh = await deps.prisma.serviceOrder.findUnique({ where: { id: row.id }, select: { status: true } })
  return fresh?.status === 'paid'
}

/** 同一张已占用的扫描单重放时直接接着做，不再占一张新单。任务已经失败则交给认领失败后的当场复核。 */
export async function replayOpenScanOrder(prisma: PrismaService, headers: Headers): Promise<string | null> {
  const terminalId = headerOf(headers, 'x-terminal-id')
  const kioskSessionId = headerOf(headers, 'x-kiosk-session-id')
  const serviceOrderId = headerOf(headers, 'x-service-order-id')
  if (!terminalId || !kioskSessionId || !serviceOrderId) return null
  const row = await prisma.serviceOrder.findUnique({ where: { id: serviceOrderId } })
  if (!row || row.terminalId !== terminalId || row.kioskSessionId !== kioskSessionId) return null
  if (row.serviceKey !== 'scan' || row.status !== 'consumed' || row.settledAt) return null
  const ref = row.consumedRef
  if (!ref || ref === 'pending') return null
  const task = await prisma.scanTask.findUnique({
    where: { id: ref },
    select: { fileId: true, status: true },
  })
  if (!task || task.fileId) return null
  if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired' || task.status === 'completed') return null
  return row.id
}

/** 这次占用没挂上任务。退回已付。用过的次数还在的，必须留着再试期限，不能变成没人管。 */
export async function releasePendingServiceConsume(prisma: PrismaService, orderId: string): Promise<void> {
  const row = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
    select: { attemptsUsed: true, status: true, consumedRef: true },
  })
  if (!row || row.status !== 'consumed' || row.consumedRef !== 'pending' || row.attemptsUsed < 1) return
  const attemptsLeft = row.attemptsUsed - 1
  await prisma.serviceOrder.updateMany({
    where: { id: orderId, status: 'consumed', consumedRef: 'pending', attemptsUsed: row.attemptsUsed },
    data: {
      status: 'paid',
      attemptsUsed: { decrement: 1 },
      consumedAt: null,
      consumedRef: null,
      failureReason: null,
      retryUntil: attemptsLeft >= 1 ? new Date(Date.now() + SERVICE_RETRY_WINDOW_MS) : null,
    },
  })
}
