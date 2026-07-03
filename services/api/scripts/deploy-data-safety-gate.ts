import 'dotenv/config'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { mkdirSync } from 'fs'
import { PrismaService } from '../src/prisma/prisma.service'

export const CORE_TABLES = ['FileObject', 'AiResumeResult', 'Order', 'EndUser', 'PrintTask'] as const

export type CoreTable = (typeof CORE_TABLES)[number]

export interface TableSnapshot {
  before: number
  after?: number
}

export interface MaxCreatedAtSnapshot {
  before: string | null
  after?: string | null
}

export interface RowAnchor {
  id: string
  createdAt: string
}

export interface DeployGateBaseline {
  version: 1
  batch: string
  generatedAt: string
  canary: {
    table: 'AuditLog'
    id: string
    action: 'deploy.canary'
    targetType: 'deploy_canary'
    targetId: string
    createdAt: string
  }
  counts: Record<CoreTable, TableSnapshot>
  maxCreatedAt: Record<CoreTable, MaxCreatedAtSnapshot>
  anchors: Record<CoreTable, { latestByCreatedAt: RowAnchor | null }>
}

export interface DeployGateAfterResult {
  status: 'passed'
  batch: string
  canaryFound: true
  counts: Record<CoreTable, Required<TableSnapshot>>
  maxCreatedAt: Record<CoreTable, Required<MaxCreatedAtSnapshot>>
  anchors: Record<CoreTable, { latestByCreatedAt: RowAnchor | null }>
  warnings: string[]
}

interface GateBeforeOptions {
  prisma: PrismaService
  batch: string
  outPath: string
}

interface GateAfterOptions {
  prisma: PrismaService
  baselinePath: string
  allowCountDrops?: Partial<Record<CoreTable, string>>
}

function isCoreTable(value: string): value is CoreTable {
  return (CORE_TABLES as readonly string[]).includes(value)
}

function assertBatch(batch: string): void {
  if (!/^deploy-[a-zA-Z0-9._-]{6,96}$/.test(batch)) {
    throw new Error('DP_GATE_INVALID_BATCH: batch must start with deploy- and contain only letters, numbers, dot, underscore, or dash')
  }
}

function redactId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}...`
}

function assertKnownTable(table: never): never {
  throw new Error(`Unsupported core table: ${table}`)
}

async function countTable(prisma: PrismaService, table: CoreTable): Promise<number> {
  switch (table) {
    case 'FileObject':
      return prisma.fileObject.count()
    case 'AiResumeResult':
      return prisma.aiResumeResult.count()
    case 'Order':
      return prisma.order.count()
    case 'EndUser':
      return prisma.endUser.count()
    case 'PrintTask':
      return prisma.printTask.count()
    default:
      return assertKnownTable(table)
  }
}

async function maxCreatedAt(prisma: PrismaService, table: CoreTable): Promise<string | null> {
  return (await latestAnchor(prisma, table))?.createdAt ?? null
}

async function latestAnchor(prisma: PrismaService, table: CoreTable): Promise<RowAnchor | null> {
  let value: { id: string; createdAt: Date } | null
  switch (table) {
    case 'FileObject':
      value = await prisma.fileObject.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } })
      break
    case 'AiResumeResult':
      value = await prisma.aiResumeResult.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } })
      break
    case 'Order':
      value = await prisma.order.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } })
      break
    case 'EndUser':
      value = await prisma.endUser.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } })
      break
    case 'PrintTask':
      value = await prisma.printTask.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } })
      break
    default:
      return assertKnownTable(table)
  }
  return value ? { id: value.id, createdAt: value.createdAt.toISOString() } : null
}

async function anchorCreatedAt(prisma: PrismaService, table: CoreTable, id: string): Promise<string | null> {
  let value: { createdAt: Date } | null
  switch (table) {
    case 'FileObject':
      value = await prisma.fileObject.findUnique({ where: { id }, select: { createdAt: true } })
      break
    case 'AiResumeResult':
      value = await prisma.aiResumeResult.findUnique({ where: { id }, select: { createdAt: true } })
      break
    case 'Order':
      value = await prisma.order.findUnique({ where: { id }, select: { createdAt: true } })
      break
    case 'EndUser':
      value = await prisma.endUser.findUnique({ where: { id }, select: { createdAt: true } })
      break
    case 'PrintTask':
      value = await prisma.printTask.findUnique({ where: { id }, select: { createdAt: true } })
      break
    default:
      return assertKnownTable(table)
  }
  return value ? value.createdAt.toISOString() : null
}

async function collectCounts(prisma: PrismaService): Promise<Record<CoreTable, TableSnapshot>> {
  const entries = await Promise.all(
    CORE_TABLES.map(async (table) => [table, { before: await countTable(prisma, table) }] as const),
  )
  return Object.fromEntries(entries) as Record<CoreTable, TableSnapshot>
}

async function collectMaxCreatedAt(prisma: PrismaService): Promise<Record<CoreTable, MaxCreatedAtSnapshot>> {
  const entries = await Promise.all(
    CORE_TABLES.map(async (table) => [table, { before: await maxCreatedAt(prisma, table) }] as const),
  )
  return Object.fromEntries(entries) as Record<CoreTable, MaxCreatedAtSnapshot>
}

async function collectAnchors(prisma: PrismaService): Promise<Record<CoreTable, { latestByCreatedAt: RowAnchor | null }>> {
  const entries = await Promise.all(
    CORE_TABLES.map(async (table) => [table, { latestByCreatedAt: await latestAnchor(prisma, table) }] as const),
  )
  return Object.fromEntries(entries) as Record<CoreTable, { latestByCreatedAt: RowAnchor | null }>
}

export async function runGateBefore({ prisma, batch, outPath }: GateBeforeOptions): Promise<DeployGateBaseline> {
  assertBatch(batch)
  const existing = await prisma.auditLog.count({
    where: { action: 'deploy.canary', targetType: 'deploy_canary', targetId: batch },
  })
  if (existing > 0) {
    throw new Error('DP_GATE_CANARY_ALREADY_EXISTS: batch already has a deploy.canary AuditLog row')
  }

  const counts = await collectCounts(prisma)
  const maxCreatedAtValues = await collectMaxCreatedAt(prisma)
  const anchors = await collectAnchors(prisma)
  const row = await prisma.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'system',
      action: 'deploy.canary',
      targetType: 'deploy_canary',
      targetId: batch,
      payloadJson: JSON.stringify({ marker: `DP-CANARY-${batch}` }),
      ipAddress: null,
      userAgent: 'deploy-data-safety-gate',
      requestId: null,
    },
  })

  const baseline: DeployGateBaseline = {
    version: 1,
    batch,
    generatedAt: new Date().toISOString(),
    canary: {
      table: 'AuditLog',
      id: row.id,
      action: 'deploy.canary',
      targetType: 'deploy_canary',
      targetId: batch,
      createdAt: row.createdAt.toISOString(),
    },
    counts,
    maxCreatedAt: maxCreatedAtValues,
    anchors,
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
  console.log(`DP-GATE before passed: batch=${batch} canary=${redactId(row.id)} baseline=${outPath}`)
  return baseline
}

function readBaseline(path: string): DeployGateBaseline {
  if (!existsSync(path)) throw new Error(`DP_GATE_BASELINE_MISSING: ${path}`)
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as DeployGateBaseline
  if (parsed.version !== 1 || !parsed.batch || parsed.canary?.table !== 'AuditLog') {
    throw new Error('DP_GATE_BASELINE_INVALID: unsupported baseline file')
  }
  assertBatch(parsed.batch)
  return parsed
}

function compareIso(after: string | null, before: string | null, table: CoreTable): void {
  if (!before) return
  if (!after) throw new Error(`DP_GATE_MAX_CREATED_AT_ROLLED_BACK: ${table} max(createdAt) disappeared`)
  if (Date.parse(after) < Date.parse(before)) {
    throw new Error(`DP_GATE_MAX_CREATED_AT_ROLLED_BACK: ${table} before=${before} after=${after}`)
  }
}

export async function runGateAfter({
  prisma,
  baselinePath,
  allowCountDrops = {},
}: GateAfterOptions): Promise<DeployGateAfterResult> {
  const baseline = readBaseline(baselinePath)
  const canary = await prisma.auditLog.findFirst({
    where: {
      id: baseline.canary.id,
      action: 'deploy.canary',
      targetType: 'deploy_canary',
      targetId: baseline.canary.targetId,
      actorId: null,
      actorRole: 'system',
    },
  })
  if (!canary) {
    throw new Error('DP_GATE_CANARY_MISSING: deploy.canary AuditLog row disappeared after deploy')
  }

  const counts = {} as Record<CoreTable, Required<TableSnapshot>>
  const maxCreatedAtValues = {} as Record<CoreTable, Required<MaxCreatedAtSnapshot>>
  const anchors = {} as Record<CoreTable, { latestByCreatedAt: RowAnchor | null }>
  const warnings: string[] = []

  for (const table of CORE_TABLES) {
    const beforeAnchor = baseline.anchors?.[table]?.latestByCreatedAt ?? null
    if (beforeAnchor) {
      const afterAnchorCreatedAt = await anchorCreatedAt(prisma, table, beforeAnchor.id)
      if (!afterAnchorCreatedAt) {
        throw new Error(`DP_GATE_ANCHOR_MISSING: ${table} baseline row disappeared id=${redactId(beforeAnchor.id)}`)
      }
      if (Date.parse(afterAnchorCreatedAt) !== Date.parse(beforeAnchor.createdAt)) {
        throw new Error(`DP_GATE_ANCHOR_MUTATED: ${table} baseline row createdAt changed id=${redactId(beforeAnchor.id)}`)
      }
    }
    anchors[table] = { latestByCreatedAt: beforeAnchor }

    const beforeCount = baseline.counts[table]?.before
    const afterCount = await countTable(prisma, table)
    if (typeof beforeCount !== 'number') {
      throw new Error(`DP_GATE_BASELINE_INVALID: missing before count for ${table}`)
    }
    if (afterCount < beforeCount) {
      const reason = allowCountDrops[table]?.trim()
      if (!reason) {
        throw new Error(`DP_GATE_COUNT_DROPPED: ${table} before=${beforeCount} after=${afterCount}`)
      }
      warnings.push(`${table} count dropped with operator explanation: ${reason}`)
    }
    counts[table] = { before: beforeCount, after: afterCount }

    const beforeMax = baseline.maxCreatedAt[table]?.before ?? null
    const afterMax = await maxCreatedAt(prisma, table)
    compareIso(afterMax, beforeMax, table)
    maxCreatedAtValues[table] = { before: beforeMax, after: afterMax }
  }

  console.log(`DP-GATE after passed: batch=${baseline.batch} canary=${redactId(baseline.canary.id)} warnings=${warnings.length}`)
  return { status: 'passed', batch: baseline.batch, canaryFound: true, counts, maxCreatedAt: maxCreatedAtValues, anchors, warnings }
}

function parseArgs(argv: string[]): {
  mode: 'before' | 'after'
  batch?: string
  outPath?: string
  baselinePath?: string
  allowCountDrops: Partial<Record<CoreTable, string>>
} {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const [mode, ...rest] = normalizedArgv
  if (mode !== 'before' && mode !== 'after') {
    throw new Error('Usage: deploy-data-safety-gate.ts before --batch deploy-... --out /path/baseline.json | after --baseline /path/baseline.json [--allow-count-drop Table:reason]')
  }
  const result: ReturnType<typeof parseArgs> = { mode, allowCountDrops: {} }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    const next = rest[i + 1]
    if (arg === '--batch' && next) {
      result.batch = next
      i += 1
    } else if (arg === '--out' && next) {
      result.outPath = next
      i += 1
    } else if (arg === '--baseline' && next) {
      result.baselinePath = next
      i += 1
    } else if (arg === '--allow-count-drop' && next) {
      const [table, ...reasonParts] = next.split(':')
      const reason = reasonParts.join(':').trim()
      if (!isCoreTable(table) || !reason) {
        throw new Error('DP_GATE_INVALID_ALLOW_COUNT_DROP: expected Table:reason')
      }
      result.allowCountDrops[table] = reason
      i += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }
  return result
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    if (args.mode === 'before') {
      if (!args.batch || !args.outPath) throw new Error('DP_GATE_ARGS_MISSING: before requires --batch and --out')
      await runGateBefore({ prisma, batch: args.batch, outPath: args.outPath })
    } else {
      if (!args.baselinePath) throw new Error('DP_GATE_ARGS_MISSING: after requires --baseline')
      await runGateAfter({ prisma, baselinePath: args.baselinePath, allowCountDrops: args.allowCountDrops })
    }
  } finally {
    await prisma.onModuleDestroy()
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
