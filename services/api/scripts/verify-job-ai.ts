/**
 * 岗位信息 AI 商用闭环 Task 2 静态门禁。
 *
 * 覆盖：
 *   1. shared 暴露岗位 AI 会话 / 推荐 / 目标岗位上下文契约。
 *   2. Prisma schema 只做 additive：新增 Job AI 相关表，并给 Job 增加可空 / 默认字段。
 *   3. SQLite 与 PostgreSQL migration 同步存在。
 *   4. 新表不存简历原文、完整聊天原文、投递结果、候选人/企业招聘闭环状态。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-ai
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let failed = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

function mustExist(rel: string, label: string): string {
  const abs = join(process.cwd(), rel)
  if (!existsSync(abs)) {
    fail(`${label} — 文件缺失: ${rel}`)
    return ''
  }
  pass(label)
  return readFileSync(abs, 'utf8')
}

function readMigrationByName(rootRel: string, migrationName: string, label: string): string {
  const rootAbs = join(process.cwd(), rootRel)
  if (!existsSync(rootAbs)) {
    fail(`${label} — 迁移目录缺失: ${rootRel}`)
    return ''
  }

  const matches = readdirSync(rootAbs)
    .filter((entry) => entry.endsWith(`_${migrationName}`))
    .sort()

  if (matches.length !== 1) {
    fail(`${label} — 预期唯一迁移 *_${migrationName}，实际 ${matches.length} 个`)
    return ''
  }

  return mustExist(join(rootRel, matches[0], 'migration.sql'), label)
}

function mustContain(source: string, markers: string[], label: string): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) fail(`${label} — 缺少: ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(source: string, markers: string[], label: string): void {
  const found = markers.filter((marker) => source.includes(marker))
  if (found.length > 0) fail(`${label} — 不应包含: ${found.join(' | ')}`)
  else pass(label)
}

function modelBlock(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`)
  if (start < 0) {
    fail(`Prisma schema 缺少 model ${modelName}`)
    return ''
  }
  const next = schema.indexOf('\nmodel ', start + 1)
  return schema.slice(start, next > start ? next : schema.length)
}

function main(): void {
  console.log('\n=== 岗位信息 AI 契约 / Schema 门禁 ===')

  const jobTypes = read('../../packages/shared/src/types/job.ts')
  const aiTypes = read('../../packages/shared/src/types/ai.ts')
  const sharedIndex = read('../../packages/shared/src/index.ts')
  const schema = read('prisma/schema.prisma')
  const pgSchema = read('prisma/postgres/schema.prisma')
  const sqliteMigration = readMigrationByName(
    'prisma/migrations',
    'add_job_ai_commercial_closure',
    'SQLite Job AI additive migration 存在',
  )
  const sqliteQualityMigration = readMigrationByName(
    'prisma/migrations',
    'add_job_quality_fields',
    'SQLite Job quality additive migration 存在',
  )
  const pgMigration = readMigrationByName(
    'prisma/postgres/migrations',
    'add_job_ai_commercial_closure',
    'PostgreSQL Job AI additive migration 存在',
  )
  const pgQualityMigration = readMigrationByName(
    'prisma/postgres/migrations',
    'add_job_quality_fields',
    'PostgreSQL Job quality additive migration 存在',
  )

  mustContain(
    jobTypes,
    [
      'JobQualityLevel',
      'JobNormalizedFields',
      'JobDataQualitySnapshotDTO',
      'educationRequirement',
      'experienceRequirement',
      'skills',
      'validThrough',
    ],
    'shared job.ts 包含岗位质量和标准化字段契约',
  )
  mustContain(
    aiTypes,
    [
      'JobAiFitLevel',
      'TargetJobContext',
      'JobRecommendationRequest',
      'JobRecommendationResponse',
      'JobAiSessionDTO',
      'reference_high',
      'reference_medium',
      'reference_low',
      '仅供参考',
    ],
    'shared ai.ts 包含岗位 AI 推荐契约与三档参考等级',
  )
  mustContain(sharedIndex, ["export * from './types/job'", "export * from './types/ai'"], 'shared index 导出 job/ai 契约')

  mustContain(
    schema,
    [
      'model JobAiSession',
      'model JobAiRecommendation',
      'model AiServiceLog',
      'model UserAiConsent',
      'model UserDataRequest',
      'model JobDataQualitySnapshot',
      'educationRequirement String?',
      'experienceRequirement String?',
      'skillsJson     String   @default("[]")',
      'benefitsJson   String   @default("[]")',
      'validThrough   DateTime?',
    ],
    'SQLite Prisma schema 包含 additive Job AI / quality 模型和字段',
  )
  mustContain(
    pgSchema,
    ['model JobAiSession', 'model JobAiRecommendation', 'model AiServiceLog', 'model UserAiConsent', 'model UserDataRequest', 'model JobDataQualitySnapshot'],
    'PostgreSQL Prisma schema 与主 schema 同步包含 Job AI 模型',
  )

  for (const name of ['JobAiSession', 'JobAiRecommendation', 'AiServiceLog', 'UserAiConsent', 'UserDataRequest', 'JobDataQualitySnapshot']) {
    const block = modelBlock(schema, name)
    mustNotContain(
      block,
      [
        'resumeText',
        'resumeRaw',
        'rawResume',
        'resumeContent',
        'resumeBody',
        'resumeMarkdown',
        'resumePlainText',
        'chatTranscript',
        'chatText',
        'chatHistory',
        'conversation',
        'messageHistory',
        'llmInput',
        'llmOutput',
        'modelInput',
        'modelOutput',
        'aiInput',
        'aiOutput',
        'fullPrompt',
        'prompt',
        'completion',
        'fullCompletion',
        'generatedText',
        'rawResponse',
        'responseText',
        'signedUrl',
        'fileName',
        'objectKey',
        'downloadUrl',
        'applyStatus',
        'applicationStatus',
        'deliveryStatus',
        'submissionStatus',
        'candidate',
        'candidateId',
        'employer',
        'interviewInvite',
        'interviewStatus',
        'offerStatus',
      ],
      `${name} 不存简历原文 / 完整对话 / 招聘闭环状态`,
    )
  }

  const recommendation = modelBlock(schema, 'JobAiRecommendation')
  mustContain(
    recommendation,
    ['fitLevel', 'reference_high | reference_medium | reference_low', 'matchPointsJson', 'gapPointsJson', 'actionChecklistJson'],
    'JobAiRecommendation 只沉淀参考等级和结构化建议',
  )
  mustContain(
    modelBlock(schema, 'JobAiSession'),
    ['accessTokenHash String?', 'expiresAt  DateTime?'],
    'JobAiSession 支持匿名令牌 hash 与 TTL 留存治理',
  )

  for (const [label, sql] of [
    ['SQLite Job AI migration', sqliteMigration],
    ['SQLite Job quality migration', sqliteQualityMigration],
    ['PostgreSQL Job AI migration', pgMigration],
    ['PostgreSQL Job quality migration', pgQualityMigration],
  ] as const) {
    mustNotContain(
      sql,
      ['DROP TABLE', 'DROP COLUMN', 'ALTER COLUMN', 'RENAME COLUMN', 'RENAME TO', 'migrate reset'],
      `${label} 只允许 additive DDL`,
    )
  }

  mustContain(
    sqliteMigration + sqliteQualityMigration,
    [
      'CREATE TABLE "JobAiSession"',
      'CREATE TABLE "JobAiRecommendation"',
      'CREATE TABLE "AiServiceLog"',
      'CREATE TABLE "UserAiConsent"',
      'CREATE TABLE "UserDataRequest"',
      'CREATE TABLE "JobDataQualitySnapshot"',
      'ALTER TABLE "Job" ADD COLUMN "skillsJson"',
      'ALTER TABLE "Job" ADD COLUMN "benefitsJson"',
      'ALTER TABLE "Job" ADD COLUMN "validThrough"',
    ],
    'SQLite migrations 创建 6 张新表并 additive 扩展 Job',
  )
  mustContain(
    pgMigration + pgQualityMigration,
    [
      'CREATE TABLE "JobAiSession"',
      'CREATE TABLE "JobAiRecommendation"',
      'CREATE TABLE "AiServiceLog"',
      'CREATE TABLE "UserAiConsent"',
      'CREATE TABLE "UserDataRequest"',
      'CREATE TABLE "JobDataQualitySnapshot"',
      'ALTER TABLE "Job" ADD COLUMN "skillsJson"',
      'ALTER TABLE "Job" ADD COLUMN "benefitsJson"',
      'ALTER TABLE "Job" ADD COLUMN "validThrough"',
    ],
    'PostgreSQL migrations 创建 6 张新表并 additive 扩展 Job',
  )

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 岗位信息 AI 契约 / Schema 门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 岗位信息 AI 契约 / Schema 门禁一致\n')
}

main()
