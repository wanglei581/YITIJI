/**
 * verify:ai-usage-retention —— P1-2a 计量表留存（2026-09-29 产品负责人已定）
 *
 * 明细与 AiServiceLog 共用 AI_SERVICE_LOG_RETENTION_DAYS，默认 90 天。
 * 到期先按北京时间月份汇总（只有金额和次数），再分批删。
 * 会员注销置空 endUserId，不删未到期明细。导出只含本人的功能、时间、状态、金额。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:ai-usage-retention
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const repoRoot = resolve(__dirname, '../../..')

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) {
    console.log(`  PASS ${name}`)
    return
  }
  failures += 1
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
}

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  return from >= 0 && to > from ? source.slice(from, to) : ''
}

const SUMMARY_COLUMNS = [
  'id',
  'monthKey',
  'featureKey',
  'vendor',
  'model',
  'status',
  'callCount',
  'measuredCostCny',
  'unmeasuredCount',
  'updatedAt',
] as const

const PERSONAL_COLUMN = /endUser|terminal|orgId|member|phone|userId|nickname|prompt|token/i

function modelBody(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`)
  if (start < 0) return ''
  const end = schema.indexOf('\n}', start)
  return end < 0 ? '' : schema.slice(start, end)
}

function modelFields(schema: string, modelName: string): string[] {
  const fields: string[] = []
  for (const line of modelBody(schema, modelName).split('\n')) {
    const trimmed = line.trim()
    const isModelHeader = trimmed.startsWith('model ') && trimmed.includes('{')
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@') || isModelHeader) continue
    const name = trimmed.split(/\s+/)[0]
    if (name) fields.push(name)
  }
  return fields
}

function verifySources(): void {
  console.log('\n── 源码与留存登记 ──')
  const cleanup = read('services/api/src/ai/ai-result.cleanup.task.ts')
  const hourly = sliceBetween(cleanup, 'async handleHourly', 'private async cleanupExpiredResumeResults')
  check('每小时清理调用用量账', hourly.includes('cleanupExpiredAiUsageRecords'))
  check('保留期只读一次再传给两处清理', /const retentionDays = readAiServiceLogRetentionDays\(\)/.test(hourly))
  check('服务日志清理用同一个天数', /cleanupExpiredAiServiceLogs\(retentionDays\)/.test(hourly))
  check('用量清理用同一个天数', /cleanupExpiredAiUsageRecords\(retentionDays\)/.test(hourly))
  check('保留期环境变量名仍在清理任务里', cleanup.includes("env['AI_SERVICE_LOG_RETENTION_DAYS']"))
  check('默认保留期是 90 天', /Math\.floor\(raw\) : 90/.test(cleanup))
  check('用量清理写审计且不带会员号', cleanup.includes("action: 'ai_usage_record.cleanup_expired'")
    && cleanup.includes('deletedCount')
    && cleanup.includes('summarizedCount')
    && cleanup.includes('retentionDays'))
  check('用量清理日志只记条数', cleanup.includes('expired AI usage records (summarized'))

  const retention = read('services/api/src/ai/usage/ai-usage-retention.ts')
  check('用量模块不自己读保留期环境变量', !retention.includes('process.env'))
  check('不另立用量保留期变量', !/AI_USAGE_[A-Z0-9_]*RETENTION/.test(retention))
  check('分批取数', retention.includes('take: batchSize'))
  const upsertAt = retention.indexOf('aiUsageMonthlySummary.upsert')
  const deleteAt = retention.indexOf('aiUsageRecord.deleteMany')
  check('源码里先汇总再删除', upsertAt >= 0 && deleteAt > upsertAt)
  check('注销处置是置空', retention.includes("MEMBER_AI_USAGE_ON_CLOSURE = 'set_null'"))
  const detachAt = retention.indexOf('export async function detachMemberAiUsageRecords')
  const detachBody = detachAt >= 0 ? retention.slice(detachAt) : ''
  check('置空函数存在且不删行', detachAt >= 0 && !detachBody.includes('deleteMany'))
  check('空会员号直接拒绝', detachBody.includes('endUserId.length === 0'))

  for (const schemaPath of [
    'services/api/prisma/schema.prisma',
    'services/api/prisma/postgres/schema.prisma',
  ]) {
    const schema = read(schemaPath)
    const fields = modelFields(schema, 'AiUsageMonthlySummary')
    check(`${schemaPath} 汇总列白名单`, fields.length === SUMMARY_COLUMNS.length
      && SUMMARY_COLUMNS.every((name) => fields.includes(name)))
    check(`${schemaPath} 汇总列没有个人字段`, fields.every((name) => !PERSONAL_COLUMN.test(name))
      && !modelBody(schema, 'AiUsageMonthlySummary').includes('@relation'))
    check(`${schemaPath} 明细有汇总时间`, modelBody(schema, 'AiUsageRecord').includes('summarizedAt'))
    check(`${schemaPath} 外键仍是置空`, modelBody(schema, 'AiUsageRecord').includes('onDelete: SetNull'))
  }

  for (const migrationPath of [
    'services/api/prisma/migrations/20260929230000_ai_usage_retention_summary/migration.sql',
    'services/api/prisma/postgres/migrations/20260929230000_ai_usage_retention_summary/migration.sql',
  ]) {
    const sql = read(migrationPath)
    check(`${migrationPath} 有汇总表`, sql.includes('AiUsageMonthlySummary') && sql.includes('summarizedAt'))
    check(`${migrationPath} 不含个人列`, !/endUserId|terminalId|orgId/.test(sql))
    check(`${migrationPath} 唯一键名字放得进 PostgreSQL`, sql.includes('AiUsageMonthly_dims_key'))
  }

  const doc = read('docs/compliance/member-personal-data-retention.md')
  check('留存矩阵登记明细 90 天', doc.includes('AiUsageRecord') && doc.includes('AI_SERVICE_LOG_RETENTION_DAYS') && doc.includes('90 天'))
  check('留存矩阵登记月汇总不含个人信息', doc.includes('AiUsageMonthlySummary') && doc.includes('长期保留') && doc.includes('不含个人信息'))
  const progress = read('docs/progress/current-progress.md')
  check(
    '进度文档已记下留存期决定',
    progress.includes('计量表留存期（已定：与 AiServiceLog 同，默认 90 天到期自动清理；按月汇总只存金额和次数、长期保留）'),
  )

  const scope = read('packages/shared/src/types/memberPrivacy.ts')
  check('数据清单写明 AI 用量', scope.includes('AI 用量（功能、时间、状态、金额）'))
  const mapper = read('services/api/src/member-privacy/member-data-export.mapper.ts')
  const limitLoop = sliceBetween(mapper, 'for (const rows of [', 'this.assertWithinLimit')
  check('用量导出受行数上限约束', limitLoop.includes('aiUsage'))
}

function moneyClose(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 1e-9
}

interface SummaryExpect {
  monthKey: string
  featureKey: string
  vendor: string
  model: string
  status: string
  callCount: number
  measuredCostCny: number
  unmeasuredCount: number
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  verifySources()

  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { cleanupExpiredAiUsageRecords, detachMemberAiUsageRecords } = await import('../src/ai/usage/ai-usage-retention')
  const { readAiServiceLogRetentionDays } = await import('../src/ai/ai-result.cleanup.task')
  const { MemberDataExportMapper } = await import('../src/member-privacy/member-data-export.mapper')

  console.log('\n── 保留期读取 ──')
  const savedRetention = process.env['AI_SERVICE_LOG_RETENTION_DAYS']
  delete process.env['AI_SERVICE_LOG_RETENTION_DAYS']
  check('未设置时默认 90 天', readAiServiceLogRetentionDays() === 90)
  check('非数字回落 90 天', readAiServiceLogRetentionDays({ AI_SERVICE_LOG_RETENTION_DAYS: 'nope' }) === 90)
  check('0 和负数回落 90 天', readAiServiceLogRetentionDays({ AI_SERVICE_LOG_RETENTION_DAYS: '0' }) === 90
    && readAiServiceLogRetentionDays({ AI_SERVICE_LOG_RETENTION_DAYS: '-3' }) === 90)
  check('正数向下取整', readAiServiceLogRetentionDays({ AI_SERVICE_LOG_RETENTION_DAYS: '10.9' }) === 10)
  if (savedRetention === undefined) delete process.env['AI_SERVICE_LOG_RETENTION_DAYS']
  else process.env['AI_SERVICE_LOG_RETENTION_DAYS'] = savedRetention

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const run = randomUUID().slice(0, 8)
  const feature = (name: string) => `gate-usage-ret-${run}-${name}`
  const createdUsers: string[] = []

  async function member(label: string): Promise<string> {
    const row = await prisma.endUser.create({
      data: { phoneHash: `gate-usage-ret-${run}-${label}`, phoneEnc: 'x' },
    })
    createdUsers.push(row.id)
    return row.id
  }

  async function usage(data: {
    featureKey: string
    createdAt: Date
    status?: string
    model?: string | null
    costCny?: number | null
    costMeasured?: boolean
    endUserId?: string | null
    summarizedAt?: Date | null
    terminalId?: string | null
    orgId?: string | null
    vendor?: string
  }): Promise<string> {
    const row = await prisma.aiUsageRecord.create({
      data: {
        dayKey: '2026-09-01',
        featureKey: data.featureKey,
        vendor: data.vendor ?? 'deepseek',
        model: data.model === undefined ? 'deepseek-v4-flash' : data.model,
        status: data.status ?? 'ok',
        costCny: data.costCny === undefined ? null : data.costCny,
        costMeasured: data.costMeasured ?? false,
        endUserId: data.endUserId ?? null,
        summarizedAt: data.summarizedAt ?? null,
        terminalId: data.terminalId ?? null,
        orgId: data.orgId ?? null,
        createdAt: data.createdAt,
      },
    })
    return row.id
  }

  async function summaries(featureKey: string): Promise<SummaryExpect[]> {
    const rows = await prisma.aiUsageMonthlySummary.findMany({
      where: { featureKey },
      orderBy: [{ monthKey: 'asc' }, { status: 'asc' }, { model: 'asc' }],
    })
    return rows.map((row) => ({
      monthKey: row.monthKey,
      featureKey: row.featureKey,
      vendor: row.vendor,
      model: row.model,
      status: row.status,
      callCount: row.callCount,
      measuredCostCny: row.measuredCostCny,
      unmeasuredCount: row.unmeasuredCount,
    }))
  }

  function expectSummary(actual: SummaryExpect[], expected: SummaryExpect, label: string): void {
    const found = actual.find((row) => row.monthKey === expected.monthKey
      && row.vendor === expected.vendor
      && row.model === expected.model
      && row.status === expected.status)
    check(
      label,
      !!found
        && found.callCount === expected.callCount
        && found.unmeasuredCount === expected.unmeasuredCount
        && moneyClose(found.measuredCostCny, expected.measuredCostCny),
      found ? JSON.stringify(found) : `missing among ${actual.length}`,
    )
  }

  try {
    console.log('\n── 到期先汇总再删 ──')
    const now = new Date('2026-09-29T04:00:00.000Z')
    const expiredAt = new Date('2026-09-01T02:00:00.000Z')
    const freshAt = new Date('2026-09-25T04:00:00.000Z')
    const key = feature('numbers')
    const measuredA = await usage({ featureKey: key, createdAt: expiredAt, costCny: 1.25, costMeasured: true })
    const measuredB = await usage({ featureKey: key, createdAt: expiredAt, costCny: 0.5, costMeasured: true })
    const unmeasured = await usage({ featureKey: key, createdAt: expiredAt, costCny: null, costMeasured: false })
    const otherStatus = await usage({
      featureKey: key,
      createdAt: expiredAt,
      status: 'upstream_error',
      costCny: 0.2,
      costMeasured: true,
    })
    const fresh = await usage({ featureKey: key, createdAt: freshAt, costCny: 9.5, costMeasured: true })
    const first = await cleanupExpiredAiUsageRecords(prisma, { now, retentionDays: 10, batchSize: 1 })
    const gone = await prisma.aiUsageRecord.findMany({ where: { id: { in: [measuredA, measuredB, unmeasured, otherStatus] } } })
    const freshRow = await prisma.aiUsageRecord.findUnique({ where: { id: fresh } })
    check('过期行被删', gone.length === 0, `left ${gone.length}`)
    check('未过期行保留', freshRow?.costCny === 9.5)
    check('分批删完三行以上', first.deletedCount >= 4 && first.summarizedCount >= 4)
    const rolled = await summaries(key)
    expectSummary(rolled, {
      monthKey: '2026-09', featureKey: key, vendor: 'deepseek', model: 'deepseek-v4-flash', status: 'ok',
      callCount: 3, measuredCostCny: 1.75, unmeasuredCount: 1,
    }, '成功调用汇总 3 次、已计量 1.75、未计量 1')
    expectSummary(rolled, {
      monthKey: '2026-09', featureKey: key, vendor: 'deepseek', model: 'deepseek-v4-flash', status: 'upstream_error',
      callCount: 1, measuredCostCny: 0.2, unmeasuredCount: 0,
    }, '另一种结局单独成行')
    check('未到期的大额不进汇总', !rolled.some((row) => moneyClose(row.measuredCostCny, 9.5) || row.callCount > 3))
    const again = await cleanupExpiredAiUsageRecords(prisma, { now, retentionDays: 10, batchSize: 1 })
    const rerolled = await summaries(key)
    check('重跑不重复计入', again.summarizedCount === 0
      && rerolled.length === rolled.length
      && rerolled.every((row, index) => row.callCount === rolled[index]?.callCount
        && moneyClose(row.measuredCostCny, rolled[index]?.measuredCostCny ?? -1)))

    console.log('\n── 已汇总过的行不重复计入 ──')
    const priorKey = feature('prior')
    await prisma.aiUsageMonthlySummary.create({
      data: {
        monthKey: '2026-09',
        featureKey: priorKey,
        vendor: 'deepseek',
        model: 'deepseek-v4-flash',
        status: 'ok',
        callCount: 1,
        measuredCostCny: 4,
        unmeasuredCount: 0,
      },
    })
    await usage({
      featureKey: priorKey,
      createdAt: expiredAt,
      costCny: 4,
      costMeasured: true,
      summarizedAt: new Date('2026-09-20T00:00:00.000Z'),
    })
    await usage({ featureKey: priorKey, createdAt: expiredAt, costCny: 1, costMeasured: true })
    await cleanupExpiredAiUsageRecords(prisma, { now, retentionDays: 10 })
    const priorRows = await summaries(priorKey)
    expectSummary(priorRows, {
      monthKey: '2026-09', featureKey: priorKey, vendor: 'deepseek', model: 'deepseek-v4-flash', status: 'ok',
      callCount: 2, measuredCostCny: 5, unmeasuredCount: 0,
    }, '已打标的 4 元不再加一次，新的 1 元加上去')
    check('两行过期明细都已删除', (await prisma.aiUsageRecord.count({ where: { featureKey: priorKey } })) === 0)

    console.log('\n── 空型号收成同一键，北京时间月份 ──')
    const nullKey = feature('null-model')
    await usage({ featureKey: nullKey, createdAt: expiredAt, model: null, costCny: 0.3, costMeasured: true })
    await usage({ featureKey: nullKey, createdAt: expiredAt, model: null, costCny: 0.7, costMeasured: true })
    await cleanupExpiredAiUsageRecords(prisma, { now, retentionDays: 10, batchSize: 1 })
    const nullRows = await summaries(nullKey)
    check('空型号只有一行汇总', nullRows.length === 1 && nullRows[0]?.model === '' && nullRows[0]?.callCount === 2
      && moneyClose(nullRows[0]?.measuredCostCny ?? -1, 1))

    const boundaryNow = new Date('2026-05-01T00:00:00.000Z')
    const boundaryKey = feature('boundary')
    await usage({ featureKey: boundaryKey, createdAt: new Date('2026-03-31T15:59:59.000Z'), costCny: 1, costMeasured: true })
    await usage({ featureKey: boundaryKey, createdAt: new Date('2026-03-31T16:00:00.000Z'), costCny: 2, costMeasured: true })
    await cleanupExpiredAiUsageRecords(prisma, { now: boundaryNow, retentionDays: 20 })
    const boundaryRows = await summaries(boundaryKey)
    check('北京时间跨月分成 3 月和 4 月', boundaryRows.map((row) => row.monthKey).sort().join(',') === '2026-03,2026-04')

    console.log('\n── 环境变量里的保留期 ──')
    process.env['AI_SERVICE_LOG_RETENTION_DAYS'] = '10'
    const retentionNow = new Date('2026-09-29T04:00:00.000Z')
    const day = 24 * 60 * 60 * 1000
    const envKey = feature('env')
    const older = await usage({ featureKey: envKey, createdAt: new Date(retentionNow.getTime() - 11 * day), costCny: 1, costMeasured: true })
    const newer = await usage({ featureKey: envKey, createdAt: new Date(retentionNow.getTime() - 9 * day), costCny: 2, costMeasured: true })
    await cleanupExpiredAiUsageRecords(prisma, {
      now: retentionNow,
      retentionDays: readAiServiceLogRetentionDays(),
    })
    check('11 天的行按 10 天保留期删除', (await prisma.aiUsageRecord.findUnique({ where: { id: older } })) === null)
    check('9 天的行保留', (await prisma.aiUsageRecord.findUnique({ where: { id: newer } })) !== null)
    delete process.env['AI_SERVICE_LOG_RETENTION_DAYS']
    const defaultKey = feature('default90')
    const tooOld = await usage({
      featureKey: defaultKey,
      createdAt: new Date(retentionNow.getTime() - 91 * day),
      costCny: 1,
      costMeasured: true,
    })
    const stillKept = await usage({
      featureKey: defaultKey,
      createdAt: new Date(retentionNow.getTime() - 89 * day),
      costCny: 1,
      costMeasured: true,
    })
    await cleanupExpiredAiUsageRecords(prisma, {
      now: retentionNow,
      retentionDays: readAiServiceLogRetentionDays(),
    })
    check('默认 90 天删掉 91 天前的行', (await prisma.aiUsageRecord.findUnique({ where: { id: tooOld } })) === null)
    check('默认 90 天留下 89 天前的行', (await prisma.aiUsageRecord.findUnique({ where: { id: stillKept } })) !== null)

    console.log('\n── 汇总行没有个人字段 ──')
    const sample = await prisma.aiUsageMonthlySummary.findFirst({ where: { featureKey: key } })
    const sampleKeys = sample ? Object.keys(sample).sort() : []
    check('运行时汇总列等于白名单', sampleKeys.join(',') === [...SUMMARY_COLUMNS].sort().join(','))
    check('运行时汇总列名不含个人字段', sampleKeys.every((name) => !PERSONAL_COLUMN.test(name)))

    console.log('\n── 会员解绑置空，不删金额 ──')
    const memberA = await member('a')
    const memberB = await member('b')
    const detachKey = feature('detach')
    await usage({ featureKey: detachKey, createdAt: freshAt, endUserId: memberA, costCny: 1.5, costMeasured: true })
    await usage({ featureKey: detachKey, createdAt: freshAt, endUserId: memberA, costCny: 2.5, costMeasured: true })
    await usage({ featureKey: detachKey, createdAt: freshAt, endUserId: memberB, costCny: 8, costMeasured: true })
    await usage({ featureKey: detachKey, createdAt: freshAt, endUserId: memberB, costCny: 8, costMeasured: true })
    const detached = await detachMemberAiUsageRecords(prisma, memberA, { batchSize: 1 })
    const aRows = await prisma.aiUsageRecord.findMany({ where: { featureKey: detachKey, OR: [{ endUserId: null }, { endUserId: memberA }] } })
    const aNull = aRows.filter((row) => row.endUserId === null)
    const bRows = await prisma.aiUsageRecord.findMany({ where: { featureKey: detachKey, endUserId: memberB } })
    check('置空了两行', detached === 2 && aNull.length === 2)
    check('置空后金额还在', aNull.reduce((sum, row) => sum + (row.costCny ?? 0), 0) === 4)
    check('没有删掉这个人的行', aRows.length === 2)
    check('另一个会员的行不动', bRows.length === 2 && bRows.every((row) => row.costCny === 8))
    check('再置空一次是 0', (await detachMemberAiUsageRecords(prisma, memberA)) === 0)
    let emptyRejected = false
    try {
      await detachMemberAiUsageRecords(prisma, '')
    } catch (error) {
      emptyRejected = (error as Error).message === 'AI_USAGE_DETACH_REQUIRES_MEMBER'
    }
    check('空会员号被拒绝', emptyRejected)

    console.log('\n── 导出只含本人的功能、时间、状态、金额 ──')
    const exportKey = feature('export')
    await usage({
      featureKey: exportKey,
      createdAt: new Date('2026-09-28T01:00:00.000Z'),
      endUserId: memberA,
      status: 'ok',
      costCny: 1.25,
      costMeasured: true,
      terminalId: 'TERMINAL_SECRET',
      orgId: 'ORG_SECRET',
      vendor: 'deepseek',
      model: 'deepseek-v4-flash',
    })
    await prisma.aiUsageRecord.updateMany({
      where: { featureKey: exportKey, endUserId: memberA },
      data: { promptTokens: 12345 },
    })
    await usage({
      featureKey: exportKey,
      createdAt: new Date('2026-09-27T01:00:00.000Z'),
      endUserId: memberA,
      status: 'timeout',
      costCny: null,
      costMeasured: false,
    })
    await usage({
      featureKey: 'OTHER_MEMBER_SECRET',
      createdAt: freshAt,
      endUserId: memberB,
      costCny: 9,
      costMeasured: true,
      terminalId: 'TERMINAL_SECRET',
    })
    const mapper = new MemberDataExportMapper(prisma)
    const envelope = await mapper.build({
      endUserId: memberA,
      requestId: `req-${run}`,
      generatedAt: new Date('2026-09-29T00:00:00.000Z'),
    })
    const exported = envelope.sections.aiUsage
    const serialized = JSON.stringify(envelope)
    check('导出两条本人用量', exported.length === 2)
    check('导出字段只有功能、时间、状态、金额', exported.every((row) => Object.keys(row).sort().join(',') === 'costCny,createdAt,featureKey,status'))
    check('未计量金额保持为空', exported.some((row) => row['costCny'] === null && row['status'] === 'timeout'))
    check('已计量金额原样导出', exported.some((row) => row['costCny'] === 1.25 && row['featureKey'] === exportKey && row['status'] === 'ok'))
    check('不导出别人的用量和终端机构', !serialized.includes('OTHER_MEMBER_SECRET')
      && !serialized.includes('TERMINAL_SECRET')
      && !serialized.includes('ORG_SECRET')
      && !serialized.includes('12345'))
  } finally {
    await prisma.aiUsageRecord.deleteMany({ where: { featureKey: { startsWith: `gate-usage-ret-${run}` } } })
    await prisma.aiUsageRecord.deleteMany({ where: { featureKey: 'OTHER_MEMBER_SECRET', endUserId: { in: createdUsers } } })
    await prisma.aiUsageMonthlySummary.deleteMany({ where: { featureKey: { startsWith: `gate-usage-ret-${run}` } } })
    if (createdUsers.length > 0) {
      await prisma.endUser.deleteMany({ where: { id: { in: createdUsers } } })
    }
    await prisma.onModuleDestroy()
  }

  console.log(`\n${checks - failures} PASS / ${failures} FAIL / ${checks} checks`)
  if (failures > 0) process.exit(1)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
