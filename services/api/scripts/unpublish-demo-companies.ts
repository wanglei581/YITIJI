/**
 * 一次性维护：下架库里残留的「（演示）」企业资料（CompanyProfile）。
 *
 * 背景：早期开发种子 prisma/seed-companies.ts 写过 3 家企业，名称都带「（演示）」，
 * 来源名是「市人社公共就业平台（演示）」。prisma/seed-guard.ts 只拦新写入，拦不住
 * 已经躺在库里的行；scripts/prod-readonly-probe.mjs 实测生产 GET /companies 仍公开这 3 家。
 * 托管 a 口径下我们云上本就不该展示企业，这是存量清理的一部分。
 *
 * 为什么是 scripts/ 下的独立命令、不进 src/companies：这是只跑一次的运维动作，不能有 HTTP 入口，
 * 也不该随 API 进程常驻；门禁 scripts/verify-demo-company-unpublish.ts 直接 import 本文件的导出函数。
 *
 * 用法（在 services/api 目录，DATABASE_URL 取受控环境，不写进命令历史）：
 *   # 第一步：dry-run（默认）。只列清单，不改库。
 *   pnpm --filter @ai-job-print/api maintenance:unpublish-demo-companies
 *
 *   # 第二步：核对清单无误、产品负责人授权后，带确认词和事由执行。
 *   UNPUBLISH_DEMO_COMPANIES_CONFIRM=UNPUBLISH_DEMO_COMPANIES \
 *   UNPUBLISH_DEMO_COMPANIES_REASON='首次发布清理开发期演示企业' \
 *   pnpm --filter @ai-job-print/api maintenance:unpublish-demo-companies
 *
 * 判据（刻意只有一条，一眼能复核）：name 与 sourceName **都**含全角字面量「（演示）」。
 * 不用探针那种 /演示|示例|demo/ 宽正则 —— 下架是写操作，范围只能收窄不能放宽。
 *
 * 行为约定：
 *   - 没设 UNPUBLISH_DEMO_COMPANIES_CONFIRM：dry-run，退出码 0，不改库、不写审计。
 *   - 设了但不等于 UNPUBLISH_DEMO_COMPANIES（含多余空格、大小写不同）：拒绝，退出码 2，不连库。
 *   - 确认词正确但事由缺失或不在 2–200 字：拒绝，退出码 2，不连库。
 *   - 执行：只把 publishStatus 改成 'unpublished'（不删行、不动 reviewStatus 等其它字段；
 *     updatedAt 由 Prisma @updatedAt 如实刷新）。已是 unpublished 的行跳过，不改、不写审计（幂等）。
 *     全部行的改动与每行一条审计在同一个事务里，审计写不进去就整体回滚。
 *   - 两种模式都打印目标数据库（PostgreSQL 只打印主机、端口、库名，不打印用户名和密码）供执行人核对。
 */
import 'dotenv/config'
import { AuditService } from '../src/audit/audit.service'
import { PrismaService, type PrismaTransactionClient } from '../src/prisma/prisma.service'

export const DEMO_COMPANY_MARK = '（演示）'
export const UNPUBLISH_DEMO_COMPANIES_CONFIRMATION = 'UNPUBLISH_DEMO_COMPANIES'
export const UNPUBLISH_DEMO_COMPANIES_AUDIT_ACTION = 'company.maintenance_unpublish'
export const UNPUBLISH_DEMO_COMPANIES_ACTOR_ROLE = 'system-cli'
const UNPUBLISHED = 'unpublished'
const SCRIPT_SOURCE = 'maintenance:unpublish-demo-companies'

export interface DemoCompanyUnpublishConfig {
  mode: 'dry-run' | 'apply'
  reason: string | null
}

export interface DemoCompanyRow {
  id: string
  name: string
  sourceName: string
  reviewStatus: string
  publishStatus: string
}

export interface DemoCompanyUnpublishResult {
  mode: 'dry-run' | 'apply'
  /** 带标记且当前不是 unpublished 的行：dry-run 时是「将改」，执行后是「已改」。 */
  toUnpublish: DemoCompanyRow[]
  /** 带标记且本来就是 unpublished 的行：不改、不写审计。 */
  alreadyUnpublished: DemoCompanyRow[]
}

export type AuditWriter = Pick<AuditService, 'writeRequired'>

export class DemoCompanyUnpublishConfigError extends Error {}

/** 读取确认词与事由。只看环境变量，不连库；配置错一律抛 DemoCompanyUnpublishConfigError。 */
export function readDemoCompanyUnpublishConfig(env: NodeJS.ProcessEnv): DemoCompanyUnpublishConfig {
  const confirm = env['UNPUBLISH_DEMO_COMPANIES_CONFIRM']
  if (confirm === undefined || confirm === '') return { mode: 'dry-run', reason: null }
  if (confirm !== UNPUBLISH_DEMO_COMPANIES_CONFIRMATION) {
    throw new DemoCompanyUnpublishConfigError(
      `UNPUBLISH_DEMO_COMPANIES_CONFIRM_MISMATCH: 确认词必须精确等于 ${UNPUBLISH_DEMO_COMPANIES_CONFIRMATION}；未改动任何数据`,
    )
  }
  const reason = env['UNPUBLISH_DEMO_COMPANIES_REASON']?.trim() ?? ''
  const reasonLength = Array.from(reason).length
  if (reasonLength < 2 || reasonLength > 200) {
    throw new DemoCompanyUnpublishConfigError(
      'UNPUBLISH_DEMO_COMPANIES_REASON_INVALID: 执行模式必须用 UNPUBLISH_DEMO_COMPANIES_REASON 写明事由（2–200 字）；未改动任何数据',
    )
  }
  return { mode: 'apply', reason }
}

/** 目标数据库的可核对描述：不含用户名、密码与查询参数。 */
export function describeDatabaseTarget(databaseUrl: string | undefined): string {
  const url = databaseUrl?.trim() ?? ''
  if (url.startsWith('file:')) {
    return `SQLite 文件 ${url.slice('file:'.length).split(/[?#]/, 1)[0]}`
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    try {
      const parsed = new URL(url)
      const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || '(未指定库名)'
      return `PostgreSQL 主机 ${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''} 库 ${database}`
    } catch {
      return 'PostgreSQL（连接串无法解析，请人工核对）'
    }
  }
  return '(未识别的 DATABASE_URL)'
}

/** 唯一判据：name 与 sourceName 都含全角「（演示）」。查询与条件更新共用这一处。 */
function demoCompanyWhere() {
  return {
    name: { contains: DEMO_COMPANY_MARK },
    sourceName: { contains: DEMO_COMPANY_MARK },
  }
}

type CompanyReader = Pick<PrismaTransactionClient, 'companyProfile'>

async function listDemoCompanies(db: CompanyReader): Promise<DemoCompanyUnpublishResult['toUnpublish']> {
  return db.companyProfile.findMany({
    where: demoCompanyWhere(),
    select: { id: true, name: true, sourceName: true, reviewStatus: true, publishStatus: true },
    orderBy: { id: 'asc' },
  })
}

function partition(rows: DemoCompanyRow[]): Pick<DemoCompanyUnpublishResult, 'toUnpublish' | 'alreadyUnpublished'> {
  return {
    toUnpublish: rows.filter((row) => row.publishStatus !== UNPUBLISHED),
    alreadyUnpublished: rows.filter((row) => row.publishStatus === UNPUBLISHED),
  }
}

/**
 * dry-run 只读；apply 在一个事务里逐行「条件更新 + 必成功审计」。
 * 条件更新带上读到的旧 publishStatus：读与写之间状态被别人改了就整体回滚，审计里的旧值不会写错。
 */
export async function runDemoCompanyUnpublish(
  prisma: Pick<PrismaService, 'companyProfile' | '$transaction'>,
  audit: AuditWriter,
  config: DemoCompanyUnpublishConfig,
): Promise<DemoCompanyUnpublishResult> {
  if (config.mode !== 'apply') {
    return { mode: 'dry-run', ...partition(await listDemoCompanies(prisma)) }
  }
  const reason = config.reason ?? ''
  return prisma.$transaction(
    async (tx: PrismaTransactionClient) => {
      const planned = partition(await listDemoCompanies(tx))
      for (const row of planned.toUnpublish) {
        const updated = await tx.companyProfile.updateMany({
          where: { id: row.id, publishStatus: row.publishStatus, ...demoCompanyWhere() },
          data: { publishStatus: UNPUBLISHED },
        })
        if (updated.count !== 1) {
          throw new Error(`UNPUBLISH_DEMO_COMPANIES_STATE_CHANGED: 企业 ${row.id} 的状态刚被修改，已整体回滚，请重新 dry-run`)
        }
        await audit.writeRequired(tx, {
          actorId: null,
          actorRole: UNPUBLISH_DEMO_COMPANIES_ACTOR_ROLE,
          action: UNPUBLISH_DEMO_COMPANIES_AUDIT_ACTION,
          targetType: 'company_profile',
          targetId: row.id,
          payload: {
            source: SCRIPT_SOURCE,
            reason,
            marker: DEMO_COMPANY_MARK,
            companyName: row.name,
            sourceName: row.sourceName,
            fromPublishStatus: row.publishStatus,
            toPublishStatus: UNPUBLISHED,
          },
        })
      }
      return { mode: 'apply' as const, ...planned }
    },
    { timeout: 60_000 },
  )
}

function printRows(title: string, rows: DemoCompanyRow[], nextStatus?: string): void {
  console.log(`${title}（${rows.length} 行）`)
  for (const row of rows) {
    const status = nextStatus ? `${row.publishStatus} → ${nextStatus}` : row.publishStatus
    console.log(`  ${row.id}  ${row.name}  来源=${row.sourceName}  reviewStatus=${row.reviewStatus}  publishStatus=${status}`)
  }
}

async function main(): Promise<void> {
  let config: DemoCompanyUnpublishConfig
  try {
    config = readDemoCompanyUnpublishConfig(process.env)
  } catch (error) {
    if (error instanceof DemoCompanyUnpublishConfigError) {
      console.error(`[unpublish-demo-companies] ${error.message}`)
      process.exit(2)
    }
    throw error
  }

  console.log(`\n=== 下架演示企业 [${config.mode === 'apply' ? '执行' : 'DRY-RUN（不改库）'}] ===`)
  console.log(`目标数据库：${describeDatabaseTarget(process.env['DATABASE_URL'])}`)
  console.log(`判据：name 与 sourceName 都含「${DEMO_COMPANY_MARK}」`)
  if (config.mode === 'apply') console.log(`事由：${config.reason}`)

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    const result = await runDemoCompanyUnpublish(prisma, new AuditService(prisma), config)
    if (result.mode === 'apply') {
      printRows('已下架', result.toUnpublish, UNPUBLISHED)
      printRows('原本就是 unpublished，未改动', result.alreadyUnpublished)
      console.log(`\n结果：已下架 ${result.toUnpublish.length} 行，写审计 ${result.toUnpublish.length} 条；跳过 ${result.alreadyUnpublished.length} 行。`)
    } else {
      printRows('将下架', result.toUnpublish, UNPUBLISHED)
      printRows('已下架（不会再改）', result.alreadyUnpublished)
      console.log(`\n结果：将改 ${result.toUnpublish.length} 行 / 已下架 ${result.alreadyUnpublished.length} 行。本次未改动任何数据。`)
      console.log(`核对无误后，加 UNPUBLISH_DEMO_COMPANIES_CONFIRM=${UNPUBLISH_DEMO_COMPANIES_CONFIRMATION} 和 UNPUBLISH_DEMO_COMPANIES_REASON='<事由>' 重跑。`)
    }
    console.log(JSON.stringify({
      ok: true,
      mode: result.mode,
      toUnpublish: result.toUnpublish.length,
      alreadyUnpublished: result.alreadyUnpublished.length,
    }))
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
