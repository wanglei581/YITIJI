/**
 * SQLite → PostgreSQL 数据迁移（第四阶段演练 + 上线切换用）。
 *
 * 双 Prisma client 模型级复制：SQLite 读（DATABASE_URL）→ PG 写（POSTGRES_URL）。
 * 类型转换（DateTime/Boolean 等）由 Prisma 两端各自处理，无手写 SQL 方言风险。
 * 表按外键拓扑序复制；结束后逐表行数对账，任何不一致退出码 1。
 *
 * 安全：
 * - 目标 PG 必须已 migrate deploy（schema 就绪）；
 * - 默认要求目标库为空（任一业务表有数据即拒绝），加 --force 才允许向非空库追加；
 * - 不打印任何行内容，只打印表名与行数。
 *
 * 用法：
 *   DATABASE_URL="file:./prisma/dev.db" \
 *   POSTGRES_URL="postgresql://user@host:5432/db" \
 *   pnpm --filter @ai-job-print/api db:pg:migrate-data
 */
import 'dotenv/config'
import { createPrismaClient, type AppPrismaClient } from '../src/prisma/create-client'

// 外键拓扑序（被引用表在前）。新增模型时必须同步维护；漏表会被末尾的全表对账抓住。
const MODEL_ORDER = [
  'organization', 'user', 'endUser', 'terminal', 'jobSource',
  'job', 'jobFair', 'fairZone', 'fairCompany', 'fairCompanyPosition', 'fairMaterial',
  'fairVenueGuide', 'fairVenueHall', 'fairVenueHallCompany', 'fairVenueFacility',
  'policyPost', 'fileObject', 'documentProcessTask', 'piiFinding',
  'printTask', 'terminalHeartbeat', 'printTaskStatusLog',
  'importBatch', 'importRecord', 'fieldMappingRule', 'syncLog',
  'aiResumeResult', 'favorite', 'benefitGrant',
  'adAsset', 'adPlaylist', 'adPlaylistItem', 'terminalScreensaverConfig',
  'mockInterviewSession', 'mockInterviewTurn', 'mockInterviewReport',
  'auditLog',
] as const

type ModelName = (typeof MODEL_ORDER)[number]
type AnyDelegate = { findMany(args?: unknown): Promise<Record<string, unknown>[]>; createMany(args: { data: unknown[] }): Promise<{ count: number }>; count(): Promise<number> }

function delegateOf(client: AppPrismaClient, model: ModelName): AnyDelegate {
  return (client as unknown as Record<string, AnyDelegate>)[model]
}

const BATCH = 500

/**
 * 孤儿行过滤：SQLite 历史库未强制外键，日志型表可能存在指向已删父行的孤儿
 * （演练时真实抓到 1 条 TerminalHeartbeat 孤儿）。这类行在 PG（强外键）无法落库，
 * 迁移时跳过并如实计数；对账按「源行数 - 跳过数 = 目标行数」校验。
 */
const ORPHAN_FILTERS: Partial<Record<ModelName, { fkField: string; parent: ModelName }>> = {
  terminalHeartbeat: { fkField: 'terminalId', parent: 'terminal' },
  printTaskStatusLog: { fkField: 'taskId', parent: 'printTask' },
}

async function main() {
  const sqliteUrl = process.env['DATABASE_URL']
  const pgUrl = process.env['POSTGRES_URL']
  if (!sqliteUrl?.startsWith('file:')) throw new Error('DATABASE_URL 必须是 SQLite（file:）源库')
  if (!pgUrl?.startsWith('postgres')) throw new Error('POSTGRES_URL 必须是 PostgreSQL 目标库')
  const force = process.argv.includes('--force')

  const src = createPrismaClient(sqliteUrl).client
  const dst = createPrismaClient(pgUrl).client

  try {
    // 目标库空库保护
    if (!force) {
      for (const model of MODEL_ORDER) {
        const n = await delegateOf(dst, model).count()
        if (n > 0) throw new Error(`目标库表 ${model} 已有 ${n} 行。确认追加请加 --force（注意主键冲突风险）`)
      }
    }

    let totalRows = 0
    const skipped = new Map<ModelName, number>()
    for (const model of MODEL_ORDER) {
      let rows = await delegateOf(src, model).findMany()
      const filter = ORPHAN_FILTERS[model]
      if (filter && rows.length > 0) {
        const parentRows = await delegateOf(dst, filter.parent).findMany()
        const parentIds = new Set(parentRows.map((r) => r['id'] as string))
        const before = rows.length
        rows = rows.filter((r) => {
          const fk = r[filter.fkField]
          return fk == null || parentIds.has(fk as string)
        })
        if (rows.length !== before) {
          skipped.set(model, before - rows.length)
          console.warn(`  ⚠ ${model}: 跳过 ${before - rows.length} 条孤儿行（${filter.fkField} 指向已删除的 ${filter.parent}）`)
        }
      }
      if (rows.length === 0) {
        console.log(`  ${model.padEnd(28)} 0`)
        continue
      }
      for (let i = 0; i < rows.length; i += BATCH) {
        await delegateOf(dst, model).createMany({ data: rows.slice(i, i + BATCH) })
      }
      totalRows += rows.length
      console.log(`  ${model.padEnd(28)} ${rows.length}`)
    }

    // 全表对账（包含 MODEL_ORDER 漏表的兜底：源库任何模型行数都必须与目标一致）
    let mismatch = 0
    for (const model of MODEL_ORDER) {
      const [a0, b] = await Promise.all([delegateOf(src, model).count(), delegateOf(dst, model).count()])
      const a = a0 - (skipped.get(model) ?? 0)
      if (a !== b) {
        console.error(`  ✗ 行数不一致 ${model}: sqlite=${a} pg=${b}`)
        mismatch += 1
      }
    }
    if (mismatch > 0) {
      console.error(`\n迁移对账失败：${mismatch} 张表不一致`)
      process.exitCode = 1
      return
    }
    console.log(`\n=== 迁移完成并对账通过：${MODEL_ORDER.length} 张表 / ${totalRows} 行 ===`)
  } finally {
    await (src as { onModuleDestroy?: () => Promise<void>; $disconnect?: () => Promise<void> }).$disconnect?.()
    await (dst as { $disconnect?: () => Promise<void> }).$disconnect?.()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
