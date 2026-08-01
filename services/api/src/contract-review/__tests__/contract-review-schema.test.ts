import assert from 'node:assert/strict'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const apiRoot = resolve(__dirname, '../../..')
const migrationName = '20260801090000_add_contract_review_task'

const schemaPaths = [
  resolve(apiRoot, 'prisma/schema.prisma'),
  resolve(apiRoot, 'prisma/postgres/schema.prisma'),
]

const migrationPaths = [
  resolve(apiRoot, 'prisma/migrations', migrationName, 'migration.sql'),
  resolve(apiRoot, 'prisma/postgres/migrations', migrationName, 'migration.sql'),
]

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function modelBlock(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`))
  assert.ok(match, `${modelName} model must exist`)
  return match[1]
}

function compact(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}

function runPrisma(args: string[], env: NodeJS.ProcessEnv, input?: string): string {
  const result = spawnSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: apiRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input,
  })
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()

  if (result.error) {
    throw new Error(`Failed to start Prisma: ${result.error.message}\n${output}`)
  }
  if (result.status !== 0) {
    throw new Error(`Prisma exited with status ${result.status ?? 'unknown'}\n${output}`)
  }
  return output
}

function assertNoSchemaDrift(config: string, schema: string, env: NodeJS.ProcessEnv): void {
  const output = runPrisma(
    [
      'migrate',
      'diff',
      '--config',
      config,
      '--from-config-datasource',
      '--to-schema',
      schema,
      '--exit-code',
    ],
    env
  )
  assert.match(output, /(?:^|\n)No difference detected\.(?:\n|$)/)
}

test('both Prisma schemas define the complete ContractReviewTask aggregate', () => {
  const expectedLines = [
    'id String @id @default(cuid())',
    'endUserId String?',
    'endUser EndUser? @relation(fields: [endUserId], references: [id], onDelete: SetNull)',
    'accessTokenHash String?',
    'sourceFileId String',
    'resultFileId String?',
    'contractType String',
    'status String @default("uploaded")',
    'consentVersion String',
    'consentedAt DateTime',
    'consentScopeHash String',
    'disclaimerVersion String',
    'rulePackVersion String',
    'schemaVersion String',
    'ocrProvider String?',
    'ocrConfidence String?',
    'analyzedPages Int @default(0)',
    'totalPages Int?',
    'truncated Boolean @default(false)',
    'professionalConsultationRecommended Boolean @default(false)',
    'aiProvider String?',
    'aiModel String?',
    'resultJson String?',
    'errorCode String?',
    'errorMessage String?',
    'expiresAt DateTime',
    'createdAt DateTime @default(now())',
    'updatedAt DateTime @updatedAt',
    '@@index([endUserId, createdAt])',
    '@@index([accessTokenHash])',
    '@@index([status, updatedAt])',
    '@@index([expiresAt])',
    '@@index([sourceFileId])',
  ]

  for (const schemaPath of schemaPaths) {
    const schema = read(schemaPath)
    const taskLines = modelBlock(schema, 'ContractReviewTask')
      .split('\n')
      .map(compact)
      .filter(Boolean)

    assert.deepEqual(taskLines, expectedLines, `${schemaPath} ContractReviewTask shape must match`)

    const endUser = modelBlock(schema, 'EndUser')
    assert.match(
      endUser,
      /^\s*contractReviewTasks\s+ContractReviewTask\[\]\s*$/m,
      `${schemaPath} EndUser must expose contractReviewTasks`
    )
  }
})

test('both migrations add only ContractReviewTask, its EndUser foreign key, and five indexes', () => {
  const expectedIndexes = [
    'ContractReviewTask_endUserId_createdAt_idx',
    'ContractReviewTask_accessTokenHash_idx',
    'ContractReviewTask_status_updatedAt_idx',
    'ContractReviewTask_expiresAt_idx',
    'ContractReviewTask_sourceFileId_idx',
  ]

  for (const migrationPath of migrationPaths) {
    const migration = read(migrationPath)

    assert.match(migration, /CREATE TABLE "ContractReviewTask"/)
    assert.match(
      migration,
      /CONSTRAINT "ContractReviewTask_endUserId_fkey"[\s\S]*FOREIGN KEY \("endUserId"\)[\s\S]*REFERENCES "EndUser"\s*\("id"\)[\s\S]*ON DELETE SET NULL ON UPDATE CASCADE/
    )
    for (const indexName of expectedIndexes) {
      assert.match(migration, new RegExp(`CREATE INDEX "${indexName}"`))
    }

    assert.equal((migration.match(/\bCREATE TABLE\b/gi) ?? []).length, 1)
    assert.equal((migration.match(/\bCREATE INDEX\b/gi) ?? []).length, 5)
    assert.doesNotMatch(migration, /^\s*(?:DROP|ALTER|DELETE|UPDATE|TRUNCATE)\b/im)
  }
})

test('fresh SQLite migrations match the complete Prisma schema without drift', () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'contract-review-schema-'))
  const databasePath = join(tempDirectory, 'fresh.db')
  const env = { DATABASE_URL: `file:${databasePath}` }

  try {
    closeSync(openSync(databasePath, 'a'))
    runPrisma(['migrate', 'deploy', '--config', 'prisma.config.ts'], env)
    assertNoSchemaDrift('prisma.config.ts', 'prisma/schema.prisma', env)

    runPrisma(
      ['db', 'execute', '--config', 'prisma.config.ts', '--stdin'],
      env,
      'ALTER TABLE "ContractReviewTask" DROP COLUMN "resultJson";'
    )
    assert.throws(
      () => assertNoSchemaDrift('prisma.config.ts', 'prisma/schema.prisma', env),
      /Prisma exited with status 2[\s\S]*Added column `resultJson`/
    )
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
})

const postgresUrl = process.env.POSTGRES_URL

test(
  'migrated PostgreSQL database matches the generated PostgreSQL schema without drift',
  { skip: postgresUrl ? false : 'POSTGRES_URL is not configured; PostgreSQL drift check skipped' },
  () => {
    assert.match(postgresUrl!, /^postgres(?:ql)?:\/\//)
    assertNoSchemaDrift('prisma.postgres.config.ts', 'prisma/postgres/schema.prisma', {
      POSTGRES_URL: postgresUrl!,
    })
  }
)
