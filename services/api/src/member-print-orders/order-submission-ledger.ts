import { randomUUID } from 'crypto'
import { BadRequestException, ConflictException } from '@nestjs/common'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'

/** Server-side processing lease. Not a client grace timeout and not proof of delivery. */
export const ORDER_SUBMISSION_LEASE_MS = 60_000
export const ORDER_SUBMISSION_RESOLVE_MAX_KEYS = 20
export const ORDER_SUBMISSION_LEDGER_UNIQUE = 'OrderSubmissionLedger_endUserId_idempotencyKey_key'

export const ORDER_SUBMISSION_STATUS = {
  processing: 'processing',
  succeeded: 'succeeded',
  abandoned: 'abandoned',
  terminalFailed: 'terminal_failed',
} as const

export const ORDER_SUBMISSION_KIND = {
  print: 'print',
  package: 'package',
  unknown: 'unknown',
} as const

export type OrderSubmissionKind = 'print' | 'package'
export type OrderSubmissionAcquire =
  | { type: 'lease'; leaseToken: string }
  | { type: 'replay'; orderId: string }

export type OrderSubmissionResolveItem = {
  key: string
  outcome: 'created' | 'processing' | 'not_created'
  orderId?: string
  orderKind?: OrderSubmissionKind
  pickupStatus?: string
  payStatus?: string
  taskStatus?: string
}

type SubmissionDb = Pick<PrismaService, 'order' | 'orderSubmissionLedger'> | Pick<PrismaTransactionClient, 'order' | 'orderSubmissionLedger'>

type LedgerRow = {
  endUserId: string
  idempotencyKey: string
  orderKind: string
  payloadHash: string
  status: string
  leaseToken: string | null
  leaseExpiresAt: Date | null
  orderId: string | null
}

type OwnedOrderRow = {
  id: string
  sourceFileId: string | null
  pickupStatus: string
  payStatus: string
  taskStatus: string
  idempotencyPayloadHash: string | null
  _count: { orderItems: number }
}

function isPrismaUniqueConflict(error: unknown): boolean {
  let current: unknown = error
  for (let i = 0; i < 6 && current && typeof current === 'object'; i += 1) {
    if ((current as { code?: unknown }).code === 'P2002') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

function reusedConflict(): never {
  throw new ConflictException({
    error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该请求标识已用于另一次打印参数，请更换标识后重试' },
  })
}

function inProgressConflict(): never {
  throw new ConflictException({
    error: { code: 'IDEMPOTENCY_IN_PROGRESS', message: '同一请求仍在处理中，请稍候重试' },
  })
}

export function abandonedConflict(): never {
  throw new ConflictException({
    error: { code: 'IDEMPOTENCY_KEY_ABANDONED', message: '该请求标识已失效，请更换标识后重试' },
  })
}

function isTerminalLedgerStatus(status: string): boolean {
  return status === ORDER_SUBMISSION_STATUS.abandoned || status === ORDER_SUBMISSION_STATUS.terminalFailed
}

function isLiveProcessingLease(row: Pick<LedgerRow, 'status' | 'leaseExpiresAt'>, now: Date): boolean {
  return row.status === ORDER_SUBMISSION_STATUS.processing
    && !!row.leaseExpiresAt
    && row.leaseExpiresAt > now
}

function assertCompatible(row: { orderKind: string; payloadHash: string }, orderKind: OrderSubmissionKind, payloadHash: string): void {
  if (row.orderKind === ORDER_SUBMISSION_KIND.unknown) return
  if (row.orderKind !== orderKind || row.payloadHash !== payloadHash) reusedConflict()
}

function kindFromOrder(order: Pick<OwnedOrderRow, 'sourceFileId' | '_count'>): OrderSubmissionKind {
  return order._count.orderItems > 0 ? 'package' : 'print'
}

function createdItem(key: string, order: OwnedOrderRow, orderKind?: string): OrderSubmissionResolveItem {
  const kind: OrderSubmissionKind = orderKind === 'print' || orderKind === 'package' ? orderKind : kindFromOrder(order)
  return {
    key,
    outcome: 'created',
    orderId: order.id,
    orderKind: kind,
    pickupStatus: order.pickupStatus,
    payStatus: order.payStatus,
    taskStatus: order.taskStatus,
  }
}

async function findLedger(db: SubmissionDb, endUserId: string, idempotencyKey: string): Promise<LedgerRow | null> {
  return db.orderSubmissionLedger.findFirst({ where: { endUserId, idempotencyKey } }) as Promise<LedgerRow | null>
}

async function findOwnedOrder(db: SubmissionDb, endUserId: string, idempotencyKey: string): Promise<OwnedOrderRow | null> {
  return db.order.findFirst({
    where: { endUserId, idempotencyKey },
    select: {
      id: true,
      sourceFileId: true,
      pickupStatus: true,
      payStatus: true,
      taskStatus: true,
      idempotencyPayloadHash: true,
      _count: { select: { orderItems: true } },
    },
  }) as Promise<OwnedOrderRow | null>
}

async function findOwnedOrderById(db: SubmissionDb, endUserId: string, orderId: string): Promise<OwnedOrderRow | null> {
  return db.order.findFirst({
    where: { id: orderId, endUserId },
    select: {
      id: true,
      sourceFileId: true,
      pickupStatus: true,
      payStatus: true,
      taskStatus: true,
      idempotencyPayloadHash: true,
      _count: { select: { orderItems: true } },
    },
  }) as Promise<OwnedOrderRow | null>
}

async function healSucceeded(
  db: SubmissionDb,
  args: { endUserId: string; idempotencyKey: string; orderId: string; orderKind: OrderSubmissionKind; payloadHash: string },
): Promise<void> {
  await db.orderSubmissionLedger.updateMany({
    where: {
      endUserId: args.endUserId,
      idempotencyKey: args.idempotencyKey,
      status: { not: ORDER_SUBMISSION_STATUS.succeeded },
    },
    data: {
      status: ORDER_SUBMISSION_STATUS.succeeded,
      orderId: args.orderId,
      orderKind: args.orderKind,
      payloadHash: args.payloadHash,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
}

/**
 * Acquire a processing lease or replay an already-created owned Order.
 * Same key with a different payload/kind is 409. Active processing is 409 IN_PROGRESS.
 * Expired processing may be reclaimed. Abandoned/terminal_failed without an Order is 409.
 */
export async function acquireOrderSubmissionLease(
  db: SubmissionDb,
  args: { endUserId: string; idempotencyKey: string; orderKind: OrderSubmissionKind; payloadHash: string },
): Promise<OrderSubmissionAcquire> {
  const { endUserId, idempotencyKey, orderKind, payloadHash } = args
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const now = new Date()
    const order = await findOwnedOrder(db, endUserId, idempotencyKey)
    const ledger = await findLedger(db, endUserId, idempotencyKey)

    if (order) {
      if (order.idempotencyPayloadHash && order.idempotencyPayloadHash !== payloadHash) reusedConflict()
      if (kindFromOrder(order) !== orderKind) reusedConflict()
      if (ledger) assertCompatible(ledger, orderKind, payloadHash)
      if (!ledger || ledger.status !== ORDER_SUBMISSION_STATUS.succeeded || ledger.orderId !== order.id) {
        await healSucceeded(db, { endUserId, idempotencyKey, orderId: order.id, orderKind, payloadHash })
      }
      return { type: 'replay', orderId: order.id }
    }

    if (ledger) {
      assertCompatible(ledger, orderKind, payloadHash)
      if (ledger.status === ORDER_SUBMISSION_STATUS.succeeded) {
        if (ledger.orderId) {
          const owned = await findOwnedOrderById(db, endUserId, ledger.orderId)
          if (owned) return { type: 'replay', orderId: owned.id }
        }
        abandonedConflict()
      }
      if (isTerminalLedgerStatus(ledger.status)) abandonedConflict()
      if (isLiveProcessingLease(ledger, now)) inProgressConflict()

      const leaseToken = randomUUID()
      const reclaimed = await db.orderSubmissionLedger.updateMany({
        where: {
          endUserId,
          idempotencyKey,
          status: ORDER_SUBMISSION_STATUS.processing,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
        data: {
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + ORDER_SUBMISSION_LEASE_MS),
          orderKind,
          payloadHash,
        },
      })
      if (reclaimed.count === 1) return { type: 'lease', leaseToken }
      continue
    }

    const leaseToken = randomUUID()
    try {
      await db.orderSubmissionLedger.create({
        data: {
          endUserId,
          idempotencyKey,
          orderKind,
          payloadHash,
          status: ORDER_SUBMISSION_STATUS.processing,
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + ORDER_SUBMISSION_LEASE_MS),
        },
      })
      return { type: 'lease', leaseToken }
    } catch (error) {
      if (isPrismaUniqueConflict(error)) continue
      throw error
    }
  }
  inProgressConflict()
}

/**
 * CAS processing+leaseToken → succeeded+orderId.
 * Must run in the same transaction as Order.create so a stale lease cannot commit.
 */
export async function completeOrderSubmission(
  db: SubmissionDb,
  args: { endUserId: string; idempotencyKey: string; leaseToken: string; orderId: string },
): Promise<void> {
  const updated = await db.orderSubmissionLedger.updateMany({
    where: {
      endUserId: args.endUserId,
      idempotencyKey: args.idempotencyKey,
      status: ORDER_SUBMISSION_STATUS.processing,
      leaseToken: args.leaseToken,
    },
    data: {
      status: ORDER_SUBMISSION_STATUS.succeeded,
      orderId: args.orderId,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
  if (updated.count !== 1) abandonedConflict()
}

/** Drop our processing row after a 4xx so the same key can retry. No-op if fenced or succeeded. */
export async function releaseOrderSubmissionLease(
  db: SubmissionDb,
  args: { endUserId: string; idempotencyKey: string; leaseToken: string },
): Promise<void> {
  await db.orderSubmissionLedger.deleteMany({
    where: {
      endUserId: args.endUserId,
      idempotencyKey: args.idempotencyKey,
      status: ORDER_SUBMISSION_STATUS.processing,
      leaseToken: args.leaseToken,
    },
  })
}

async function tombstoneAbandoned(
  db: SubmissionDb,
  endUserId: string,
  idempotencyKey: string,
): Promise<void> {
  try {
    await db.orderSubmissionLedger.create({
      data: {
        endUserId,
        idempotencyKey,
        orderKind: ORDER_SUBMISSION_KIND.unknown,
        payloadHash: '',
        status: ORDER_SUBMISSION_STATUS.abandoned,
      },
    })
  } catch (error) {
    if (!isPrismaUniqueConflict(error)) throw error
  }
}

async function resolveOne(db: SubmissionDb, endUserId: string, key: string): Promise<OrderSubmissionResolveItem> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const now = new Date()
    const order = await findOwnedOrder(db, endUserId, key)
    const ledger = await findLedger(db, endUserId, key)

    if (order) {
      const kind = ledger && (ledger.orderKind === 'print' || ledger.orderKind === 'package')
        ? ledger.orderKind
        : kindFromOrder(order)
      if (!ledger || ledger.status !== ORDER_SUBMISSION_STATUS.succeeded || ledger.orderId !== order.id) {
        await healSucceeded(db, {
          endUserId,
          idempotencyKey: key,
          orderId: order.id,
          orderKind: kind,
          payloadHash: order.idempotencyPayloadHash || ledger?.payloadHash || '',
        })
      }
      return createdItem(key, order, kind)
    }

    if (!ledger) {
      await tombstoneAbandoned(db, endUserId, key)
      const raced = await findLedger(db, endUserId, key)
      if (!raced) return { key, outcome: 'not_created' }
      continue
    }

    if (ledger.status === ORDER_SUBMISSION_STATUS.succeeded) {
      if (ledger.orderId) {
        const owned = await findOwnedOrderById(db, endUserId, ledger.orderId)
        if (owned) return createdItem(key, owned, ledger.orderKind)
      }
      return { key, outcome: 'not_created' }
    }

    if (isTerminalLedgerStatus(ledger.status)) return { key, outcome: 'not_created' }

    if (isLiveProcessingLease(ledger, now)) return { key, outcome: 'processing' }

    const abandoned = await db.orderSubmissionLedger.updateMany({
      where: {
        endUserId,
        idempotencyKey: key,
        status: ORDER_SUBMISSION_STATUS.processing,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        status: ORDER_SUBMISSION_STATUS.abandoned,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    if (abandoned.count === 1) return { key, outcome: 'not_created' }
  }
  return { key, outcome: 'processing' }
}

/**
 * Owner-scoped batch resolve. Missing keys are tombstoned as abandoned before
 * not_created so a late original POST cannot commit. Active leases stay processing.
 * Another user's key is indistinguishable from never-created (tombstone is caller-scoped).
 */
export async function resolveOrderSubmissions(
  db: SubmissionDb,
  endUserId: string,
  keys: string[],
): Promise<{ items: OrderSubmissionResolveItem[] }> {
  if (keys.length > ORDER_SUBMISSION_RESOLVE_MAX_KEYS) {
    throw new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: `一次最多核对 ${ORDER_SUBMISSION_RESOLVE_MAX_KEYS} 个请求标识` },
    })
  }
  const items: OrderSubmissionResolveItem[] = []
  for (const key of keys) {
    items.push(await resolveOne(db, endUserId, key))
  }
  return { items }
}
